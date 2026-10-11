import {
  feedColumnIds,
  profileColumnId,
  profileUidFromColumnId,
  state,
} from "./state.js";
import { elements } from "./elements.js";
import { initials, getContrastColor, safeColor } from "./utils.js";

export function syncComposer() {
  document.querySelectorAll(".composer").forEach((composer) => {
    const text = composer.querySelector('[data-composer-field="text"]');
    const count = composer.querySelector('[data-composer-field="count"]');
    const submit = composer.querySelector('[data-composer-action="submit"]');
    if (!text || !count || !submit) return;
    count.textContent = `${text.value.length}/${composer.classList.contains("composer--comment") ? 180 : 280}`;
    submit.disabled = !state.db || !state.authUser || text.value.trim().length === 0;
  });
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
function _composerAuthHandler(event) {
  const composer = event.currentTarget;
  if (composer && composer.classList.contains("hidden")) {
    openAuth();
  }
}

export function syncAuthUi() {
  if (!state.authResolved) {
    if (elements.authGate) elements.authGate.classList.add("visible");
    if (elements.groupsAuthGate) elements.groupsAuthGate.classList.add("visible");
    setHidden(elements.authGateMessage, true);
    setHidden(elements.groupsAuthGateMessage, true);
    setHidden(elements.openAuthFromGate, true);
    setHidden(elements.openGroupsAuthFromGate, true);
    setHidden(elements.authPending, false);
    setHidden(elements.groupsAuthPending, false);
    document.querySelectorAll(".composer").forEach((composer) => {
      composer.classList.add("hidden");
    });
    [
      elements.authButton,
      elements.mobileAuthButton,
      elements.createGroupButton,
      elements.groupNameInput,
      elements.groupDescriptionInput,
    ].forEach((element) => {
      if (element && "disabled" in element) element.disabled = true;
    });
    syncComposer();
    return;
  }

  const isSignedIn = Boolean(state.authUser);
  if (elements.authGate) {
    elements.authGate.classList.toggle("visible", !isSignedIn);
  }
  if (elements.groupsAuthGate) {
    elements.groupsAuthGate.classList.toggle("visible", !isSignedIn);
  }
  setHidden(elements.authGateMessage, false);
  setHidden(elements.groupsAuthGateMessage, false);
  setHidden(elements.openAuthFromGate, false);
  setHidden(elements.openGroupsAuthFromGate, false);
  setHidden(elements.authPending, true);
  setHidden(elements.groupsAuthPending, true);

  document.querySelectorAll(".composer").forEach((composer) => {
    composer.classList.toggle("hidden", !isSignedIn);
    composer.removeEventListener("click", _composerAuthHandler);
    if (!isSignedIn) {
      composer.addEventListener("click", _composerAuthHandler);
    }
  });

  if (elements.authButton) {
    const buttonLabel = elements.authButton.querySelector("span:last-child");
    setText(buttonLabel, isSignedIn ? "Hesap" : "Giriş");
    elements.authButton.disabled = false;
  }

  setText(elements.mobileAuthButton, isSignedIn ? "Hesap" : "Giriş");
  if (elements.mobileAuthButton) elements.mobileAuthButton.disabled = false;
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
    avatar.style.background = safeColor(color);
    avatar.style.color = getContrastColor(safeColor(color));
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

let currentView = "feed";

export function getMainView() {
  return currentView;
}

export function showMainView(view) {
  setMainView(view);
}

function setMainView(view) {
  if (currentView === "profile" && view !== "profile") {
    window.dispatchEvent(new Event("profile:left"));
  }
  currentView = view;
  elements.profileView?.classList.toggle("hidden", view !== "profile");
  elements.feed?.classList.toggle("hidden", view !== "feed");
  syncNavigationState();
}

function syncNavigationState() {
  elements.feedButton?.classList.toggle(
    "active",
    currentView === "feed" && state.openFeedColumns.includes(""),
  );
  elements.searchButton?.classList.toggle(
    "active",
    state.openFeedColumns.includes(feedColumnIds.search),
  );
  elements.groupsButton?.classList.toggle(
    "active",
    state.openFeedColumns.includes(feedColumnIds.groups),
  );
  elements.authButton?.classList.toggle(
    "active",
    state.openFeedColumns.includes(feedColumnIds.account) ||
      (state.authUser &&
        state.openFeedColumns.includes(profileColumnId(state.authUser.uid))),
  );
}

window.addEventListener("feed-columns:updated", syncNavigationState);

function openFeedColumn(id) {
  if (currentView !== "feed") {
    setMainView("feed");
  }
  if (!state.openFeedColumns.includes(id)) {
    state.openFeedColumns.push(id);
  }
  window.dispatchEvent(new CustomEvent("feed-columns:focus-mobile", { detail: { id } }));
  window.dispatchEvent(new Event("feed-columns:updated"));
  syncNavigationState();
}

function closeFeedColumn(id) {
  state.openFeedColumns = state.openFeedColumns.filter((columnId) => columnId !== id);
  window.dispatchEvent(new Event("feed-columns:updated"));
  const profileUid = profileUidFromColumnId(id);
  if (profileUid) {
    window.dispatchEvent(new CustomEvent("profile:closed", { detail: { uid: profileUid } }));
  }
  syncNavigationState();
}

export function openFeed() {
  if (!state.openFeedColumns.includes("")) {
    state.openFeedColumns.unshift("");
    window.dispatchEvent(new Event("feed-columns:updated"));
  }
  setMainView("feed");
}

export function openSearch() {
  openFeedColumn(feedColumnIds.search);
}

export function openGroups() {
  if (!state.authUser) {
    openAuth();
    return;
  }
  openFeedColumn(feedColumnIds.groups);
}

export function openProfileColumn(uid) {
  openFeedColumn(profileColumnId(uid));
}

export function closeProfileColumn(uid) {
  closeFeedColumn(profileColumnId(uid));
}

export function openSettings() {
  if (!state.authUser) {
    openAuth();
    return;
  }

  openFeedColumn(feedColumnIds.account);
}

export function closeSettings() {
  closeFeedColumn(feedColumnIds.account);
  openFeed();
}
