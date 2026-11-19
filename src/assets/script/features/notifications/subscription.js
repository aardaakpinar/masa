/** notifications feature'ının Firebase canlı aboneliği. Veriyi repository'den alır, store'a yazar. */
import { state } from "../../state.js";
import { watchNotifications, stopListener } from "../../services/repositories/notifications.js";
import { LIMIT, setLoadError } from "./internal.js";
import { renderNotifications } from "./view.js";

let notificationsRef = null;
let unsubscribe = null;
let ownerUid = null;

export function startNotifications() {
	const uid = state.authUser?.uid;
	if (!uid || !state.db || ownerUid === uid) return;
	stopNotifications();
	ownerUid = uid;
	setLoadError("");
	notificationsRef = null;
	const watched = watchNotifications(uid, {
		limit: LIMIT,
		onData: (notifications) => {
			setLoadError("");
			state.notifications = notifications;
			renderNotifications();
		},
		onError: (error) => {
			console.warn("Bildirimler okunamadı (firebase-rules.json yayınlandı mı?):", error?.message || error);
			setLoadError("Bildirimler yüklenemedi. Veritabanı kurallarının güncel olduğundan emin ol.");
			state.notifications = {};
			renderNotifications();
		},
	});
	notificationsRef = watched.query;
	unsubscribe = watched.unsubscribe;
}

export function stopNotifications() {
	stopListener(unsubscribe);
	unsubscribe = null;
	notificationsRef = null;
	setLoadError("");
	ownerUid = null;
	state.notifications = {};
	renderNotifications();
}
