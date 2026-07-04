import { state, storageKeys } from "./state.js";
import { elements } from "./elements.js";
import {
	cleanName,
	sanitizeEmail,
	isValidEmail,
	authMessage,
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
import { renderPosts } from "./posts.js";
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

	const userPostsQuery = query(
		ref(state.db, "posts"),
		orderByChild("authorId"),
		equalTo(uid),
	);
	let postsSnapshot;
	try {
		postsSnapshot = await get(userPostsQuery);
	} catch (error) {
		if (String(error?.message || "").includes("Index not defined")) {
			postsSnapshot = await get(ref(state.db, "posts"));
		} else {
			throw error;
		}
	}

	if (!postsSnapshot.exists()) return;

	const userPosts = postsSnapshot.val();
	for (const [postId, post] of Object.entries(userPosts)) {
		if (post?.authorId === uid) {
			await update(ref(state.db, `posts/${postId}`), {
				authorName: anonymousProfile.name,
				authorColor: anonymousProfile.color,
				isAnonymous: true,
				deletedAt: anonymousProfile.deletedAt,
			});
		}

		const comments = post?.comments || {};
		for (const [commentId, comment] of Object.entries(comments)) {
			if (comment?.authorId === uid) {
				await update(
					ref(state.db, `posts/${postId}/comments/${commentId}`),
					{
						authorName: anonymousProfile.name,
						authorColor: anonymousProfile.color,
						isAnonymous: true,
						deletedAt: anonymousProfile.deletedAt,
					},
				);
			}
		}
	}
}

export function subscribeToAuth() {
	onAuthStateChanged(state.auth, async (user) => {
		state.authUser = user;
		if (user) {
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
		await set(ref(state.db, `users_private/${user.uid}`), {
			email: user.email,
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

	const passwordRegex =
		/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/;

	if (password.length < 8) {
		elements.authError.textContent = "Şifre en az 8 karakter olmalı.";
		return;
	}
	if (state.authMode === "register" && !passwordRegex.test(password)) {
		elements.authError.textContent =
			"Şifre büyük, küçük, sayı ve sembol içermeli.";
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
			await set(ref(state.db, `users_private/${credential.user.uid}`), {
				email,
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
		elements.authError.textContent =
			error.message || authMessage(error.code);
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

		// Keep historical posts/comments in sync with latest profile display.
		const userPostsQuery = query(
			ref(state.db, "posts"),
			orderByChild("authorId"),
			equalTo(state.authUser.uid),
		);
		let postsSnapshot;
		try {
			postsSnapshot = await get(userPostsQuery);
		} catch (error) {
			// Fallback for projects without indexOn authorId in RTDB rules.
			if (String(error?.message || "").includes("Index not defined")) {
				postsSnapshot = await get(ref(state.db, "posts"));
			} else {
				throw error;
			}
		}
		if (postsSnapshot.exists()) {
			const updates = {};
			const userPosts = postsSnapshot.val();
			for (const [postId, post] of Object.entries(userPosts)) {
				if (post?.authorId === state.authUser.uid) {
					updates[`posts/${postId}/authorName`] = name;
					updates[`posts/${postId}/authorColor`] = color;
				}

				const comments = post?.comments || {};
				for (const [commentId, comment] of Object.entries(comments)) {
					if (comment?.authorId === state.authUser.uid) {
						updates[
							`posts/${postId}/comments/${commentId}/authorName`
						] = name;
						updates[
							`posts/${postId}/comments/${commentId}/authorColor`
						] = color;
					}
				}
			}
			if (Object.keys(updates).length) {
				await update(ref(state.db), updates);
			}
		}

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
		"Yeni şifreyi gir (8+ karakter, büyük, küçük, sayı, sembol):",
	);
	if (!newPassword) return;

	const passwordRegex =
		/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/;

	if (newPassword.length < 8) {
		console.warn("Şifre en az 8 karakter olmalı.");
		return;
	}
	if (!passwordRegex.test(newPassword)) {
		console.warn("Şifre büyük, küçük, sayı ve sembol içermeli.");
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

		await update(
			ref(state.db, `users/${state.authUser.uid}`),
			anonymousProfile,
		);
		await set(ref(state.db, `users_private/${state.authUser.uid}`), {
			email: "deleted@anonymous.local",
		});
		await anonymizeUserContent(state.authUser.uid, anonymousProfile);

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
