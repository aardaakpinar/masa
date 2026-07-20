import { state } from "./state.js";
import { elements } from "./elements.js";
import {
  initials,
  formatTime,
  createRichTextFragment,
  getContrastColor,
  extractHashtags,
  friendlyErrorMessage,
} from "./utils.js";
import {
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  off,
  serverTimestamp,
  query,
  orderByKey,
  limitToLast,
  endAt,
  get,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { openAuth } from "./ui.js";
import { canViewGroup, getGroupName } from "./groups.js";

const POSTS_PAGE_SIZE = 15;
let oldestLoadedKey = null;
let hasMorePosts = true;
let isLoadingMore = false;
let activeCommentPostId = null;
let liveWindowPostIds = new Set();

// Composer'da beklemede olan medya/anket taslağı (henüz gönderilmemiş)
let pendingMedia = null; // { dataUrl } | null
let pendingPollOptions = null; // string[] | null

export function setPendingMedia(dataUrl) {
  pendingMedia = dataUrl ? { dataUrl } : null;
}

export function clearPendingMedia() {
  pendingMedia = null;
}

export function getPendingMedia() {
  return pendingMedia;
}

export function setPendingPollOptions(options) {
  pendingPollOptions = options;
}

export function clearPendingPoll() {
  pendingPollOptions = null;
}

export function getPendingPollOptions() {
  return pendingPollOptions;
}

export function hasPendingAttachment() {
  return Boolean(pendingMedia || pendingPollOptions);
}

export function subscribeToPosts() {
  if (!state.db) return;

  stopPostSubscription();
  state.posts = {};
  oldestLoadedKey = null;
  hasMorePosts = true;
  isLoadingMore = false;
  liveWindowPostIds = new Set();

  state.postsRef = query(
    ref(state.db, "posts"),
    orderByKey(),
    limitToLast(POSTS_PAGE_SIZE),
  );
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
      renderGroupDetailPosts();
    },
    (error) => {
      console.error("Postlar yüklenemedi:", error);
      if (elements.feedError) {
        elements.feedError.hidden = false;
        elements.feedError.textContent =
          "Postlar yüklenemedi. " + friendlyErrorMessage(error, "Lütfen internet bağlantını kontrol edip tekrar dene.");
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

let loadMoreIndicator = null;

function showLoadMoreIndicator() {
  if (loadMoreIndicator) return;
  loadMoreIndicator = document.createElement("div");
  loadMoreIndicator.className = "empty-state";
  loadMoreIndicator.textContent = "Yükleniyor…";
  elements.postList?.append(loadMoreIndicator);
}

function hideLoadMoreIndicator() {
  loadMoreIndicator?.remove();
  loadMoreIndicator = null;
}

export async function loadMorePosts() {
  if (!state.db || !hasMorePosts || isLoadingMore || !oldestLoadedKey) return;

  isLoadingMore = true;
  showLoadMoreIndicator();
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
    renderGroupDetailPosts();
  } catch (error) {
    console.error("Daha fazla post yüklenemedi:", error);
    if (elements.feedError) {
      elements.feedError.hidden = false;
      elements.feedError.textContent =
        "Daha fazla post yüklenemedi. " + friendlyErrorMessage(error, "Lütfen tekrar dene.");
    }
  } finally {
    hideLoadMoreIndicator();
    isLoadingMore = false;
  }
}

export function renderPosts() {
  if (!elements.postList) return;

  if (elements.postsLoading) elements.postsLoading.remove();

  const selectedGroupId = elements.postGroupSelect?.value || "";

  const posts = Object.entries(state.posts)
    .map(([id, post]) => ({ id, ...post }))
    .filter((post) => canViewGroup(post.groupId))
    .filter((post) => !selectedGroupId || post.groupId === selectedGroupId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = selectedGroupId
      ? "Bu masaya henüz mesaj atılmamış."
      : "İlk postu paylaşarak akışı başlat.";
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

export function renderGroupDetailPosts() {
  if (!elements.groupDetailPostList || !state.activeGroupId) return;

  const groupId = state.activeGroupId;
  const posts = Object.entries(state.posts)
    .map(([id, post]) => ({ id, ...post }))
    .filter((post) => post.groupId === groupId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Bu masaya henüz mesaj atılmamış.";
    elements.groupDetailPostList.replaceChildren(empty);
    return;
  }

  elements.groupDetailPostList.replaceChildren(...posts.map(createPostElement));
  refreshIcons();
}

export function createPostElement(post) {
  const article = document.createElement("article");
  article.className = "post";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.style.background = post.authorColor || "#2563eb";
  avatar.style.color = getContrastColor(post.authorColor || "#2563eb");
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
    groupBadge.textContent = getGroupName(post.groupId);

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

  const mediaEl = post.media?.dataUrl ? createMediaElement(post.media) : null;
  const pollEl = post.poll ? createPollElement(post) : null;

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
  likeButton.addEventListener("click", () => {
    if (!state.authUser) {
      openAuth();
      return;
    }
    toggleLike(post.id, liked);
  });

  const commentCount = Object.keys(post.comments || {}).length;
  const commentButton = document.createElement("button");
  commentButton.className = "action-button";
  commentButton.type = "button";
  const commentIcon = document.createElement("span");
  commentIcon.setAttribute("data-lucide", "message-circle");
  commentButton.append(commentIcon, ` ${commentCount}`);
  commentButton.addEventListener("click", () => {
    if (!state.authUser) {
      openAuth();
      return;
    }
    openComments(post.id);
  });

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
    deleteButton.addEventListener("click", () =>
      remove(ref(state.db, `posts/${post.id}`)),
    );
    actions.append(deleteButton);
  }

  body.append(header, text);
  if (mediaEl) body.append(mediaEl);
  if (pollEl) body.append(pollEl);
  body.append(actions);
  article.append(avatar, body);
  return article;
}

function createMediaElement(media) {
  const wrap = document.createElement("div");
  wrap.className = "post-media";
  const img = document.createElement("img");
  img.src = media.dataUrl;
  img.alt = "Gönderi görseli";
  img.loading = "lazy";
  wrap.append(img);
  return wrap;
}

function createPollElement(post) {
  const wrap = document.createElement("div");
  wrap.className = "post-poll";

  const optionEntries = Object.entries(post.poll?.options || {}).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const totalVotes = optionEntries.reduce(
    (sum, [, option]) => sum + Object.keys(option.votes || {}).length,
    0,
  );
  const myVoteKey = optionEntries.find(([, option]) =>
    Boolean(state.authUser && option.votes?.[state.authUser.uid]),
  )?.[0];

  optionEntries.forEach(([key, option]) => {
    const count = Object.keys(option.votes || {}).length;
    const percent = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
    const voted = myVoteKey === key;

    const button = document.createElement("button");
    button.type = "button";
    button.className = `post-poll-option${voted ? " voted" : ""}`;

    const fill = document.createElement("span");
    fill.className = "post-poll-option-fill";
    if (myVoteKey !== undefined) {
      fill.style.width = `${percent}%`;
    }

    const label = document.createElement("span");
    label.className = "post-poll-option-label";
    const optionText = document.createElement("span");
    optionText.textContent = option.text || "";
    label.append(optionText);
    if (myVoteKey !== undefined) {
      const percentText = document.createElement("span");
      percentText.textContent = `${percent}%`;
      label.append(percentText);
    }

    button.append(fill, label);
    button.addEventListener("click", () => {
      if (!state.authUser) {
        openAuth();
        return;
      }
      voteOnPoll(post.id, key);
    });

    wrap.append(button);
  });

  const meta = document.createElement("div");
  meta.className = "post-poll-meta";
  meta.textContent = `${totalVotes} oy`;
  wrap.append(meta);

  return wrap;
}

export async function voteOnPoll(postId, optionKey) {
  if (!state.authUser) {
    openAuth();
    return;
  }
  const post = state.posts[postId];
  const options = post?.poll?.options;
  if (!options || !options[optionKey]) return;

  const uid = state.authUser.uid;
  const updates = {};
  Object.keys(options).forEach((key) => {
    if (key === optionKey) {
      updates[`posts/${postId}/poll/options/${key}/votes/${uid}`] = true;
    } else if (options[key].votes?.[uid]) {
      updates[`posts/${postId}/poll/options/${key}/votes/${uid}`] = null;
    }
  });

  try {
    await update(ref(state.db), updates);
  } catch (error) {
    console.error("Oy kullanılamadı:", error);
  }
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
    empty.className = "comment-empty";

    const icon = document.createElement("span");
    icon.className = "comment-empty-icon";
    icon.setAttribute("data-lucide", "message-circle");
    const emptyText = document.createElement("span");
    emptyText.textContent = "Henüz yorum yok. İlk yorumu sen yap.";

    empty.append(icon, emptyText);
    list.append(empty);
  } else {
    comments.forEach((comment) => {
      const item = document.createElement("div");
      item.className = "comment-item";

      // Avatar column with thread line
      const avatarCol = document.createElement("div");
      avatarCol.className = "comment-avatar-col";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.width = "36px";
      avatar.style.height = "36px";
      avatar.style.fontSize = "13px";
      avatar.style.flexShrink = "0";
      avatar.style.background = comment.authorColor || "#2563eb";
      avatar.style.color = getContrastColor(comment.authorColor || "#2563eb");
      avatar.textContent = initials(comment.authorName);

      const threadLine = document.createElement("div");
      threadLine.className = "comment-thread-line";

      avatarCol.append(avatar, threadLine);

      // Content
      const content = document.createElement("div");
      content.className = "comment-content";

      const meta = document.createElement("div");
      meta.className = "comment-meta";

      const commenter = document.createElement("span");
      commenter.className = "comment-author";
      commenter.textContent = comment.authorName || "Anonim";

      const commentTime = document.createElement("time");
      commentTime.className = "comment-time";
      commentTime.textContent = formatTime(comment.createdAt);

      meta.append(commenter, commentTime);

      const text = document.createElement("p");
      text.className = "comment-text";
      text.append(createRichTextFragment(comment.text || ""));

      // Actions
      const actions = document.createElement("div");
      actions.className = "comment-actions";

      const likes = comment.likes || {};
      const liked = Boolean(state.authUser && likes[state.authUser.uid]);

      const likeButton = document.createElement("button");
      likeButton.className = `action-button${liked ? " liked" : ""}`;
      likeButton.type = "button";
      const commentLikeIcon = document.createElement("span");
      commentLikeIcon.setAttribute("data-lucide", "heart");
      const commentLikeCount = document.createElement("span");
      commentLikeCount.textContent = String(Object.keys(likes).length);
      likeButton.append(commentLikeIcon, commentLikeCount);

      likeButton.addEventListener("click", async () => {
        if (!state.authUser) {
          openAuth();
          return;
        }
        const likeRef = ref(
          state.db,
          `posts/${post.id}/comments/${comment.id}/likes/${state.authUser.uid}`,
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

      if (state.authUser && comment.authorId === state.authUser.uid) {
        const del = document.createElement("button");
        del.className = "action-button";
        del.type = "button";
        const commentDeleteIcon = document.createElement("span");
        commentDeleteIcon.setAttribute("data-lucide", "trash-2");
        del.append(commentDeleteIcon);
        del.addEventListener("click", () =>
          remove(ref(state.db, `posts/${post.id}/comments/${comment.id}`)),
        );
        actions.append(del);
      }

      content.append(meta, text, actions);
      item.append(avatarCol, content);
      list.append(item);
    });
  }

  wrap.append(list);
  return wrap;
}

function createCommentScreen(post) {
  const container = document.createElement("section");
  container.className = "comments-screen";
  container.style.paddingLeft = "0";
  container.style.paddingRight = "0";

  const body = document.createElement("div");

  // Original post preview
  const postPreview = createPostElement(post);

  // Section heading
  const heading = document.createElement("div");
  heading.className = "comments-section-heading";
  const headingIcon = document.createElement("span");
  headingIcon.setAttribute("data-lucide", "message-circle");
  const headingText = document.createElement("span");
  const commentCount = Object.keys(post.comments || {}).length;
  headingText.textContent =
    commentCount > 0 ? `${commentCount} Yorum` : "Yorumlar";
  heading.append(headingIcon, headingText);

  const comments = createCommentsSection(post);

  body.append(postPreview, heading, comments);
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
  await createPost(text, {
    media: pendingMedia,
    pollOptions: pendingPollOptions,
  });
  clearPendingMedia();
  clearPendingPoll();
}

function syncComposerMode() {
  if (!elements.sendPost || !elements.postText) return;
  const commentMode = Boolean(activeCommentPostId);
  elements.postText.placeholder = commentMode
    ? "Ne düşünüyorsun?"
    : "Neler oluyor?";
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

export async function createPost(text, { media, pollOptions } = {}) {
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
    throw new Error("Bu masada paylaşım yapmak için üye olmalısın.");
  }

  const tags = extractHashtags(text);
  const tagMap = {};
  tags.forEach((tag) => {
    tagMap[tag.replace(/^#/, "")] = true;
  });

  const payload = {
    text,
    authorId: state.authUser.uid,
    authorName: state.profile.name,
    authorColor: state.profile.color,
    createdAt: serverTimestamp(),
    likes: {},
    groupId: isGroupPost ? groupId : "",
  };

  if (Object.keys(tagMap).length) {
    payload.tags = tagMap;
  }

  if (media?.dataUrl) {
    payload.media = { type: "image", dataUrl: media.dataUrl };
  }

  const cleanOptions = (pollOptions || [])
    .map((option) => (option || "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (cleanOptions.length >= 2) {
    const options = {};
    cleanOptions.forEach((optionText, index) => {
      options[String(index)] = { text: optionText, votes: {} };
    });
    payload.poll = { options };
  }

  const postRef = push(ref(state.db, "posts"));
  await set(postRef, payload);
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
