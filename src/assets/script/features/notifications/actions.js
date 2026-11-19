/** notifications feature'ı yazma action'ları: kullanıcı niyeti → repository. */
import { state } from "../../state.js";
import {
	writeNotification,
	updateNotification,
	markNotificationsRead,
	clearNotifications,
	removeNotification,
	timestamp,
} from "../../services/repositories/notifications.js";
import { TYPE_META, getNotificationList } from "./internal.js";

let warnedWrite = false;

export async function notify(targetUid, { type, postId = "", groupId = "", snippet = "" }, key) {
	const me = state.authUser?.uid;
	if (!me || !state.db || !targetUid || targetUid === me || !TYPE_META[type]) return;
	const id = key || `${type}_${me}_${postId || groupId}_${Date.now().toString(36)}`;
	const payload = { type, actorId: me, createdAt: timestamp(), read: false };
	if (postId) payload.postId = String(postId).slice(0, 128);
	if (groupId) payload.groupId = String(groupId).slice(0, 128);
	if (snippet) payload.snippet = String(snippet).slice(0, 120);
	try {
		await writeNotification(targetUid, id, payload);
	} catch (error) {
		// Bildirim bir yan etkidir; ana işlemi (beğeni/yorum) asla bozmaz.
		// Sabit anahtarlı (beğeni) bildirim zaten varsa kural yazmayı reddeder; bu beklenen bir durumdur.
		// Ancak tüm bildirimler reddediliyorsa kurallar yayınlanmamış olabilir: bir kez uyar.
		if (!warnedWrite) {
			warnedWrite = true;
			console.warn("Bildirim yazılamadı (firebase-rules.json yayınlandı mı?):", error?.message || error);
		}
	}
}

export async function markRead(id) {
	if (!state.authUser || !state.notifications?.[id] || state.notifications[id].read) return;
	await updateNotification(state.authUser.uid, id, { read: true }).catch(() => {});
}

export async function markAllRead() {
	if (!state.authUser) return;
	const ids = getNotificationList().filter((item) => !item.read).map((item) => item.id);
	await markNotificationsRead(state.authUser.uid, ids).catch(() => {});
}

export async function clearAll() {
	if (!state.authUser) return;
	const ids = getNotificationList().map((item) => item.id);
	await clearNotifications(state.authUser.uid, ids).catch(() => {});
}

export async function removeOne(id) {
	if (!state.authUser) return;
	await removeNotification(state.authUser.uid, id).catch(() => {});
}
