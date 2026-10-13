import { ref, set, update, remove, onValue, query, limitToLast, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { state, feedColumnIds } from "./state.js";
import { elements } from "./elements.js";
import { resolveUserName } from "./users.js";
import { openFeedColumnById, openFeed, openAuth } from "./ui.js";
import { initials, getContrastColor, safeColor, timeAgo } from "./utils.js";

// Bildirimler: notifications/<alıcı uid>/<id>
//   { type, actorId, postId?, groupId?, snippet?, createdAt, read }
// Yalnızca alıcı okuyabilir; başkaları yalnızca (kendi adına, okunmamış) bildirim EKLEYEBİLİR.
const LIMIT = 50;
let notificationsRef = null;
let unsubscribe = null;
let loadError = "";
let warnedWrite = false;
let ownerUid = null;

const TYPE_META = {
	like: { icon: "heart", text: "gönderini beğendi" },
	comment: { icon: "message-circle", text: "gönderine yorum yaptı" },
	join_request: { icon: "user-plus", text: "masana katılmak istiyor" },
	join_approved: { icon: "check-circle", text: "masa katılma isteğini onayladı" },
};

export function getNotificationList() {
	return Object.entries(state.notifications || {})
		.map(([id, item]) => ({ id, ...item }))
		.filter((item) => TYPE_META[item.type])
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getUnreadCount() {
	return getNotificationList().filter((item) => !item.read).length;
}

// ---- Üretme ----
// Beğeni bildirimi sabit anahtar kullanır: beğen/geri al/beğen döngüsü bildirimi çoğaltmaz.
export async function notify(targetUid, { type, postId = "", groupId = "", snippet = "" }, key) {
	const me = state.authUser?.uid;
	if (!me || !state.db || !targetUid || targetUid === me || !TYPE_META[type]) return;
	const id = key || `${type}_${me}_${postId || groupId}_${Date.now().toString(36)}`;
	const payload = { type, actorId: me, createdAt: serverTimestamp(), read: false };
	if (postId) payload.postId = String(postId).slice(0, 128);
	if (groupId) payload.groupId = String(groupId).slice(0, 128);
	if (snippet) payload.snippet = String(snippet).slice(0, 120);
	try {
		await set(ref(state.db, `notifications/${targetUid}/${id}`), payload);
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

export function likeNotificationKey(postId) {
	return `like_${state.authUser?.uid}_${postId}`;
}

// ---- Dinleme ----
export function startNotifications() {
	const uid = state.authUser?.uid;
	if (!uid || !state.db || ownerUid === uid) return;
	stopNotifications();
	ownerUid = uid;
	loadError = "";
	notificationsRef = query(ref(state.db, `notifications/${uid}`), limitToLast(LIMIT));
	// onValue bir "dinlemeyi bırak" fonksiyonu döndürür; off() ile eşleşmez.
	unsubscribe = onValue(
		notificationsRef,
		(snapshot) => {
			loadError = "";
			state.notifications = snapshot.val() || {};
			renderNotifications();
		},
		(error) => {
			console.warn("Bildirimler okunamadı (firebase-rules.json yayınlandı mı?):", error?.message || error);
			loadError = "Bildirimler yüklenemedi. Veritabanı kurallarının güncel olduğundan emin ol.";
			state.notifications = {};
			renderNotifications();
		},
	);
}

export function stopNotifications() {
	if (typeof unsubscribe === "function") unsubscribe();
	unsubscribe = null;
	notificationsRef = null;
	loadError = "";
	ownerUid = null;
	state.notifications = {};
	renderNotifications();
}

// ---- Okundu / silme ----
export async function markRead(id) {
	if (!state.authUser || !state.notifications?.[id] || state.notifications[id].read) return;
	await update(ref(state.db, `notifications/${state.authUser.uid}/${id}`), { read: true }).catch(() => {});
}

export async function markAllRead() {
	if (!state.authUser) return;
	const updates = {};
	getNotificationList().forEach((item) => {
		if (!item.read) updates[`notifications/${state.authUser.uid}/${item.id}/read`] = true;
	});
	if (Object.keys(updates).length) await update(ref(state.db), updates).catch(() => {});
}

export async function clearAll() {
	if (!state.authUser) return;
	const updates = {};
	getNotificationList().forEach((item) => {
		updates[`notifications/${state.authUser.uid}/${item.id}`] = null;
	});
	if (Object.keys(updates).length) await update(ref(state.db), updates).catch(() => {});
}

async function removeOne(id) {
	if (!state.authUser) return;
	await remove(ref(state.db, `notifications/${state.authUser.uid}/${id}`)).catch(() => {});
}

// ---- Görünüm ----
function openTarget(item) {
	if (item.type === "join_request" || item.type === "join_approved") {
		if (item.groupId && item.type === "join_approved") {
			window.dispatchEvent(new CustomEvent("group-feed:open", { detail: { groupId: item.groupId } }));
		} else {
			window.dispatchEvent(new Event("groups:open"));
		}
		return;
	}
	if (item.groupId && state.groups?.[item.groupId]) {
		window.dispatchEvent(new CustomEvent("group-feed:open", { detail: { groupId: item.groupId } }));
	} else {
		openFeed();
	}
}

function createItem(item) {
	const meta = TYPE_META[item.type];
	const actorName = resolveUserName(item.actorId, "Birisi");
	const actor = state.users?.[item.actorId];
	const color = safeColor(actor?.color);

	const row = document.createElement("div");
	row.className = `notification${item.read ? "" : " notification--unread"}`;
	row.dataset.type = item.type;

	const main = document.createElement("button");
	main.type = "button";
	main.className = "notification__main";

	const avatarWrap = document.createElement("div");
	avatarWrap.className = "notification__avatar";
	const avatar = document.createElement("div");
	avatar.className = "avatar";
	avatar.textContent = initials(actorName);
	avatar.style.background = color;
	avatar.style.color = getContrastColor(color);
	const badge = document.createElement("span");
	badge.className = `notification__badge notification__badge--${item.type}`;
	const icon = document.createElement("span");
	icon.setAttribute("data-lucide", meta.icon);
	badge.append(icon);
	avatarWrap.append(avatar, badge);

	const body = document.createElement("div");
	body.className = "notification__body";
	const line = document.createElement("p");
	line.className = "notification__text";
	const strong = document.createElement("strong");
	strong.textContent = actorName;
	line.append(strong, ` ${meta.text}`);
	body.append(line);
	if (item.snippet) {
		const snippet = document.createElement("p");
		snippet.className = "notification__snippet";
		snippet.textContent = item.snippet;
		body.append(snippet);
	}
	const time = document.createElement("time");
	time.className = "notification__time";
	time.textContent = timeAgo(item.createdAt);
	body.append(time);

	main.append(avatarWrap, body);
	main.addEventListener("click", () => {
		void markRead(item.id);
		openTarget(item);
	});

	const dismiss = document.createElement("button");
	dismiss.type = "button";
	dismiss.className = "notification__dismiss";
	dismiss.setAttribute("aria-label", "Bildirimi sil");
	const x = document.createElement("span");
	x.setAttribute("data-lucide", "x");
	dismiss.append(x);
	dismiss.addEventListener("click", () => void removeOne(item.id));

	row.append(main, dismiss);
	return row;
}

export function renderNotifications() {
	const unread = getUnreadCount();
	document.querySelectorAll("[data-notification-badge]").forEach((badge) => {
		badge.textContent = unread > 99 ? "99+" : String(unread);
		badge.hidden = unread === 0;
	});
	elements.notificationsButton?.setAttribute("aria-label", unread ? `Bildirimler (${unread} yeni)` : "Bildirimler");

	const list = elements.notificationsList;
	if (!list) return;
	const items = getNotificationList();
	elements.notificationsReadAll && (elements.notificationsReadAll.disabled = unread === 0);
	elements.notificationsClear && (elements.notificationsClear.disabled = items.length === 0);

	if (!state.authUser) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = "Bildirimleri görmek için giriş yap.";
		list.replaceChildren(empty);
		return;
	}
	if (loadError) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = loadError;
		list.replaceChildren(empty);
		return;
	}
	if (!items.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state notification-empty";
		const icon = document.createElement("span");
		icon.setAttribute("data-lucide", "bell");
		const text = document.createElement("p");
		text.textContent = "Henüz bildirim yok. Beğeniler, yorumlar ve masa istekleri burada görünür.";
		empty.append(icon, text);
		list.replaceChildren(empty);
	} else {
		list.replaceChildren(...items.map(createItem));
	}
	window.lucide?.createIcons();
}

export function openNotifications() {
	if (!state.authUser) {
		openAuth();
		return;
	}
	openFeedColumnById(feedColumnIds.notifications);
}

export function setupNotifications() {
	elements.notificationsReadAll?.addEventListener("click", () => void markAllRead());
	elements.notificationsClear?.addEventListener("click", () => void clearAll());
	window.addEventListener("users:updated", renderNotifications);
	window.addEventListener("feed-columns:updated", () => {
		// Kolon açıkken görünen zamanlar da tazelensin.
		if (state.openFeedColumns.includes(feedColumnIds.notifications)) renderNotifications();
	});
	setInterval(() => {
		if (state.openFeedColumns.includes(feedColumnIds.notifications)) renderNotifications();
	}, 60000);
	renderNotifications();
}
