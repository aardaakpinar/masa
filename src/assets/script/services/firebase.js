import {
  getApp,
  getApps,
  initializeApp,
  initializeAppCheck,
  ReCaptchaV3Provider,
  getAuth,
  getDatabase,
} from "./firebase-sdk.js";

// Saf altyapı katmanı: ne state'e yazar ne de feature modüllerini import eder.
// Abonelik kurulumu app/bootstrap.js içindedir.

const APP_NAME = "masa-app";
let appCheckStarted = false;

// App Check: istekleri yalnızca gerçek uygulamadan gelen (reCAPTCHA v3 ile doğrulanmış)
// istemcilere açar. Site anahtarı yoksa sessizce atlanır.
function initAppCheck(app) {
	const siteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
	if (!siteKey || appCheckStarted) return;
	try {
		if (["localhost", "127.0.0.1"].includes(window.location.hostname)) {
			// Yerelde konsola yazılan debug token ile çalışır.
			self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
		}
		initializeAppCheck(app, {
			provider: new ReCaptchaV3Provider(siteKey),
			isTokenAutoRefreshEnabled: true,
		});
		appCheckStarted = true;
	} catch (error) {
		console.warn("App Check başlatılamadı: " + error.message);
	}
}

/** Yapılandırma doğrulanır, SDK örnekleri oluşturulur ve döndürülür. */
export function initFirebase(config) {
	if (!config?.databaseURL || !config?.apiKey || !config?.projectId) {
		throw new Error("apiKey, projectId ve databaseURL alanları gerekli.");
	}

	const app = getApps().some((item) => item.name === APP_NAME)
		? getApp(APP_NAME)
		: initializeApp(config, APP_NAME);
	initAppCheck(app);

	return { app, auth: getAuth(app), db: getDatabase(app) };
}
