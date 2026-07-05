import { storageKeys, firebaseConfig, state } from "./state.js";
import { elements } from "./elements.js";
import { connectToFirebase } from "./firebase.js";
import {
	submitAuth,
	saveSettingsAvatar,
	saveProfileSettings,
	openChangePasswordDialog,
	confirmDeleteAccount,
	setAuthMode,
	logout,
} from "./auth.js";
import {
	syncAuthMode,
	syncAuthUi,
	syncComposer,
	openAuth,
	closeSettings,
	openSearch,
	openGroups,
	openGroupDetail,
} from "./ui.js";
import {
	submitComposerText,
	loadMorePosts,
	closeComments,
	renderGroupDetailPosts,
	renderPosts,
	setPendingMedia,
	clearPendingMedia,
	setPendingPollOptions,
	clearPendingPoll,
} from "./posts.js";
import {
	submitGroupForm,
	syncGroupFormCounts,
	renderGroupDetail,
	deleteGroup,
	openGroupSettingsPanel,
	closeGroupSettingsPanel,
	submitGroupEditForm,
	syncGroupEditFormCounts,
} from "./groups.js";
import { setupDiscover } from "./discover.js";
import { initials, getContrastColor } from "./utils.js";

function bind(element, eventName, handler) {
	element?.addEventListener(eventName, handler);
}

function openMobileMenu() {
	document.body.classList.add("mobile-drawer-open");
	if (elements.mobileBackdrop) {
		elements.mobileBackdrop.hidden = false;
	}
}

function closeMobileMenu() {
	document.body.classList.remove("mobile-drawer-open");
	if (elements.mobileBackdrop) {
		elements.mobileBackdrop.hidden = true;
	}
}

const COMPOSER_MAX_ROWS = 5;

// Yazı yazıldıkça textarea'yı büyütür (rows=1 -> rows=5'e kadar).
function autoGrowComposer() {
	const el = elements.postText;
	if (!el) return;

	const style = window.getComputedStyle(el);
	const lineHeight = parseFloat(style.lineHeight) || 24;
	const maxHeight = lineHeight * COMPOSER_MAX_ROWS;

	el.style.height = "auto";
	const nextHeight = Math.min(el.scrollHeight, maxHeight);
	el.style.height = `${Math.max(nextHeight, lineHeight)}px`;
	el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

// Composer'ı "aktif" gösterir (masa etiketleri bu durumda açılır):
// yazı yazılıyor, odaklanılmış ya da medya/anket eklenmişse aktif kalır.
function syncComposerActiveState() {
	if (!elements.composerEl || !elements.postText) return;
	const hasText = elements.postText.value.trim().length > 0;
	const isFocused = document.activeElement === elements.postText;
	const hasMedia = !elements.composerMediaPreview?.classList.contains("hidden");
	const hasPoll = !elements.composerPollFields?.classList.contains("hidden");
	elements.composerEl.classList.toggle(
		"active",
		hasText || isFocused || hasMedia || hasPoll,
	);
}

function resizeImageFile(file, maxDimension = 1080, quality = 0.78) {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(new Error("Görsel okunamadı."));
		reader.onload = () => {
			const img = new Image();
			img.onerror = () => reject(new Error("Görsel işlenemedi."));
			img.onload = () => {
				const scale = Math.min(
					1,
					maxDimension / Math.max(img.width, img.height),
				);
				const width = Math.round(img.width * scale);
				const height = Math.round(img.height * scale);

				const canvas = document.createElement("canvas");
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext("2d");
				ctx.drawImage(img, 0, 0, width, height);
				resolve(canvas.toDataURL("image/jpeg", quality));
			};
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	});
}

function showMediaPreview(dataUrl) {
	if (!elements.composerMediaPreview) return;
	const img = document.getElementById("composerMediaImage");
	if (img) img.src = dataUrl;
	elements.composerMediaPreview.classList.remove("hidden");
	syncComposerActiveState();
}

function hideMediaPreview() {
	if (!elements.composerMediaPreview) return;
	elements.composerMediaPreview.classList.add("hidden");
	const img = document.getElementById("composerMediaImage");
	if (img) img.src = "";
	syncComposerActiveState();
}

const MAX_POLL_OPTIONS = 4;
const MIN_POLL_OPTIONS = 2;

function createPollOptionRow(index, value = "") {
	const row = document.createElement("div");
	row.className = "composer-poll-option-row";

	const input = document.createElement("input");
	input.type = "text";
	input.maxLength = 60;
	input.placeholder = `Seçenek ${index + 1}`;
	input.value = value;
	input.addEventListener("input", syncPendingPollFromInputs);

	row.append(input);

	if (index >= MIN_POLL_OPTIONS) {
		const removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.className = "composer-poll-option-remove";
		removeButton.setAttribute("aria-label", "Seçeneği kaldır");
		removeButton.textContent = "×";
		removeButton.addEventListener("click", () => {
			row.remove();
			renumberPollOptions();
			syncPendingPollFromInputs();
		});
		row.append(removeButton);
	}

	return row;
}

