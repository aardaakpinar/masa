/**
 * notifications feature'ının feature-içi ortak durumu ve saf yardımcıları.
 * Dış feature'lar bu dosyayı import etmez; her şey index.js üzerinden geçer.
 */
import { state } from "../../state.js";

export const LIMIT = 50;

export const TYPE_META = {
	like: { icon: "heart", text: "gönderini beğendi" },
	comment: { icon: "message-circle", text: "gönderine yorum yaptı" },
	join_request: { icon: "user-plus", text: "masana katılmak istiyor" },
	join_approved: { icon: "check-circle", text: "masa katılma isteğini onayladı" },
};

let loadError = "";
export function getLoadError() {
	return loadError;
}
export function setLoadError(value) {
	loadError = value;
}

export function getNotificationList() {
	return Object.entries(state.notifications || {})
		.map(([id, item]) => ({ id, ...item }))
		.filter((item) => TYPE_META[item.type])
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getUnreadCount() {
	return getNotificationList().filter((item) => !item.read).length;
}

// Beğeni bildirimi sabit anahtar kullanır: beğen/geri al/beğen döngüsü bildirimi çoğaltmaz.
export function likeNotificationKey(postId) {
	return `like_${state.authUser?.uid}_${postId}`;
}
