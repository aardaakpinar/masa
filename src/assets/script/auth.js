import { state, storageKeys } from "./state.js";
import { elements } from "./elements.js";
import {
	cleanName,
	sanitizeEmail,
	isValidEmail,
	authMessage,
	friendlyErrorMessage,
	validatePassword,
} from "./utils.js";
import {
	onAuthStateChanged,
	createUserWithEmailAndPassword,
	signInWithEmailAndPassword,
	signOut,
	updateProfile,
	updatePassword,
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
import { syncAuthUi, syncComposer, syncAuthMode, closeSettings } from "./ui.js";

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
			if (elements.authDialog?.open) {
				elements.authDialog.close();
			}
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
	} else {
		state.profile = {
			name: cleanName(
				user.displayName || user.email?.split("@")[0] || "User",
			),
			color: "#2563eb",
		};
		await set(userRef, {
			...state.profile,
			createdAt: serverTimestamp(),
			isDisabled: false,
		});
	}

	syncAuthUi();
	renderGroups();
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

export async function submitAuth() {
	if (!state.auth) {
		elements.authError.textContent = "Önce Firebase bağlantısı kurulmalı.";
		return;
	}

	const email = sanitizeEmail(elements.authEmail.value.trim());
	const password = elements.authPassword.value;
	const name = cleanName(
		elements.authName.value.trim() || email.split("@")[0] || "User",
	);

	if (!email || !isValidEmail(email)) {
		elements.authError.textContent = "Geçerli bir e-posta adresi gir.";
		return;
	}

	const passwordProblem = validatePassword(password, {
		strict: state.authMode === "register",
	});
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
		if (state.authMode === "register") {
			if (!elements.authName.value.trim()) {
				throw new Error("Kayıt yaparken görünen ad gereklidir.");
			}
			if (await isNameTaken(name)) {
				elements.authError.textContent =
					"Bu kullanıcı adı zaten alınmış, lütfen başka bir tane seç.";
				elements.submitAuth.disabled = false;
				return;
			}
			const credential = await createUserWithEmailAndPassword(
				state.auth,
				email,
				password,
			);
			await updateProfile(credential.user, { displayName: name });
			await set(ref(state.db, `users/${credential.user.uid}`), {
				name,
				color: "#2563eb",
				createdAt: serverTimestamp(),
				isDisabled: false,
			});
		} else {
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
		}
		recordAuthAttempt(true);
	} catch (error) {
		recordAuthAttempt(false);
		console.error("Giriş/kayıt hatası:", error);
		// Firebase hataları (error.code) için hazır, kullanıcı dostu Türkçe metin kullan.
		// error.message'ı doğrudan göstermek İngilizce/teknik metin sızdırır; bunun tek
		// istisnası, kendi kodumuzun az önce fırlattığı ("Bu hesap devre dışı..." gibi)
		// zaten Türkçe ve kullanıcıya uygun mesajlardır (bunların error.code'u yoktur).
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

	try {
		await update(ref(state.db, `users/${state.authUser.uid}`), {
			name,
			color,
			updatedAt: serverTimestamp(),
		});

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
		await update(
			ref(state.db, `users/${state.authUser.uid}`),
			anonymousProfile,
		);

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
