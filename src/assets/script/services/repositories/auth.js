/**
 * Kimlik repository'si: Firebase Auth/RTDB çağrıları, users/... ve usernames/...
 * yolları yalnızca burada. Feature modülleri SDK'yı doğrudan kullanmaz.
 */
import {
	onAuthStateChanged,
	signInWithEmailAndPassword,
	signOut,
	updateProfile,
	updatePassword,
	createUserWithEmailAndPassword,
	sendEmailVerification,
	reload,
	get,
	ref,
	set,
	update,
	remove,
	serverTimestamp,
	query,
	orderByChild,
	equalTo,
} from "../firebase-sdk.js";
import { getState } from "../../shared/store/store.js";
import { usernameKey } from "../../utils.js";

const db = () => getState().db;
const auth = () => getState().auth;

function target(path) {
	return ref(db(), path);
}

// ---- Auth ----

export function watchAuth(onChange) {
	return onAuthStateChanged(auth(), onChange);
}

/** Modular SDK dinleyicilerinin döndürdüğü unsubscribe fonksiyonunu kapatır. */
export function stopListener(unsubscribe) {
	if (typeof unsubscribe === "function") unsubscribe();
}

export function signIn(email, password) {
	return signInWithEmailAndPassword(auth(), email, password);
}

export function signUp(email, password) {
	return createUserWithEmailAndPassword(auth(), email, password);
}

export function signOutUser() {
	return signOut(auth());
}

export function updateUserDisplayName(user, name) {
	return updateProfile(user, { displayName: name });
}

export function sendVerification(user) {
	return sendEmailVerification(user);
}

export function reloadUser(user) {
	return reload(user);
}

export function applyPassword(user, newPassword) {
	return updatePassword(user, newPassword);
}

// ---- Profil ----

export async function fetchProfile(uid) {
	const snapshot = await get(target(`users/${uid}`));
	return snapshot.val();
}

export function writeProfile(uid, profile) {
	return set(target(`users/${uid}`), profile);
}

export function updateUserDoc(uid, patch) {
	return update(target(`users/${uid}`), patch);
}

export function updateAt(path, patch) {
	return update(target(path), patch);
}

export function timestamp() {
	return serverTimestamp();
}

// ---- Kullanıcı adı rezervasyonu ----

export function claimUsername(uid, name) {
	return set(target(`usernames/${usernameKey(name)}`), uid);
}

export async function releaseUsername(uid, name) {
	try {
		const nodeRef = target(`usernames/${usernameKey(name)}`);
		if ((await get(nodeRef)).val() === uid) await remove(nodeRef);
	} catch (error) {
		console.warn("Kullanıcı adı serbest bırakılamadı: " + error.message);
	}
}

export async function ensureUsernameClaim(uid, name) {
	try {
		const nodeRef = target(`usernames/${usernameKey(name)}`);
		if (!(await get(nodeRef)).exists()) await set(nodeRef, uid);
	} catch (error) {
		console.warn("Kullanıcı adı rezerve edilemedi: " + error.message);
	}
}

export async function isNameTaken(name, excludeUid) {
	if (!db()) return false;
	const normalized = name.trim().toLowerCase();

	const usersQuery = query(
		ref(db(), "users"),
		orderByChild("name"),
		equalTo(name),
	);
	let snapshot;
	try {
		snapshot = await get(usersQuery);
	} catch (error) {
		// indexOn "name" tanımlı olmayan projeler için fallback.
		if (String(error?.message || "").includes("Index not defined")) {
			snapshot = await get(ref(db(), "users"));
		} else {
			throw error;
		}
	}

	if (!snapshot.exists()) return false;

	const users = snapshot.val();
	return Object.entries(users).some(
		([uid, user]) =>
			uid !== excludeUid &&
			String(user?.name || "").trim().toLowerCase() === normalized,
	);
}
