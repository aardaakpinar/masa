import {
  ref,
  onValue,
  off,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { state } from "./state.js";
import { safeColor } from "./utils.js";

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

// Bir gönderi/yorumun yazarı için güncel ad ve renk. Canlı profil yoksa (eski kayıt,
// henüz yüklenmedi) kayıtta saklı değerlere düşer.
export function resolveAuthor(item) {
  const uid = item?.authorId;
  const live = uid && uid === state.authUser?.uid ? state.profile : state.users?.[uid];
  const useLive = !item?.isAnonymous && live;
  return {
    name: (useLive && live.name) || item?.authorName || "Anonim",
    color: safeColor((useLive && live.color) || item?.authorColor),
  };
}

export function resolveUserName(uid, fallback) {
  const live = uid && uid === state.authUser?.uid ? state.profile : state.users?.[uid];
  return live?.name || fallback || "Anonim";
}
