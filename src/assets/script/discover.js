import { elements } from "./elements.js";
import { state } from "./state.js";

let queryText = "";

function getPosts() {
  return Object.entries(state.posts || {})
    .map(([id, post]) => ({ id, ...post }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function renderDiscover() {
  if (!elements.searchResults) return;
  const posts = getPosts();
  const q = queryText.trim().toLowerCase();
  const filtered = q
    ? posts.filter((post) => `${post.text || ""} ${post.authorName || ""}`.toLowerCase().includes(q))
    : posts.slice(0, 8);

  elements.searchResults.innerHTML = filtered.length
    ? filtered
        .map(
          (post) =>
            `<article class="post"><div class="avatar" style="background:${post.authorColor || "#2563eb"}">${(post.authorName || "A").slice(0, 1).toUpperCase()}</div><div><div class="post-header"><strong class="post-author">${post.authorName || "Anonim"}</strong></div><p class="post-text">${post.text || ""}</p></div></article>`,
        )
        .join("")
    : `<div class="empty-state">Sonuc bulunamadi.</div>`;
}

export function setupDiscover() {
  elements.searchInput?.addEventListener("input", (event) => {
    queryText = event.target.value || "";
    renderDiscover();
  });

  window.addEventListener("posts:updated", renderDiscover);
}
