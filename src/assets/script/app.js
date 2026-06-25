import { storageKeys, firebaseConfig } from "./state.js";
import { elements } from "./elements.js";
import { connectToFirebase } from "./firebase.js";
import { submitAuth, saveSettingsAvatar, saveProfileSettings, openChangePasswordDialog, confirmDeleteAccount, setAuthMode, logout } from "./auth.js";
import { syncAuthMode, syncAuthUi, syncComposer, openAuth, closeSettings, openSearch, openGroups } from "./ui.js";
import { submitComposerText, loadMorePosts, closeComments } from "./posts.js";
import { submitGroupForm } from "./groups.js";
import { setupDiscover } from "./discover.js";
import { initials } from "./utils.js";

syncAuthMode();
syncAuthUi();
syncComposer();
setupDiscover();

const storedConfig = localStorage.getItem(storageKeys.config);
if (storedConfig) {
  connectToFirebase(storedConfig);
} else {
  const defaultConfigText = JSON.stringify(firebaseConfig, null, 2);
  connectToFirebase(defaultConfigText);
}

elements.authButton.addEventListener("click", openAuth);
elements.searchButton.addEventListener("click", openSearch);
elements.groupsButton?.addEventListener("click", openGroups);
elements.openAuthFromGate.addEventListener("click", openAuth);
elements.openGroupsAuthFromGate?.addEventListener("click", openAuth);
elements.changePasswordButton.addEventListener("click", openChangePasswordDialog);
elements.deleteAccountButton.addEventListener("click", confirmDeleteAccount);
elements.logoutButton.addEventListener("click", () => {
  logout();
  window.location.href = "login.html";
});
elements.settingsAvatarInput.addEventListener("change", saveSettingsAvatar);
elements.saveProfileButton.addEventListener("click", saveProfileSettings);
elements.createGroupButton?.addEventListener("click", submitGroupForm);
elements.settingsAvatarButton?.addEventListener("click", () => {
  elements.settingsAvatarInput?.click();
});
elements.settingsNameInput?.addEventListener("input", (event) => {
  const value = event.target.value || "User";
  if (elements.settingsProfileName) elements.settingsProfileName.textContent = value;
  if (elements.settingsAvatarButton) elements.settingsAvatarButton.textContent = initials(value);
});
elements.settingsAvatarInput?.addEventListener("input", (event) => {
  if (elements.settingsAvatarButton) {
    elements.settingsAvatarButton.style.background = event.target.value;
  }
});
elements.feedButton.addEventListener("click", () => {
  closeComments();
  closeSettings();
});

elements.loginMode.addEventListener("click", () => setAuthMode("login"));
elements.registerMode.addEventListener("click", () => setAuthMode("register"));
elements.submitAuth.addEventListener("click", submitAuth);
elements.authPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitAuth();
});
elements.authEmail.addEventListener("keydown", (event) => {
  if (event.key === "Enter") submitAuth();
});

elements.postText?.addEventListener("input", syncComposer);

elements.sendPost?.addEventListener("click", async () => {
  const text = elements.postText?.value.trim();
  if (!text) return;

  elements.sendPost.disabled = true;
  if (elements.settingsError) {
    elements.settingsError.textContent = "";
  }

  try {
    await submitComposerText(text);
    if (elements.postText) elements.postText.value = "";
  } catch (error) {
    if (elements.settingsError) {
      elements.settingsError.textContent = "Post paylaşılamadı: " + error.message;
    }
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
