import { state, storageKeys } from "./state.js";
import { elements } from "./elements.js";
import {
	cleanName,
	sanitizeEmail,
	isValidEmail,
	authMessage,
	friendlyErrorMessage,
	validatePassword,
	usernameKey,
} from "./utils.js";
import {
	onAuthStateChanged,
	signInWithEmailAndPassword,
	signOut,
	updateProfile,
	updatePassword,
	sendSignInLinkToEmail,
	isSignInWithEmailLink,
	signInWithEmailLink,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
	get,
	ref,
	set,
	update,
	remove,
	serverTimestamp,
	query,
	orderByChild,
	equalTo,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { renderPosts, fetchOwnPostsWithPaths } from "./posts.js";
import { subscribeToUsers, stopUsersSubscription } from "./users.js";
import { renderGroups } from "./groups.js";
import {
	syncAuthUi,
	syncComposer,
	syncAuthMode,
	closeSettings,
	closeAuthColumn,
	openAuthColumn,
} from "./ui.js";

const authAttempts = {
	attempts: [],
	maxAttempts: 5,
	timeWindow: 15 * 60 * 1000,
};

function buildAnonymousProfile(deletedAt) {
	return {
		name: "Silinmiş kullanıcı",
		color: "#94a3b8",
		isDisabled: true,
		deletedAt,
	};
}

async function anonymizeUserContent(uid, anonymousProfile) {
	if (!state.db) return;

	const ownPosts = await fetchOwnPostsWithPaths(uid);

	for (const { path, post } of ownPosts) {
		if (post?.authorId === uid) {
			await update(ref(state.db, path), {
				authorName: anonymousProfile.name,
				authorColor: anonymousProfile.color,
				isAnonymous: true,
				deletedAt: anonymousProfile.deletedAt,
			});
		}

		const comments = post?.comments || {};
		for (const [commentId, comment] of Object.entries(comments)) {
			if (comment?.authorId === uid) {
				await update(ref(state.db, `${path}/comments/${commentId}`), {
					authorName: anonymousProfile.name,
					authorColor: anonymousProfile.color,
					isAnonymous: true,
					deletedAt: anonymousProfile.deletedAt,
				});
			}
		}
	}
}

export function subscribeToAuth() {
	void handleEmailLinkOnLoad();
	onAuthStateChanged(state.auth, async (user) => {
		state.authUser = user;
		state.authResolved = true;
		if (user) {
			subscribeToUsers();
			try {
				await loadOrCreateProfile(user);
			} catch (error) {
				state.profile = {
					name: cleanName(
						user.displayName || user.email?.split("@")[0] || "User",
					),
					color: "#2563eb",
				};
				console.warn("Profil bilgisi alınamadı: " + error.message);
			}
			closeAuthColumn();
		} else {
			stopUsersSubscription();
			state.authUser = null;
			state.profile = {
				name: "User",
				color: "#2563eb",
			};
		}
		syncAuthUi();
		renderPosts();
		renderGroups();
	});
}

export async function loadOrCreateProfile(user) {
	const userRef = ref(state.db, `users/${user.uid}`);
	const snapshot = await get(userRef);
	const profile = snapshot.val();

	if (profile?.isDisabled) {
		state.profile = {
			name: "Silinmiş kullanıcı",
			color: "#94a3b8",
		};
		await signOut(state.auth);
		state.authUser = null;
		return;
	}

	if (profile) {
		state.profile = {
			name: cleanName(profile.name || user.displayName || "User"),
			color: profile.color || "#2563eb",
		};
		void ensureUsernameClaim(user.uid, state.profile.name);
	} else {
		// Yeni hesap: kayıtta yazılan ad (varsa) kullanılır; ad alınmışsa sayı eklenir.
		const wantedName = cleanName(
			readPendingName() ||
				user.displayName ||
				user.email?.split("@")[0] ||
				"User",
		);
		const name = await reserveUsername(user.uid, wantedName);
		state.profile = { name, color: "#2563eb" };
		if (user.displayName !== name) {
			await updateProfile(user, { displayName: name }).catch(() => {});
		}
		await set(userRef, {
			...state.profile,
			createdAt: serverTimestamp(),
			isDisabled: false,
		});
		clearPendingName();
	}

	syncAuthUi();
	renderGroups();
}

// Kullanıcı adı rezervasyonu: usernames/<anahtar> = uid. Kurallar aynı adı ikinci kişiye vermez.
async function claimUsername(uid, name) {
	await set(ref(state.db, `usernames/${usernameKey(name)}`), uid);
}

async function releaseUsername(uid, name) {
	try {
		const nodeRef = ref(state.db, `usernames/${usernameKey(name)}`);
		if ((await get(nodeRef)).val() === uid) await remove(nodeRef);
	} catch (error) {
		console.warn("Kullanıcı adı serbest bırakılamadı: " + error.message);
	}
}

// Rezervasyonu olmayan eski hesaplar ilk girişte adını (boşsa) sahiplenir.
async function ensureUsernameClaim(uid, name) {
	try {
		const nodeRef = ref(state.db, `usernames/${usernameKey(name)}`);
		if (!(await get(nodeRef)).exists()) await set(nodeRef, uid);
	} catch (error) {
		console.warn("Kullanıcı adı rezerve edilemedi: " + error.message);
	}
}

async function isNameTaken(name, excludeUid) {
	if (!state.db) return false;
	const normalized = name.trim().toLowerCase();

	const usersQuery = query(
		ref(state.db, "users"),
		orderByChild("name"),
		equalTo(name),
	);
	let snapshot;
	try {
		snapshot = await get(usersQuery);
	} catch (error) {
		// Fallback for projects without indexOn "name" in RTDB rules.
		if (String(error?.message || "").includes("Index not defined")) {
			snapshot = await get(ref(state.db, "users"));
		} else {
			throw error;
		}
	}

	if (!snapshot.exists()) return false;

	const users = snapshot.val();
	return Object.entries(users).some(
		([uid, user]) =>
			uid !== excludeUid &&
			String(user?.name || "")
				.trim()
				.toLowerCase() === normalized,
	);
}

// ---------- E-posta bağlantısıyla giriş / kayıt (passwordless) ----------
const LINK_TTL = 6 * 60 * 60 * 1000;
const RESEND_COOLDOWN = 30 * 1000;
let lastLinkSentAt = 0;

function readJson(key) {
	try {
		return JSON.parse(localStorage.getItem(key) || "null");
	} catch {
		return null;
	}
}

function readPendingName() {
	const stored = readJson(storageKeys.pendingName);
	if (!stored || Date.now() - stored.ts > LINK_TTL) return "";
	return stored.name || "";
}

function clearPendingName() {
	try {
		localStorage.removeItem(storageKeys.pendingName);
	} catch {}
}

function emailLinkUrl() {
	// Bağlantı aynı sayfaya döner (GitHub Pages alt dizini dahil), arama/hash temizlenir.
	return window.location.href.split(/[?#]/)[0];
}

function setAuthStep(step) {
	state.authStep = step;
	syncAuthMode();
}

export async function submitAuth() {
	if (!state.auth) {
		elements.authError.textContent = "Önce Firebase bağlantısı kurulmalı.";
		return;
	}
	if (state.authStep === "complete") {
		await completeEmailLink(elements.authEmail.value);
		return;
	}
	if (state.authMode === "login" && state.authUsePassword) {
		await submitPasswordLogin();
		return;
	}
	await sendEmailLink({ fromForm: true });
}

export async function sendEmailLink({ fromForm = false } = {}) {
	const errorEl = fromForm ? elements.authError : elements.authSentError;
	const email = fromForm
		? sanitizeEmail(elements.authEmail.value.trim())
		: state.authEmail;
	const isRegister = state.authMode === "register";
	const name = fromForm
		? cleanName((elements.authName?.value || "").trim())
		: readPendingName();

	if (!email || !isValidEmail(email)) {
		errorEl.textContent = "Geçerli bir e-posta adresi gir.";
		return;
	}
	if (fromForm && isRegister && !(elements.authName?.value || "").trim()) {
		errorEl.textContent = "Kayıt olurken görünen ad gereklidir.";
		return;
	}
	const wait = Math.ceil((lastLinkSentAt + RESEND_COOLDOWN - Date.now()) / 1000);
	if (wait > 0) {
		errorEl.textContent = `Yeni bağlantı için ${wait} saniye bekle.`;
		return;
	}

	const button = fromForm ? elements.submitAuth : elements.authResend;
	if (button) button.disabled = true;
	try {
		await sendSignInLinkToEmail(state.auth, email, {
			url: emailLinkUrl(),
			handleCodeInApp: true,
		});
		lastLinkSentAt = Date.now();
		// Bağlantı başka sekmede/aynı tarayıcıda açılırsa e-postayı sormadan tamamlanır.
		localStorage.setItem(
			storageKeys.emailLink,
			JSON.stringify({ email, ts: Date.now() }),
		);
		if (fromForm && isRegister && name) {
			localStorage.setItem(
				storageKeys.pendingName,
				JSON.stringify({ name, ts: Date.now() }),
			);
		}
		state.authEmail = email;
		setAuthStep("sent");
	} catch (error) {
		console.error("E-posta bağlantısı gönderilemedi:", error);
		errorEl.textContent = error.code
			? authMessage(error.code)
			: "Bağlantı gönderilemedi. Lütfen tekrar dene.";
	} finally {
		if (button) button.disabled = false;
	}
}

export function backToAuthForm() {
	state.authStep = "form";
	if (elements.authEmail) elements.authEmail.value = state.authEmail || "";
	syncAuthMode();
}

// Sayfa e-postadaki bağlantıyla açıldıysa girişi tamamlar.
async function handleEmailLinkOnLoad() {
	if (!state.auth || !isSignInWithEmailLink(state.auth, window.location.href)) {
		return;
	}
	const stored = readJson(storageKeys.emailLink);
	const email =
		stored?.email && Date.now() - stored.ts <= LINK_TTL ? stored.email : "";

	openAuthColumn();
	if (email) {
		state.authEmail = email;
		await completeEmailLink(email);
	} else {
		// Bağlantı başka bir cihazda açıldı: güvenlik için e-posta yeniden istenir.
		setAuthStep("complete");
	}
}

async function completeEmailLink(rawEmail) {
	const email = sanitizeEmail(String(rawEmail || "").trim());
	if (!email || !isValidEmail(email)) {
		elements.authError.textContent = "Geçerli bir e-posta adresi gir.";
		return;
	}
	if (elements.submitAuth) elements.submitAuth.disabled = true;
	try {
		await signInWithEmailLink(state.auth, email, window.location.href);
		try {
			localStorage.removeItem(storageKeys.emailLink);
		} catch {}
		// oobCode adres çubuğunda kalmasın.
		history.replaceState(history.state, "", emailLinkUrl());
		state.authStep = "form";
		syncAuthMode();
	} catch (error) {
		console.error("E-posta bağlantısıyla giriş başarısız:", error);
		const dead = ["auth/invalid-action-code", "auth/expired-action-code"].includes(error.code);
		if (dead) {
			history.replaceState(history.state, "", emailLinkUrl());
			state.authStep = "form";
			syncAuthMode();
		}
		elements.authError.textContent = error.code
			? authMessage(error.code)
			: "Giriş tamamlanamadı. Lütfen tekrar dene.";
		if (dead) return;
	} finally {
		if (elements.submitAuth) elements.submitAuth.disabled = false;
	}
}

// Ad alınmışsa sonuna sayı ekleyerek rezerve eder (kullanıcı sonra Hesap'tan değiştirebilir).
async function reserveUsername(uid, baseName) {
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const candidate =
			attempt === 0
				? baseName
				: cleanName(`${baseName.slice(0, 40)}${Math.floor(1000 + Math.random() * 9000)}`);
		try {
			if (await isNameTaken(candidate, uid)) continue;
			await claimUsername(uid, candidate);
			return candidate;
		} catch {
			// rezerve edilmiş: sıradaki adayı dene
		}
	}
	throw new Error("Kullanıcı adı ayrılamadı.");
}

// Eski hesaplar için şifreyle giriş korunur.
async function submitPasswordLogin() {
	const email = sanitizeEmail(elements.authEmail.value.trim());
	const password = elements.authPassword.value;

	if (!email || !isValidEmail(email)) {
		elements.authError.textContent = "Geçerli bir e-posta adresi gir.";
		return;
	}

	const passwordProblem = validatePassword(password, { strict: false });
	if (passwordProblem) {
		elements.authError.textContent = passwordProblem;
		return;
	}

	if (isAuthRateLimited()) {
		const waitMin = getRateLimitWaitMinutes();
		elements.authError.textContent = `Çok fazla deneme yapıldı. ${waitMin} dakika sonra tekrar dene.`;
		return;
	}

	elements.submitAuth.disabled = true;

	try {
		const credential = await signInWithEmailAndPassword(
			state.auth,
			email,
			password,
		);
		const profileSnapshot = await get(
			ref(state.db, `users/${credential.user.uid}`),
		);
		const profile = profileSnapshot.val();
		if (profile?.isDisabled) {
			await signOut(state.auth);
			state.authUser = null;
			throw new Error("Bu hesap devre dışı bırakılmıştır.");
		}
		recordAuthAttempt(true);
	} catch (error) {
		recordAuthAttempt(false);
		console.error("Giriş hatası:", error);
		elements.authError.textContent = error.code
			? authMessage(error.code)
			: error.message || "İşlem tamamlanamadı. Lütfen tekrar dene.";
	} finally {
		elements.submitAuth.disabled = false;
	}
}

export async function saveSettingsAvatar() {
	const newColor = elements.settingsAvatarInput.value;
	state.profile.color = newColor;

	if (!state.authUser || !state.db) return;

	try {
		await update(ref(state.db, `users/${state.authUser.uid}`), {
			color: newColor,
			updatedAt: serverTimestamp(),
		});
	} catch (error) {
		console.warn("Profil guncellenemedi: " + error.message);
	}
}

export async function saveProfileSettings() {
	if (!state.authUser || !state.db) {
		console.warn("Giriş yapılmalıdır.");
		return;
	}

	const name = cleanName(
		elements.settingsNameInput?.value || state.profile.name,
	);
	const color = elements.settingsAvatarInput?.value || state.profile.color;

	if (
		name !== state.profile.name &&
		(await isNameTaken(name, state.authUser.uid))
	) {
		alert("Bu kullanıcı adı zaten alınmış, lütfen başka bir tane seç.");
		return;
	}

	const previousName = state.profile.name;
	const renamed = name !== previousName;
	try {
		if (renamed) {
			try {
				await claimUsername(state.authUser.uid, name);
			} catch {
				alert("Bu kullanıcı adı zaten alınmış, lütfen başka bir tane seç.");
				return;
			}
		}
		try {
			await update(ref(state.db, `users/${state.authUser.uid}`), {
				name,
				color,
				updatedAt: serverTimestamp(),
			});
		} catch (updateError) {
			if (renamed) await releaseUsername(state.authUser.uid, name);
			throw updateError;
		}
		if (renamed) await releaseUsername(state.authUser.uid, previousName);

		// Gönderi ve yorumlarda ad/renk saklanmaz; herkes güncel profili users/ altından okur.
		state.profile.name = name;
		state.profile.color = color;
		syncAuthUi();
		renderGroups();
	} catch (error) {
		console.warn("Profil güncellenemedi: " + error.message);
	}
}

export function setAuthMode(mode) {
	state.authMode = mode;
	state.authStep = "form";
	syncAuthMode();
}

export async function logout() {
	if (!state.auth) return;
	clearRememberMe();
	await signOut(state.auth);
}

export function saveRememberMe(email, remember) {
	if (remember) {
		localStorage.setItem(
			storageKeys.rememberMe,
			JSON.stringify({ email, timestamp: Date.now() }),
		);
	} else {
		clearRememberMe();
	}
}

export function clearRememberMe() {
	localStorage.removeItem(storageKeys.rememberMe);
}

export function getRememberedEmail() {
	const stored = localStorage.getItem(storageKeys.rememberMe);
	if (stored) {
		try {
			const data = JSON.parse(stored);
			return data.email;
		} catch (e) {
			clearRememberMe();
		}
	}
	return null;
}

export function openChangePasswordDialog() {
	if (!state.authUser) {
		console.warn("Giriş yapılmalıdır.");
		return;
	}

	const newPassword = prompt(
		"Yeni şifreyi gir (8+ karakter, büyük harf, küçük harf, rakam, sembol):",
	);
	if (!newPassword) return;

	const passwordProblem = validatePassword(newPassword);
	if (passwordProblem) {
		alert(passwordProblem);
		return;
	}

	updatePassword(state.authUser, newPassword)
		.then(() => {
			alert("Şifre başarıyla değiştirildi.");
		})
		.catch((error) => {
			console.warn("Şifre değiştirilemedi: " + error.message);
		});
}

export async function confirmDeleteAccount() {
	if (!state.authUser) {
		console.warn("Giriş yapılmalıdır.");
		return;
	}

	const confirmed = confirm(
		"Hesabınızı devre dışı bırakmak istediğinizden emin misiniz? Bu işlem hesabı anonimleştirir ve oturumu kapatır.",
	);

	if (!confirmed) return;

	const doubleConfirm = prompt(
		`Hesabınızı devre dışı bırakmak için "${state.authUser.email}" yazınız:`,
	);

	if (doubleConfirm !== state.authUser.email) {
		console.warn("Doğrulama başarısız. Hesap silinmedi.");
		return;
	}

	elements.deleteAccountButton.disabled = true;

	try {
		const deletedAt = serverTimestamp();
		const anonymousProfile = buildAnonymousProfile(deletedAt);

		// Önce içerik anonimleştirilir: hesap devre dışı kalınca (isDisabled) kurallar
		// kullanıcının kendi gönderilerine yazmasını zaten engeller.
		await anonymizeUserContent(state.authUser.uid, anonymousProfile);
		const previousName = state.profile.name;
		await update(
			ref(state.db, `users/${state.authUser.uid}`),
			anonymousProfile,
		);
		await releaseUsername(state.authUser.uid, previousName);

		state.profile = {
			name: anonymousProfile.name,
			color: anonymousProfile.color,
		};

		closeSettings();
		await signOut(state.auth);
		state.authUser = null;
	} catch (error) {
		console.warn("Hesap devre dışı bırakılamadı: " + error.message);
		elements.deleteAccountButton.disabled = false;
	}
}

function recordAuthAttempt(success) {
	const now = Date.now();
	authAttempts.attempts = authAttempts.attempts.filter(
		(timestamp) => now - timestamp < authAttempts.timeWindow,
	);

	if (!success) {
		authAttempts.attempts.push(now);
	}
}

function isAuthRateLimited() {
	const now = Date.now();
	const recentAttempts = authAttempts.attempts.filter(
		(timestamp) => now - timestamp < authAttempts.timeWindow,
	);
	return recentAttempts.length >= authAttempts.maxAttempts;
}

function getRateLimitWaitMinutes() {
	const now = Date.now();
	const oldest = [...authAttempts.attempts].sort()[0];
	if (!oldest) return 15;
	return Math.max(
		1,
		Math.ceil((oldest + authAttempts.timeWindow - now) / 60000),
	);
}

export { getRateLimitWaitMinutes };
