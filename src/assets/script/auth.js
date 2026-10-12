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
	createUserWithEmailAndPassword,
	sendEmailVerification,
	reload,
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
import { renderGroups, subscribeToGroups, stopGroupSubscription } from "./groups.js";
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

// Giriş yapmış ama e-postası doğrulanmamış kullanıcı uygulamada "çıkış yapmış" sayılır:
// yalnızca doğrulama adımını görür. (Kurallar da doğrulanmamış hesaba yazma izni vermez.)
function enterVerifyStep(user) {
	stopUsersSubscription();
	stopGroupSubscription();
	state.groups = {};
	state.authUser = null;
	state.pendingUser = user;
	state.authEmail = user.email || "";
	state.authStep = "verify";
	state.profile = { name: "User", color: "#2563eb" };
	syncAuthMode();
	openAuthColumn();
	void sendVerificationOnce(user);
}

async function activateUser(user) {
	state.pendingUser = null;
	state.authStep = "form";
	state.authUser = user;
	try {
		// Önce profil: devre dışı hesaplar için masalar/kullanıcılar hiç dinlenmez.
		if ((await loadOrCreateProfile(user)) === "disabled") {
			state.authUser = null;
			state.authNotice = "Bu hesap devre dışı bırakılmıştır.";
			state.authStep = "form";
			openAuthColumn(); // giriş kolonu kapanmaz; hata mesajı orada görünür
			syncAuthMode();
			return;
		}
		state.authNotice = "";
		subscribeToUsers();
		// /groups yalnızca doğrulanmış, giriş yapmış kullanıcıya açık: oturum açılınca dinlenir.
		subscribeToGroups();
	} catch (error) {
		subscribeToUsers();
		subscribeToGroups();
		state.profile = {
			name: cleanName(
				user.displayName || user.email?.split("@")[0] || "User",
			),
			color: "#2563eb",
		};
		console.warn("Profil bilgisi alınamadı: " + error.message);
	}
	closeAuthColumn();
	syncAuthMode();
}

export function subscribeToAuth() {
	onAuthStateChanged(state.auth, async (user) => {
		state.authResolved = true;
		if (user && !user.emailVerified) {
			enterVerifyStep(user);
		} else if (user) {
			await activateUser(user);
		} else {
			stopUsersSubscription();
			stopGroupSubscription();
			state.groups = {};
			state.authUser = null;
			state.pendingUser = null;
			state.authStep = "form";
			state.profile = {
				name: "User",
				color: "#2563eb",
			};
			syncAuthMode();
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
		return "disabled";
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

// ---------- E-posta doğrulaması ----------
const RESEND_COOLDOWN = 60 * 1000;
let lastVerificationSentAt = 0;

// Aynı kullanıcıya sayfa yenilemelerinde sürekli e-posta gitmesin (10 dk içinde bir kez).
async function sendVerificationOnce(user) {
	const key = `masa.verifySent.${user.uid}`;
	try {
		const last = Number(sessionStorage.getItem(key) || 0);
		if (Date.now() - last < 10 * 60 * 1000) return;
		sessionStorage.setItem(key, String(Date.now()));
	} catch {}
	try {
		await sendEmailVerification(user);
		lastVerificationSentAt = Date.now();
	} catch (error) {
		console.error("Doğrulama e-postası gönderilemedi:", error);
		if (elements.authSentError) {
			elements.authSentError.textContent = error.code
				? authMessage(error.code)
				: "Doğrulama e-postası gönderilemedi.";
		}
	}
}

export async function resendVerification() {
	const user = state.pendingUser;
	if (!user) return;
	const errorEl = elements.authSentError;
	errorEl.textContent = "";
	const wait = Math.ceil((lastVerificationSentAt + RESEND_COOLDOWN - Date.now()) / 1000);
	if (wait > 0) {
		errorEl.textContent = `Yeni bağlantı için ${wait} saniye bekle.`;
		return;
	}
	elements.authResend.disabled = true;
	try {
		await sendEmailVerification(user);
		lastVerificationSentAt = Date.now();
		errorEl.textContent = "";
		elements.authResend.textContent = "Gönderildi";
		setTimeout(() => {
			elements.authResend.textContent = "Tekrar gönder";
		}, 3000);
	} catch (error) {
		console.error("Doğrulama e-postası gönderilemedi:", error);
		errorEl.textContent = error.code
			? authMessage(error.code)
			: "Doğrulama e-postası gönderilemedi.";
	} finally {
		elements.authResend.disabled = false;
	}
}

// "Doğruladım" düğmesi: kullanıcıyı yeniler; doğrulanmışsa oturumu uygulamaya açar.
export async function confirmVerified() {
	const user = state.pendingUser;
	if (!user) return;
	const errorEl = elements.authSentError;
	errorEl.textContent = "";
	elements.authVerified.disabled = true;
	try {
		await reload(user);
		if (!user.emailVerified) {
			errorEl.textContent =
				"E-postan henüz doğrulanmamış görünüyor. Bağlantıya tıkladığından emin ol.";
			return;
		}
		// Kuralların email_verified bilgisini görmesi için kimlik jetonu yenilenir.
		await user.getIdToken(true);
		await activateUser(user);
		syncAuthUi();
		renderPosts();
		renderGroups();
	} catch (error) {
		console.error("Doğrulama kontrol edilemedi:", error);
		errorEl.textContent = error.code
			? authMessage(error.code)
			: "Doğrulama kontrol edilemedi. Lütfen tekrar dene.";
	} finally {
		elements.authVerified.disabled = false;
	}
}

export async function cancelVerification() {
	state.pendingUser = null;
	state.authStep = "form";
	await logout();
	syncAuthMode();
}

export async function submitAuth() {
	if (!state.auth) {
		elements.authError.textContent = "Önce Firebase bağlantısı kurulmalı.";
		return;
	}

	state.authNotice = "";
	const isRegister = state.authMode === "register";
	const email = sanitizeEmail(elements.authEmail.value.trim());
	const password = elements.authPassword.value;
	const rawName = (elements.authName?.value || "").trim();

	if (!email || !isValidEmail(email)) {
		elements.authError.textContent = "Geçerli bir e-posta adresi gir.";
		return;
	}
	if (isRegister && !rawName) {
		elements.authError.textContent = "Kayıt olurken görünen ad gereklidir.";
		return;
	}
	const passwordProblem = validatePassword(password, { strict: isRegister });
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
		if (isRegister) {
			const credential = await createUserWithEmailAndPassword(
				state.auth,
				email,
				password,
			);
			// Seçilen ad hesapta saklanır; profil kaydı e-posta doğrulandıktan sonra oluşturulur.
			await updateProfile(credential.user, {
				displayName: cleanName(rawName),
			}).catch(() => {});
			// Doğrulama e-postası ve adım geçişi onAuthStateChanged içinde yapılır.
		} else {
			await signInWithEmailAndPassword(state.auth, email, password);
		}
		recordAuthAttempt(true);
	} catch (error) {
		recordAuthAttempt(false);
		console.error("Giriş/kayıt hatası:", error);
		elements.authError.textContent = error.code
			? authMessage(error.code)
			: error.message || "İşlem tamamlanamadı. Lütfen tekrar dene.";
	} finally {
		elements.submitAuth.disabled = false;
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
	state.authNotice = "";
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
