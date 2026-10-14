import { feedColumnIds, profileUidFromColumnId, state } from "./state.js";
import { resolveUserName } from "./users.js";
import { elements } from "./elements.js";
import { initials, cleanName, getContrastColor, friendlyErrorMessage, safeColor } from "./utils.js";
import { openGroups } from "./ui.js";
import { notify } from "./notifications.js";
import { ref, push, set, get, onValue, off, query, orderByChild, limitToLast, serverTimestamp, update, remove } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

const groupsTabsElement = document.querySelector("#groupsTabs");
let groupFilter = "mine";
let isSubmittingGroup = false;
let isSubmittingGroupEdit = false;
let isGroupSettingsOpen = false;
let groupLogoDataUrl = "";
let groupEditLogoDataUrl = "";

const MAX_GROUP_LOGO_FILE_SIZE = 5 * 1024 * 1024;
const MAX_GROUP_LOGO_DATA_URL_LENGTH = 350_000;
const SAFE_GROUP_LOGO_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,/;

function safeGroupLogo(value) {
	return typeof value === "string" && value.length <= MAX_GROUP_LOGO_DATA_URL_LENGTH && SAFE_GROUP_LOGO_DATA_URL.test(value) ? value : "";
}

// Logo masa kaydında değil group_logos/<masa> altında tutulur (masa listesi hafif kalır).
// Masa kaydında yalnızca logoRev (sürüm damgası) bulunur; logo ekrana gelince bir kez indirilir.
// Eski (gömülü) group.logo geçiş betiği çalışana kadar okunmaya devam eder.
const groupLogoCache = new Map(); // `${id}:${rev}` -> dataUrl | null
const groupLogoLoading = new Set();
let groupLogoRenderTimer = 0;

function getGroupLogo(groupId, group) {
	if (!group) return "";
	if (group.logo) return safeGroupLogo(group.logo);
	if (!group.logoRev || !state.db) return "";
	const key = `${groupId}:${group.logoRev}`;
	if (groupLogoCache.has(key)) return groupLogoCache.get(key) || "";
	if (!groupLogoLoading.has(key)) {
		groupLogoLoading.add(key);
		get(ref(state.db, `group_logos/${groupId}`))
			.then((snapshot) => safeGroupLogo(snapshot.val()?.dataUrl))
			.catch(() => "")
			.then((dataUrl) => {
				groupLogoCache.set(key, dataUrl || null);
				groupLogoLoading.delete(key);
				// Birden çok logo art arda gelirse tek seferde yeniden çiz.
				clearTimeout(groupLogoRenderTimer);
				groupLogoRenderTimer = setTimeout(() => {
					renderGroups();
					if (state.activeGroupId) renderGroupDetail();
				}, 60);
			});
	}
	return "";
}

