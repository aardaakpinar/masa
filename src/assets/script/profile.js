import { state } from "./state.js";
import { elements } from "./elements.js";
import { initials, getContrastColor, safeColor } from "./utils.js";
import {
  openSettings,
  openAuth,
  openProfileColumn,
} from "./ui.js";
import {
  renderPostList,
  subscribeProfilePosts,
  stopProfilePosts,
} from "./posts.js";
import { canViewGroup } from "./groups.js";

const monthYear = new Intl.DateTimeFormat("tr-TR", {
  month: "long",
  year: "numeric",
});

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

  openProfileColumn(uid);
  subscribeProfilePosts(uid);
  renderProfile();
}

function renderProfileColumn(column) {
  const uid = column.dataset.profileUid;
  const data = getProfileData(uid);
  const field = (name) => column.querySelector(`[data-profile-field="${name}"]`);
  const title = field("title");
  const name = field("name");
  const avatar = field("avatar");
  const meta = field("meta");
  const editButton = field("edit");
  const postsTitle = field("posts-title");
  const postList = field("posts");

  if (!data) {
    if (title) title.textContent = "Profil";
    if (name) name.textContent = "Kullanıcı bulunamadı";
    if (avatar) {
      avatar.textContent = "?";
      avatar.style.background = "";
    }
    if (meta) meta.textContent = "";
    if (editButton) editButton.hidden = true;
    if (postsTitle) postsTitle.textContent = "";
    postList?.replaceChildren();
    return;
  }

  if (title) title.textContent = data.name;
  const columnHeading = column.querySelector(".feed-column__title h2");
  if (columnHeading) columnHeading.textContent = data.name;
  if (name) name.textContent = data.name;
  if (avatar) {
    avatar.textContent = initials(data.name);
    avatar.style.background = data.color;
    avatar.style.color = getContrastColor(data.color);
  }
  if (editButton) editButton.hidden = !data.isMe;

  const posts = profilePosts(uid);
  const joined = data.createdAt
    ? `${monthYear.format(new Date(data.createdAt))} tarihinde katıldı`
    : "";
  if (meta) {
    meta.textContent = [joined, `${posts.length} gönderi`]
      .filter(Boolean)
      .join(" · ");
  }
  if (postsTitle) postsTitle.textContent = "Gönderiler";

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = data.isMe
      ? "Henüz bir şey paylaşmadın."
      : "Henüz paylaşılmış bir gönderi yok.";
    postList?.replaceChildren(empty);
    return;
  }

  if (postList) renderPostList(postList, posts);
}

export function renderProfile() {
  document.querySelectorAll(".profile-column").forEach(renderProfileColumn);
  if (window.lucide) window.lucide.createIcons();
}

export function setupProfile() {
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-profile-field="edit"]')) openSettings();
  });
  elements.viewProfileButton?.addEventListener("click", () => {
    if (state.authUser) openProfile(state.authUser.uid);
  });

  window.addEventListener("profile:open", (event) => openProfile(event.detail?.uid));
  window.addEventListener("profile:refresh", renderProfile);
  window.addEventListener("users:updated", renderProfile);
  window.addEventListener("profile:closed", (event) => {
    const uid = event.detail?.uid;
    if (uid) stopProfilePosts(uid);
  });
}
