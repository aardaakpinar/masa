import { ref, onValue, off } from "./services/firebase-sdk.js";
import { state } from "./state.js";

// Data erişimi artık shared/selectors içinde. Eski import yolları bozulmasın.
export { resolveAuthor, resolveUserName } from "./shared/store/selectors.js";

// Kullanıcı profilleri canlı dinlenir. İsim ve avatar rengi gönderi/yorumlara kopyalanmaz;
// her çizimde buradan okunur, böylece profil değişince herkesin ekranında kendiliğinden güncellenir.
let usersRef = null;
let notifyTimer = null;

function scheduleNotify() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => window.dispatchEvent(new Event("users:updated")), 30);
}

export function subscribeToUsers() {
  if (!state.db || usersRef) return;
  usersRef = ref(state.db, "users");
  onValue(
    usersRef,
    (snapshot) => {
      state.users = snapshot.val() || {};
      scheduleNotify();
    },
    (error) => console.warn("Kullanıcı profilleri dinlenemedi: " + error.message),
  );
}

export function stopUsersSubscription() {
  if (usersRef) off(usersRef);
  usersRef = null;
  state.users = {};
}

// resolveAuthor / resolveUserName shared/store/selectors.js'ten yeniden dışa verilir.
