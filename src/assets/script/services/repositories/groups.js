/**
 * Masa repository'si: Firebase yol bilgisi ve tüm yazma/okuma işlemleri
 * yalnızca burada. Feature modülleri SDK'yı doğrudan kullanmaz.
 */
import {
	ref,
	push,
	set,
	get,
	onValue,
	off,
	query,
	orderByChild,
	limitToLast,
	serverTimestamp,
	update,
	remove,
} from "../firebase-sdk.js";
import { getState } from "../../shared/store/store.js";

const db = () => getState().db;

function target(path) {
	return ref(db(), path);
}

// ---- Dinleyiciler ----

/** Masa listesi: createdAt'a göre son 100 masa. Sorguyu döndürür. */
export function watchGroups(onData, onError) {
	const groupsQuery = query(ref(db(), "groups"), orderByChild("createdAt"), limitToLast(100));
	const unsubscribe = onValue(groupsQuery, onData, onError);
	return { query: groupsQuery, unsubscribe };
}

/** Sahip olunan masanın tüm katılma istekleri: group_requests/<masa>. */
export function watchGroupRequests(groupId, onData, onError) {
	const requestRef = target(`group_requests/${groupId}`);
	const unsubscribe = onValue(requestRef, (snapshot) => onData(snapshot.val()), onError);
	return { ref: requestRef, unsubscribe };
}

/** Üye olunmayan onaylı masada yalnızca kendi isteğin: group_requests/<masa>/<uid>. */
export function watchMyJoinRequest(groupId, uid, onData, onError) {
	const requestRef = target(`group_requests/${groupId}/${uid}`);
	const unsubscribe = onValue(requestRef, (snapshot) => onData(snapshot.val()), onError);
	return { ref: requestRef, unsubscribe };
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

export async function fetchUsers() {
	const snapshot = await get(ref(db(), "users"));
	return snapshot.val() || {};
}

export async function readGroupLogo(groupId) {
	const snapshot = await get(target(`group_logos/${groupId}`));
	return snapshot.val()?.dataUrl || null;
}

// ---- Yazma ----

/** Yeni masayı oluşturur, varsa logosunu yazar; logo yazımı başarısızsa masayı geri alır. */
export async function createGroupRecord({ name, description, color, joinMode, ownerId, ownerName, logo }) {
	const groupRef = push(ref(db(), "groups"));
	const payload = {
		name,
		description,
		color,
		joinMode,
		ownerId,
		ownerName,
		createdAt: serverTimestamp(),
		members: {
			[ownerId]: { role: "owner", joinedAt: serverTimestamp() },
		},
		...(logo ? { logoRev: serverTimestamp() } : {}),
	};
	await set(groupRef, payload);

	if (logo) {
		try {
			await set(ref(db(), `group_logos/${groupRef.key}`), { dataUrl: logo });
		} catch (error) {
			await remove(ref(db(), `groups/${groupRef.key}`)).catch(() => {});
			throw error;
		}
	}
	return groupRef.key;
}

/** Masa alanlarını, logo sürümünü ve bekleyen istek temizliğini tek atomik yazmada günceller. */
export function updateGroupRecord(groupId, { name, description, color, joinMode, logoChanged, nextLogo, clearRequestUids }) {
	const updates = {
		[`groups/${groupId}/name`]: name,
		[`groups/${groupId}/description`]: description,
		[`groups/${groupId}/color`]: color,
		[`groups/${groupId}/joinMode`]: joinMode,
	};
	if (logoChanged) {
		updates[`groups/${groupId}/logo`] = null; // eski gömülü alanı temizle
		updates[`group_logos/${groupId}`] = nextLogo ? { dataUrl: nextLogo } : null;
		updates[`groups/${groupId}/logoRev`] = nextLogo ? serverTimestamp() : null;
	}
	if (clearRequestUids) {
		clearRequestUids.forEach((uid) => {
			updates[`group_requests/${groupId}/${uid}`] = null;
		});
	}
	return update(ref(db()), updates);
}

export function addGroupMember(groupId, uid) {
	return update(target(`groups/${groupId}/members/${uid}`), {
		role: "member",
		joinedAt: serverTimestamp(),
	});
}

export function approveJoinRequestRecord(groupId, uid) {
	// Üyelik ve isteğin silinmesi tek atomik yazmada.
	return update(ref(db()), {
		[`groups/${groupId}/members/${uid}`]: { role: "member", joinedAt: serverTimestamp() },
		[`group_requests/${groupId}/${uid}`]: null,
	});
}

export function setJoinRequest(groupId, uid) {
	return set(target(`group_requests/${groupId}/${uid}`), {
		requestedAt: serverTimestamp(),
	});
}

export function removeJoinRequest(groupId, uid) {
	return remove(target(`group_requests/${groupId}/${uid}`));
}

export function removeGroupMember(groupId, uid) {
	return remove(target(`groups/${groupId}/members/${uid}`));
}

export function deleteGroupRecord(groupId) {
	// Masa silinirken gönderileri de temizlenir (yetim veri kalmasın).
	return update(ref(db()), {
		[`groups/${groupId}`]: null,
		[`group_posts/${groupId}`]: null,
		[`group_post_media/${groupId}`]: null,
		[`group_post_comments/${groupId}`]: null,
		[`group_logos/${groupId}`]: null,
	});
}