function renumberPollOptions() {
	const rows = elements.composerPollOptions?.querySelectorAll(
		".composer-poll-option-row",
	);
	rows?.forEach((row, index) => {
		const input = row.querySelector("input");
		if (input) input.placeholder = `Seçenek ${index + 1}`;
	});
}

function syncPendingPollFromInputs() {
	const inputs = elements.composerPollOptions?.querySelectorAll("input") || [];
	setPendingPollOptions(Array.from(inputs).map((input) => input.value));
}

function openPollFields() {
	if (!elements.composerPollFields || !elements.composerPollOptions) return;
	elements.composerPollOptions.replaceChildren(
		createPollOptionRow(0),
		createPollOptionRow(1),
	);
	elements.composerPollFields.classList.remove("hidden");
	elements.composerPollButton?.classList.add("active");
	syncPendingPollFromInputs();
	syncComposerActiveState();
}

function closePollFields() {
	if (!elements.composerPollFields || !elements.composerPollOptions) return;
	elements.composerPollFields.classList.add("hidden");
	elements.composerPollOptions.replaceChildren();
	elements.composerPollButton?.classList.remove("active");
	clearPendingPoll();
	syncComposerActiveState();
}

function resetComposerAttachments() {
	clearPendingMedia();
	hideMediaPreview();
	if (elements.composerMediaInput) elements.composerMediaInput.value = "";
	closePollFields();
}

syncAuthMode();
syncAuthUi();
syncComposer();
syncGroupFormCounts();
setupDiscover();
autoGrowComposer();
syncComposerActiveState();

const storedConfig = localStorage.getItem(storageKeys.config);
if (storedConfig) {
	connectToFirebase(storedConfig);
} else {
	const defaultConfigText = JSON.stringify(firebaseConfig, null, 2);
	connectToFirebase(defaultConfigText);
}

elements.mobileMenuButtons.forEach((button) => {
	bind(button, "click", () => {
		if (document.body.classList.contains("mobile-drawer-open")) {
			closeMobileMenu();
		} else {
			openMobileMenu();
		}
	});
});
elements.closeSettingsButtons.forEach((button) => {
	bind(button, "click", () => {
		closeSettings();
	});
});

bind(elements.authButton, "click", () => {
	openAuth();
	closeMobileMenu();
});
bind(elements.searchButton, "click", () => {
	openSearch();
	closeMobileMenu();
});
bind(elements.groupsButton, "click", () => {
	openGroups();
	closeMobileMenu();
});
bind(elements.groupDetailBack, "click", () => {
	openGroups();
});
window.addEventListener("groups:open", () => {
	renderGroupDetail();
	renderGroupDetailPosts();
	openGroupDetail();
	closeMobileMenu();
});
bind(elements.mobileBackdrop, "click", closeMobileMenu);
bind(elements.openAuthFromGate, "click", openAuth);
bind(elements.openGroupsAuthFromGate, "click", openAuth);
bind(elements.changePasswordButton, "click", openChangePasswordDialog);
bind(elements.deleteAccountButton, "click", confirmDeleteAccount);
bind(elements.logoutButton, "click", () => {
	logout();
	window.location.href = "login.html";
});
bind(elements.settingsAvatarInput, "change", saveSettingsAvatar);
bind(elements.saveProfileButton, "click", saveProfileSettings);
bind(elements.createGroupButton, "click", submitGroupForm);
bind(elements.groupNameInput, "input", syncGroupFormCounts);
bind(elements.groupDescriptionInput, "input", syncGroupFormCounts);
bind(elements.groupAvatarButton, "click", () => {
	elements.groupAvatarColorInput?.click();
});
bind(elements.groupAvatarColorInput, "input", (event) => {
	if (elements.groupAvatarPreview) {
		elements.groupAvatarPreview.style.background = event.target.value;
		elements.groupAvatarPreview.style.color = getContrastColor(
			event.target.value,
		);
	}
});
bind(elements.groupAvatarCharInput, "input", (event) => {
	const char = (event.target.value || "").trim().slice(0, 1).toUpperCase();
	event.target.value = char;
	if (elements.groupAvatarPreview) {
		elements.groupAvatarPreview.textContent =
			char || initials(elements.groupNameInput?.value || "") || "M";
	}
});
bind(elements.groupDetailSettingsButton, "click", openGroupSettingsPanel);
bind(elements.groupDetailEditCancelButton, "click", closeGroupSettingsPanel);
bind(elements.groupDetailEditSaveButton, "click", submitGroupEditForm);
bind(elements.groupDetailEditNameInput, "input", syncGroupEditFormCounts);
bind(
	elements.groupDetailEditDescriptionInput,
	"input",
	syncGroupEditFormCounts,
);
bind(elements.groupDetailEditAvatarButton, "click", () => {
	elements.groupDetailEditAvatarColorInput?.click();
});
bind(elements.groupDetailEditAvatarColorInput, "input", (event) => {
	if (elements.groupDetailEditAvatarPreview) {
		elements.groupDetailEditAvatarPreview.style.background =
			event.target.value;
		elements.groupDetailEditAvatarPreview.style.color = getContrastColor(
			event.target.value,
		);
	}
});
bind(elements.groupDetailEditAvatarCharInput, "input", (event) => {
	const char = (event.target.value || "").trim().slice(0, 1).toUpperCase();
	event.target.value = char;
	if (elements.groupDetailEditAvatarPreview) {
		elements.groupDetailEditAvatarPreview.textContent =
			char ||
			initials(elements.groupDetailEditNameInput?.value || "") ||
			"M";
	}
});
bind(elements.groupDetailDeleteButton, "click", () => {
	if (state.activeGroupId) deleteGroup(state.activeGroupId);
});
bind(elements.settingsAvatarButton, "click", () => {
	elements.settingsAvatarInput?.click();
});
bind(elements.settingsNameInput, "input", (event) => {
	const value = event.target.value || "User";
	if (elements.settingsProfileName)
		elements.settingsProfileName.textContent = value;
	const avatar =
		elements.settingsAvatarButton?.querySelector(".profile-avatar");
	if (avatar) avatar.textContent = initials(value);
});
bind(elements.settingsAvatarInput, "input", (event) => {
	const avatar =
		elements.settingsAvatarButton?.querySelector(".profile-avatar") ||
		elements.settingsAvatarButton;
	if (avatar) {
		avatar.style.background = event.target.value;
		avatar.style.color = getContrastColor(event.target.value);
	}
});
bind(elements.feedButton, "click", () => {
	closeComments();
	closeSettings();
	closeMobileMenu();
});

