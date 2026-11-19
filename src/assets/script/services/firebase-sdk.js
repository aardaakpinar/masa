/**
 * Firebase SDK tek giriş noktası.
 *
 * Kural: `firebasejs` CDN import'u yalnızca bu dosyada (services katmanında) bulunur.
 * Feature modülleri SDK'yı doğrudan değil, buradan import eder. Böylece SDK
 * sürümü/yolu tek yerde değişir ve altyapı ile iş kodu ayrışır.
 */

export {
  getApp,
  getApps,
  initializeApp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";

export {
  initializeAppCheck,
  ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app-check.js";

export {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  updatePassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  reload,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

export {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  off,
  serverTimestamp,
  increment,
  query,
  orderByKey,
  orderByChild,
  equalTo,
  limitToLast,
  endAt,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
