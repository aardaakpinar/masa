import { state } from "./state.js";
import { elements } from "./elements.js";
import { initials, formatTime, createRichTextFragment } from "./utils.js";
import { ref, push, set, update, remove, onValue, off, serverTimestamp, query, orderByKey, limitToLast, endAt, get } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { openAuth } from "./ui.js";
import { canViewGroup, getGroupName } from "./groups.js";

const POSTS_PAGE_SIZE = 15;
let oldestLoadedKey = null;
let hasMorePosts = true;
let isLoadingMore = false;
let activeCommentPostId = null;
let liveWindowPostIds = new Set();

export function subscribeToPosts() {
  if (!state.db) return;

  stopPostSubscription();
  state.posts = {};
  oldestLoadedKey = null;
  hasMorePosts = true;
  isLoadingMore = false;
  liveWindowPostIds = new Set();

  state.postsRef = query(ref(state.db, "posts"), orderByKey(), limitToLast(POSTS_PAGE_SIZE));
  onValue(
    state.postsRef,
    (snapshot) => {
      const incomingPosts = snapshot.val() || {};
      const incomingIds = new Set(Object.keys(incomingPosts));

      // Remove posts that disappeared from the live window (e.g. deleted).
      liveWindowPostIds.forEach((id) => {
        if (!incomingIds.has(id)) {
          delete state.posts[id];
        }
      });

      state.posts = { ...state.posts, ...incomingPosts };
      liveWindowPostIds = incomingIds;
      const keys = Object.keys(state.posts);
      if (keys.length) {
        oldestLoadedKey = keys.sort()[0];
      }
      renderPosts();
    },
    (error) => {
      if (elements.settingsError) {
        elements.settingsError.textContent = "Postlar yüklenemedi: " + error.message;
      }
    },
  );
}

export function stopPostSubscription() {
  if (state.db && state.postsRef) {
    off(state.postsRef);
  }
  state.postsRef = null;
}

export async function loadMorePosts() {
  if (!state.db || !hasMorePosts || isLoadingMore || !oldestLoadedKey) return;

  isLoadingMore = true;
  try {
    const olderPostsQuery = query(
      ref(state.db, "posts"),
      orderByKey(),
      endAt(oldestLoadedKey),
      limitToLast(POSTS_PAGE_SIZE + 1),
    );
    const snapshot = await get(olderPostsQuery);
    const page = snapshot.val() || {};
    const entries = Object.entries(page);

    const filtered = entries.filter(([id]) => id !== oldestLoadedKey);
    if (!filtered.length) {
      hasMorePosts = false;
      return;
    }

    state.posts = {
      ...Object.fromEntries(filtered),
      ...state.posts,
    };
    oldestLoadedKey = filtered.map(([id]) => id).sort()[0];
    if (filtered.length < POSTS_PAGE_SIZE) {
      hasMorePosts = false;
    }
    renderPosts();
  } catch (error) {
    if (elements.settingsError) {
      elements.settingsError.textContent = "Daha fazla post yüklenemedi: " + error.message;
    }
  } finally {
    isLoadingMore = false;
  }
}

