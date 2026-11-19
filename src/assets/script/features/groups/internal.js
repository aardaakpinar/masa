/**
 * groups feature'ının feature-içi ortak durumu ve saf yardımcıları.
 * Dış feature'lar bu dosyayı import etmez; her şey index.js üzerinden geçer.
 */
import { state } from "../../state.js";
import { elements } from "../../elements.js";
import { initials, safeColor, getContrastColor } from "../../utils.js";
import { fetchUsers, readGroupLogo } from "../../services/repositories/groups.js";

export const groupsTabsElement = document.querySelector("#groupsTabs");

export const MAX_GROUP_LOGO_FILE_SIZE = 5 * 1024 * 1024;
export const MAX_GROUP_LOGO_DATA_URL_LENGTH = 350_000;
export const SAFE_GROUP_LOGO_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,/;

export function safeGroupLogo(value) {
	return typeof value === "string" && value.length <= MAX_GROUP_LOGO_DATA_URL_LENGTH && SAFE_GROUP_LOGO_DATA_URL.test(value) ? value : "";
}

export let groupFilter = "mine";
export function setGroupFilter(filter) {
	groupFilter = filter === "create" ? "create" : "mine";
}

export let isSubmittingGroup = false;
export function setSubmittingGroup(value) {
	isSubmittingGroup = value;
}

export let isSubmittingGroupEdit = false;
export function setSubmittingGroupEdit(value) {
	isSubmittingGroupEdit = value;
}

export let isGroupSettingsOpen = false;
export function setIsGroupSettingsOpen(value) {
	isGroupSettingsOpen = value;
}

export let groupLogoDataUrl = "";
export function setGroupLogoDataUrl(value) {
	groupLogoDataUrl = value;
}

export let groupEditLogoDataUrl = "";
export function setGroupEditLogoDataUrl(value) {
	groupEditLogoDataUrl = value;
}

// Logo masa kaydında değil group_logos/<masa> altında tutulur (masa listesi hafif kalır).
// Masa kaydında yalnızca logoRev (sürüm damgası) bulunur; logo ekrana gelince bir kez indirilir.
// Eski (gömülü) group.logo geçiş betiği çalışana kadar okunmaya devam eder.
const groupLogoCache = new Map(); // `${id}:${rev}` -> dataUrl | null
const groupLogoLoading = new Set();
let groupLogoRenderTimer = 0;

let groupLogoRefresh = () => {};
export function setGroupLogoRefresh(fn) {
	groupLogoRefresh = fn;
}

export function getGroupLogo(groupId, group) {
	if (!group) return "";
	if (group.logo) return safeGroupLogo(group.logo);
	if (!group.logoRev || !state.db) return "";
	const key = `${groupId}:${group.logoRev}`;
	if (groupLogoCache.has(key)) return groupLogoCache.get(key) || "";
	if (!groupLogoLoading.has(key)) {
		groupLogoLoading.add(key);
		readGroupLogo(groupId)
			.then((dataUrl) => safeGroupLogo(dataUrl))
			.catch(() => "")
			.then((dataUrl) => {
				groupLogoCache.set(key, dataUrl || null);
				groupLogoLoading.delete(key);
				// Birden çok logo art arda gelirse tek seferde yeniden çiz.
				clearTimeout(groupLogoRenderTimer);
				groupLogoRenderTimer = setTimeout(() => {
					groupLogoRefresh();
				}, 60);
			});
	}
	return "";
}

export function setGroupAvatarPreview(preview, name, color, logo = "") {
	if (!preview) return;
	const safeLogo = safeGroupLogo(logo);
	const safeAvatarColor = safeColor(color);
	preview.textContent = safeLogo ? "" : initials(name) || "M";
	preview.style.backgroundColor = safeAvatarColor;
	preview.style.color = getContrastColor(safeAvatarColor);
	preview.style.backgroundImage = safeLogo ? `url("${safeLogo}")` : "";
	preview.style.backgroundPosition = "center";
	preview.style.backgroundSize = "cover";
	preview.style.backgroundRepeat = "no-repeat";
}

