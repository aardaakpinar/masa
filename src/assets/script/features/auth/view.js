/** auth feature'ının DOM/UI yardımcıları. İş akışları actions.js'te, SDK repository'de. */
import { elements } from "../../elements.js";

export function setAuthError(message) {
	elements.authError.textContent = message;
}

/** Doğrulama adımındaki hata alanı (sendVerificationOnce null olabilir). */
export function setAuthSentErrorIfAvailable(message) {
	if (elements.authSentError) {
		elements.authSentError.textContent = message;
	}
}

export function clearAuthSentError() {
	elements.authSentError.textContent = "";
}

export function setAuthSentError(message) {
	elements.authSentError.textContent = message;
}

export function setAuthResendDisabled(disabled) {
	elements.authResend.disabled = disabled;
}

export function showAuthResendSuccess() {
	elements.authResend.textContent = "Gönderildi";
	setTimeout(() => {
		elements.authResend.textContent = "Tekrar gönder";
	}, 3000);
}

export function setAuthVerifiedDisabled(disabled) {
	elements.authVerified.disabled = disabled;
}

export function setSubmitAuthDisabled(disabled) {
	elements.submitAuth.disabled = disabled;
}

export function readAuthForm() {
	return {
		email: elements.authEmail.value.trim(),
		password: elements.authPassword.value,
		name: (elements.authName?.value || "").trim(),
	};
}

export function readAvatarColor() {
	return elements.settingsAvatarInput.value;
}

export function readSettingsForm() {
	return {
		name: elements.settingsNameInput?.value || "",
		color: elements.settingsAvatarInput?.value || "",
	};
}

export function askNewPassword() {
	return prompt(
		"Yeni şifreyi gir (8+ karakter, büyük harf, küçük harf, rakam, sembol):",
	);
}

export function confirmDeletionIntent() {
	return confirm(
		"Hesabınızı devre dışı bırakmak istediğinizden emin misiniz? Bu işlem hesabı anonimleştirir ve oturumu kapatır.",
	);
}

export function askDeletionEmail(email) {
	return prompt(`Hesabınızı devre dışı bırakmak için "${email}" yazınız:`);
}

export function setDeleteAccountDisabled(disabled) {
	elements.deleteAccountButton.disabled = disabled;
}

export function showAlert(message) {
	alert(message);
}