export function renderPosts() {
  if (!elements.postList) return;
  
  const posts = Object.entries(state.posts)
    .map(([id, post]) => ({ id, ...post }))
    .filter((post) => canViewGroup(post.groupId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "İlk postu paylaşarak akışı başlat.";
    elements.postList.replaceChildren(empty);
    return;
  }

  if (activeCommentPostId) {
    const activePost = posts.find((post) => post.id === activeCommentPostId);
    if (!activePost) {
      activeCommentPostId = null;
      elements.postList.replaceChildren(...posts.map(createPostElement));
      return;
    }
    elements.postList.replaceChildren(createCommentScreen(activePost));
    refreshIcons();
    return;
  }

  elements.postList.replaceChildren(...posts.map(createPostElement));
  refreshIcons();
  window.dispatchEvent(new Event("posts:updated"));
}

export function createPostElement(post) {
  const article = document.createElement("article");
  article.className = "post";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.style.background = post.authorColor || "#2563eb";
  avatar.textContent = initials(post.authorName);

  const body = document.createElement("div");
  const header = document.createElement("div");
  header.className = "post-header";

  const author = document.createElement("span");
  author.className = "post-author";
  author.textContent = post.authorName || "Anonim";

  const meta = document.createElement("div");
meta.className = "post-meta";

if (post.groupId) {
  const groupBadge = document.createElement("span");
  groupBadge.className = "post-group-badge";
  groupBadge.textContent = "#" + getGroupName(post.groupId);

  meta.append(groupBadge);
}

const time = document.createElement("time");
time.className = "post-time";
time.textContent = formatTime(post.createdAt);

meta.append(time);

header.append(author, meta);

  const text = document.createElement("p");
  text.className = "post-text";
  text.append(createRichTextFragment(post.text || ""));

  const actions = document.createElement("div");
  actions.className = "post-actions";

  const likes = post.likes || {};
  const liked = Boolean(state.authUser && likes[state.authUser.uid]);
  const likeButton = document.createElement("button");
  likeButton.className = `action-button${liked ? " liked" : ""}`;
  likeButton.type = "button";
  const likeIcon = document.createElement("span");
  likeIcon.setAttribute("data-lucide", "heart");
  likeButton.append(likeIcon, ` ${Object.keys(likes).length}`);
  likeButton.disabled = !state.authUser;
  likeButton.addEventListener("click", () => toggleLike(post.id, liked));

  const commentCount = Object.keys(post.comments || {}).length;
  const commentButton = document.createElement("button");
  commentButton.className = "action-button";
  commentButton.type = "button";
  const commentIcon = document.createElement("span");
  commentIcon.setAttribute("data-lucide", "message-circle");
  commentButton.append(commentIcon, ` ${commentCount}`);
  commentButton.addEventListener("click", () => openComments(post.id));

  if (!post.__fromDiscover) {
    actions.append(likeButton, commentButton);
  } else {
    actions.append(likeButton);
  }

  if (state.authUser && post.authorId === state.authUser.uid) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "action-button";
    deleteButton.type = "button";
    const deleteIcon = document.createElement("span");
    deleteIcon.setAttribute("data-lucide", "trash-2");
    deleteButton.append(deleteIcon);
    deleteButton.addEventListener("click", () => remove(ref(state.db, `posts/${post.id}`)));
    actions.append(deleteButton);
  }

  body.append(header, text, actions);
  article.append(avatar, body);
  return article;
}

