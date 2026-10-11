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
	sendEmailLink,
	backToAuthForm,
	logout,
} from "./auth.js";
import {
	syncAuthMode,
	syncAuthUi,
	syncComposer,
	openAuth,
	openAuthColumn,
	openFeed,
	closeSettings,
	openSearch,
	openGroups,
} from "./ui.js";
import {
	submitComposerText,
	loadMorePosts,
	closeComments,
	renderPosts,
	openGroupFeedColumn,
} from "./posts.js";
import {
	submitGroupForm,
	syncGroupFormCounts,
	deleteGroup,
	toggleColumnGroupSettings,
	closeGroupSettingsPanel,
	setGroupsTab,
	submitGroupEditForm,
	syncGroupEditFormCounts,
	selectGroupLogo,
	removeGroupLogo,
	syncGroupAvatarColorPreview,
} from "./groups.js";
import { setupDiscover } from "./discover.js";
import { setupProfile } from "./profile.js";
import { initials, getContrastColor } from "./utils.js";

// Adres çubuğunda /index.html görünmesin: /masa/index.html -> /masa/
if (/\/index\.html$/.test(window.location.pathname)) {
	history.replaceState(
		history.state,
		"",
		window.location.pathname.replace(/index\.html$/, "") + window.location.search + window.location.hash,
	);
}

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
const composerMedia = new WeakMap();

function composerField(composer, field) {
	return composer?.querySelector(`[data-composer-field="${field}"]`) || null;
}

// Yazı yazıldıkça textarea'yı büyütür (rows=1 -> rows=5'e kadar).
function autoGrowComposer(composer = elements.composerEl) {
	const el = composerField(composer, "text");
	if (!el) return;

	const style = window.getComputedStyle(el);
	const lineHeight = parseFloat(style.lineHeight) || 24;
	const maxHeight = lineHeight * COMPOSER_MAX_ROWS;

	el.style.height = "auto";
	const nextHeight = Math.min(el.scrollHeight, maxHeight);
	el.style.height = `${Math.max(nextHeight, lineHeight)}px`;
	el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
}

