/** auth feature'ı yazma action'ları: kullanıcı niyeti → repository. */
import { state, storageKeys } from "../../state.js";
import {
	cleanName,
	sanitizeEmail,
	isValidEmail,
	authMessage,
	validatePassword,
} from "../../utils.js";
import { renderPosts, fetchOwnPostsWithPaths } from "../../posts.js";
import { subscribeToUsers, stopUsersSubscription } from "../../users.js";
import { renderGroups, subscribeToGroups, stopGroupSubscription } from "../../groups.js";
import { startNotifications, stopNotifications } from "../../notifications.js";
import {
	syncAuthUi,
	syncAuthMode,
	closeSettings,
	closeAuthColumn,
	openAuthColumn,
} from "../../ui.js";
import {
	signIn,
	signUp,
	signOutUser,
	updateUserDisplayName,
	sendVerification,
	reloadUser,
	applyPassword,
	fetchProfile,
	writeProfile,
	updateUserDoc,
	updateAt,
	timestamp,
	claimUsername,
	releaseUsername,
	ensureUsernameClaim,
	isNameTaken,
} from "../../services/repositories/auth.js";
import {
	recordAuthAttempt,
	isAuthRateLimited,
	getRateLimitWaitMinutes,
	shouldSendVerificationOnce,
	markVerificationSent,
	getResendWaitSeconds,
	buildAnonymousProfile,
} from "./internal.js";
import {
	setAuthError,
	setAuthSentErrorIfAvailable,
	clearAuthSentError,
	setAuthSentError,
	setAuthResendDisabled,
	showAuthResendSuccess,
	setAuthVerifiedDisabled,
	setSubmitAuthDisabled,
	readAuthForm,
	readAvatarColor,
	readSettingsForm,
	askNewPassword,
	confirmDeletionIntent,
	askDeletionEmail,
	setDeleteAccountDisabled,
	showAlert,
} from "./view.js";

export async function loadOrCreateProfile(user) {
	const profile = await fetchProfile(user.uid);

	if (profile?.isDisabled) {
		state.profile = {
			name: "Silinmiş kullanıcı",
			color: "#94a3b8",
		};
		await signOutUser();
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
			await updateUserDisplayName(user, name).catch(() => {});
		}
		await writeProfile(user.uid, {
			...state.profile,
			createdAt: timestamp(),
			isDisabled: false,
		});
	}

	syncAuthUi();
	renderGroups();
}

// Kullanıcı adı rezervasyonu: usernames/<anahtar> = uid.
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

async function anonymizeUserContent(uid, anonymousProfile) {
	if (!state.db) return;

	const ownPosts = await fetchOwnPostsWithPaths(uid);

	for (const { path, post } of ownPosts) {
		if (post?.authorId === uid) {
			await updateAt(path, {
				authorName: anonymousProfile.name,
				authorColor: anonymousProfile.color,
				isAnonymous: true,
				deletedAt: anonymousProfile.deletedAt,
			});
		}

		const comments = post?.comments || {};
		for (const [commentId, comment] of Object.entries(comments)) {
			if (comment?.authorId === uid) {
				await updateAt(`${path}/comments/${commentId}`, {
					authorName: anonymousProfile.name,
					authorColor: anonymousProfile.color,
					isAnonymous: true,
					deletedAt: anonymousProfile.deletedAt,
				});
			}
		}
	}
}

