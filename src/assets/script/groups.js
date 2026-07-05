import { state } from "./state.js";
import { elements } from "./elements.js";
import { initials, cleanName, getContrastColor } from "./utils.js";
import { openGroups } from "./ui.js";
import { ref, push, set, get, onValue, off, query, orderByChild, limitToLast, serverTimestamp, update, remove } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

let isSubmittingGroup = false;
let isSubmittingGroupEdit = false;
let isGroupSettingsOpen = false;

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
			state.activeGroupId = group.id;
			window.dispatchEvent(new Event("groups:open"));
		}
	});

	const avatar = document.createElement("div");
	avatar.className = "avatar group-card__avatar";
	avatar.style.background = group.color || "#2563eb";
	avatar.style.color = getContrastColor(group.color || "#2563eb");
	avatar.textContent = group.avatarChar || initials(group.name);

	const content = document.createElement("span");
	content.className = "group-card__content";

	const title = document.createElement("h4");
	title.textContent = group.name || "Masa";

	const meta = document.createElement("span");
	meta.className = "group-card__meta";
	const memberCount = Object.keys(group.members || {}).length;
	meta.textContent = `${memberCount} üye · ${group.ownerName || "Anonim"} oluşturdu`;

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
		status.textContent = isOwner || joined ? "üye" : "öneri";

		if (!joined && !isOwner) {
			const joinButton = document.createElement("button");
			joinButton.type = "button";
			joinButton.className = "button button--secondary group-action";
			joinButton.textContent = "Katıl";
			joinButton.addEventListener("click", async (event) => {
				event.stopPropagation();
				joinButton.disabled = true;
				joinButton.textContent = "Katılınıyor…";
				try {
					await joinGroup(group.id);
				} finally {
					joinButton.disabled = false;
					joinButton.textContent = "Katıl";
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

export function renderGroups() {
	const groups = getGroups();
	renderInto(elements.groupsList, groups, "Henüz bir masa yok. İlkini sen oluştur.");
	syncComposerGroupOptions();
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
		elements.groupDetailAvatar.textContent = group.avatarChar || initials(group.name);
		elements.groupDetailAvatar.style.background = group.color || "#2563eb";
		elements.groupDetailAvatar.style.color = getContrastColor(group.color || "#2563eb");
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
		elements.groupDetailMeta.textContent = `${memberCount} üye · ${group.ownerName || "Anonim"} oluşturdu`;
	}

	if (elements.groupDetailOwnerActions) {
		elements.groupDetailOwnerActions.hidden = !isOwner;
	}
	if (!isOwner) {
		closeGroupSettingsPanel();
	} else if (isGroupSettingsOpen) {
		fillGroupEditForm(group);
	}

	renderGroupDetailMembers();
}

function fillGroupEditForm(group) {
	if (elements.groupDetailEditNameInput) {
		elements.groupDetailEditNameInput.value = group.name || "";
	}
	if (elements.groupDetailEditDescriptionInput) {
		elements.groupDetailEditDescriptionInput.value = group.description || "";
	}
	if (elements.groupDetailEditAvatarCharInput) {
		elements.groupDetailEditAvatarCharInput.value = group.avatarChar || "";
	}
	if (elements.groupDetailEditAvatarColorInput) {
		elements.groupDetailEditAvatarColorInput.value = group.color || "#2563eb";
	}
	if (elements.groupDetailEditAvatarPreview) {
		const color = group.color || "#2563eb";
		elements.groupDetailEditAvatarPreview.textContent = group.avatarChar || initials(group.name) || "M";
		elements.groupDetailEditAvatarPreview.style.background = color;
		elements.groupDetailEditAvatarPreview.style.color = getContrastColor(color);
	}
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
	fillGroupEditForm(group);
	renderGroupDetailMembers();
	elements.groupDetailSettingsPanel?.classList.remove("hidden");
	elements.groupDetailPostsSection?.classList.add("hidden");
}

export function closeGroupSettingsPanel() {
	isGroupSettingsOpen = false;
	elements.groupDetailSettingsPanel?.classList.add("hidden");
	elements.groupDetailPostsSection?.classList.remove("hidden");
}

export function syncGroupEditFormCounts() {
	if (elements.groupDetailEditNameCount) {
		elements.groupDetailEditNameCount.textContent = `${elements.groupDetailEditNameInput?.value.length || 0}/48`;
	}
	if (elements.groupDetailEditDescriptionCount) {
		elements.groupDetailEditDescriptionCount.textContent = `${elements.groupDetailEditDescriptionInput?.value.length || 0}/160`;
	}
}

export async function updateGroup(groupId, { name, description, avatarChar, color }) {
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

	const groupName = cleanName(name).slice(0, 48);
	const groupDescription = String(description || "")
		.trim()
		.slice(0, 160);
	const groupAvatarChar = String(avatarChar || "")
		.trim()
		.slice(0, 1)
		.toUpperCase();
	const groupColor = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : group.color || "#2563eb";

	if (!groupName) {
		throw new Error("Masa adı gerekli.");
	}

	await update(ref(state.db, `groups/${groupId}`), {
		name: groupName,
		description: groupDescription,
		avatarChar: groupAvatarChar || null,
		color: groupColor,
	});
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
			avatarChar: elements.groupDetailEditAvatarCharInput?.value || "",
			color: elements.groupDetailEditAvatarColorInput?.value || "",
		});
		closeGroupSettingsPanel();
	} catch (error) {
		if (elements.groupDetailEditError) {
			elements.groupDetailEditError.hidden = false;
			elements.groupDetailEditError.textContent = error.message || "Masa güncellenemedi.";
		}
	} finally {
		isSubmittingGroupEdit = false;
		if (elements.groupDetailEditSaveButton) {
			elements.groupDetailEditSaveButton.disabled = false;
		}
	}
}

