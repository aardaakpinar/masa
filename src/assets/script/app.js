import { storageKeys, firebaseConfig } from "./state.js";
import { elements } from "./elements.js";
import { connectToFirebase } from "./firebase.js";
import { submitAuth, saveSettingsAvatar, openChangePasswordDialog, confirmDeleteAccount, setAuthMode, logout } from "./auth.js";
import { syncAuthMode, syncAuthUi, syncComposer, openAuth, closeSettings } from "./ui.js";
import { submitComposerText, loadMorePosts, closeComments } from "./posts.js";

syncAuthMode();
syncAuthUi();
syncComposer();

const storedConfig = localStorage.getItem(storageKeys.config);
if (storedConfig) {
  connectToFirebase(storedConfig);
} else {
  const defaultConfigText = JSON.stringify(firebaseConfig, null, 2);
  connectToFirebase(defaultConfigText);
}

elements.authButton.addEventListener("click", openAuth);
elements.openAuthFromGate.addEventListener("click", openAuth);
elements.changePasswordButton.addEventListener("click", openChangePasswordDialog);
elements.deleteAccountButton.addEventListener("click", confirmDeleteAccount);
elements.logoutButton.addEventListener("click", () => {
  logout();
  window.location.href = "login.html";
});
elements.settingsAvatarInput.addEventListener("change", saveSettingsAvatar);
elements.feedButton.addEventListener("click", () => {
  closeComments();
  if (!elements.settingsPanel.classList.contains("hidden")) {
    closeSettings();
  }
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

elements.postText.addEventListener("input", syncComposer);

elements.sendPost.addEventListener("click", async () => {
  const text = elements.postText.value.trim();
  if (!text) return;

  elements.sendPost.disabled = true;
  if (elements.settingsError) {
    elements.settingsError.textContent = "";
  }

  try {
    await submitComposerText(text);
    elements.postText.value = "";
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
