/**
 * Gönderi repository'si: Firebase yol bilgisi ve tüm yazma/okuma işlemleri
 * yalnızca burada. Feature modülleri SDK'yı doğrudan kullanmaz.
 */
import {
	ref,
	push,
	set,
	update,
	remove,
	get,
	onValue,
	off,
	query,
	orderByKey,
	orderByChild,
	equalTo,
	limitToLast,
	endAt,
	serverTimestamp,
	increment,
} from "../firebase-sdk.js";
import { getState } from "../../shared/store/store.js";

const db = () => getState().db;

function target(path) {
	return ref(db(), path);
}

// ---- Dinleyiciler ----

/** Ana akışın canlı penceresi. Sorguyu döndürür (stopListener ile kapatılır). */
export function watchPublicPosts({ pageSize, onData, onError }) {
	const q = query(ref(db(), "posts"), orderByKey(), limitToLast(pageSize));
	const unsubscribe = onValue(q, (snapshot) => onData(snapshot.val() || {}), onError);
	return { query: q, unsubscribe };
}

/** Profil sayfası: bir kullanıcının son 30 herkese açık gönderisi. */
export function watchProfilePosts(uid, onData, onError) {
	const q = query(ref(db(), "posts"), orderByChild("authorId"), equalTo(uid), limitToLast(30));
	const unsubscribe = onValue(q, (snapshot) => onData(snapshot.val() || {}), onError);
	return { query: q, unsubscribe };
}

/** Üyesi olunan bir masanın gönderileri. */
export function watchGroupPosts(groupId, onData, onError, limit = 100) {
	const q = query(ref(db(), `group_posts/${groupId}`), orderByKey(), limitToLast(limit));
	const unsubscribe = onValue(q, (snapshot) => onData(snapshot.val() || {}), onError);
	return { query: q, unsubscribe };
}

export function watchComments(path, onData, onError) {
	const commentsRef = target(path);
	const unsubscribe = onValue(
		commentsRef,
		(snapshot) => onData(snapshot.val() || {}),
		() => onError?.(),
	);
	return { ref: commentsRef, unsubscribe };
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

// ---- Okuma ----

export async function fetchOlderPosts(beforeKey, limit) {
	const q = query(ref(db(), "posts"), orderByKey(), endAt(beforeKey), limitToLast(limit));
	const snapshot = await get(q);
	return snapshot.val() || {};
}

/** Kullanıcının kendi gönderileri: herkese açık + erişilebilir masalar. */
export async function fetchOwnPosts(uid, groupIds) {
	const results = [];

	let publicSnapshot;
	try {
		publicSnapshot = await get(query(ref(db(), "posts"), orderByChild("authorId"), equalTo(uid)));
	} catch (error) {
		if (!String(error?.message || "").includes("Index not defined")) throw error;
		publicSnapshot = await get(ref(db(), "posts"));
	}
	Object.entries(publicSnapshot.val() || {}).forEach(([id, post]) => {
		results.push({ path: `posts/${id}`, post });
	});

	for (const groupId of groupIds) {
		try {
			const snapshot = await get(
				query(ref(db(), `group_posts/${groupId}`), orderByChild("authorId"), equalTo(uid)),
			);
			Object.entries(snapshot.val() || {}).forEach(([id, post]) => {
				results.push({ path: `group_posts/${groupId}/${id}`, post });
			});
		} catch (error) {
			console.warn("Masa gönderileri okunamadı:", error?.message || error);
		}
	}
	return results;
}

export async function readMedia(path) {
	try {
		const snapshot = await get(target(path));
		return snapshot.val()?.dataUrl || null;
	} catch {
		return null;
	}
}

// ---- Yazma ----

export function writeAt(path, payload) {
	return set(target(path), payload);
}

export function removeAt(path) {
	return remove(target(path));
}

export function reservePostKey(groupId) {
	return push(ref(db(), groupId ? `group_posts/${groupId}` : "posts")).key;
}

export function nextCommentKey(path) {
	return push(target(path)).key;
}

export function changeCommentCount(path, delta) {
	return set(target(path), increment(delta)).catch((error) => {
		console.warn("Yorum sayacı güncellenemedi:", error);
	});
}

export function addLike(path, uid) {
	return update(target(path), { [uid]: true });
}

export function setLike(path, value) {
	return value ? set(target(path), true) : remove(target(path));
}

export function votePoll(path, optionKey) {
	return set(target(path), String(optionKey));
}

export function timestamp() {
	return serverTimestamp();
}
