/** posts feature'ının Firebase canlı abonelikleri. Veriyi repository'den alır, store'a yazar. */
import { state } from "../../state.js";
import { elements } from "../../elements.js";
import { dispatch, subscribe } from "../../shared/store/store.js";
import { friendlyErrorMessage } from "../../utils.js";
import {
	watchPublicPosts,
	watchProfilePosts,
	watchGroupPosts,
	fetchOlderPosts,
	fetchOwnPosts,
	stopListener,
} from "../../services/repositories/posts.js";
import {
	POSTS_PAGE_SIZE,
	GROUP_POSTS_LIMIT,
	publicPosts,
	setPublicPosts,
	extraPosts,
	extraRefs,
	rebuildPosts,
	setCommentsRefresh,
} from "./internal.js";
import { renderPosts, renderGroupDetailPosts } from "./view.js";

let oldestLoadedKey = null;
let hasMorePosts = true;
let isLoadingMore = false;
let liveWindowPostIds = new Set();
let loadMoreIndicator = null;

// posts dilimi değişince görünümler store üzerinden yenilenir. `rebuildPosts()`
// dispatch ettiği için abonelikler artık elle render çağrısı yapmaz.
let unsubscribePostsView = null;

function ensurePostsViewSubscription() {
	if (unsubscribePostsView) return;
	unsubscribePostsView = subscribe("posts", () => {
		renderPosts();
		window.dispatchEvent(new Event("profile:refresh"));
	});
}

// Yalnızca posts dışındaki veriler (kullanıcı adı/rengi) değişince kullanılır.
function refreshPostViews() {
	renderPosts();
	window.dispatchEvent(new Event("profile:refresh"));
}

// Yorum cache'i değişince yalnızca ilgili görünümler yenilenir.
setCommentsRefresh(() => {
	renderPosts();
	window.dispatchEvent(new Event("profile:refresh"));
});

// Profil sayfası: seçilen kullanıcının son 30 herkese açık gönderisi canlı dinlenir.
export function subscribeProfilePosts(uid) {
	if (!state.db || !uid || extraRefs.has(uid)) return;
	const { query: profileQuery, unsubscribe } = watchProfilePosts(
		uid,
		(posts) => {
			extraPosts.set(uid, posts);
			rebuildPosts();
		},
		(error) => console.warn("Profil gönderileri yüklenemedi: " + error.message),
	);
	extraRefs.set(uid, { query: profileQuery, unsubscribe });
}

export function stopProfilePosts(uid) {
	const stoppedUids = uid ? [uid] : [...extraRefs.keys()];
	let hadPosts = false;
	stoppedUids.forEach((profileUid) => {
		const entry = extraRefs.get(profileUid);
		if (entry) stopListener(entry.unsubscribe);
		extraRefs.delete(profileUid);
		hadPosts = extraPosts.delete(profileUid) || hadPosts;
	});
	if (hadPosts) {
		rebuildPosts();
	}
}

// Üyesi olunan her masa için group_posts/<masa> dinlenir; üyelikten çıkınca kapanır.
export function syncGroupPostSubscriptions() {
	if (!state.db) return;
	const uid = state.authUser?.uid;
	const wanted = new Set(
		uid
			? Object.entries(state.groups || {})
					.filter(([, group]) => group.ownerId === uid || group.members?.[uid])
					.map(([id]) => id)
			: [],
	);

	let changed = false;

	Object.keys(state.groupPostRefs).forEach((groupId) => {
		if (wanted.has(groupId)) return;
		stopListener(state.groupPostRefs[groupId]);
		delete state.groupPostRefs[groupId];
		delete state.groupPosts[groupId];
		changed = true;
	});

	wanted.forEach((groupId) => {
		if (state.groupPostRefs[groupId]) return;
		const { query: groupQuery, unsubscribe } = watchGroupPosts(
			groupId,
			(posts) => {
				state.groupPosts[groupId] = posts;
				rebuildPosts();
			},
			(error) => {
				console.error("Masa gönderileri yüklenemedi:", error);
				state.groupPosts[groupId] = {};
				rebuildPosts();
			},
			GROUP_POSTS_LIMIT,
		);
		// Eski kod query'yi saklardı; off() artık unsubscribe ile yapılıyor.
		state.groupPostRefs[groupId] = unsubscribe;
	});

	if (changed) {
		rebuildPosts();
	}
}