bind(elements.loginMode, "click", () => setAuthMode("login"));
bind(elements.registerMode, "click", () => setAuthMode("register"));
bind(elements.submitAuth, "click", submitAuth);
bind(elements.authPassword, "keydown", (event) => {
	if (event.key === "Enter") submitAuth();
});
bind(elements.authEmail, "keydown", (event) => {
	if (event.key === "Enter") submitAuth();
});

if (elements.authPasswordToggle && elements.authPassword) {
	bind(elements.authPasswordToggle, "click", () => {
		const isHidden = elements.authPassword.type === "password";
		elements.authPassword.type = isHidden ? "text" : "password";
		elements.authPasswordToggle.setAttribute(
			"aria-label",
			isHidden ? "Şifreyi gizle" : "Şifreyi göster",
		);
		elements.authPasswordToggle.innerHTML = isHidden ? "🙈" : "👁";
	});
}

bind(elements.postText, "input", () => {
	syncComposer();
	autoGrowComposer();
	syncComposerActiveState();
});
bind(elements.postText, "focus", syncComposerActiveState);
bind(elements.postText, "blur", () => {
	// Bir sonraki tık işlenene kadar bekle, böylece chip tıklaması sırasında
	// composer aniden kapanmasın.
	setTimeout(syncComposerActiveState, 120);
});
bind(elements.postGroupSelect, "change", () => {
	renderPosts();
});

bind(elements.composerMediaButton, "click", () => {
	elements.composerMediaInput?.click();
});
bind(elements.composerMediaInput, "change", async (event) => {
	const file = event.target.files?.[0];
	if (!file) return;
	try {
		const dataUrl = await resizeImageFile(file);
		setPendingMedia(dataUrl);
		showMediaPreview(dataUrl);
	} catch (error) {
		console.warn("Görsel eklenemedi: " + error.message);
	}
});
bind(elements.composerMediaRemove, "click", () => {
	clearPendingMedia();
	hideMediaPreview();
	if (elements.composerMediaInput) elements.composerMediaInput.value = "";
});

bind(elements.composerPollButton, "click", () => {
	const isOpen = !elements.composerPollFields?.classList.contains("hidden");
	if (isOpen) {
		closePollFields();
	} else {
		openPollFields();
	}
});
bind(elements.composerPollAddOption, "click", () => {
	const rows =
		elements.composerPollOptions?.querySelectorAll(".composer-poll-option-row")
			.length || 0;
	if (rows >= MAX_POLL_OPTIONS) return;
	elements.composerPollOptions?.append(createPollOptionRow(rows));
	syncPendingPollFromInputs();
});
bind(elements.composerPollRemove, "click", closePollFields);

window.addEventListener("resize", () => {
	if (window.innerWidth > 760) {
		closeMobileMenu();
	}
});

bind(elements.sendPost, "click", async () => {
	const text = elements.postText?.value.trim();
	if (!text) return;

	elements.sendPost.disabled = true;

	try {
		await submitComposerText(text);
		if (elements.postText) {
			elements.postText.value = "";
			autoGrowComposer();
		}
		resetComposerAttachments();
	} catch (error) {
		console.warn("Post paylaşılamadı: " + error.message);
	} finally {
		syncComposer();
		syncComposerActiveState();
		elements.sendPost.disabled = false;
	}
});

window.addEventListener("scroll", () => {
	const threshold = 300;
	const nearBottom =
		window.innerHeight + window.scrollY >=
		document.body.offsetHeight - threshold;
	if (nearBottom) {
		loadMorePosts();
	}
});
