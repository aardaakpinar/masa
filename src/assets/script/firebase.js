import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { state, storageKeys, firebaseConfig } from "./state.js";
import { subscribeToAuth } from "./auth.js";
import { subscribeToPosts, stopPostSubscription } from "./posts.js";
import { subscribeToGroups, stopGroupSubscription } from "./groups.js";
import { syncAuthUi, syncComposer } from "./ui.js";

export function connectToFirebase(rawConfig) {
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
    state.auth = getAuth(state.app);
    state.db = getDatabase(state.app);

    subscribeToAuth();
    subscribeToPosts();
    subscribeToGroups();
  } catch (error) {
    state.auth = null;
    state.db = null;
    state.authUser = null;
    console.warn("Firebase bağlantı hatası: " + error.message);
  }

  syncAuthUi();
  syncComposer();
}

export { storageKeys, firebaseConfig };