function syncComposerGroupOptions() {
	if (!elements.postGroupSelect) return;

	const groups = getGroups().filter(isMember);
	const current = elements.postGroupSelect.value;

	const options = [{ value: "", label: "Akış" }, ...groups.map((group) => ({ value: group.id, label: group.name }))];

	elements.postGroupSelect.replaceChildren(
		...options.map(({ value, label }) => {
			const option = document.createElement("option");
			option.value = value;
			option.textContent = label;
			return option;
		}),
	);

	if (current && options.some((option) => option.value === current)) {
		elements.postGroupSelect.value = current;
	} else {
		elements.postGroupSelect.value = "";
		state.activeGroupId = "";
		if (current !== "") {
			elements.postGroupSelect.dispatchEvent(new Event("change"));
		}
	}

	renderComposerGroupChips(groups);
}

// Composer'ın üstünde, hangi masaya paylaşım yapılacağını seçmek için
// tıklanabilir masa etiketleri (chip) gösterir. Seçilen chip, gizli
// #postGroupSelect elemanının değerini günceller ve "change" tetikler.
export function renderComposerGroupChips(memberGroups) {
	if (!elements.composerGroupChips || !elements.postGroupSelect) return;

	const groups = memberGroups || getGroups().filter(isMember);
	const selectedId = elements.postGroupSelect.value || "";

	const chips = [
		{ id: "", name: "Akış", color: null },
		...groups.map((group) => ({
			id: group.id,
			name: group.name,
			color: group.color,
		})),
	];

	elements.composerGroupChips.replaceChildren(
		...chips.map(({ id, name, color }) => {
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = `composer-group-chip${id === selectedId ? " active" : ""}`;

			if (color) {
				const dot = document.createElement("span");
				dot.className = "chip-dot";
				dot.style.background = color;
				chip.append(dot);
			}

			const label = document.createElement("span");
			label.textContent = name;
			chip.append(label);

			chip.addEventListener("click", () => {
				if (elements.postGroupSelect.value === id) return;
				elements.postGroupSelect.value = id;
				elements.postGroupSelect.dispatchEvent(new Event("change"));
				renderComposerGroupChips(groups);
			});

			return chip;
		}),
	);
}

