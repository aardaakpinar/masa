import { state } from "./state.js";
import { elements } from "./elements.js";
import { initials, getContrastColor, safeColor } from "./utils.js";
import { getMainView, showMainView, openSettings, openAuth, openFeed } from "./ui.js";
import {
  createPostElement,
  subscribeProfilePosts,
  stopProfilePosts,
} from "./posts.js";
import { canViewGroup } from "./groups.js";

let returnView = "feed";

const monthYear = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });

// Bir kullanıcının görüntülenecek profili (kendi profilim canlı state.profile'dan gelir).
export function getProfileData(uid) {
  const isMe = Boolean(state.authUser && state.authUser.uid === uid);
  const live = isMe ? { ...state.users?.[uid], ...state.profile } : state.users?.[uid];
  if (!live || live.isDisabled) return null;
  return {
    uid,
    isMe,
    name: live.name || "Anonim",
    color: safeColor(live.color),
    createdAt: live.createdAt || null,
  };
}

function profilePosts(uid) {
  return Object.entries(state.posts || {})
    .map(([id, post]) => ({ id, ...post }))
    .filter((post) => post.authorId === uid && canViewGroup(post.groupId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function openProfile(uid) {
  if (!uid) return;
  if (!state.authUser) {
    openAuth();
    return;
  }

  if (getMainView() !== "profile") returnView = getMainView();
  state.profileUid = uid;
  showMainView("profile");
  subscribeProfilePosts(uid);
  renderProfile();
  window.scrollTo({ top: 0 });
}

export function closeProfile() {
  const target = returnView === "profile" ? "feed" : returnView;
  showMainView(target);
}

export function renderProfile() {
  const uid = state.profileUid;
  if (!uid || !elements.profileView || elements.profileView.classList.contains("hidden")) return;

  const data = getProfileData(uid);

  if (!data) {
    elements.profileTitle.textContent = "Profil";
    elements.profileName.textContent = "Kullanıcı bulunamadı";
    elements.profileAvatar.textContent = "?";
    elements.profileAvatar.style.background = "";
    elements.profileMeta.textContent = "";
    elements.profileEditButton.hidden = true;
    elements.profilePostsTitle.textContent = "";
    elements.profilePostList.replaceChildren();
    return;
  }

  elements.profileTitle.textContent = data.name;
  elements.profileName.textContent = data.name;
  elements.profileAvatar.textContent = initials(data.name);
  elements.profileAvatar.style.background = data.color;
  elements.profileAvatar.style.color = getContrastColor(data.color);
  elements.profileEditButton.hidden = !data.isMe;

  const posts = profilePosts(uid);
  const joined = data.createdAt ? `${monthYear.format(new Date(data.createdAt))} tarihinde katıldı` : "";
  elements.profileMeta.textContent = [joined, `${posts.length} gönderi`].filter(Boolean).join(" · ");
  elements.profilePostsTitle.textContent = "Gönderiler";

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = data.isMe ? "Henüz bir şey paylaşmadın." : "Henüz paylaşılmış bir gönderi yok.";
    elements.profilePostList.replaceChildren(empty);
    return;
  }

  elements.profilePostList.replaceChildren(...posts.map(createPostElement));
  if (window.lucide) window.lucide.createIcons();
}

export function setupProfile() {
  elements.profileBack?.addEventListener("click", closeProfile);
  elements.profileEditButton?.addEventListener("click", openSettings);
  elements.viewProfileButton?.addEventListener("click", () => {
    if (state.authUser) openProfile(state.authUser.uid);
  });

  window.addEventListener("profile:open", (event) => openProfile(event.detail?.uid));
  window.addEventListener("profile:refresh", renderProfile);
  window.addEventListener("users:updated", renderProfile);
  window.addEventListener("profile:left", () => {
    stopProfilePosts();
    state.profileUid = null;
  });
  window.addEventListener("feed:open", openFeed);
}
