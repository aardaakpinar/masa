/**
 * posts feature'ının feature-içi ortak durumu ve saf yardımcıları.
 * Dış feature'lar bu dosyayı import etmez; her şey index.js üzerinden geçer.
 */
import { state } from "../../state.js";
import { dispatch } from "../../shared/store/store.js";
import {
	watchComments as repoWatchComments,
	readMedia,
	stopListener,
} from "../../services/repositories/posts.js";

export const POSTS_PAGE_SIZE = 15;
export const GROUP_POSTS_LIMIT = 100;
export const SAFE_IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;

// Birleşik gönderi haritası: herkese açık + profil fazlası + masa gönderileri.
export let publicPosts = {};
export function setPublicPosts(posts) {
	publicPosts = posts;
}

export const extraPosts = new Map();
export const extraRefs = new Map();

// Yorum dinlemeleri yalnızca açık olan gönderiler için tutulur.
export const commentCache = new Map();
export const commentRefs = new Map();
export const profileCommentPostIds = new WeakMap();
export const profileOpenCommentIds = new Set();
export let activeCommentPostId = null;
export function setActiveCommentPostId(id) {
	activeCommentPostId = id;
}

let commentsRefresh = () => {};
export function setCommentsRefresh(fn) {
	commentsRefresh = fn;
}

/** Herkese açık + ek + masa gönderilerini tek haritada birleştirir. */
export function rebuildPosts() {
	const merged = {};
	Object.entries(publicPosts).forEach(([id, post]) => {
		merged[id] = { ...post, __path: `posts/${id}` };
	});
	extraPosts.forEach((posts) => {
		Object.entries(posts).forEach(([id, post]) => {
			if (!merged[id]) merged[id] = { ...post, __path: `posts/${id}`, __extra: true };
		});
	});
	Object.entries(state.groupPosts).forEach(([groupId, map]) => {
		Object.entries(map).forEach(([id, post]) => {
			merged[id] = { ...post, groupId, __path: `group_posts/${groupId}/${id}` };
		});
	});
	dispatch("posts", merged);
}

// Gönderinin veritabanındaki yolu (bellekteki __path alanından okunur).
export function postPath(postId) {
	return state.posts[postId]?.__path || `posts/${postId}`;
}

function sidePath(kind, postId) {
	const path = postPath(postId);
	const groupMatch = path.match(/^group_posts\/([^/]+)\/(.+)$/);
	return groupMatch
		? `group_${kind}/${groupMatch[1]}/${groupMatch[2]}`
		: `${kind}/${postId}`;
}

export function mediaPath(postId) {
	return sidePath("post_media", postId);
}

export function commentsPath(postId) {
	return sidePath("post_comments", postId);
}

export function getComments(post) {
	return commentCache.has(post.id) ? commentCache.get(post.id) : post.comments || {};
}

export function getCommentCount(post) {
	if (commentCache.has(post.id)) return Object.keys(commentCache.get(post.id)).length;
	return Number.isFinite(post.commentCount)
		? post.commentCount
		: Object.keys(post.comments || {}).length;
}

/** Eski ve yeni oy modelini birleştirip sayıları/kişisel oyu çıkarır. */
export function getPollVotes(post) {
	const voteByUser = {};
	Object.entries(post.poll?.options || {}).forEach(([key, option]) => {
		Object.keys(option.votes || {}).forEach((uid) => {
			voteByUser[uid] = key;
		});
	});
	Object.entries(post.poll?.votes || {}).forEach(([uid, key]) => {
		voteByUser[uid] = String(key);
	});

	const counts = {};
	Object.values(voteByUser).forEach((key) => {
		counts[key] = (counts[key] || 0) + 1;
	});
	return {
		counts,
		total: Object.keys(voteByUser).length,
		mine: state.authUser ? voteByUser[state.authUser.uid] : undefined,
	};
}

// ---- Görseller: ekrana yaklaşınca bir kez indirilir ----
const mediaCache = new Map();

export function loadMedia(postId) {
	const path = mediaPath(postId);
	if (!mediaCache.has(path)) {
		mediaCache.set(path, readMedia(path));
	}
	return mediaCache.get(path);
}

// ---- Yorum dinlemeleri ----

export function watchComments(postId) {
	if (!state.db || commentRefs.has(postId)) return;
	const path = commentsPath(postId);
	const { ref: commentsRef, unsubscribe } = repoWatchComments(
		path,
		(comments) => {
			commentCache.set(postId, comments);
			commentsRefresh();
		},
		() => {
			commentCache.set(postId, {});
			commentsRefresh();
		},
	);
	commentRefs.set(postId, { commentsRef, unsubscribe });
}

export function unwatchComments(keepIds) {
	[...commentRefs.keys()].forEach((postId) => {
		if (keepIds.has(postId)) return;
		const entry = commentRefs.get(postId);
		stopListener(entry?.unsubscribe);
		commentRefs.delete(postId);
		commentCache.delete(postId);
	});
}

export function syncCommentWatchers() {
	const keep = new Set(profileOpenCommentIds);
	if (activeCommentPostId) keep.add(activeCommentPostId);
	unwatchComments(keep);
}
