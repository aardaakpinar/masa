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

const EMPTY_TEXT = {
  posts: ["Henüz bir şey paylaşmadın.", "Henüz paylaşılmış bir gönderi yok."],
  media: ["Henüz görsel paylaşmadın.", "Henüz paylaşılmış görsel yok."],
  polls: ["Henüz anket açmadın.", "Henüz açılmış anket yok."],
};

function filterByTab(posts, tab) {
  if (tab === "media") return posts.filter((post) => post.hasMedia || post.media?.dataUrl);
  if (tab === "polls") return posts.filter((post) => post.poll);
  return posts;
}

function countGroups(uid) {
  return Object.values(state.groups || {}).filter(
    (group) => group?.ownerId === uid || group?.members?.[uid],
  ).length;
}

function renderProfileColumn(column) {
  const uid = column.dataset.profileUid;
  const data = getProfileData(uid);
  const field = (name) => column.querySelector(`[data-profile-field="${name}"]`);
  const stat = (name) => column.querySelector(`[data-profile-stat="${name}"]`);
  const name = field("name");
  const avatar = field("avatar");
  const meta = field("meta");
  const editButton = field("edit");
  const postList = field("posts");
  const tab = column.dataset.tab || "posts";

  column.querySelectorAll("[data-profile-tab]").forEach((button) => {
    const active = button.dataset.profileTab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  if (!data) {
    if (name) name.textContent = "Kullanıcı bulunamadı";
    if (avatar) {
      avatar.textContent = "?";
      avatar.style.background = "";
    }
    if (meta) meta.textContent = "";
    if (editButton) editButton.hidden = true;
    ["posts", "likes", "groups"].forEach((key) => {
      if (stat(key)) stat(key).textContent = "0";
    });
    postList?.replaceChildren();
    return;
  }

  const columnHeading = column.querySelector(".feed-column__title h2");
  if (columnHeading) columnHeading.textContent = data.name;
  column.style.setProperty("--profile-color", data.color);
  if (name) name.textContent = data.name;
  if (avatar) {
    avatar.textContent = initials(data.name);
    avatar.style.background = data.color;
    avatar.style.color = getContrastColor(data.color);
  }
  if (editButton) editButton.hidden = !data.isMe;

  const posts = profilePosts(uid);
  const likesReceived = posts.reduce((sum, post) => sum + Object.keys(post.likes || {}).length, 0);
  if (meta) {
    meta.textContent = data.createdAt
      ? `${monthYear.format(new Date(data.createdAt))} tarihinde katıldı`
      : "";
  }
  if (stat("posts")) stat("posts").textContent = String(posts.length);
  if (stat("likes")) stat("likes").textContent = String(likesReceived);
  if (stat("groups")) stat("groups").textContent = String(countGroups(uid));

  const visible = filterByTab(posts, tab);
  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = EMPTY_TEXT[tab][data.isMe ? 0 : 1];
    postList?.replaceChildren(empty);
    return;
  }

  if (postList) renderPostList(postList, visible);
}

export function renderProfile() {
  document.querySelectorAll(".profile-column").forEach(renderProfileColumn);
  if (window.lucide) window.lucide.createIcons();
}

export function setupProfile() {
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-profile-field="edit"]')) {
      openSettings();
      return;
    }
    const tabButton = event.target.closest("[data-profile-tab]");
    const column = tabButton?.closest(".profile-column");
    if (column) {
      column.dataset.tab = tabButton.dataset.profileTab;
      renderProfileColumn(column);
      if (window.lucide) window.lucide.createIcons();
    }
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
