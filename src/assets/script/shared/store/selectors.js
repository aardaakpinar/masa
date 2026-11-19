/**
 * Saf seçiciler: ne DOM'a ne Firebase'e dokunur, yalnızca store'dan okur.
 * Feature'lar birbirinin içine girmek yerine buradaki seçicileri kullanır.
 */
import { getState } from "./store.js";
import { safeColor, extractHashtags } from "../../utils.js";

export function currentUid(state = getState()) {
  return state.authUser?.uid || "";
}

export function canViewGroup(groupId, state = getState()) {
  if (!groupId) return true;
  const group = state.groups?.[groupId];
  if (!group || !state.authUser) return false;
  return Boolean(group.members?.[state.authUser.uid] || group.ownerId === state.authUser.uid);
}

export function getGroupName(groupId, state = getState()) {
  return state.groups?.[groupId]?.name || "Masa";
}

export function isGroupMember(groupId, state = getState()) {
  const uid = currentUid(state);
  return Boolean(uid && state.groups?.[groupId]?.members?.[uid]);
}

export function isGroupOwner(groupId, state = getState()) {
  const uid = currentUid(state);
  return Boolean(uid && state.groups?.[groupId]?.ownerId === uid);
}

// Profil değişince gönderi/yorumlar yeniden çizilir; ad ve renk kayda kopyalanmaz.
export function resolveAuthor(item, state = getState()) {
  const uid = item?.authorId;
  const live = uid && uid === currentUid(state) ? state.profile : state.users?.[uid];
  const useLive = !item?.isAnonymous && live;
  return {
    name: (useLive && live.name) || item?.authorName || "Anonim",
    color: safeColor((useLive && live.color) || item?.authorColor),
  };
}

export function resolveUserName(uid, fallback, state = getState()) {
  const live = uid && uid === currentUid(state) ? state.profile : state.users?.[uid];
  return live?.name || fallback || "Anonim";
}

export function selectPosts(state = getState()) {
  return Object.entries(state.posts || {}).map(([id, post]) => ({ id, ...post }));
}

// Ana akış: herkese açık, görüntülenebilir, profil için eklenmiş eski gönderiler hariç.
export function selectFeedPosts(state = getState()) {
  return selectPosts(state)
    .filter((post) => !post.__extra && canViewGroup(post.groupId, state) && !post.groupId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function selectGroupFeedPosts(groupId, state = getState()) {
  return selectPosts(state)
    .filter((post) => post.groupId === groupId && !post.__extra)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function selectGroupDetailPosts(groupId, state = getState()) {
  return selectPosts(state)
    .filter((post) => post.groupId === groupId && canViewGroup(groupId, state))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function selectProfilePosts(uid, state = getState()) {
  return selectPosts(state)
    .filter((post) => post.authorId === uid && canViewGroup(post.groupId, state))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function selectSearchPosts(state = getState()) {
  return selectPosts(state)
    .filter((post) => !post.__extra && canViewGroup(post.groupId, state))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function selectGroups(state = getState()) {
  return Object.entries(state.groups || {})
    .map(([id, group]) => ({ id, ...group }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function selectMyGroups(state = getState()) {
  const uid = currentUid(state);
  return selectGroups(state).filter(
    (group) => group.ownerId === uid || group.members?.[uid],
  );
}

export function selectGroupRequests(groupId, state = getState()) {
  return Object.entries(state.groupRequests?.[groupId] || {})
    .sort((a, b) => (a[1]?.requestedAt || 0) - (b[1]?.requestedAt || 0));
}

export function selectGroupMembers(groupId, state = getState()) {
  return Object.entries(state.groups?.[groupId]?.members || {})
    .map(([uid, member]) => ({ uid, ...member }))
    .sort((a, b) => {
      if (a.role === "owner") return -1;
      if (b.role === "owner") return 1;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
}

export function selectProfileData(uid, state = getState()) {
  const isMe = Boolean(state.authUser && state.authUser.uid === uid);
  const live = isMe ? { ...(state.users?.[uid] || {}), ...state.profile } : state.users?.[uid];
  if (!live || live.isDisabled) return null;
  return {
    uid,
    isMe,
    name: live.name || "Anonim",
    color: safeColor(live.color),
    createdAt: live.createdAt || null,
  };
}

export function selectNotifications(state = getState()) {
  return Object.entries(state.notifications || {})
    .map(([id, item]) => ({ id, ...item }))
    .filter((item) => ["like", "comment", "join_request", "join_approved"].includes(item.type))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function selectUnreadCount(state = getState()) {
  return selectNotifications(state).filter((item) => !item.read).length;
}

export function selectTrendingTags(limit = 6, state = getState()) {
  const counts = new Map();
  selectSearchPosts(state)
    .slice(0, 150)
    .forEach((post) => {
      extractHashtags(post.text || "").forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

export function selectOpenFeedColumns(state = getState()) {
  return state.openFeedColumns || [];
}