// Composer, metin alanı, odak veya ek varlığında aktif görünür.
function syncComposerActiveState(composer = elements.composerEl) {
	const text = composerField(composer, "text");
	const mediaPreview = composerField(composer, "media-preview");
	const pollFields = composerField(composer, "poll-fields");
	if (!composer || !text) return;
	const hasText = text.value.trim().length > 0;
	const isFocused = document.activeElement === text;
	const hasMedia = !mediaPreview?.classList.contains("hidden");
	const hasPoll = !pollFields?.classList.contains("hidden");
	composer.classList.toggle(
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

function showMediaPreview(composer, dataUrl) {
	const preview = composerField(composer, "media-preview");
	if (!preview) return;
	const img = composerField(composer, "media-image");
	if (img) img.src = dataUrl;
	preview.classList.remove("hidden");
	syncComposerActiveState(composer);
}

function hideMediaPreview(composer) {
	const preview = composerField(composer, "media-preview");
	if (!preview) return;
	preview.classList.add("hidden");
	const img = composerField(composer, "media-image");
	if (img) img.src = "";
	syncComposerActiveState(composer);
}

const MAX_POLL_OPTIONS = 4;
const MIN_POLL_OPTIONS = 2;

function createPollOptionRow(index, composer, value = "") {
	const row = document.createElement("div");
	row.className = "composer-poll-option-row";

	const input = document.createElement("input");
	input.type = "text";
	input.maxLength = 60;
	input.placeholder = `Seçenek ${index + 1}`;
	input.value = value;
	row.append(input);

	if (index >= MIN_POLL_OPTIONS) {
		const removeButton = document.createElement("button");
		removeButton.type = "button";
		removeButton.className = "composer-poll-option-remove";
		removeButton.setAttribute("aria-label", "Seçeneği kaldır");
		removeButton.textContent = "×";
		removeButton.addEventListener("click", () => {
			row.remove();
			renumberPollOptions(composer);
		});
		row.append(removeButton);
	}

	return row;
}

function renumberPollOptions(composer) {
	const rows = composerField(composer, "poll-options")?.querySelectorAll(".composer-poll-option-row");
	rows?.forEach((row, index) => {
		const input = row.querySelector("input");
		if (input) input.placeholder = `Seçenek ${index + 1}`;
	});
}

function openPollFields(composer) {
	const fields = composerField(composer, "poll-fields");
	const options = composerField(composer, "poll-options");
	if (!fields || !options) return;
	options.replaceChildren(
		createPollOptionRow(0, composer),
		createPollOptionRow(1, composer),
	);
	fields.classList.remove("hidden");
	composer.querySelector('[data-composer-action="poll-toggle"]')?.classList.add("active");
	syncComposerActiveState(composer);
}

function closePollFields(composer) {
	const fields = composerField(composer, "poll-fields");
	const options = composerField(composer, "poll-options");
	if (!fields || !options) return;
	fields.classList.add("hidden");
	options.replaceChildren();
	composer.querySelector('[data-composer-action="poll-toggle"]')?.classList.remove("active");
	syncComposerActiveState(composer);
}

function resetComposerAttachments(composer) {
	composerMedia.delete(composer);
	hideMediaPreview(composer);
	const input = composerField(composer, "media-input");
	if (input) input.value = "";
	closePollFields(composer);
}

syncAuthMode();
syncAuthUi();
syncComposer();
syncGroupFormCounts();
setupDiscover();
setupProfile();
autoGrowComposer();
syncComposerActiveState();

// Yapılandırma yalnızca build sırasındaki ortam değişkenlerinden gelir.
// (localStorage aynı origin'deki başka sitelerle paylaşıldığı için kullanılmaz.)
connectToFirebase(JSON.stringify(firebaseConfig, null, 2));

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
window.addEventListener("account:open", openAuth);
bind(elements.searchButton, "click", () => {
	openSearch();
	closeMobileMenu();
});
const openGroupsFromNavigation = () => {
	if (!state.authUser) {
		openAuth();
		closeMobileMenu();
		return;
	}
	setGroupsTab("mine");
	openGroups();
	closeMobileMenu();
};
bind(elements.groupsButton, "click", openGroupsFromNavigation);
window.addEventListener("group-feed:open", (event) => {
	openGroupFeedColumn(event.detail?.groupId);
	closeMobileMenu();
});
window.addEventListener("group-settings:toggle", (event) => {
	const groupId = event.detail?.groupId;
	const slot = [...document.querySelectorAll(".feed-column__settings")].find(
		(candidate) => candidate.dataset.groupSettingsSlot === groupId,
	);
	toggleColumnGroupSettings(groupId, slot);
});
bind(elements.mobileBackdrop, "click", closeMobileMenu);
bind(elements.openAuthFromGate, "click", openAuth);
bind(elements.openGroupsAuthFromGate, "click", openAuth);
bind(elements.changePasswordButton, "click", openChangePasswordDialog);
bind(elements.deleteAccountButton, "click", confirmDeleteAccount);
bind(elements.logoutButton, "click", async () => {
	await logout();
	closeSettings();
	openAuthColumn("login");
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
	syncGroupAvatarColorPreview(event.target.value);
});
bind(elements.groupLogoButton, "click", () => elements.groupLogoInput?.click());
bind(elements.groupLogoInput, "change", (event) => {
	const file = event.target.files?.[0];
	if (file) void selectGroupLogo(file);
});
bind(elements.groupLogoRemoveButton, "click", () => removeGroupLogo());
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
	syncGroupAvatarColorPreview(event.target.value, true);
});
bind(elements.groupDetailEditLogoButton, "click", () => elements.groupDetailEditLogoInput?.click());
bind(elements.groupDetailEditLogoInput, "change", (event) => {
	const file = event.target.files?.[0];
	if (file) void selectGroupLogo(file, true);
});
bind(elements.groupDetailEditLogoRemoveButton, "click", () => removeGroupLogo(true));
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
	openFeed();
	closeMobileMenu();
});

bind(elements.loginMode, "click", () => setAuthMode("login"));
bind(elements.registerMode, "click", () => setAuthMode("register"));
bind(elements.authMethodToggle, "click", () => {
	state.authUsePassword = !state.authUsePassword;
	syncAuthMode();
	(state.authUsePassword ? elements.authPassword : elements.authEmail)?.focus();
});
bind(elements.authResend, "click", () => sendEmailLink());
bind(elements.authBack, "click", backToAuthForm);
bind(elements.authForm, "submit", (event) => {
	event.preventDefault();
	submitAuth();
});