function setGroupAvatarPreview(preview, name, color, logo = "") {
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

function resizeGroupLogo(file) {
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

function updateLogoControls(editing, hasLogo) {
	const button = editing ? elements.groupDetailEditLogoButton : elements.groupLogoButton;
	const removeButton = editing ? elements.groupDetailEditLogoRemoveButton : elements.groupLogoRemoveButton;
	if (button) {
		button.title = hasLogo ? "Masa logosunu değiştir" : "Masa logosu ekle";
		button.setAttribute("aria-label", button.title);
	}
	if (removeButton) removeButton.hidden = !hasLogo;
}

export async function selectGroupLogo(file, editing = false) {
	const errorElement = editing ? elements.groupDetailEditError : elements.groupCreateError;
	try {
		const dataUrl = await resizeGroupLogo(file);
		if (editing) {
			groupEditLogoDataUrl = dataUrl;
			setGroupAvatarPreview(elements.groupDetailEditAvatarPreview, elements.groupDetailEditNameInput?.value, elements.groupDetailEditAvatarColorInput?.value, dataUrl);
		} else {
			groupLogoDataUrl = dataUrl;
			setGroupAvatarPreview(elements.groupAvatarPreview, elements.groupNameInput?.value, elements.groupAvatarColorInput?.value, dataUrl);
		}
		updateLogoControls(editing, true);
		if (errorElement) {
			errorElement.hidden = true;
			errorElement.textContent = "";
		}
	} catch (error) {
		console.error("Masa logosu yüklenemedi:", error);
		if (errorElement) {
			errorElement.hidden = false;
			errorElement.textContent = friendlyErrorMessage(error, "Masa logosu yüklenemedi.");
		}
	} finally {
		const input = editing ? elements.groupDetailEditLogoInput : elements.groupLogoInput;
		if (input) input.value = "";
	}
}

export function removeGroupLogo(editing = false) {
	if (editing) {
		groupEditLogoDataUrl = "";
		setGroupAvatarPreview(elements.groupDetailEditAvatarPreview, elements.groupDetailEditNameInput?.value, elements.groupDetailEditAvatarColorInput?.value);
		if (elements.groupDetailEditLogoInput) elements.groupDetailEditLogoInput.value = "";
	} else {
		groupLogoDataUrl = "";
		setGroupAvatarPreview(elements.groupAvatarPreview, elements.groupNameInput?.value, elements.groupAvatarColorInput?.value);
		if (elements.groupLogoInput) elements.groupLogoInput.value = "";
	}
	updateLogoControls(editing, false);
}

export function syncGroupAvatarColorPreview(color, editing = false) {
	if (editing) {
		setGroupAvatarPreview(elements.groupDetailEditAvatarPreview, elements.groupDetailEditNameInput?.value, color, groupEditLogoDataUrl);
	} else {
		setGroupAvatarPreview(elements.groupAvatarPreview, elements.groupNameInput?.value, color, groupLogoDataUrl);
	}
}

async function loadUsersProfiles() {
	if (!state.db) return;

	try {
		const snapshot = await get(ref(state.db, "users"));
		state.users = snapshot.val() || {};
	} catch (error) {
		console.error("Kullanıcı profilleri yüklenemedi:", error);
	}
}

function resolveMemberProfile(member, uid) {
	const profile = uid ? state.users?.[uid] : null;
	const isCurrentUser = Boolean(state.authUser && state.authUser.uid === uid);

	return {
		name: profile?.name || member?.name || (isCurrentUser ? state.profile.name : "Anonim üye"),
		color: profile?.color || member?.color || (isCurrentUser ? state.profile.color : "#2563eb"),
	};
}

export function subscribeToGroups() {
	if (!state.db) return;

	stopGroupSubscription();
	state.groups = {};
	state.groupsRef = query(ref(state.db, "groups"), orderByChild("createdAt"), limitToLast(100));

	onValue(
		state.groupsRef,
		(snapshot) => {
			state.groups = snapshot.val() || {};
			void loadUsersProfiles();
			renderGroups();
			if (state.activeGroupId) {
				renderGroupDetail();
			}
		},
		(error) => {
			// Giriş yapılmamış / devre dışı hesaplarda /groups okunamaz: beklenen durum, hata değil.
			if (/permission[_ ]denied/i.test(`${error?.code} ${error?.message}`)) {
				state.groups = {};
				renderGroups();
				return;
			}
			console.error("Masalar yüklenemedi:", error);
		},
	);
}

export function stopGroupSubscription() {
	if (state.db && state.groupsRef) {
		off(state.groupsRef);
	}
	state.groupsRef = null;
}

function getGroups() {
	return Object.entries(state.groups || {})
		.map(([id, group]) => ({ id, ...group }))
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function isApprovalGroup(group) {
	return group?.joinMode === "approval";
}

function isMember(group) {
	return Boolean(state.authUser && group.members && group.members[state.authUser.uid]);
}

export function createGroupCard(group, { compact = false } = {}) {
	const card = document.createElement("article");
	card.className = compact ? "group-card group-card--compact" : "group-card";

	const isOwnerViewer = Boolean(state.authUser && group.ownerId === state.authUser.uid);
	const canOpenDetail = isOwnerViewer || isMember(group);

	const head = document.createElement("button");
	head.type = "button";
	head.className = "group-card__head";
	if (!canOpenDetail) {
		head.classList.add("group-card__head--static");
	}
	head.addEventListener("click", () => {
		if (canOpenDetail) {
			window.dispatchEvent(new CustomEvent("group-feed:open", { detail: { groupId: group.id } }));
		}
	});

	const avatar = document.createElement("div");
	avatar.className = "avatar group-card__avatar";
	setGroupAvatarPreview(avatar, group.name, group.color, getGroupLogo(group.id, group));

	const content = document.createElement("span");
	content.className = "group-card__content";

	const title = document.createElement("h4");
	title.textContent = group.name || "Masa";

	const meta = document.createElement("span");
	meta.className = "group-card__meta";
	const memberCount = Object.keys(group.members || {}).length;
	meta.textContent = `${memberCount} üye · ${resolveUserName(group.ownerId, group.ownerName)} oluşturdu`;

	const description = document.createElement("p");
	description.className = "group-card__description";
	description.textContent = group.description || "Açıklama eklenmemiş.";

	const titleRow = document.createElement("span");
	titleRow.className = "group-card__title-row";

	const titleWrap = document.createElement("span");
	titleWrap.className = "group-card__title-wrap";

	const status = document.createElement("span");
	status.className = "group-card__status";

	const actions = document.createElement("div");
	actions.className = "group-card__actions";

	if (state.authUser) {
		const joined = isMember(group);
		const isOwner = isOwnerViewer;
		const approval = isApprovalGroup(group);
		const pending = Boolean(state.myJoinRequests?.[group.id]);
		const pendingCount = Object.keys(state.groupRequests?.[group.id] || {}).length;

		if (isOwner || joined) {
			status.textContent = isOwner && pendingCount ? `${pendingCount} yeni istek` : "üye";
		} else if (approval) {
			status.textContent = pending ? "istek bekliyor" : "onaylı";
		} else {
			status.textContent = "öneri";
		}

		if (!joined && !isOwner) {
			const idleLabel = approval ? (pending ? "İsteği geri çek" : "İstek gönder") : "Katıl";
			const busyLabel = approval ? (pending ? "Geri çekiliyor…" : "Gönderiliyor…") : "Katılınıyor…";
			const joinButton = document.createElement("button");
			joinButton.type = "button";
			joinButton.className = "button button--secondary group-action";
			joinButton.textContent = idleLabel;
			joinButton.addEventListener("click", async (event) => {
				event.stopPropagation();
				joinButton.disabled = true;
				joinButton.textContent = busyLabel;
				try {
					if (approval && pending) {
						await cancelJoinRequest(group.id);
					} else {
						await joinGroup(group.id);
					}
				} finally {
					joinButton.disabled = false;
					joinButton.textContent = idleLabel;
				}
			});
			actions.append(joinButton);
		}

		if (joined && !isOwner) {
			const leaveButton = document.createElement("button");
			leaveButton.type = "button";
			leaveButton.className = "button button--secondary group-action";
			leaveButton.textContent = "Gruptan Çık";
			leaveButton.addEventListener("click", async (event) => {
				event.stopPropagation();
				leaveButton.disabled = true;
				leaveButton.textContent = "Ayrılınıyor…";
				try {
					await leaveGroup(group.id);
				} finally {
					leaveButton.disabled = false;
					leaveButton.textContent = "Gruptan Çık";
				}
			});
			actions.append(leaveButton);
		}
	} else {
		status.textContent = "öneri";
	}

	const arrow = document.createElement("span");
	arrow.className = "group-card__arrow";
	arrow.setAttribute("aria-hidden", "true");
	arrow.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`;
	if (!canOpenDetail) {
		arrow.classList.add("hidden");
	}

	titleWrap.append(title);
	titleRow.append(titleWrap, status, arrow);

	content.append(titleRow, meta, description);
	if (actions.childNodes.length) {
		content.append(actions);
	}

	head.append(avatar, content);
	card.append(head);
	return card;
}

function renderInto(container, groups, emptyText) {
	if (!container) return;

	if (!groups.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state empty-state--compact";
		empty.textContent = emptyText;
		container.replaceChildren(empty);
		return;
	}

	container.replaceChildren(
		...groups.map((group) =>
			createGroupCard(group, {
				compact: container !== elements.groupsList,
			}),
		),
	);
}

const GROUP_EMPTY_TEXT = {
	mine: "Henüz hiçbir masaya üye değilsin. “Oluştur” sekmesinden ilk masanı aç.",
};

function isMine(group) {
	return Boolean(state.authUser && (group.ownerId === state.authUser.uid || isMember(group)));
}

function filterGroups(groups) {
	if (groupFilter === "mine") return groups.filter(isMine);
	return groups;
}

// Masalar ekranı iki sekmeli: "mine" (liste) ve "create" (yeni masa formu).
export function setGroupsTab(filter = "mine") {
	groupFilter = filter === "create" ? "create" : "mine";
	const isCreate = groupFilter === "create";

	// Kolon kapalıyken DOM'dan ayrıldığı için document yerine saklı referans kullanılır.
	groupsTabsElement?.querySelectorAll(".search-tab").forEach((button) => {
		const active = button.dataset.filter === groupFilter;
		button.classList.toggle("active", active);
		button.setAttribute("aria-selected", String(active));
	});

	if (elements.groupsList) elements.groupsList.hidden = isCreate;
	const formCard = elements.createGroupButton?.closest(".groups-form-card");
	if (formCard) formCard.hidden = !isCreate;

	if (!isCreate) {
		renderGroups();
	}
}

groupsTabsElement?.addEventListener("click", (event) => {
	const tab = event.target.closest(".search-tab");
	if (tab) setGroupsTab(tab.dataset.filter);
});

export function renderGroups() {
	// Masa gönderileri üyeliğe bağlı olarak dinlenir; posts.js bu olayı dinler.
	window.dispatchEvent(new Event("groups:updated"));
	const groups = getGroups();
	renderInto(elements.groupsList, filterGroups(groups), GROUP_EMPTY_TEXT[groupFilter]);
	updateGroupStats();
}

export function renderGroupDetail() {
	const groupId = state.activeGroupId;
	const group = groupId ? state.groups?.[groupId] : null;

	if (!group) {
		if (elements.groupDetailError) {
			elements.groupDetailError.hidden = false;
			elements.groupDetailError.textContent = "Bu masa artık mevcut değil.";
		}
		if (elements.groupDetailHeader) {
			elements.groupDetailHeader.hidden = true;
		}
		if (elements.groupDetailMembersList) {
			elements.groupDetailMembersList.replaceChildren();
		}
		closeGroupSettingsPanel();
		return;
	}

	const isOwner = Boolean(state.authUser && group.ownerId === state.authUser.uid);
	const isGroupMember = isMember(group);

	if (!isOwner && !isGroupMember) {
		// Sadece üyesi olduğun ya da sahibi olduğun masalara girebilirsin.
		state.activeGroupId = "";
		closeGroupSettingsPanel();
		openGroups();
		return;
	}

	if (elements.groupDetailError) {
		elements.groupDetailError.hidden = true;
	}
	if (elements.groupDetailHeader) {
		elements.groupDetailHeader.hidden = false;
	}

	if (elements.groupDetailAvatar) {
		setGroupAvatarPreview(elements.groupDetailAvatar, group.name, group.color, getGroupLogo(groupId, group));
	}
	if (elements.groupDetailTitle) {
		elements.groupDetailTitle.textContent = group.name || "Masa";
	}
	if (elements.groupDetailName) {
		elements.groupDetailName.textContent = group.name || "Masa";
	}
	if (elements.groupDetailDescription) {
		elements.groupDetailDescription.textContent = group.description || "Açıklama eklenmemiş.";
	}
	if (elements.groupDetailMeta) {
		const memberCount = Object.keys(group.members || {}).length;
		elements.groupDetailMeta.textContent = `${memberCount} üye · ${resolveUserName(group.ownerId, group.ownerName)} oluşturdu`;
	}

	if (elements.groupDetailOwnerActions) {
		elements.groupDetailOwnerActions.hidden = !isOwner;
	}
	if (!isOwner) {
		closeGroupSettingsPanel();
	} else if (isGroupSettingsOpen) {
		fillGroupEditForm(state.activeGroupId, group);
	}

	renderGroupDetailMembers();
	renderGroupRequests();
}

function fillGroupEditForm(groupId, group) {
	if (elements.groupDetailEditJoinModeSelect) {
		elements.groupDetailEditJoinModeSelect.value = group.joinMode === "approval" ? "approval" : "open";
	}

	if (elements.groupDetailEditNameInput) {
		elements.groupDetailEditNameInput.value = group.name || "";
	}

	if (elements.groupDetailEditDescriptionInput) {
		elements.groupDetailEditDescriptionInput.value = group.description || "";
	}

	if (elements.groupDetailEditAvatarColorInput) {
		elements.groupDetailEditAvatarColorInput.value = group.color || "#2563eb";
	}

	groupEditLogoDataUrl = getGroupLogo(groupId, group);

	if (elements.groupDetailEditAvatarPreview) {
		setGroupAvatarPreview(elements.groupDetailEditAvatarPreview, group.name, group.color, groupEditLogoDataUrl);
	}

	updateLogoControls(true, Boolean(groupEditLogoDataUrl));

	if (elements.groupDetailEditError) {
		elements.groupDetailEditError.hidden = true;
		elements.groupDetailEditError.textContent = "";
	}

	syncGroupEditFormCounts();
}

export function openGroupSettingsPanel() {
	const group = state.activeGroupId ? state.groups?.[state.activeGroupId] : null;
	if (!group || !state.authUser || group.ownerId !== state.authUser.uid) {
		return;
	}

	isGroupSettingsOpen = true;
	fillGroupEditForm(state.activeGroupId, group);
	renderGroupDetailMembers();
	syncSettingsButtonState();
}

function syncSettingsButtonState() {
	const button = elements.groupDetailSettingsButton;
	if (!button) return;
	button.setAttribute("aria-expanded", String(isGroupSettingsOpen));
	button.classList.toggle("active", isGroupSettingsOpen);
}

export function toggleGroupSettingsPanel() {
	if (isGroupSettingsOpen) {
		closeGroupSettingsPanel();
	} else {
		openGroupSettingsPanel();
	}
}

export function closeGroupSettingsPanel() {
	isGroupSettingsOpen = false;
	if (elements.groupDetailEditForm && elements.groupDetailSettingsPanel) {
		elements.groupDetailSettingsPanel.append(elements.groupDetailEditForm);
		delete elements.groupDetailEditForm.dataset.openGroupId;
	}
	// İstek ve üye listeleri de formla birlikte kolondan geri alınır.
	if (elements.groupDetailExtras && elements.groupDetailSettingsPanel) {
		elements.groupDetailSettingsPanel.append(elements.groupDetailExtras);
	}
	document.querySelectorAll(".feed-column__settings").forEach((slot) => {
		slot.hidden = true;
		slot.closest(".feed-column")?.classList.remove("feed-column--settings-open");
	});
	syncSettingsButtonState();
}

export function toggleColumnGroupSettings(groupId, slot) {
	if (isGroupSettingsOpen && state.activeGroupId === groupId) {
		closeGroupSettingsPanel();
		return;
	}
	closeGroupSettingsPanel();
	state.activeGroupId = groupId;
	const group = state.groups?.[groupId];
	if (!group || group.ownerId !== state.authUser?.uid || !slot) return;
	renderGroupDetail();
	openGroupSettingsPanel();
	elements.groupDetailEditForm.dataset.openGroupId = groupId;
	slot.append(elements.groupDetailEditForm);
	// Katılma istekleri ve üyeler: kolonda da sahibi onaylayıp çıkarabilsin.
	if (elements.groupDetailExtras) slot.append(elements.groupDetailExtras);
	renderGroupRequests();
	renderGroupDetailMembers();
	slot.hidden = false;
	slot.closest(".feed-column")?.classList.add("feed-column--settings-open");
}

export function syncGroupEditFormCounts() {
	if (elements.groupDetailEditNameCount) {
		elements.groupDetailEditNameCount.textContent = `${elements.groupDetailEditNameInput?.value.length || 0}/28`;
	}
	if (elements.groupDetailEditDescriptionCount) {
		elements.groupDetailEditDescriptionCount.textContent = `${elements.groupDetailEditDescriptionInput?.value.length || 0}/160`;
	}
	syncGroupAvatarColorPreview(elements.groupDetailEditAvatarColorInput?.value || "", true);
}

export async function updateGroup(groupId, { name, description, color, joinMode, logo }) {
	if (!state.authUser) {
		throw new Error("Masayı düzenlemek için giriş yapmalısın.");
	}
	if (!state.db) {
		throw new Error("Veritabanı bağlantısı kurulamadı.");
	}

	const group = state.groups?.[groupId];
	if (!group || group.ownerId !== state.authUser.uid) {
		throw new Error("Bu masayı düzenleme yetkin yok.");
	}

	const groupName = cleanName(name).slice(0, 28);
	const groupDescription = String(description || "")
		.trim()
		.slice(0, 160);
	const groupColor = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : group.color || "#2563eb";

	if (!groupName) {
		throw new Error("Masa adı gerekli.");
	}

	const mode = joinMode === "approval" ? "approval" : "open";
	const updates = {
		[`groups/${groupId}/name`]: groupName,
		[`groups/${groupId}/description`]: groupDescription,
		[`groups/${groupId}/color`]: groupColor,
		[`groups/${groupId}/joinMode`]: mode,
	};

	// Logo değişmediyse (aynı veri) dokunma; değiştiyse yeni sürüm damgası ver.
	const nextLogo = safeGroupLogo(logo);
	if (nextLogo !== getGroupLogo(groupId, group)) {
		updates[`groups/${groupId}/logo`] = null; // eski gömülü alanı temizle
		updates[`group_logos/${groupId}`] = nextLogo ? { dataUrl: nextLogo } : null;
		updates[`groups/${groupId}/logoRev`] = nextLogo ? serverTimestamp() : null;
	}

	// Masa herkese açık yapılınca bekleyen istekler anlamını yitirir; temizlenir.
	if (mode === "open") {
		Object.keys(state.groupRequests?.[groupId] || {}).forEach((uid) => {
			updates[`group_requests/${groupId}/${uid}`] = null;
		});
	}

	await update(ref(state.db), updates);
}

export async function submitGroupEditForm() {
	if (isSubmittingGroupEdit || !state.activeGroupId) return;

	isSubmittingGroupEdit = true;
	if (elements.groupDetailEditSaveButton) {
		elements.groupDetailEditSaveButton.disabled = true;
	}
	if (elements.groupDetailEditError) {
		elements.groupDetailEditError.hidden = true;
		elements.groupDetailEditError.textContent = "";
	}

	try {
		await updateGroup(state.activeGroupId, {
			name: elements.groupDetailEditNameInput?.value || "",
			description: elements.groupDetailEditDescriptionInput?.value || "",
			color: elements.groupDetailEditAvatarColorInput?.value || "",
			joinMode: elements.groupDetailEditJoinModeSelect?.value || "open",
			logo: groupEditLogoDataUrl,
		});
		closeGroupSettingsPanel();
	} catch (error) {
		console.error("Masa güncellenemedi:", error);
		if (elements.groupDetailEditError) {
			elements.groupDetailEditError.hidden = false;
			elements.groupDetailEditError.textContent = friendlyErrorMessage(error, "Masa güncellenemedi.");
		}
	} finally {
		isSubmittingGroupEdit = false;
		if (elements.groupDetailEditSaveButton) {
			elements.groupDetailEditSaveButton.disabled = false;
		}
	}
}

function pruneUnavailableFeedColumns() {
	const availableGroupIds = new Set(
		getGroups()
			.filter((group) => isMember(group) || group.ownerId === state.authUser?.uid)
			.map(({ id }) => id),
	);
	const fixedColumnIds = new Set(Object.values(feedColumnIds));
	const nextColumns = state.openFeedColumns.filter((id) => !id || fixedColumnIds.has(id) || profileUidFromColumnId(id) || availableGroupIds.has(id));
	if (nextColumns.length === state.openFeedColumns.length) return;
	state.openFeedColumns = nextColumns;
	window.dispatchEvent(new Event("feed-columns:updated"));
}

window.addEventListener("groups:updated", pruneUnavailableFeedColumns);

function updateGroupStats() {
	if (elements.groupCount) {
		elements.groupCount.textContent = String(getGroups().length);
	}
	if (elements.groupNameCount) {
		elements.groupNameCount.textContent = `${elements.groupNameInput?.value.length || 0}/28`;
	}
	if (elements.groupDescriptionCount) {
		elements.groupDescriptionCount.textContent = `${elements.groupDescriptionInput?.value.length || 0}/160`;
	}
	if (elements.groupAvatarPreview) {
		setGroupAvatarPreview(elements.groupAvatarPreview, elements.groupNameInput?.value, elements.groupAvatarColorInput?.value, groupLogoDataUrl);
	}
}

export async function createGroup({ name, description, color, joinMode, logo }) {
	if (!state.authUser) {
		throw new Error("Masa oluşturmak için giriş yapmalısın.");
	}
	if (!state.db) {
		throw new Error("Veritabanı bağlantısı kurulamadı.");
	}

	const groupName = cleanName(name).slice(0, 28);
	const groupDescription = String(description || "")
		.trim()
		.slice(0, 160);
	const groupColor = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : state.profile.color || "#2563eb";

	if (!groupName) {
		throw new Error("Masa adı gerekli.");
	}

	const groupRef = push(ref(state.db, "groups"));
	await set(groupRef, {
		name: groupName,
		description: groupDescription,
		color: groupColor,
		joinMode: joinMode === "approval" ? "approval" : "open",
		ownerId: state.authUser.uid,
		ownerName: state.profile.name,
		createdAt: serverTimestamp(),
		members: {
			[state.authUser.uid]: {
				role: "owner",
				joinedAt: serverTimestamp(),
			},
		},
		...(safeGroupLogo(logo) ? { logoRev: serverTimestamp() } : {}),
	});

	const createdLogo = safeGroupLogo(logo);
	if (createdLogo) {
		try {
			await set(ref(state.db, `group_logos/${groupRef.key}`), { dataUrl: createdLogo });
		} catch (error) {
			await remove(ref(state.db, `groups/${groupRef.key}`)).catch(() => {});
			throw error;
		}
	}

	return groupRef.key;
}

export async function joinGroup(groupId) {
	if (!state.authUser || !state.db) return;

	const group = state.groups?.[groupId];
	if (!group) return;
	if (group.members?.[state.authUser.uid]) return;

	if (isApprovalGroup(group)) {
		return requestToJoin(groupId);
	}

	try {
		await update(ref(state.db, `groups/${groupId}/members/${state.authUser.uid}`), {
			role: "member",
			joinedAt: serverTimestamp(),
		});
	} catch (error) {
		console.error("Topluluğa katılınamadı:", error);
		if (elements.groupError) {
			elements.groupError.textContent = "Topluluğa katılınamadı. " + friendlyErrorMessage(error, "Lütfen tekrar dene.");
		}
		throw error;
	}
}

// ---- Katılma istekleri (onaylı masalar) ----
// İstekler groups/ altında değil group_requests/ altında tutulur: groups herkese okunabilir,
// istek listesi ise yalnızca masa sahibine açıktır.
export async function requestToJoin(groupId) {
	if (!state.authUser || !state.db) return;
	try {
		await set(ref(state.db, `group_requests/${groupId}/${state.authUser.uid}`), {
			requestedAt: serverTimestamp(),
		});
		state.myJoinRequests[groupId] = true;
		renderGroups();
		notify(state.groups?.[groupId]?.ownerId, { type: "join_request", groupId, snippet: state.groups?.[groupId]?.name || "" });
	} catch (error) {
		console.error("Katılma isteği gönderilemedi:", error);
		if (elements.groupError) {
			elements.groupError.textContent = "İstek gönderilemedi. " + friendlyErrorMessage(error, "Lütfen tekrar dene.");
		}
		throw error;
	}
}

export async function cancelJoinRequest(groupId) {
	if (!state.authUser || !state.db) return;
	await remove(ref(state.db, `group_requests/${groupId}/${state.authUser.uid}`));
	delete state.myJoinRequests[groupId];
	renderGroups();
}

export async function approveJoinRequest(groupId, uid) {
	const group = state.groups?.[groupId];
	if (!state.authUser || !state.db || !group || group.ownerId !== state.authUser.uid) return;
	// Üyelik ve isteğin silinmesi tek atomik yazmada.
	await update(ref(state.db), {
		[`groups/${groupId}/members/${uid}`]: { role: "member", joinedAt: serverTimestamp() },
		[`group_requests/${groupId}/${uid}`]: null,
	});
	notify(uid, { type: "join_approved", groupId, snippet: group.name || "" });
}

export async function rejectJoinRequest(groupId, uid) {
	const group = state.groups?.[groupId];
	if (!state.authUser || !state.db || !group || group.ownerId !== state.authUser.uid) return;
	await remove(ref(state.db, `group_requests/${groupId}/${uid}`));
}

function createRequestRow(groupId, uid, request) {
	const row = document.createElement("div");
	row.className = "request-row";

	const avatar = document.createElement("div");
	avatar.className = "avatar request-row__avatar";
	const profile = state.users?.[uid];
	const name = resolveUserName(uid, "Anonim");
	avatar.textContent = initials(name);
	avatar.style.background = safeColor(profile?.color);
	avatar.style.color = getContrastColor(safeColor(profile?.color));

	const info = document.createElement("div");
	info.className = "request-row__info";
	const nameEl = document.createElement("span");
	nameEl.className = "request-row__name";
	nameEl.textContent = name;
	info.append(nameEl);
	if (request?.requestedAt) {
		const meta = document.createElement("span");
		meta.className = "request-row__meta";
		meta.textContent = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(request.requestedAt));
		info.append(meta);
	}

	const actions = document.createElement("div");
	actions.className = "request-row__actions";
	const handler = (button, label, fn) => async () => {
		actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
		button.textContent = label;
		try {
			await fn(groupId, uid);
		} catch (error) {
			console.error("İstek işlenemedi:", error);
			actions.querySelectorAll("button").forEach((b) => (b.disabled = false));
		}
	};

	const approve = document.createElement("button");
	approve.type = "button";
	approve.className = "button button--primary group-action";
	approve.textContent = "Onayla";
	approve.addEventListener("click", handler(approve, "Onaylanıyor…", approveJoinRequest));

	const reject = document.createElement("button");
	reject.type = "button";
	reject.className = "button button--secondary group-action";
	reject.textContent = "Reddet";
	reject.addEventListener("click", handler(reject, "Reddediliyor…", rejectJoinRequest));

	actions.append(approve, reject);
	row.append(avatar, info, actions);
	return row;
}

export function renderGroupRequests() {
	const list = elements.groupDetailRequestsList;
	const heading = elements.groupDetailRequestsHeading;
	if (!list || !heading) return;

	const groupId = state.activeGroupId;
	const group = groupId ? state.groups?.[groupId] : null;
	const isOwnerViewer = Boolean(group && state.authUser && group.ownerId === state.authUser.uid);
	const requests = Object.entries(state.groupRequests?.[groupId] || {}).sort((a, b) => (a[1]?.requestedAt || 0) - (b[1]?.requestedAt || 0));

	const visible = isOwnerViewer && requests.length > 0;
	heading.classList.toggle("hidden", !visible);
	list.classList.toggle("hidden", !visible);
	if (!visible) {
		list.replaceChildren();
		return;
	}

	heading.textContent = `Katılma istekleri (${requests.length})`;
	list.replaceChildren(...requests.map(([uid, request]) => createRequestRow(groupId, uid, request)));
}

// Onaylı masalar için istekler canlı dinlenir: sahibi olduğun masalarda tüm istekler,
// üye olmadığın onaylı masalarda yalnızca kendi isteğin.
function syncRefs(refs, wantedIds, makeRef, onData, onDrop) {
	Object.keys(refs).forEach((id) => {
		if (wantedIds.has(id)) return;
		off(refs[id]);
		delete refs[id];
		onDrop(id);
	});
	wantedIds.forEach((id) => {
		if (refs[id]) return;
		const r = makeRef(id);
		refs[id] = r;
		onValue(
			r,
			(snapshot) => {
				onData(id, snapshot.val());
				renderGroups();
				renderGroupRequests();
			},
			() => onData(id, null),
		);
	});
}

export function syncJoinRequestSubscriptions() {
	if (!state.db) return;
	const uid = state.authUser?.uid;
	const owned = new Set();
	const watching = new Set();

	if (uid) {
		Object.entries(state.groups || {}).forEach(([id, group]) => {
			if (!isApprovalGroup(group)) return;
			if (group.ownerId === uid) owned.add(id);
			else if (!group.members?.[uid]) watching.add(id);
		});
	}

	syncRefs(
		state.groupRequestRefs,
		owned,
		(id) => ref(state.db, `group_requests/${id}`),
		(id, value) => {
			state.groupRequests[id] = value || {};
		},
		(id) => {
			delete state.groupRequests[id];
		},
	);
	syncRefs(
		state.myJoinRequestRefs,
		watching,
		(id) => ref(state.db, `group_requests/${id}/${uid}`),
		(id, value) => {
			state.myJoinRequests[id] = Boolean(value);
		},
		(id) => {
			delete state.myJoinRequests[id];
		},
	);
}

window.addEventListener("groups:updated", syncJoinRequestSubscriptions);

export async function leaveGroup(groupId) {
	if (!state.authUser || !state.db) return;

	const group = state.groups?.[groupId];
	if (!group) return;
	if (group.ownerId === state.authUser.uid) return;
	if (!group.members?.[state.authUser.uid]) return;

	const confirmed = confirm(`"${group.name}" grubundan çıkmak istediğine emin misin?`);
	if (!confirmed) return;

	try {
		await remove(ref(state.db, `groups/${groupId}/members/${state.authUser.uid}`));
	} catch (error) {
		console.error("Gruptan çıkılamadı:", error);
		if (elements.groupError) {
			elements.groupError.textContent = "Gruptan çıkılamadı. " + friendlyErrorMessage(error, "Lütfen tekrar dene.");
		}
		throw error;
	}
}

export async function deleteGroup(groupId) {
	if (!state.authUser || !state.db) return;
	const group = state.groups?.[groupId];
	if (!group || group.ownerId !== state.authUser.uid) return;

	const confirmed = confirm(`"${group.name}" topluluğunu silmek istediğine emin misin?`);
	if (!confirmed) return;

	// Masa silinirken gönderileri de temizlenir (yetim veri kalmasın).
	await update(ref(state.db), {
		[`groups/${groupId}`]: null,
		[`group_posts/${groupId}`]: null,
		[`group_post_media/${groupId}`]: null,
		[`group_post_comments/${groupId}`]: null,
		[`group_logos/${groupId}`]: null,
	});
	if (state.activeGroupId === groupId) {
		state.activeGroupId = "";
		closeGroupSettingsPanel();
		openGroups();
	}
}

export async function removeMember(groupId, uid) {
	if (!state.authUser || !state.db) return;

	const group = state.groups?.[groupId];
	if (!group || group.ownerId !== state.authUser.uid) return;
	if (uid === group.ownerId) return;

	const member = group.members?.[uid];
	const confirmed = confirm(`"${member?.name || "Bu üyeyi"}" masadan çıkarmak istediğine emin misin?`);
	if (!confirmed) return;

	try {
		await remove(ref(state.db, `groups/${groupId}/members/${uid}`));
		if (state.activeGroupId === groupId) {
			renderGroupDetail();
		}
		renderGroups();
	} catch (error) {
		console.error("Üye çıkarılamadı:", error);
		throw error;
	}
}

function createMemberRow(group, groupId, member, isOwnerViewer) {
	const row = document.createElement("div");
	row.className = "member-row";
	const activeGroupId = group?.id || groupId;

	const memberProfile = resolveMemberProfile(member, member.uid);
	const avatar = document.createElement("div");
	avatar.className = "avatar member-row__avatar";
	const color = memberProfile.color;
	avatar.style.background = safeColor(color);
	avatar.style.color = getContrastColor(safeColor(color));
	avatar.textContent = initials(memberProfile.name || "Üye");

	const info = document.createElement("div");
	info.className = "member-row__info";

	const name = document.createElement("span");
	name.className = "member-row__name";
	name.textContent = memberProfile.name || "Anonim üye";

	const roleBadge = document.createElement("span");
	roleBadge.className = "member-row__role";
	roleBadge.textContent = member.role === "owner" ? "Yönetici" : "Üye";

	info.append(name, roleBadge);
	row.append(avatar, info);

	if (isOwnerViewer && member.role !== "owner") {
		const removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.className = "button button--danger group-action member-row__remove";
		removeButton.textContent = "Çıkar";
		removeButton.addEventListener("click", async (event) => {
			event.preventDefault();
			event.stopPropagation();
			removeButton.disabled = true;
			try {
				await removeMember(activeGroupId, member.uid);
			} catch (error) {
				console.error("Üye çıkarılamadı:", error);
				if (elements.groupError) {
					elements.groupError.textContent = "Üye çıkarılamadı. " + friendlyErrorMessage(error, "Lütfen tekrar dene.");
				}
			} finally {
				removeButton.disabled = false;
			}
		});
		row.append(removeButton);
	}

	return row;
}

export function renderGroupDetailMembers() {
	if (!elements.groupDetailMembersList) return;

	const groupId = state.activeGroupId;
	const group = groupId ? state.groups?.[groupId] : null;

	if (!group) {
		elements.groupDetailMembersList.replaceChildren();
		return;
	}

	const isOwnerViewer = Boolean(state.authUser && group.ownerId === state.authUser.uid);

	if (!state.users || Object.keys(state.users).length === 0) {
		void loadUsersProfiles();
	}

	const members = Object.entries(group.members || {})
		.map(([uid, member]) => ({ uid, ...member }))
		.sort((a, b) => {
			if (a.role === "owner") return -1;
			if (b.role === "owner") return 1;
			return (a.joinedAt || 0) - (b.joinedAt || 0);
		});

	if (!members.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = "Bu masada henüz üye yok.";
		elements.groupDetailMembersList.replaceChildren(empty);
		return;
	}

	elements.groupDetailMembersList.replaceChildren(...members.map((member) => createMemberRow(group, groupId, member, isOwnerViewer)));
}

export function canViewGroup(groupId) {
	if (!groupId) return true;
	const group = state.groups?.[groupId];
	if (!group) return false;
	if (!state.authUser) return false;
	return Boolean(group.members?.[state.authUser.uid] || group.ownerId === state.authUser.uid);
}

export function getGroupName(groupId) {
	return state.groups?.[groupId]?.name || "Masa";
}

export function getMemberGroups() {
	return getGroups().filter(isMember);
}

export async function submitGroupForm() {
	if (isSubmittingGroup) return;

	isSubmittingGroup = true;
	if (elements.createGroupButton) {
		elements.createGroupButton.disabled = true;
	}
	if (elements.groupCreateError) {
		elements.groupCreateError.hidden = true;
		elements.groupCreateError.textContent = "";
	}

	try {
		await createGroup({
			name: elements.groupNameInput?.value || "",
			description: elements.groupDescriptionInput?.value || "",
			color: elements.groupAvatarColorInput?.value || "",
			joinMode: elements.groupJoinModeSelect?.value || "open",
			logo: groupLogoDataUrl,
		});

		if (elements.groupJoinModeSelect) elements.groupJoinModeSelect.value = "open";
		if (elements.groupNameInput) elements.groupNameInput.value = "";
		if (elements.groupDescriptionInput) elements.groupDescriptionInput.value = "";
		if (elements.groupAvatarColorInput) elements.groupAvatarColorInput.value = "#2563eb";
		removeGroupLogo();
		if (elements.groupAvatarPreview) setGroupAvatarPreview(elements.groupAvatarPreview, "", "#2563eb");
		setGroupsTab("mine");
	} catch (error) {
		console.error("Masa oluşturulamadı:", error);
		if (elements.groupCreateError) {
			elements.groupCreateError.hidden = false;
			elements.groupCreateError.textContent = friendlyErrorMessage(error, "Masa oluşturulamadı.");
		}
	} finally {
		isSubmittingGroup = false;
		if (elements.createGroupButton) {
			elements.createGroupButton.disabled = false;
		}
	}
}

export function syncGroupFormCounts() {
	3;
	updateGroupStats();
}

// Üyelerden biri adını/rengini değiştirince masa listesi ve üye satırları güncellenir.
window.addEventListener("users:updated", () => {
	renderGroups();
	if (state.activeGroupId) {
		const group = state.groups?.[state.activeGroupId];
		if (group && elements.groupDetailMeta) {
			const memberCount = Object.keys(group.members || {}).length;
			elements.groupDetailMeta.textContent = `${memberCount} üye · ${resolveUserName(group.ownerId, group.ownerName)} oluşturdu`;
		}
		renderGroupDetailMembers();
	}
});
