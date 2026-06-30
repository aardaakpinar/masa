import { elements } from "./elements.js";
import { state } from "./state.js";
import { createPostElement } from "./posts.js";
import { createGroupCard } from "./groups.js";
import { openSearch } from "./ui.js";

let queryText = "";

function getPosts() {
  return Object.entries(state.posts || {})
    .map(([id, post]) => ({ id, ...post }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getGroups() {
  return Object.entries(state.groups || {})
    .map(([id, group]) => ({ id, ...group }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderGroupResults(groupQuery) {
  const q = groupQuery.trim().toLowerCase();
  const groups = getGroups().filter((group) => {
    if (!q) return true;
    const source = `${group.name || ""} ${group.description || ""}`.toLowerCase();
    return source.includes(q);
  });

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Masa bulunamadı.";
    elements.searchResults.replaceChildren(empty);
    return;
  }

  elements.searchResults.replaceChildren(
    ...groups.map((group) => createGroupCard(group, { compact: true }))
  );

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

export function renderDiscover() {
  if (!elements.searchResults) return;

  const rawQuery = queryText.trim();

  if (rawQuery.startsWith("-")) {
    renderGroupResults(rawQuery.slice(1));
    return;
  }

  const posts = getPosts();
  const q = rawQuery.toLowerCase();
  const qWithoutHash = q.startsWith("#") ? q.slice(1) : q;
  const qWithoutAt = q.startsWith("@") ? q.slice(1) : q;

  let results = [];

  if (q) {
    posts.forEach((post) => {
      const postSource = `
        ${post.text || ""}
        ${post.authorName || ""}
      `.toLowerCase();

      const postMatch =
        q.startsWith("@")
          ? (post.authorName || "").toLowerCase().includes(qWithoutAt)
          : postSource.includes(q) ||
            (q.startsWith("#") && postSource.includes(qWithoutHash));

      if (postMatch) {
        results.push({
          ...post,
          __fromDiscover: true
        });
      }

      Object.values(post.comments || {}).forEach((comment) => {
        const commentSource = `
          ${comment.text || ""}
          ${comment.authorName || ""}
        `.toLowerCase();

        const commentMatch =
          q.startsWith("@")
            ? (comment.authorName || "").toLowerCase().includes(qWithoutAt)
            : commentSource.includes(q) ||
              (q.startsWith("#") && commentSource.includes(qWithoutHash));

        if (commentMatch) {
          results.push({
            ...comment,
            id: `${post.id}-${comment.createdAt}`,
            createdAt: comment.createdAt,
            likes: comment.likes || {},
            comments: {},
            __fromDiscover: true,
            __isComment: true
          });
        }
      });
    });
  } else {
    results = posts.slice(0, 8).map((post) => ({
      ...post,
      __fromDiscover: true
    }));
  }

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Sonuç bulunamadı.";
    elements.searchResults.replaceChildren(empty);
    return;
  }

  elements.searchResults.replaceChildren(
    ...results.map((item) => createPostElement(item))
  );

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

export function setupDiscover() {
  elements.searchInput?.addEventListener("input", (event) => {
    queryText = event.target.value || "";
    renderDiscover();
  });

  window.addEventListener("posts:updated", renderDiscover);
  window.addEventListener("search:query", (event) => {
    openSearch();
    queryText = event.detail?.query || "";
    if (elements.searchInput) {
      elements.searchInput.value = queryText;
    }
    renderDiscover();
  });
}