window.addEventListener("groups:updated", syncGroupPostSubscriptions);
window.addEventListener("users:updated", () => refreshPostViews());

// Kullanıcının kendi gönderileri (herkese açık + üyesi olduğu masalar) ve yolları.
export async function fetchOwnPostsWithPaths(uid) {
	if (!state.db) return [];
	const groupIds = Object.entries(state.groups || {})
		.filter(([, group]) => group.ownerId === uid || group.members?.[uid])
		.map(([id]) => id);
	return fetchOwnPosts(uid, groupIds);
}

export function subscribeToPosts() {
	if (!state.db) return;

	stopPostSubscription();
	ensurePostsViewSubscription();
	setPublicPosts({});
	dispatch({ posts: {}, groupPosts: {} });
	oldestLoadedKey = null;
	hasMorePosts = true;
	isLoadingMore = false;
	liveWindowPostIds = new Set();

	const { query: postsQuery, unsubscribe } = watchPublicPosts({
		pageSize: POSTS_PAGE_SIZE,
		onData: (incomingPosts) => {
			const incomingIds = new Set(Object.keys(incomingPosts));

			// Canlı pencereden kaybolan (silinen) gönderileri kaldır.
			liveWindowPostIds.forEach((id) => {
				if (!incomingIds.has(id)) delete publicPosts[id];
			});

			setPublicPosts({ ...publicPosts, ...incomingPosts });
			liveWindowPostIds = incomingIds;
			const keys = Object.keys(publicPosts);
			if (keys.length) oldestLoadedKey = keys.sort()[0];
			rebuildPosts();
		},
		onError: (error) => {
			console.error("Postlar yüklenemedi:", error);
			if (elements.feedError) {
				elements.feedError.hidden = false;
				elements.feedError.textContent = "Postlar yüklenemedi. " + friendlyErrorMessage(error, "Lütfen internet bağlantını kontrol edip tekrar dene.");
			}
		},
	});
	state.postsRef = { query: postsQuery, unsubscribe };
}

export function stopPostSubscription() {
	unsubscribePostsView?.();
	unsubscribePostsView = null;

	if (state.db && state.postsRef) {
		stopListener(state.postsRef.unsubscribe || state.postsRef);
	}
	state.postsRef = null;

	Object.values(state.groupPostRefs).forEach((groupRef) => stopListener(groupRef));
	state.groupPostRefs = {};
}

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
		const page = await fetchOlderPosts(oldestLoadedKey, POSTS_PAGE_SIZE + 1);
		const entries = Object.entries(page);
		const filtered = entries.filter(([id]) => id !== oldestLoadedKey);
		if (!filtered.length) {
			hasMorePosts = false;
			return;
		}

		setPublicPosts({ ...Object.fromEntries(filtered), ...publicPosts });
		rebuildPosts();
		oldestLoadedKey = filtered.map(([id]) => id).sort()[0];
		if (filtered.length < POSTS_PAGE_SIZE) hasMorePosts = false;
		renderGroupDetailPosts();
	} catch (error) {
		console.error("Daha fazla post yüklenemedi:", error);
		if (elements.feedError) {
			elements.feedError.hidden = false;
			elements.feedError.textContent = "Daha fazla post yüklenemedi. " + friendlyErrorMessage(error, "Lütfen tekrar dene.");
		}
	} finally {
		hideLoadMoreIndicator();
		isLoadingMore = false;
	}
}
