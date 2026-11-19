/**
 * auth feature'ının genel API'si. Diğer modüller yalnızca bu dosyayı import eder;
 * feature içi dosyalar (view/actions/subscription/internal) dışarı açılmaz.
 */
export { getRateLimitWaitMinutes } from "./internal.js";
export { subscribeToAuth } from "./subscription.js";
export {
	loadOrCreateProfile,
	resendVerification,
	confirmVerified,
	cancelVerification,
	submitAuth,
	saveSettingsAvatar,
	saveProfileSettings,
	setAuthMode,
	logout,
	saveRememberMe,
	clearRememberMe,
	getRememberedEmail,
	openChangePasswordDialog,
	confirmDeleteAccount,
} from "./actions.js";
