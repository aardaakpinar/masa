/**
 * Bildirim repository'si: Firebase yol bilgisi ve tüm okuma/yazma işlemleri
 * yalnızca burada. Feature modülleri SDK'yı doğrudan kullanmaz.
 *
 * Bildirimler: notifications/<alıcı uid>/<id>
 *   { type, actorId, postId?, groupId?, snippet?, createdAt, read }
 */
import {
	ref,
	set,
	update,
	remove,
	get,
	onValue,
	off,
	query,
	limitToLast,
	serverTimestamp,
} from "../firebase-sdk.js";
import { getState } from "../../shared/store/store.js";

const db = () => getState().db;

function target(path) {
	return ref(db(), path);
}

function notificationsPath(uid) {
	return `notifications/${uid}`;
}

function notificationPath(uid, id) {
	return `${notificationsPath(uid)}/${id}`;
}

export function watchNotifications(uid, { limit, onData, onError }) {
	const notificationsQuery = query(target(notificationsPath(uid)), limitToLast(limit));
	// onValue bir "dinlemeyi bırak" fonksiyonu döndürür; off() ile eşleşmez.
	const unsubscribe = onValue(
		notificationsQuery,
		(snapshot) => onData(snapshot.val() || {}),
		(error) => onError?.(error),
	);
	return { query: notificationsQuery, unsubscribe };
}

export function stopListener(listener) {
	// Modular SDK: onValue() döndüren unsubscribe fonksiyonu.
	if (typeof listener === "function") {
		listener();
		return;
	}
	// Eski ref/query değerleri için geriye uyumluluk.
	if (listener) off(listener);
}

export async function fetchNotification(uid, id) {
	const snapshot = await get(target(notificationPath(uid, id)));
	return snapshot.val() || null;
}

export async function fetchNotifications(uid, limit) {
	const q = query(target(notificationsPath(uid)), limitToLast(limit));
	const snapshot = await get(q);
	return snapshot.val() || {};
}

export function writeNotification(uid, id, payload) {
	return set(target(notificationPath(uid, id)), payload);
}

export function updateNotification(uid, id, patch) {
	return update(target(notificationPath(uid, id)), patch);
}

export function markNotificationsRead(uid, ids) {
	const updates = {};
	ids.forEach((id) => {
		updates[`${notificationPath(uid, id)}/read`] = true;
	});
	if (!Object.keys(updates).length) return Promise.resolve();
	return update(ref(db()), updates);
}

export function clearNotifications(uid, ids) {
	const updates = {};
	ids.forEach((id) => {
		updates[notificationPath(uid, id)] = null;
	});
	if (!Object.keys(updates).length) return Promise.resolve();
	return update(ref(db()), updates);
}

export function removeNotification(uid, id) {
	return remove(target(notificationPath(uid, id)));
}

export function timestamp() {
	return serverTimestamp();
}
