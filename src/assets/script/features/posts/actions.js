/** posts feature'ı yazma action'ları: kullanıcı niyeti → repository. */
import { state } from "../../state.js";
import { openAuth } from "../../ui.js";
import { notify, likeNotificationKey } from "../../notifications.js";
import { canViewGroup } from "../../shared/store/selectors.js";
import { extractHashtags } from "../../utils.js";
import {
	writeAt,
	removeAt,
	reservePostKey,
	nextCommentKey,
	changeCommentCount,
	addLike,
	setLike,
	votePoll as repoVotePoll,
	timestamp,
} from "../../services/repositories/posts.js";
import { postPath, mediaPath, commentsPath } from "./internal.js";

/** Gönderiyi ve bağlı yorum/görsel düğümlerini siler. */
export async function deletePost(post) {
	const id = post.id;
	const tasks = [commentsPath(id), post.hasMedia ? mediaPath(id) : null];
	for (const path of tasks) {
		if (!path) continue;
		try {
			await removeAt(path);
		} catch (error) {
			console.warn("Bağlı veri silinemedi:", error);
		}
	}
	await removeAt(postPath(id));
}

export async function deleteComment(postId, commentId) {
	if (!state.db) return;
	await removeAt(`${commentsPath(postId)}/${commentId}`);
	await changeCommentCount(`${postPath(postId)}/commentCount`, -1);
}

export function toggleLike(postId, liked) {
	if (!state.authUser) {
		openAuth();
		return Promise.resolve();
	}

	const path = `${postPath(postId)}/likes/${state.authUser.uid}`;
	if (liked) {
		return removeAt(path);
	}

	const authorId = state.posts[postId]?.authorId;
	const snippet = String(state.posts[postId]?.text || "").slice(0, 100);
	const groupId = state.posts[postId]?.groupId || "";
	return addLike(`${postPath(postId)}/likes`, state.authUser.uid).then(() =>
		notify(authorId, { type: "like", postId, groupId, snippet }, likeNotificationKey(postId)),
	);
}

export async function voteOnPoll(postId, optionKey) {
	if (!state.authUser) {
		openAuth();
		return;
	}
	const post = state.posts[postId];
	const options = post?.poll?.options;
	if (!options || !options[optionKey]) return;

	try {
		// Tek düğüm = tek oy: aynı kullanıcı birden fazla şıkka oy veremez.
		await repoVotePoll(`${postPath(postId)}/poll/votes/${state.authUser.uid}`, optionKey);
	} catch (error) {
		console.error("Oy kullanılamadı:", error);
	}
}

export async function createPost(text, { groupId = "", media, pollOptions } = {}) {
	if (!state.authUser) throw new Error("Post atmak için giriş yapmalısınız.");
	if (!state.db) throw new Error("Veritabanı bağlantısı kurulamadı.");
	if (!text) return;

	const isGroupPost = Boolean(groupId);
	if (isGroupPost && !canViewGroup(groupId)) {
		throw new Error("Bu masada paylaşım yapmak için üye olmalısın.");
	}

	const tagMap = {};
	extractHashtags(text).forEach((tag) => {
		tagMap[tag.replace(/^#/, "")] = true;
	});

	const payload = {
		text,
		authorId: state.authUser.uid,
		createdAt: timestamp(),
		likes: {},
		groupId: isGroupPost ? groupId : "",
		commentCount: 0,
	};
	if (Object.keys(tagMap).length) payload.tags = tagMap;
	if (media?.dataUrl) payload.hasMedia = true; // görsel post_media altında tutulur

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

	const postKey = reservePostKey(isGroupPost ? groupId : "");
	const path = isGroupPost ? `group_posts/${groupId}/${postKey}` : `posts/${postKey}`;
	await writeAt(path, payload);

	if (media?.dataUrl) {
		const mediaDest = isGroupPost ? `group_post_media/${groupId}/${postKey}` : `post_media/${postKey}`;
		try {
			await writeAt(mediaDest, { type: "image", dataUrl: media.dataUrl });
		} catch (error) {
			await removeAt(path).catch(() => {}); // yarım gönderi bırakma
			throw error;
		}
	}
}

export async function createComment(postId, text) {
	if (!state.authUser) throw new Error("Yorum yapmak için giriş yapmalısınız.");
	if (!state.db) throw new Error("Veritabanı bağlantısı kurulamadı.");
	if (!text) return;

	const path = commentsPath(postId);
	const commentId = nextCommentKey(path);
	await writeAt(`${path}/${commentId}`, {
		text: text.slice(0, 180),
		authorId: state.authUser.uid,
		createdAt: timestamp(),
	});
	notify(state.posts[postId]?.authorId, {
		type: "comment",
		postId,
		groupId: state.posts[postId]?.groupId || "",
		snippet: text,
	});
	await changeCommentCount(`${postPath(postId)}/commentCount`, 1);
}

export async function submitComposerText(text, { groupId = "", commentPostId = "", media = null, pollOptions = null } = {}) {
	if (commentPostId) {
		const post = state.posts[commentPostId];
		if (!post || (post.groupId || "") !== groupId) {
			throw new Error("Yorum yapılacak gönderi bulunamadı.");
		}
		await createComment(commentPostId, text);
		return;
	}
	await createPost(text, { groupId, media, pollOptions });
}

// setLike yalnızca yorum beğenileri için kullanılır; gönderi beğenisi addLike/removeAt ile yönetilir.
export { setLike };