function updateGroupStats() {
	if (elements.groupCount) {
		elements.groupCount.textContent = String(getGroups().length);
	}
	if (elements.groupNameCount) {
		elements.groupNameCount.textContent = `${elements.groupNameInput?.value.length || 0}/48`;
	}
	if (elements.groupDescriptionCount) {
		elements.groupDescriptionCount.textContent = `${elements.groupDescriptionInput?.value.length || 0}/160`;
	}
	if (elements.groupAvatarPreview && !elements.groupAvatarCharInput?.value) {
		elements.groupAvatarPreview.textContent = initials(elements.groupNameInput?.value || "") || "M";
	}
}

export async function createGroup({ name, description, avatarChar, color }) {
	if (!state.authUser) {
		throw new Error("Masa oluşturmak için giriş yapmalısın.");
	}
	if (!state.db) {
		throw new Error("Veritabanı bağlantısı kurulamadı.");
	}

	const groupName = cleanName(name).slice(0, 48);
	const groupDescription = String(description || "")
		.trim()
		.slice(0, 160);
	const groupAvatarChar = String(avatarChar || "")
		.trim()
		.slice(0, 1)
		.toUpperCase();
	const groupColor = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : state.profile.color || "#2563eb";

	if (!groupName) {
		throw new Error("Masa adı gerekli.");
	}

	const groupRef = push(ref(state.db, "groups"));
	await set(groupRef, {
		name: groupName,
		description: groupDescription,
		avatarChar: groupAvatarChar || null,
		color: groupColor,
		ownerId: state.authUser.uid,
		ownerName: state.profile.name,
		createdAt: serverTimestamp(),
		members: {
			[state.authUser.uid]: {
				role: "owner",
				joinedAt: serverTimestamp(),
			},
		},
	});

	return groupRef.key;
}

export async function joinGroup(groupId) {
	if (!state.authUser || !state.db) return;

	const group = state.groups?.[groupId];
	if (!group) return;
	if (group.members?.[state.authUser.uid]) return;

	try {
		await update(ref(state.db, `groups/${groupId}/members/${state.authUser.uid}`), {
			role: "member",
			joinedAt: serverTimestamp(),
		});
	} catch (error) {
		const message = String(error?.message || "");
		if (elements.groupError) {
			elements.groupError.textContent = "Topluluğa katılınamadı: " + error.message + (message.includes("Permission denied") ? " Rules içinde members/$uid/role için 'member' izni verin." : "");
		}
		throw error;
	}
}

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
		const message = String(error?.message || "");
		if (elements.groupError) {
			elements.groupError.textContent = "Gruptan çıkılamadı: " + error.message + (message.includes("Permission denied") ? " Rules içinde members/$uid için silme izni verin." : "");
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

	await remove(ref(state.db, `groups/${groupId}`));
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
	avatar.style.background = color;
	avatar.style.color = getContrastColor(color);
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
				if (elements.groupError) {
					elements.groupError.textContent = "Üye çıkarılamadı: " + (error?.message || "Bilinmeyen hata");
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
	return state.groups?.[groupId]?.avatarChar + " " + state.groups?.[groupId]?.name || "Masa";
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

	try {
		await createGroup({
			name: elements.groupNameInput?.value || "",
			description: elements.groupDescriptionInput?.value || "",
			avatarChar: elements.groupAvatarCharInput?.value || "",
			color: elements.groupAvatarColorInput?.value || "",
		});

		if (elements.groupNameInput) elements.groupNameInput.value = "";
		if (elements.groupDescriptionInput) elements.groupDescriptionInput.value = "";
		if (elements.groupAvatarCharInput) elements.groupAvatarCharInput.value = "";
		if (elements.groupAvatarColorInput) elements.groupAvatarColorInput.value = "#2563eb";
		if (elements.groupAvatarPreview) {
			elements.groupAvatarPreview.textContent = "M";
			elements.groupAvatarPreview.style.background = "#2563eb";
			elements.groupAvatarPreview.style.color = getContrastColor("#2563eb");
		}
	} catch (error) {
		console.error("Masa oluşturulamadı:", error);
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
