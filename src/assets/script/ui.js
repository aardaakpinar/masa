import { state } from "./state.js";
import { elements } from "./elements.js";
import { initials, getContrastColor } from "./utils.js";

export function syncComposer() {
  if (!elements.postText || !elements.charCount || !elements.sendPost) return;

  const length = elements.postText.value.trim().length;
  elements.charCount.textContent = `${elements.postText.value.length}/280`;
  elements.sendPost.disabled = !state.db || !state.authUser || length === 0;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function setValue(element, value) {
  if (element && "value" in element) {
    element.value = value;
  }
}

function setHidden(element, hidden) {
  if (element) {
    element.hidden = hidden;
  }
}

function toggleClass(element, className, enabled) {
  if (element) {
    element.classList.toggle(className, enabled);
  }
}

// Composer tıklama handler'ı — isimlendirilmiş olduğu için removeEventListener ile temizlenebilir
function _composerAuthHandler() {
  // Sadece locked durumdaysa (giriş yapılmamışsa) auth aç
  const composer = document.querySelector(".composer");
  if (composer && composer.classList.contains("locked")) {
    openAuth();
  }
}

export function syncAuthUi() {
  const isSignedIn = Boolean(state.authUser);
  if (elements.authGate) {
    elements.authGate.classList.toggle("visible", !isSignedIn);
  }
  if (elements.groupsAuthGate) {
    elements.groupsAuthGate.classList.toggle("visible", !isSignedIn);
  }

  const composer = document.querySelector(".composer");
  if (composer) {
    composer.classList.toggle("locked", !isSignedIn);
    // Önceki listener'ı temizle, sonra sadece giriş yapılmamışsa yenisini ekle
    composer.removeEventListener("click", _composerAuthHandler);
    if (!isSignedIn) {
      composer.addEventListener("click", _composerAuthHandler);
    }
  }

  if (elements.authButton) {
    const buttonLabel = elements.authButton.querySelector("span:last-child");
    setText(buttonLabel, isSignedIn ? "Hesap" : "Giriş");
  }

  setText(elements.mobileAuthButton, isSignedIn ? "Hesap" : "Giriş");
  setHidden(elements.panelAuthButton, isSignedIn);
  setHidden(elements.logoutButton, !isSignedIn);
  setText(
    elements.accountText,
    isSignedIn
      ? `${state.profile.name} olarak giriş yapıldı.`
      : "Giriş yapılmadı.",
  );
  if (elements.createGroupButton) {
    elements.createGroupButton.disabled = !isSignedIn || !state.db;
  }
  if (elements.groupNameInput) {
    elements.groupNameInput.disabled = !isSignedIn;
  }
  if (elements.groupDescriptionInput) {
    elements.groupDescriptionInput.disabled = !isSignedIn;
  }
  if (elements.groupCount) {
    setText(
      elements.groupCount,
      String(state.groups ? Object.keys(state.groups).length : 0),
    );
  }

  if (!isSignedIn) {
    closeSettings();
  }

  if (elements.settingsEmail) {
    setValue(
      elements.settingsEmail,
      isSignedIn ? state.authUser?.email || "" : "",
    );
  }
  if (elements.settingsNameInput) {
    setValue(
      elements.settingsNameInput,
      isSignedIn ? state.profile.name || "" : "",
    );
  }
  if (elements.settingsAvatarInput) {
    setValue(
      elements.settingsAvatarInput,
      isSignedIn ? state.profile.color || "#2563eb" : "#2563eb",
    );
  }
  if (elements.settingsAvatarButton) {
    const name = isSignedIn ? state.profile.name || "User" : "User";
    const color = isSignedIn ? state.profile.color || "#2563eb" : "#2563eb";
    const avatar =
      elements.settingsAvatarButton.querySelector(".profile-avatar") ||
      elements.settingsAvatarButton;
    avatar.textContent = initials(name);
    avatar.style.background = color;
    avatar.style.color = getContrastColor(color);
  }
  if (elements.settingsProfileName) {
    setText(
      elements.settingsProfileName,
      isSignedIn ? state.profile.name || "User" : "User",
    );
  }
  syncComposer();
}

export function syncAuthMode() {
  const isRegister = state.authMode === "register";
  const authNameField = elements.authName?.closest("label");
  if (authNameField) {
    authNameField.style.display = isRegister ? "grid" : "none";
  }

  setText(elements.authTitle, isRegister ? "Kayıt ol" : "Giriş yap");
  setText(elements.submitAuth, isRegister ? "Kayıt ol" : "Giriş yap");

  if (elements.authPassword) {
    elements.authPassword.autocomplete = isRegister
      ? "new-password"
      : "current-password";
  }

  toggleClass(elements.loginMode, "active", !isRegister);
  toggleClass(elements.registerMode, "active", isRegister);
  if (elements.authError) {
    elements.authError.textContent = "";
  }
}

export function openAuth() {
  if (state.authUser) {
    openSettings();
    return;
  }

  // Redirect to login page instead of showing modal
  window.location.href = "login.html";
}

function setMainView(view) {
  elements.feed?.classList.toggle("hidden", view !== "feed");
  elements.groupsView?.classList.toggle("hidden", view !== "groups");
  elements.searchPanel?.classList.toggle("hidden", view !== "search");
  elements.settingsPanel?.classList.toggle("hidden", view !== "settings");

  elements.feedButton?.classList.toggle("active", view === "feed");
  elements.searchButton?.classList.toggle("active", view === "search");
  elements.groupsButton?.classList.toggle("active", view === "groups");
  elements.authButton?.classList.toggle("active", view === "settings");
}

export function openFeed() {
  setMainView("feed");
}

export function openSearch() {
  setMainView("search");
}

export function openGroups() {
  setMainView("groups");
}

export function openSettings() {
  if (!state.authUser) {
    openAuth();
    return;
  }

  setMainView("settings");
}

export function closeSettings() {
  openFeed();
}
