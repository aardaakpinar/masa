/** groups feature'ının DOM/view katmanı. Veri okur, action çağırır, DOM üretir. */
import { state } from "../../state.js";
import { resolveUserName } from "../../users.js";
import { elements } from "../../elements.js";
import { initials, getContrastColor, safeColor, friendlyErrorMessage } from "../../utils.js";
import { openGroups } from "../../ui.js";
import {
	groupsTabsElement,
	groupFilter,
	setGroupFilter,
	groupLogoDataUrl,
	groupEditLogoDataUrl,
	setGroupEditLogoDataUrl,
	isGroupSettingsOpen,
	setIsGroupSettingsOpen,
	setGroupAvatarPreview,
	updateLogoControls,
	getGroupLogo,
	getGroups,
	isMember,
	isApprovalGroup,
	filterGroups,
	resolveMemberProfile,
	loadUsersProfiles,
	setGroupLogoRefresh,
} from "./internal.js";
import {
	joinGroup,
	cancelJoinRequest,
	leaveGroup,
	approveJoinRequest,
	rejectJoinRequest,
	removeMember,
} from "./actions.js";

// Logo yüklendiğinde liste ve (açıksa) masa detayı yeniden çizilir.
setGroupLogoRefresh(() => {
	renderGroups();
	if (state.activeGroupId) renderGroupDetail();
});

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

// Masalar ekranı iki sekmeli: "mine" (liste) ve "create" (yeni masa formu).
export function setGroupsTab(filter = "mine") {
	setGroupFilter(filter);
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

	setGroupEditLogoDataUrl(getGroupLogo(groupId, group));

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

	setIsGroupSettingsOpen(true);
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
	setIsGroupSettingsOpen(false);
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

export function syncGroupAvatarColorPreview(color, editing = false) {
	if (editing) {
		setGroupAvatarPreview(elements.groupDetailEditAvatarPreview, elements.groupDetailEditNameInput?.value, color, groupEditLogoDataUrl);
	} else {
		setGroupAvatarPreview(elements.groupAvatarPreview, elements.groupNameInput?.value, color, groupLogoDataUrl);
	}
}

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

export function syncGroupFormCounts() {
	3;
	updateGroupStats();
}
