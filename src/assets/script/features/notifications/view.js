/** notifications feature'ının DOM/görünüm kodu. Yazma işlemleri actions üzerinden yapılır. */
import { state, feedColumnIds } from "../../state.js";
import { elements } from "../../elements.js";
import { resolveUserName } from "../../shared/store/selectors.js";
import { openFeedColumnById, openFeed, openAuth } from "../../ui.js";
import { initials, getContrastColor, safeColor, timeAgo } from "../../utils.js";
import { TYPE_META, getNotificationList, getUnreadCount, getLoadError } from "./internal.js";
import { markRead, markAllRead, clearAll, removeOne } from "./actions.js";

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
	if (getLoadError()) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = getLoadError();
		list.replaceChildren(empty);
		return;
	}
	if (!items.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state notification-empty";
		const text = document.createElement("p");
		text.textContent = "Henüz bildirim yok. Beğeniler, yorumlar ve masa istekleri burada görünür.";
		empty.append(text);
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
