import { state } from "./state.js";
import { elements } from "./elements.js";
import { initials, cleanName, getContrastColor } from "./utils.js";
import {
  ref,
  push,
  set,
  onValue,
  off,
  query,
  orderByChild,
  limitToLast,
  serverTimestamp,
  update,
  remove,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

let isSubmittingGroup = false;

export function subscribeToGroups() {
  if (!state.db) return;

  stopGroupSubscription();
  state.groups = {};
  state.groupsRef = query(ref(state.db, "groups"), orderByChild("createdAt"), limitToLast(100));

  onValue(
    state.groupsRef,
    (snapshot) => {
      state.groups = snapshot.val() || {};
      renderGroups();
    },
    (error) => {
      console.error("Masalar yüklenemedi:", error);
    },
  );
}

export function stopGroupSubscription() {
  if (state.db && state.groupsRef) {
    off(state.groupsRef);
  }
  state.groupsRef = null;
}

function getGroups() {
  return Object.entries(state.groups || {})
    .map(([id, group]) => ({ id, ...group }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function isMember(group) {
  return Boolean(state.authUser && group.members && group.members[state.authUser.uid]);
}

function createGroupCard(group, { compact = false } = {}) {
  const card = document.createElement("article");
  card.className = compact ? "group-card group-card--compact" : "group-card";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "group-card__head";
  head.addEventListener("click", () => {
    if (state.authUser && group.members?.[state.authUser.uid]) {
      state.activeGroupId = group.id;
      window.dispatchEvent(new Event("groups:open"));
    }
  });

  const avatar = document.createElement("div");
  avatar.className = "avatar group-card__avatar";
  avatar.style.background = group.color || "#2563eb";
  avatar.style.color = getContrastColor(group.color || "#2563eb");
  avatar.textContent = initials(group.name);

  const content = document.createElement("span");
  content.className = "group-card__content";

  const title = document.createElement("h4");
  title.textContent = group.name || "Masa";

  const meta = document.createElement("span");
  meta.className = "group-card__meta";
  const memberCount = Object.keys(group.members || {}).length;
  meta.textContent = `${memberCount} üye · ${group.ownerName || "Anonim"} oluşturdu`;

  const description = document.createElement("p");
  description.className = "group-card__description";
  description.textContent = group.description || "Açıklama eklenmemiş.";

  const titleRow = document.createElement("span");
  titleRow.className = "group-card__title-row";

  const titleWrap = document.createElement("span");
  titleWrap.className = "group-card__title-wrap";

  const status = document.createElement("span");
  status.className = "group-card__status";

  const actions = document.createElement("div");
  actions.className = "group-card__actions";

  if (state.authUser) {
    const joined = isMember(group);
    const isOwner = group.ownerId === state.authUser.uid;
    status.textContent = isOwner || joined ? "üye" : "öneri";

    if (!joined && !isOwner) {
      const joinButton = document.createElement("button");
      joinButton.type = "button";
      joinButton.className = "button button--secondary group-action";
      joinButton.textContent = "Katıl";
      joinButton.addEventListener("click", async () => {
        joinButton.disabled = true;
        joinButton.textContent = "Katılınıyor…";
        try { await joinGroup(group.id); } finally {
          joinButton.disabled = false;
          joinButton.textContent = "Katıl";
        }
      });
      actions.append(joinButton);
    }

    if (joined && !isOwner) {
      const leaveButton = document.createElement("button");
      leaveButton.type = "button";
      leaveButton.className = "button button--secondary group-action";
      leaveButton.textContent = "Gruptan Çık";
      leaveButton.addEventListener("click", async () => {
        leaveButton.disabled = true;
        leaveButton.textContent = "Ayrılınıyor…";
        try { await leaveGroup(group.id); } finally {
          leaveButton.disabled = false;
          leaveButton.textContent = "Gruptan Çık";
        }
      });
      actions.append(leaveButton);
    }

    if (isOwner) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "button button--danger group-action";
      deleteButton.textContent = "Sil";
      deleteButton.addEventListener("click", () => deleteGroup(group.id));
      actions.append(deleteButton);
    }
  } else {
    status.textContent = "öneri";
  }

  const arrow = document.createElement("span");
  arrow.className = "group-card__arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`;

  titleWrap.append(title);
  titleRow.append(titleWrap, status, arrow);

  content.append(titleRow, meta, description);
  if (actions.childNodes.length) {
    content.append(actions);
  }

  head.append(avatar, content);
  card.append(head);
  return card;
}

function renderInto(container, groups, emptyText) {
  if (!container) return;

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state empty-state--compact";
    empty.textContent = emptyText;
    container.replaceChildren(empty);
    return;
  }

  container.replaceChildren(...groups.map((group) => createGroupCard(group, { compact: container !== elements.groupsList })));
}

export function renderGroups() {
  const groups = getGroups();
  renderInto(elements.groupsList, groups, "Henüz bir masa yok. İlkini sen oluştur.");
  renderInto(elements.topGroupsList, groups.slice(0, 3), "Henüz önerilecek masa yok.");
  syncComposerGroupOptions();
  updateGroupStats();
}

function syncComposerGroupOptions() {
  if (!elements.postGroupSelect) return;

  const groups = getGroups().filter(isMember);
  const current = elements.postGroupSelect.value;

  const options = [
    { value: "", label: "Akış" },
    ...groups.map((group) => ({ value: group.id, label: group.name })),
  ];

  elements.postGroupSelect.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );

  if (current && options.some((option) => option.value === current)) {
    elements.postGroupSelect.value = current;
  } else {
    elements.postGroupSelect.value = "";
    state.activeGroupId = "";
  }
}

function updateGroupStats() {
  if (elements.groupCount) {
    elements.groupCount.textContent = String(getGroups().length);
  }
  if (elements.groupNameCount) {
    elements.groupNameCount.textContent = `${elements.groupNameInput?.value.length || 0}/48`;
  }
  if (elements.groupDescriptionCount) {
    elements.groupDescriptionCount.textContent = `${elements.groupDescriptionInput?.value.length || 0}/160`;
  }
}

export async function createGroup({ name, description }) {
  if (!state.authUser) {
    throw new Error("Masa oluşturmak için giriş yapmalısın.");
  }
  if (!state.db) {
    throw new Error("Veritabanı bağlantısı kurulamadı.");
  }

  const groupName = cleanName(name).slice(0, 48);
  const groupDescription = String(description || "").trim().slice(0, 160);

  if (!groupName) {
    throw new Error("Masa adı gerekli.");
  }

  const groupRef = push(ref(state.db, "groups"));
  await set(groupRef, {
    name: groupName,
    description: groupDescription,
    color: state.profile.color || "#2563eb",
    ownerId: state.authUser.uid,
    ownerName: state.profile.name,
    createdAt: serverTimestamp(),
    members: {
      [state.authUser.uid]: {
        role: "owner",
        joinedAt: serverTimestamp(),
      },
    },
  });

  return groupRef.key;
}

export async function joinGroup(groupId) {
  if (!state.authUser || !state.db) return;

  const group = state.groups?.[groupId];
  if (!group) return;
  if (group.members?.[state.authUser.uid]) return;

  try {
    await update(ref(state.db, `groups/${groupId}/members/${state.authUser.uid}`), {
      role: "member",
      joinedAt: serverTimestamp(),
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (elements.groupError) {
      elements.groupError.textContent =
        "Topluluğa katılınamadı: " +
        error.message +
        (message.includes("Permission denied")
          ? " Rules içinde members/$uid/role için 'member' izni verin."
          : "");
    }
    throw error;
  }
}

export async function leaveGroup(groupId) {
  if (!state.authUser || !state.db) return;

  const group = state.groups?.[groupId];
  if (!group) return;
  if (group.ownerId === state.authUser.uid) return;
  if (!group.members?.[state.authUser.uid]) return;

  const confirmed = confirm(`"${group.name}" grubundan çıkmak istediğine emin misin?`);
  if (!confirmed) return;

  try {
    await remove(ref(state.db, `groups/${groupId}/members/${state.authUser.uid}`));
  } catch (error) {
    const message = String(error?.message || "");
    if (elements.groupError) {
      elements.groupError.textContent =
        "Gruptan çıkılamadı: " +
        error.message +
        (message.includes("Permission denied")
          ? " Rules içinde members/$uid için silme izni verin."
          : "");
    }
    throw error;
  }
}

export async function deleteGroup(groupId) {
  if (!state.authUser || !state.db) return;
  const group = state.groups?.[groupId];
  if (!group || group.ownerId !== state.authUser.uid) return;

  const confirmed = confirm(`"${group.name}" topluluğunu silmek istediğine emin misin?`);
  if (!confirmed) return;

  await remove(ref(state.db, `groups/${groupId}`));
  if (state.activeGroupId === groupId) {
    state.activeGroupId = "";
  }
}

export function canViewGroup(groupId) {
  if (!groupId) return true;
  const group = state.groups?.[groupId];
  if (!group) return false;
  if (!state.authUser) return false;
  return Boolean(group.members?.[state.authUser.uid] || group.ownerId === state.authUser.uid);
}

export function getGroupName(groupId) {
  return state.groups?.[groupId]?.name || "Masa";
}

export function getMemberGroups() {
  return getGroups().filter(isMember);
}

export async function submitGroupForm() {
  if (isSubmittingGroup) return;

  isSubmittingGroup = true;
  if (elements.createGroupButton) {
    elements.createGroupButton.disabled = true;
  }

  try {
    await createGroup({
      name: elements.groupNameInput?.value || "",
      description: elements.groupDescriptionInput?.value || "",
    });

    if (elements.groupNameInput) elements.groupNameInput.value = "";
    if (elements.groupDescriptionInput) elements.groupDescriptionInput.value = "";
  } catch (error) {
    console.error("Masa oluşturulamadı:", error);
  } finally {
    isSubmittingGroup = false;
    if (elements.createGroupButton) {
      elements.createGroupButton.disabled = false;
    }
  }
}

export function syncGroupFormCounts() {
  updateGroupStats();
}
