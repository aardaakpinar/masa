import { storageKeys, firebaseConfig } from "./state.js";
import { elements } from "./elements.js";
import { connectToFirebase } from "./firebase.js";
import { submitAuth, saveSettingsAvatar, saveProfileSettings, openChangePasswordDialog, confirmDeleteAccount, setAuthMode, logout } from "./auth.js";
import { syncAuthMode, syncAuthUi, syncComposer, openAuth, closeSettings, openSearch, openGroups } from "./ui.js";
import { submitComposerText, loadMorePosts, closeComments } from "./posts.js";
import { submitGroupForm, syncGroupFormCounts } from "./groups.js";
import { setupDiscover } from "./discover.js";
import { initials } from "./utils.js";

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

syncAuthMode();
syncAuthUi();
syncComposer();
syncGroupFormCounts();
setupDiscover();

const storedConfig = localStorage.getItem(storageKeys.config);
if (storedConfig) {
  connectToFirebase(storedConfig);
} else {
  const defaultConfigText = JSON.stringify(firebaseConfig, null, 2);
  connectToFirebase(defaultConfigText);
}

elements.mobileMenuButtons.forEach(button => {
  bind(button, "click", () => {
    if (document.body.classList.contains("mobile-drawer-open")) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });
});
elements.closeSettingsButtons.forEach(button => {
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
bind(elements.settingsAvatarButton, "click", () => {
  elements.settingsAvatarInput?.click();
});
bind(elements.settingsNameInput, "input", (event) => {
  const value = event.target.value || "User";
  if (elements.settingsProfileName) elements.settingsProfileName.textContent = value;
  if (elements.settingsAvatarButton) elements.settingsAvatarButton.textContent = initials(value);
});
bind(elements.settingsAvatarInput, "input", (event) => {
  const avatar = elements.settingsAvatarButton?.querySelector(".profile-avatar") || elements.settingsAvatarButton;
  if (avatar) {
    avatar.style.background = event.target.value;
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

bind(elements.postText, "input", syncComposer);

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
    if (elements.postText) elements.postText.value = "";
  } catch (error) {
    console.warn("Post paylaşılamadı: " + error.message);
  } finally {
    syncComposer();
    elements.sendPost.disabled = false;
  }
});

window.addEventListener("scroll", () => {
  const threshold = 300;
  const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - threshold;
  if (nearBottom) {
    loadMorePosts();
  }
});
