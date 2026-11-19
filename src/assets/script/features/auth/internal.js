/**
 * auth feature'ının feature-içi ortak durumu, rate-limit yardımcıları ve saf
 * yardımcıları. SDK kullanılmaz; dış feature'lar bu dosyayı import etmez.
 */

export const RESEND_COOLDOWN = 60 * 1000;
const VERIFY_ONCE_WINDOW = 10 * 60 * 1000;

const authAttempts = {
	attempts: [],
	maxAttempts: 5,
	timeWindow: 15 * 60 * 1000,
};

let lastVerificationSentAt = 0;

export function recordAuthAttempt(success) {
	const now = Date.now();
	authAttempts.attempts = authAttempts.attempts.filter(
		(timestamp) => now - timestamp < authAttempts.timeWindow,
	);

	if (!success) {
		authAttempts.attempts.push(now);
	}
}

export function isAuthRateLimited() {
	const now = Date.now();
	const recentAttempts = authAttempts.attempts.filter(
		(timestamp) => now - timestamp < authAttempts.timeWindow,
	);
	return recentAttempts.length >= authAttempts.maxAttempts;
}

export function getRateLimitWaitMinutes() {
	const now = Date.now();
	const oldest = [...authAttempts.attempts].sort()[0];
	if (!oldest) return 15;
	return Math.max(
		1,
		Math.ceil((oldest + authAttempts.timeWindow - now) / 60000),
	);
}

// Aynı kullanıcıya sayfa yenilemelerinde sürekli e-posta gitmesin.
export function shouldSendVerificationOnce(uid) {
	const key = `masa.verifySent.${uid}`;
	try {
		const last = Number(sessionStorage.getItem(key) || 0);
		if (Date.now() - last < VERIFY_ONCE_WINDOW) return false;
		sessionStorage.setItem(key, String(Date.now()));
	} catch {}
	return true;
}

export function markVerificationSent() {
	lastVerificationSentAt = Date.now();
}

export function getResendWaitSeconds() {
	return Math.ceil((lastVerificationSentAt + RESEND_COOLDOWN - Date.now()) / 1000);
}

export function buildAnonymousProfile(deletedAt) {
	return {
		name: "Silinmiş kullanıcı",
		color: "#94a3b8",
		isDisabled: true,
		deletedAt,
	};
}
