import {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { state, storageKeys, firebaseConfig } from "./state.js";
import { subscribeToAuth } from "./auth.js";
import { subscribeToPosts, stopPostSubscription } from "./posts.js";
import { stopGroupSubscription } from "./groups.js";
import { syncAuthUi, syncComposer } from "./ui.js";

// App Check: istekleri yalnızca gerçek uygulamadan gelen (reCAPTCHA v3 ile doğrulanmış)
// istemcilere açar. Site anahtarı yoksa sessizce atlanır.
let appCheckStarted = false;
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

export function connectToFirebase(rawConfig) {
  state.authResolved = false;
  try {
    const config = JSON.parse(rawConfig);
    if (!config.databaseURL || !config.apiKey || !config.projectId) {
      throw new Error("apiKey, projectId ve databaseURL alanları gerekli.");
    }

    stopPostSubscription();
    stopGroupSubscription();
    const appName = "masa-app";
    state.app = getApps().some((app) => app.name === appName)
      ? getApp(appName)
      : initializeApp(config, appName);
    initAppCheck(state.app);
    state.auth = getAuth(state.app);
    state.db = getDatabase(state.app);

    subscribeToAuth();
    subscribeToPosts();
  } catch (error) {
    state.auth = null;
    state.db = null;
    state.authUser = null;
    state.authResolved = true;
    console.warn("Firebase bağlantı hatası: " + error.message);
  }

  syncAuthUi();
  syncComposer();
}

export { storageKeys, firebaseConfig };