export function resizeGroupLogo(file) {
	return new Promise((resolve, reject) => {
		if (!file || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
			reject(new Error("Logo için JPEG, PNG, WebP veya GIF görseli seç."));
			return;
		}
		if (file.size > MAX_GROUP_LOGO_FILE_SIZE) {
			reject(new Error("Logo görseli 5 MB'dan küçük olmalı."));
			return;
		}

		const reader = new FileReader();
		reader.onerror = () => reject(new Error("Logo görseli okunamadı."));
		reader.onload = () => {
			const image = new Image();
			image.onerror = () => reject(new Error("Logo görseli açılamadı."));
			image.onload = () => {
				const scale = Math.min(1, 512 / Math.max(image.width, image.height));
				const canvas = document.createElement("canvas");
				canvas.width = Math.max(1, Math.round(image.width * scale));
				canvas.height = Math.max(1, Math.round(image.height * scale));
				const context = canvas.getContext("2d");
				if (!context) {
					reject(new Error("Logo görseli işlenemedi."));
					return;
				}
				context.drawImage(image, 0, 0, canvas.width, canvas.height);
				const webp = canvas.toDataURL("image/webp", 0.78);
				let dataUrl = webp.startsWith("data:image/webp;") ? webp : "";
				if (!dataUrl) {
					context.fillStyle = "#ffffff";
					context.fillRect(0, 0, canvas.width, canvas.height);
					context.drawImage(image, 0, 0, canvas.width, canvas.height);
					dataUrl = canvas.toDataURL("image/jpeg", 0.78);
				}
				if (dataUrl.length > MAX_GROUP_LOGO_DATA_URL_LENGTH) {
					reject(new Error("Logo dosyası sıkıştırıldıktan sonra da çok büyük. Daha küçük bir görsel seç."));
					return;
				}
				resolve(dataUrl);
			};
			image.src = String(reader.result);
		};
		reader.readAsDataURL(file);
	});
}

export function updateLogoControls(editing, hasLogo) {
	const button = editing ? elements.groupDetailEditLogoButton : elements.groupLogoButton;
	const removeButton = editing ? elements.groupDetailEditLogoRemoveButton : elements.groupLogoRemoveButton;
	if (button) {
		button.title = hasLogo ? "Masa logosunu değiştir" : "Masa logosu ekle";
		button.setAttribute("aria-label", button.title);
	}
	if (removeButton) removeButton.hidden = !hasLogo;
}

export async function loadUsersProfiles() {
	if (!state.db) return;

	try {
		state.users = await fetchUsers();
	} catch (error) {
		console.error("Kullanıcı profilleri yüklenemedi:", error);
	}
}

export function getGroups() {
	return Object.entries(state.groups || {})
		.map(([id, group]) => ({ id, ...group }))
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function isApprovalGroup(group) {
	return group?.joinMode === "approval";
}

export function isMember(group) {
	return Boolean(state.authUser && group.members && group.members[state.authUser.uid]);
}

function isMine(group) {
	return Boolean(state.authUser && (group.ownerId === state.authUser.uid || isMember(group)));
}

export function filterGroups(groups) {
	if (groupFilter === "mine") return groups.filter(isMine);
	return groups;
}

export function resolveMemberProfile(member, uid) {
	const profile = uid ? state.users?.[uid] : null;
	const isCurrentUser = Boolean(state.authUser && state.authUser.uid === uid);

	return {
		name: profile?.name || member?.name || (isCurrentUser ? state.profile.name : "Anonim üye"),
		color: profile?.color || member?.color || (isCurrentUser ? state.profile.color : "#2563eb"),
	};
}

export function getMemberGroups() {
	return getGroups().filter(isMember);
}