if (elements.authPasswordToggle && elements.authPassword) {
	bind(elements.authPasswordToggle, "click", () => {
		const isHidden = elements.authPassword.type === "password";
		elements.authPassword.type = isHidden ? "text" : "password";
		elements.authPasswordToggle.setAttribute(
			"aria-label",
			isHidden ? "Şifreyi gizle" : "Şifreyi göster",
		);
		elements.authPasswordToggle.innerHTML = `<span data-lucide="${isHidden ? "eye-off" : "eye"}"></span>`;
		window.lucide?.createIcons();
	});
}

document.addEventListener("input", (event) => {
	const composer = event.target.closest(".composer");
	if (!composer) return;
	if (event.target.matches('[data-composer-field="text"]')) {
		syncComposer();
		autoGrowComposer(composer);
		syncComposerActiveState(composer);
	} else if (event.target.closest(".composer-poll-options")) {
		syncComposerActiveState(composer);
	}
});

document.addEventListener("focusin", (event) => {
	const composer = event.target.closest(".composer");
	if (composer) syncComposerActiveState(composer);
});
document.addEventListener("focusout", (event) => {
	const composer = event.target.closest(".composer");
	if (composer) setTimeout(() => syncComposerActiveState(composer), 120);
});
document.addEventListener("change", async (event) => {
	const input = event.target.closest('[data-composer-field="media-input"]');
	const composer = input?.closest(".composer");
	const file = input?.files?.[0];
	if (!composer || !file) return;
	try {
		const dataUrl = await resizeImageFile(file);
		composerMedia.set(composer, { dataUrl });
		showMediaPreview(composer, dataUrl);
	} catch (error) {
		console.warn("Görsel eklenemedi: " + error.message);
	}
});

document.addEventListener("click", async (event) => {
	const action = event.target.closest("[data-composer-action]");
	const composer = action?.closest(".composer");
	if (!action || !composer) return;

	switch (action.dataset.composerAction) {
		case "media-open":
			composerField(composer, "media-input")?.click();
			break;
		case "media-remove":
			composerMedia.delete(composer);
			hideMediaPreview(composer);
			if (composerField(composer, "media-input")) {
				composerField(composer, "media-input").value = "";
			}
			break;
		case "poll-toggle":
			if (!composerField(composer, "poll-fields")?.classList.contains("hidden")) {
				closePollFields(composer);
			} else {
				openPollFields(composer);
			}
			break;
		case "poll-add": {
			const options = composerField(composer, "poll-options");
			const rows = options?.querySelectorAll(".composer-poll-option-row").length || 0;
			if (rows < MAX_POLL_OPTIONS) {
				options?.append(createPollOptionRow(rows, composer));
			}
			break;
		}
		case "poll-remove":
			closePollFields(composer);
			break;
		case "submit": {
			const text = composerField(composer, "text")?.value.trim();
			if (!text) return;
			action.disabled = true;
			const pollOptions = composerField(composer, "poll-fields")?.classList.contains("hidden")
				? null
				: Array.from(composerField(composer, "poll-options")?.querySelectorAll("input") || [])
					.map((input) => input.value);
			const groupId = composer.dataset.groupId || "";
			const isComment = Boolean(composer.dataset.commentPostId);
			try {
				await submitComposerText(text, {
					groupId,
					commentPostId: composer.dataset.commentPostId || "",
					media: composerMedia.get(composer) || null,
					pollOptions,
				});
				const textField = composerField(composer, "text");
				if (textField) textField.value = "";
				autoGrowComposer(composer);
				if (!isComment) resetComposerAttachments(composer);
			} catch (error) {
				console.warn((isComment ? "Yorum gönderilemedi: " : "Post paylaşılamadı: ") + error.message);
			} finally {
				syncComposer();
				syncComposerActiveState(composer);
				action.disabled = false;
			}
			break;
		}
	}
});

window.addEventListener("resize", () => {
	if (window.innerWidth > 760) {
		closeMobileMenu();
	}
});

// Sayfa kilitli (100dvh); kaydırma kolonların içinde olur. 'scroll' olayı kabarmaz,
// bu yüzden yakalama (capture) aşamasında dinliyoruz.
document.addEventListener(
	"scroll",
	(event) => {
		const target = event.target;
		if (!(target instanceof Element) || !target.matches(".feed-column__posts")) return;
		const threshold = 300;
		const nearBottom =
			target.scrollTop + target.clientHeight >= target.scrollHeight - threshold;
		if (nearBottom) {
			loadMorePosts();
		}
	},
	true,
);