// Giriş yapmış ama e-postası doğrulanmamış kullanıcı uygulamada "çıkış yapmış" sayılır.
export function enterVerifyStep(user) {
	stopUsersSubscription();
	stopGroupSubscription();
	stopNotifications();
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

export async function activateUser(user) {
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
		startNotifications();
	} catch (error) {
		subscribeToUsers();
		subscribeToGroups();
		startNotifications();
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

async function sendVerificationOnce(user) {
	if (!shouldSendVerificationOnce(user.uid)) return;
	try {
		await sendVerification(user);
		markVerificationSent();
	} catch (error) {
		console.error("Doğrulama e-postası gönderilemedi:", error);
		setAuthSentErrorIfAvailable(
			error.code
				? authMessage(error.code)
				: "Doğrulama e-postası gönderilemedi.",
		);
	}
}

export async function resendVerification() {
	const user = state.pendingUser;
	if (!user) return;
	clearAuthSentError();
	const wait = getResendWaitSeconds();
	if (wait > 0) {
		setAuthSentError(`Yeni bağlantı için ${wait} saniye bekle.`);
		return;
	}
	setAuthResendDisabled(true);
	try {
		await sendVerification(user);
		markVerificationSent();
		clearAuthSentError();
		showAuthResendSuccess();
	} catch (error) {
		console.error("Doğrulama e-postası gönderilemedi:", error);
		setAuthSentError(
			error.code
				? authMessage(error.code)
				: "Doğrulama e-postası gönderilemedi.",
		);
	} finally {
		setAuthResendDisabled(false);
	}
}

// "Doğruladım" düğmesi: kullanıcıyı yeniler; doğrulanmışsa oturumu uygulamaya açar.
export async function confirmVerified() {
	const user = state.pendingUser;
	if (!user) return;
	clearAuthSentError();
	setAuthVerifiedDisabled(true);
	try {
		await reloadUser(user);
		if (!user.emailVerified) {
			setAuthSentError(
				"E-postan henüz doğrulanmamış görünüyor. Bağlantıya tıkladığından emin ol.",
			);
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
		setAuthSentError(
			error.code
				? authMessage(error.code)
				: "Doğrulama kontrol edilemedi. Lütfen tekrar dene.",
		);
	} finally {
		setAuthVerifiedDisabled(false);
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
		setAuthError("Önce Firebase bağlantısı kurulmalı.");
		return;
	}

	state.authNotice = "";
	const isRegister = state.authMode === "register";
	const form = readAuthForm();
	const email = sanitizeEmail(form.email);
	const password = form.password;
	const rawName = form.name;

	if (!email || !isValidEmail(email)) {
		setAuthError("Geçerli bir e-posta adresi gir.");
		return;
	}
	if (isRegister && !rawName) {
		setAuthError("Kayıt olurken görünen ad gereklidir.");
		return;
	}
	const passwordProblem = validatePassword(password, { strict: isRegister });
	if (passwordProblem) {
		setAuthError(passwordProblem);
		return;
	}
	if (isAuthRateLimited()) {
		const waitMin = getRateLimitWaitMinutes();
		setAuthError(`Çok fazla deneme yapıldı. ${waitMin} dakika sonra tekrar dene.`);
		return;
	}

	setSubmitAuthDisabled(true);
	try {
		if (isRegister) {
			const credential = await signUp(email, password);
			// Seçilen ad hesapta saklanır; profil kaydı e-posta doğrulandıktan sonra oluşturulur.
			await updateUserDisplayName(credential.user, cleanName(rawName)).catch(() => {});
			// Doğrulama e-postası ve adım geçişi onAuthStateChanged içinde yapılır.
		} else {
			await signIn(email, password);
		}
		recordAuthAttempt(true);
	} catch (error) {
		recordAuthAttempt(false);
		console.error("Giriş/kayıt hatası:", error);
		setAuthError(
			error.code
				? authMessage(error.code)
				: error.message || "İşlem tamamlanamadı. Lütfen tekrar dene.",
		);
	} finally {
		setSubmitAuthDisabled(false);
	}
}

export async function saveSettingsAvatar() {
	const newColor = readAvatarColor();
	state.profile.color = newColor;

	if (!state.authUser || !state.db) return;

	try {
		await updateUserDoc(state.authUser.uid, {
			color: newColor,
			updatedAt: timestamp(),
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

	const form = readSettingsForm();
	const name = cleanName(form.name || state.profile.name);
	const color = form.color || state.profile.color;

	if (
		name !== state.profile.name &&
		(await isNameTaken(name, state.authUser.uid))
	) {
		showAlert("Bu kullanıcı adı zaten alınmış, lütfen başka bir tane seç.");
		return;
	}

	const previousName = state.profile.name;
	const renamed = name !== previousName;
	try {
		if (renamed) {
			try {
				await claimUsername(state.authUser.uid, name);
			} catch {
				showAlert("Bu kullanıcı adı zaten alınmış, lütfen başka bir tane seç.");
				return;
			}
		}
		try {
			await updateUserDoc(state.authUser.uid, {
				name,
				color,
				updatedAt: timestamp(),
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
	await signOutUser();
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

	const newPassword = askNewPassword();
	if (!newPassword) return;

	const passwordProblem = validatePassword(newPassword);
	if (passwordProblem) {
		showAlert(passwordProblem);
		return;
	}

	applyPassword(state.authUser, newPassword)
		.then(() => {
			showAlert("Şifre başarıyla değiştirildi.");
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

	if (!confirmDeletionIntent()) return;

	const doubleConfirm = askDeletionEmail(state.authUser.email);

	if (doubleConfirm !== state.authUser.email) {
		console.warn("Doğrulama başarısız. Hesap silinmedi.");
		return;
	}

	setDeleteAccountDisabled(true);

	try {
		const deletedAt = timestamp();
		const anonymousProfile = buildAnonymousProfile(deletedAt);

		// Önce içerik anonimleştirilir: hesap devre dışı kalınca (isDisabled) kurallar
		// kullanıcının kendi gönderilerine yazmasını zaten engeller.
		await anonymizeUserContent(state.authUser.uid, anonymousProfile);
		const previousName = state.profile.name;
		await updateUserDoc(state.authUser.uid, anonymousProfile);
		await releaseUsername(state.authUser.uid, previousName);

		state.profile = {
			name: anonymousProfile.name,
			color: anonymousProfile.color,
		};

		closeSettings();
		await signOutUser();
		state.authUser = null;
	} catch (error) {
		console.warn("Hesap devre dışı bırakılamadı: " + error.message);
		setDeleteAccountDisabled(false);
	}
}
