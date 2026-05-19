import { state } from "./state.js";
import { elements } from "./elements.js";

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

export function syncAuthUi() {
  const isSignedIn = Boolean(state.authUser);
  if (elements.authGate) {
    elements.authGate.classList.toggle("visible", !isSignedIn);
  }

  const composer = document.querySelector(".composer");
  if (composer) {
    composer.classList.toggle("locked", !isSignedIn);
  }

  if (elements.authButton) {
    const buttonLabel = elements.authButton.querySelector("span:last-child");
    setText(buttonLabel, isSignedIn ? "Hesap" : "Giriş");
  }

  setText(elements.mobileAuthButton, isSignedIn ? "Hesap" : "Giriş");
  setHidden(elements.panelAuthButton, isSignedIn);
  setHidden(elements.logoutButton, !isSignedIn);
  setText(elements.accountText, isSignedIn ? `${state.profile.name} olarak giriş yapıldı.` : "Giriş yapılmadı.");

  if (!isSignedIn) {
    closeSettings();
  }

  if (elements.settingsEmail) {
    setValue(elements.settingsEmail, isSignedIn ? state.authUser?.email || "" : "");
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
    elements.authPassword.autocomplete = isRegister ? "new-password" : "current-password";
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

export function openSettings() {
  if (!state.authUser) {
    openAuth();
    return;
  }

  if (elements.settingsError) elements.settingsError.textContent = "";
  if (elements.settingsSuccess) elements.settingsSuccess.textContent = "";
  if (elements.settingsPanel) {
    elements.settingsPanel.classList.remove("hidden");
  }
  if (elements.feed) {
    elements.feed.classList.add("hidden");
  }
}

export function closeSettings() {
  if (elements.settingsPanel) {
    elements.settingsPanel.classList.add("hidden");
  }
  if (elements.feed) {
    elements.feed.classList.remove("hidden");
  }
}