function createCommentsSection(post) {
  const wrap = document.createElement("div");
  wrap.className = "comments";

  const comments = Object.entries(post.comments || {})
    .map(([id, comment]) => ({ id, ...comment }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const list = document.createElement("div");
  list.className = "comments-list";

  if (!comments.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Henüz yorum yok.";
    list.append(empty);
  } else {
    comments.forEach((comment) => {
      const item = document.createElement("div");
      item.className = "comment-item";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.width = "36px";
      avatar.style.height = "36px";
      avatar.style.fontSize = "13px";
      avatar.style.flexShrink = "0";
      avatar.style.background = comment.authorColor;
      avatar.textContent = initials(comment.authorName);

      const contentWrap = document.createElement("div");
      contentWrap.style.minWidth = "0";
      contentWrap.style.flex = "1";

      const meta = document.createElement("div");
      meta.className = "post-header";

      const commenter = document.createElement("span");
      commenter.className = "post-author";
      commenter.textContent = comment.authorName || "Anonim";

      const commentTime = document.createElement("time");
      commentTime.className = "post-time";
      commentTime.textContent = formatTime(comment.createdAt);

      meta.append(commenter, commentTime);

      const content = document.createElement("p");
      content.className = "post-text";
      content.append(createRichTextFragment(comment.text || ""));

      // LIKE SİSTEMİ
      const actions = document.createElement("div");
      actions.className = "post-actions";

      const likes = comment.likes || {};
      const liked = Boolean(
        state.authUser && likes[state.authUser.uid]
      );

      const likeButton = document.createElement("button");
      likeButton.className = `action-button${liked ? " liked" : ""}`;
      likeButton.type = "button";
      const commentLikeIcon = document.createElement("span");
      commentLikeIcon.setAttribute("data-lucide", "heart");
      const commentLikeCount = document.createElement("span");
      commentLikeCount.textContent = String(Object.keys(likes).length);
      likeButton.append(commentLikeIcon, commentLikeCount);

      likeButton.disabled = !state.authUser;

      likeButton.addEventListener("click", async () => {
        if (!state.authUser) return;

        const likeRef = ref(
          state.db,
          `posts/${post.id}/comments/${comment.id}/likes/${state.authUser.uid}`
        );

        try {
          if (liked) {
            await remove(likeRef);
          } else {
            await set(likeRef, true);
          }
        } catch (err) {
          console.error("Yorum beğenilemedi:", err);
        }
      });

      actions.append(likeButton);

      // SİLME
      if (state.authUser && comment.authorId === state.authUser.uid) {
        const del = document.createElement("button");
        del.className = "action-button";
        del.type = "button";
        const commentDeleteIcon = document.createElement("span");
        commentDeleteIcon.setAttribute("data-lucide", "trash-2");
        del.append(commentDeleteIcon);

        del.addEventListener("click", () =>
          remove(ref(state.db, `posts/${post.id}/comments/${comment.id}`))
        );

        actions.append(del);
      }

      contentWrap.append(meta, content, actions);

      item.append(avatar, contentWrap);

      list.append(item);
    });
  }

  wrap.append(list);

  return wrap;
}

function createCommentScreen(post) {
  const container = document.createElement("section");
  container.className = "post comments-screen";
  container.style.paddingLeft = "0";
  container.style.paddingRight = "0";

  const body = document.createElement("div");

  const title = document.createElement("h3");
  title.style.margin = "0";
  title.style.paddingLeft = "18px";
  title.textContent = "Yorumlar";

  const postPreview = createPostElement(post);

  const comments = createCommentsSection(post);

  body.append(title, postPreview, comments);

  container.append(body);

  return container;
}

export function openComments(postId) {
  if (activeCommentPostId === postId) {
    closeComments();
    return;
  }

  activeCommentPostId = postId;
  syncComposerMode();
  renderPosts();
}

export function closeComments() {
  activeCommentPostId = null;
  syncComposerMode();
  renderPosts();
}

export function getComposerMode() {
  return activeCommentPostId ? "comment" : "post";
}

export async function submitComposerText(text) {
  if (activeCommentPostId) {
    await createComment(activeCommentPostId, text);
    return;
  }
  await createPost(text);
}

function syncComposerMode() {
  if (!elements.sendPost || !elements.postText) return;
  const commentMode = Boolean(activeCommentPostId);
  elements.sendPost.textContent = commentMode ? "Yorum Paylaş" : "Paylaş";
  elements.postText.placeholder = commentMode ? "Ne düşünüyorsun?" : "Neler oluyor?";
  elements.postText.maxLength = commentMode ? 180 : 280;
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

export function toggleLike(postId, liked) {
  if (!state.authUser) {
    openAuth();
    return Promise.resolve();
  }

  const likeRef = ref(state.db, `posts/${postId}/likes/${state.authUser.uid}`);
  if (liked) {
    return remove(likeRef);
  }

  return update(ref(state.db, `posts/${postId}/likes`), {
    [state.authUser.uid]: true,
  });
}

export async function createPost(text) {
  if (!state.authUser) {
    throw new Error("Post atmak için giriş yapmalısınız.");
  }
  if (!state.db) {
    throw new Error("Veritabanı bağlantısı kurulamadı.");
  }
  if (!text) return;

  const groupId = elements.postGroupSelect?.value || "";
  const isGroupPost = Boolean(groupId);
  if (isGroupPost && !canViewGroup(groupId)) {
    throw new Error("Bu toplulukta paylaşım yapmak için üye olmalısın.");
  }

  const postRef = push(ref(state.db, "posts"));
  await set(postRef, {
    text,
    authorId: state.authUser.uid,
    authorName: state.profile.name,
    authorColor: state.profile.color,
    createdAt: serverTimestamp(),
    likes: {},
    groupId: isGroupPost ? groupId : "",
  });
}

export async function createComment(postId, text) {
  if (!state.authUser) {
    throw new Error("Yorum yapmak için giriş yapmalısınız.");
  }
  if (!state.db) {
    throw new Error("Veritabanı bağlantısı kurulamadı.");
  }
  if (!text) return;

  const commentRef = push(ref(state.db, `posts/${postId}/comments`));
  await set(commentRef, {
    text: text.slice(0, 180),
    authorId: state.authUser.uid,
    authorName: state.profile.name,
    authorColor: state.profile.color,
    createdAt: serverTimestamp(),
  });
}
