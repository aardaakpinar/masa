/** groups feature'ı yazma action'ları: kullanıcı niyeti → repository. */
import { state } from "../../state.js";
import { elements } from "../../elements.js";
import { cleanName, friendlyErrorMessage } from "../../utils.js";
import { notify } from "../../notifications.js";
import { openGroups } from "../../ui.js";
import {
	createGroupRecord,
	updateGroupRecord,
	addGroupMember,
	approveJoinRequestRecord,
	setJoinRequest,
	removeJoinRequest,
	removeGroupMember,
	deleteGroupRecord,
} from "../../services/repositories/groups.js";
import {
	resizeGroupLogo,
	safeGroupLogo,
	setGroupAvatarPreview,
	updateLogoControls,
	getGroupLogo,
	groupLogoDataUrl,
	setGroupLogoDataUrl,
	groupEditLogoDataUrl,
	setGroupEditLogoDataUrl,
	isSubmittingGroup,
	setSubmittingGroup,
	isSubmittingGroupEdit,
	setSubmittingGroupEdit,
	isApprovalGroup,
} from "./internal.js";
import {
	closeGroupSettingsPanel,
	renderGroups,
	renderGroupDetail,
	setGroupsTab,
} from "./view.js";

export async function selectGroupLogo(file, editing = false) {
	const errorElement = editing ? elements.groupDetailEditError : elements.groupCreateError;
	try {
		const dataUrl = await resizeGroupLogo(file);
		if (editing) {
			setGroupEditLogoDataUrl(dataUrl);
			setGroupAvatarPreview(elements.groupDetailEditAvatarPreview, elements.groupDetailEditNameInput?.value, elements.groupDetailEditAvatarColorInput?.value, dataUrl);
		} else {
			setGroupLogoDataUrl(dataUrl);
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
		setGroupEditLogoDataUrl("");
		setGroupAvatarPreview(elements.groupDetailEditAvatarPreview, elements.groupDetailEditNameInput?.value, elements.groupDetailEditAvatarColorInput?.value);
		if (elements.groupDetailEditLogoInput) elements.groupDetailEditLogoInput.value = "";
	} else {
		setGroupLogoDataUrl("");
		setGroupAvatarPreview(elements.groupAvatarPreview, elements.groupNameInput?.value, elements.groupAvatarColorInput?.value);
		if (elements.groupLogoInput) elements.groupLogoInput.value = "";
	}
	updateLogoControls(editing, false);
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

	// Logo değişmediyse (aynı veri) dokunma; değiştiyse yeni sürüm damgası ver.
	const nextLogo = safeGroupLogo(logo);
	const logoChanged = nextLogo !== getGroupLogo(groupId, group);

	// Masa herkese açık yapılınca bekleyen istekler anlamını yitirir; temizlenir.
	const clearRequestUids = mode === "open" ? Object.keys(state.groupRequests?.[groupId] || {}) : [];

	await updateGroupRecord(groupId, {
		name: groupName,
		description: groupDescription,
		color: groupColor,
		joinMode: mode,
		logoChanged,
		nextLogo,
		clearRequestUids,
	});
}

export async function submitGroupEditForm() {
	if (isSubmittingGroupEdit || !state.activeGroupId) return;

	setSubmittingGroupEdit(true);
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
		setSubmittingGroupEdit(false);
		if (elements.groupDetailEditSaveButton) {
			elements.groupDetailEditSaveButton.disabled = false;
		}
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

	return createGroupRecord({
		name: groupName,
		description: groupDescription,
		color: groupColor,
		joinMode: joinMode === "approval" ? "approval" : "open",
		ownerId: state.authUser.uid,
		ownerName: state.profile.name,
		logo: safeGroupLogo(logo),
	});
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
		await addGroupMember(groupId, state.authUser.uid);
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
		await setJoinRequest(groupId, state.authUser.uid);
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
	await removeJoinRequest(groupId, state.authUser.uid);
	delete state.myJoinRequests[groupId];
	renderGroups();
}

export async function approveJoinRequest(groupId, uid) {
	const group = state.groups?.[groupId];
	if (!state.authUser || !state.db || !group || group.ownerId !== state.authUser.uid) return;
	await approveJoinRequestRecord(groupId, uid);
	notify(uid, { type: "join_approved", groupId, snippet: group.name || "" });
}

export async function rejectJoinRequest(groupId, uid) {
	const group = state.groups?.[groupId];
	if (!state.authUser || !state.db || !group || group.ownerId !== state.authUser.uid) return;
	await removeJoinRequest(groupId, uid);
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
		await removeGroupMember(groupId, state.authUser.uid);
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

	await deleteGroupRecord(groupId);
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
		await removeGroupMember(groupId, uid);
		if (state.activeGroupId === groupId) {
			renderGroupDetail();
		}
		renderGroups();
	} catch (error) {
		console.error("Üye çıkarılamadı:", error);
		throw error;
	}
}

export async function submitGroupForm() {
	if (isSubmittingGroup) return;

	setSubmittingGroup(true);
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
		setSubmittingGroup(false);
		if (elements.createGroupButton) {
			elements.createGroupButton.disabled = false;
		}
	}
}
