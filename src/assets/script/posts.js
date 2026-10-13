import { feedColumnIds, profileUidFromColumnId, state } from "./state.js";
import { elements } from "./elements.js";
import { resolveAuthor } from "./users.js";
import { initials, formatTime, createRichTextFragment, getContrastColor, safeColor, extractHashtags, friendlyErrorMessage } from "./utils.js";
import { ref, push, set, update, remove, onValue, off, serverTimestamp, increment, query, orderByKey, limitToLast, endAt, get, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { closeProfileColumn, openAuth, syncComposer } from "./ui.js";
import { canViewGroup, closeGroupSettingsPanel, getGroupName } from "./groups.js";
import { notify, likeNotificationKey } from "./notifications.js";

const POSTS_PAGE_SIZE = 15;
let oldestLoadedKey = null;
let hasMorePosts = true;
let isLoadingMore = false;
let activeCommentPostId = null;
const profileCommentPostIds = new WeakMap();
const profileOpenCommentIds = new Set(); // yorumları açık profil gönderileri (dinleme için)
let liveWindowPostIds = new Set();
let publicPosts = {};
const extraPosts = new Map();
const extraRefs = new Map();

const GROUP_POSTS_LIMIT = 100;
const groupComposers = new Map();
let pendingMobileFocusId = null;
const auxiliaryColumns = [
	{ id: feedColumnIds.search, element: document.querySelector("#search"), title: "Ara" },
	{ id: feedColumnIds.groups, element: document.querySelector("#groupsView"), title: "Masalar" },
	{ id: feedColumnIds.account, element: document.querySelector("#settingsPanel"), title: "Hesap" },
	{ id: feedColumnIds.auth, element: document.querySelector("#authPanel"), title: "Giriş" },
	{ id: feedColumnIds.notifications, element: document.querySelector("#notificationsView"), title: "Bildirimler" },
];

// Herkese açık gönderiler + üyesi olunan masaların gönderileri tek haritada birleşir.
// __path alanı yalnızca bellekte tutulur ve veritabanına yazılmaz.
function rebuildPosts() {
	const merged = {};
	Object.entries(publicPosts).forEach(([id, post]) => {
		merged[id] = { ...post, __path: `posts/${id}` };
	});
	// Profil sayfasında açılan kullanıcının eski gönderileri (akışta görünmez: __extra).
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
	state.posts = merged;
}

// Bir gönderinin veritabanındaki yolu (herkese açık: posts/…, masa: group_posts/<masa>/…).
export function postPath(postId) {
	return state.posts[postId]?.__path || `posts/${postId}`;
}

// Ağır veriler (görsel, yorumlar) gönderi düğümünün dışında tutulur; akış hafif kalır:
//   posts/<id>                  -> çekirdek alanlar (+ hasMedia, commentCount)
//   post_media/<id>             -> görsel (masa: group_post_media/<masa>/<id>)
//   post_comments/<id>/<yorum>  -> yorumlar (masa: group_post_comments/<masa>/<id>/<yorum>)
// Eski (gömülü) veri geçiş betiği çalışana kadar okunmaya devam eder.
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

// ---- Yorumlar: yalnızca açık olan gönderi için dinlenir ----
const commentCache = new Map(); // postId -> { id: yorum }
const commentRefs = new Map(); // postId -> ref

function watchComments(postId) {
	if (!state.db || commentRefs.has(postId)) return;
	const commentsRef = ref(state.db, commentsPath(postId));
	commentRefs.set(postId, commentsRef);
	onValue(
		commentsRef,
		(snapshot) => {
			commentCache.set(postId, snapshot.val() || {});
			refreshCommentViews();
		},
		() => {
			commentCache.set(postId, {});
			refreshCommentViews();
		},
	);
}

function unwatchComments(keepIds) {
	[...commentRefs.keys()].forEach((postId) => {
		if (keepIds.has(postId)) return;
		off(commentRefs.get(postId));
		commentRefs.delete(postId);
		commentCache.delete(postId);
	});
}

// Yalnızca yorumları açık olan gönderilerin yorum dinlemeleri açık kalır.
function syncCommentWatchers() {
	const keep = new Set(profileOpenCommentIds);
	if (activeCommentPostId) keep.add(activeCommentPostId);
	unwatchComments(keep);
}

function refreshCommentViews() {
	renderPosts();
	window.dispatchEvent(new Event("profile:refresh"));
}

function getComments(post) {
	return commentCache.has(post.id) ? commentCache.get(post.id) : post.comments || {};
}

function getCommentCount(post) {
	if (commentCache.has(post.id)) return Object.keys(commentCache.get(post.id)).length;
	return Number.isFinite(post.commentCount)
		? post.commentCount
		: Object.keys(post.comments || {}).length;
}

// ---- Görseller: ekrana yaklaşınca bir kez indirilir ----
const mediaCache = new Map(); // yol -> Promise<string|null>

function loadMedia(postId) {
	const path = mediaPath(postId);
	if (!mediaCache.has(path)) {
		mediaCache.set(
			path,
			get(ref(state.db, path))
				.then((snapshot) => snapshot.val()?.dataUrl || null)
				.catch(() => null),
		);
	}
	return mediaCache.get(path);
}

const mediaObserver =
	typeof IntersectionObserver === "function"
		? new IntersectionObserver(
				(entries) => {
					entries.forEach((entry) => {
						if (!entry.isIntersecting) return;
						mediaObserver.unobserve(entry.target);
						entry.target.__loadMedia?.();
					});
				},
				{ rootMargin: "400px" },
			)
		: null;

function createLazyMediaElement(post) {
	const wrap = document.createElement("div");
	wrap.className = "post-media post-media--loading";
	wrap.__loadMedia = async () => {
		const dataUrl = await loadMedia(post.id);
		if (!SAFE_IMAGE_DATA_URL.test(String(dataUrl || ""))) {
			wrap.remove();
			return;
		}
		const img = document.createElement("img");
		img.src = dataUrl;
		img.alt = "Gönderi görseli";
		wrap.classList.remove("post-media--loading");
		wrap.append(img);
	};
	if (mediaObserver) mediaObserver.observe(wrap);
	else void wrap.__loadMedia();
	return wrap;
}

// Gönderiyi ve ona bağlı yorum/görsel düğümlerini siler (önce bağlılar: kurallar gönderinin sahibine bakar).
async function deletePost(post) {
	const id = post.id;
	const tasks = [commentsPath(id), post.hasMedia ? mediaPath(id) : null];
	for (const path of tasks) {
		if (!path) continue;
		try {
			await remove(ref(state.db, path));
		} catch (error) {
			console.warn("Bağlı veri silinemedi:", error);
		}
	}
	await remove(ref(state.db, postPath(id)));
}

function refreshPostViews() {
	renderPosts();
	renderGroupFeedColumns();
	window.dispatchEvent(new Event("profile:refresh"));
}

// Profil sayfası: seçilen kullanıcının son 30 herkese açık gönderisi canlı dinlenir.
export function subscribeProfilePosts(uid) {
	if (!state.db || !uid || extraRefs.has(uid)) return;
	const profileRef = query(ref(state.db, "posts"), orderByChild("authorId"), equalTo(uid), limitToLast(30));
	extraRefs.set(uid, profileRef);
	onValue(
		profileRef,
		(snapshot) => {
			extraPosts.set(uid, snapshot.val() || {});
			rebuildPosts();
			refreshPostViews();
		},
		(error) => console.warn("Profil gönderileri yüklenemedi: " + error.message),
	);
}

export function stopProfilePosts(uid) {
	const stoppedUids = uid ? [uid] : [...extraRefs.keys()];
	let hadPosts = false;
	stoppedUids.forEach((profileUid) => {
		const profileRef = extraRefs.get(profileUid);
		if (profileRef) off(profileRef);
		extraRefs.delete(profileUid);
		hadPosts = extraPosts.delete(profileUid) || hadPosts;
	});
	if (hadPosts) {
		rebuildPosts();
		refreshPostViews();
	}
}

function openProfileOf(uid) {
	if (uid) window.dispatchEvent(new CustomEvent("profile:open", { detail: { uid } }));
}

// Ad / avatar tıklanınca profil açılır.
function makeProfileLink(element, uid) {
	if (!uid) return;
	element.classList.add("is-profile-link");
	element.setAttribute("role", "link");
	element.tabIndex = 0;
	element.addEventListener("click", (event) => {
		event.stopPropagation();
		openProfileOf(uid);
	});
	element.addEventListener("keydown", (event) => {
		if (event.key === "Enter") openProfileOf(uid);
	});
}

// Üyesi olunan her masa için group_posts/<masa> dinlenir; üyelikten çıkınca dinleme kapanır.
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
		off(state.groupPostRefs[groupId]);
		delete state.groupPostRefs[groupId];
		delete state.groupPosts[groupId];
		changed = true;
	});

	wanted.forEach((groupId) => {
		if (state.groupPostRefs[groupId]) return;
		const groupQuery = query(ref(state.db, `group_posts/${groupId}`), orderByKey(), limitToLast(GROUP_POSTS_LIMIT));
		state.groupPostRefs[groupId] = groupQuery;
		onValue(
			groupQuery,
			(snapshot) => {
				state.groupPosts[groupId] = snapshot.val() || {};
				rebuildPosts();
				refreshPostViews();
			},
			(error) => {
				console.error("Masa gönderileri yüklenemedi:", error);
				state.groupPosts[groupId] = {};
				rebuildPosts();
				refreshPostViews();
			},
		);
	});

	if (changed) {
		rebuildPosts();
		refreshPostViews();
	}
}

window.addEventListener("groups:updated", syncGroupPostSubscriptions);
// Bir kullanıcı adını/rengini değiştirince gönderi ve yorumlar yeniden çizilir.
window.addEventListener("users:updated", () => refreshPostViews());

// Kullanıcının kendi gönderileri (herkese açık + üyesi olduğu masalar) ve yolları.
export async function fetchOwnPostsWithPaths(uid) {
	const results = [];
	if (!state.db) return results;

	let publicSnapshot;
	try {
		publicSnapshot = await get(query(ref(state.db, "posts"), orderByChild("authorId"), equalTo(uid)));
	} catch (error) {
		if (String(error?.message || "").includes("Index not defined")) {
			publicSnapshot = await get(ref(state.db, "posts"));
		} else {
			throw error;
		}
	}
	Object.entries(publicSnapshot.val() || {}).forEach(([id, post]) => {
		results.push({ path: `posts/${id}`, post });
	});

	const groupIds = Object.entries(state.groups || {})
		.filter(([, group]) => group.ownerId === uid || group.members?.[uid])
		.map(([id]) => id);

	for (const groupId of groupIds) {
		try {
			const snapshot = await get(query(ref(state.db, `group_posts/${groupId}`), orderByChild("authorId"), equalTo(uid)));
			Object.entries(snapshot.val() || {}).forEach(([id, post]) => {
				results.push({ path: `group_posts/${groupId}/${id}`, post });
			});
		} catch (error) {
			console.warn("Masa gönderileri okunamadı:", error?.message || error);
		}
	}

	return results;
}

export function subscribeToPosts() {
	if (!state.db) return;

	stopPostSubscription();
	publicPosts = {};
	state.posts = {};
	state.groupPosts = {};
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
					delete publicPosts[id];
				}
			});

			publicPosts = { ...publicPosts, ...incomingPosts };
			liveWindowPostIds = incomingIds;
			const keys = Object.keys(publicPosts);
			if (keys.length) {
				oldestLoadedKey = keys.sort()[0];
			}
			rebuildPosts();
			refreshPostViews();
		},
		(error) => {
			console.error("Postlar yüklenemedi:", error);
			if (elements.feedError) {
				elements.feedError.hidden = false;
				elements.feedError.textContent = "Postlar yüklenemedi. " + friendlyErrorMessage(error, "Lütfen internet bağlantını kontrol edip tekrar dene.");
			}
		},
	);
}

export function stopPostSubscription() {
	if (state.db && state.postsRef) {
		off(state.postsRef);
	}
	state.postsRef = null;

	Object.values(state.groupPostRefs).forEach((groupRef) => off(groupRef));
	state.groupPostRefs = {};
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
		const olderPostsQuery = query(ref(state.db, "posts"), orderByKey(), endAt(oldestLoadedKey), limitToLast(POSTS_PAGE_SIZE + 1));
		const snapshot = await get(olderPostsQuery);
		const page = snapshot.val() || {};
		const entries = Object.entries(page);

		const filtered = entries.filter(([id]) => id !== oldestLoadedKey);
		if (!filtered.length) {
			hasMorePosts = false;
			return;
		}

		publicPosts = {
			...Object.fromEntries(filtered),
			...publicPosts,
		};
		rebuildPosts();
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
			elements.feedError.textContent = "Daha fazla post yüklenemedi. " + friendlyErrorMessage(error, "Lütfen tekrar dene.");
		}
	} finally {
		hideLoadMoreIndicator();
		isLoadingMore = false;
	}
}

export function renderPosts() {
	renderGroupFeedColumns();
	if (!elements.postList) return;

	if (elements.postsLoading) elements.postsLoading.remove();
	if (activeCommentPostId && !state.posts[activeCommentPostId]) {
		activeCommentPostId = null;
	}
	const posts = Object.entries(state.posts)
		.map(([id, post]) => ({ id, ...post }))
		.filter((post) => !post.__extra || post.id === activeCommentPostId)
		.filter((post) => canViewGroup(post.groupId))
		.filter((post) => !post.groupId)
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

	if (!posts.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = "Akışta henüz gönderi yok.";
		elements.postList.replaceChildren(empty);
		return;
	}

	renderPostList(elements.postList, posts);
	syncCommentComposers();
	refreshIcons();
	window.dispatchEvent(new Event("posts:updated"));
}

export function renderPostList(container, posts) {
	const isProfilePostList = container.matches('[data-profile-field="posts"]');
	const activePostId = isProfilePostList ? profileCommentPostIds.get(container) : activeCommentPostId;
	const activePost = posts.find((post) => post.id === activePostId);
	if (activePost) {
		container.replaceChildren(createCommentScreen(activePost, container));
		return;
	}
	container.replaceChildren(...posts.map(createPostElement));
}

// Kolonlar yeniden çizilirken (kapatma, sıralama, yeni gönderi) kaydırma konumu korunur.
const columnScrollSelector = ".feed-column__body, .feed-column__posts, .feed-column__settings";

function columnKey(column) {
	return column.dataset.columnId || "__feed__";
}

function captureColumnViewState(container) {
	const scrollLeft = container.scrollLeft;
	const tops = new Map();
	let anchor = null;
	container.querySelectorAll(":scope > .feed-column").forEach((column) => {
		tops.set(
			columnKey(column),
			[...column.querySelectorAll(columnScrollSelector)].map((el) => el.scrollTop),
		);
		// Görünen ilk kolon: kapanma sonrası ekranda aynı yerde kalması için çıpa
		if (!anchor && column.offsetLeft + column.offsetWidth > scrollLeft) {
			anchor = { key: columnKey(column), shift: column.offsetLeft - scrollLeft };
		}
	});
	return { scrollLeft, tops, anchor };
}

function restoreColumnViewState(container, view) {
	container.querySelectorAll(":scope > .feed-column").forEach((column) => {
		const saved = view.tops.get(columnKey(column));
		if (!saved) return;
		[...column.querySelectorAll(columnScrollSelector)].forEach((el, i) => {
			if (saved[i]) el.scrollTop = saved[i];
		});
	});
	const anchorColumn = view.anchor && [...container.querySelectorAll(":scope > .feed-column")].find((column) => columnKey(column) === view.anchor.key);
	const target = anchorColumn ? anchorColumn.offsetLeft - view.anchor.shift : view.scrollLeft;
	container.scrollLeft = Math.max(0, target);
}

function focusLatestMobileColumn(container) {
	if (!window.matchMedia("(max-width: 760px)").matches) return;
	const focusId = pendingMobileFocusId || state.openFeedColumns[state.openFeedColumns.length - 1];
	const targetColumn = (focusId && [...container.querySelectorAll(":scope > .feed-column")].find((column) => (column.dataset.columnId || "") === focusId)) || container.lastElementChild;
	if (!targetColumn) return;
	targetColumn.scrollIntoView({
		behavior: "smooth",
		block: "nearest",
		inline: "start",
	});
	pendingMobileFocusId = null;
}

window.addEventListener("feed-columns:focus-mobile", (event) => {
	const id = event.detail?.id;
	if (id) pendingMobileFocusId = id;
});

function renderGroupFeedColumns() {
	const container = elements.groupFeedColumns;
	if (!container || !elements.feedColumn) return;

	groupComposers.forEach((composer, groupId) => {
		if (!state.groups?.[groupId] || !canViewGroup(groupId)) {
			groupComposers.delete(groupId);
		}
	});

	const columns = state.openFeedColumns
		.map((groupId) => {
			if (!groupId) {
				setupBaseFeedColumnReordering();
				return elements.feedColumn;
			}
			const auxiliary = auxiliaryColumns.find((column) => column.id === groupId);
			if (auxiliary?.element) {
				setupAuxiliaryColumn(auxiliary);
				return auxiliary.element;
			}
			const profileUid = profileUidFromColumnId(groupId);
			if (profileUid) {
				const template = document.querySelector("#profileView");
				if (!template) return null;
				let profileColumn = [...document.querySelectorAll(".profile-column")].find((candidate) => candidate.dataset.profileUid === profileUid);
				if (!profileColumn) {
					profileColumn = template.cloneNode(true);
					profileColumn.removeAttribute("id");
					profileColumn.querySelectorAll("[id]").forEach((element) => {
						element.removeAttribute("id");
					});
					profileColumn.dataset.profileUid = profileUid;
					profileColumn.classList.add("profile-column");
				}
				setupAuxiliaryColumn({
					id: groupId,
					element: profileColumn,
					title: "Profil",
				});
				return profileColumn;
			}
			if (!state.groups?.[groupId] || !canViewGroup(groupId)) return null;

			const group = state.groups[groupId];
			const column = document.createElement("section");
			column.className = "feed-column";
			column.dataset.columnId = groupId;
			column.setAttribute("aria-label", `${group.name || "Masa"} akışı`);

			const heading = document.createElement("header");
			heading.className = "feed-column__heading";
			heading.dataset.columnId = groupId;
			heading.draggable = true;

			const titleWrap = document.createElement("div");
			titleWrap.className = "feed-column__title";
			const title = document.createElement("h2");
			title.textContent = group.name || "Masa";
			titleWrap.append(title);

			const controls = createColumnControls(groupId, group.name || "Masa");
			if (group.ownerId === state.authUser?.uid) {
				const settings = document.createElement("button");
				settings.type = "button";
				settings.className = "feed-column__settings-button";
				settings.setAttribute("aria-label", `${group.name || "Masa"} ayarları`);
				settings.title = "Masa ayarları";
				settings.innerHTML = '<span data-lucide="settings"></span>';
				settings.addEventListener("click", () => {
					window.dispatchEvent(new CustomEvent("group-settings:toggle", { detail: { groupId } }));
				});
				controls.insertBefore(settings, controls.lastElementChild);
			}

			const composer = getColumnComposer(groupId, group.name || "Masa");
			const settingsSlot = document.createElement("section");
			settingsSlot.className = "feed-column__settings";
			settingsSlot.dataset.groupSettingsSlot = groupId;
			settingsSlot.hidden = true;
			const isSettingsOpen = elements.groupDetailEditForm?.dataset.openGroupId === groupId;
			column.classList.toggle("feed-column--settings-open", isSettingsOpen);
			const list = document.createElement("div");
			list.className = "feed-column__posts";
			const posts = Object.entries(state.posts)
				.map(([id, post]) => ({ id, ...post }))
				.filter((post) => post.groupId === groupId && !post.__extra)
				.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

			if (posts.length) {
				renderPostList(list, posts);
			} else {
				const empty = document.createElement("div");
				empty.className = "empty-state";
				empty.textContent = "Bu masada henüz gönderi yok.";
				list.append(empty);
			}

			heading.append(titleWrap, controls);
			column.append(heading, settingsSlot, composer, list);
			setupColumnReordering(column, heading, groupId);
			return column;
		})
		.filter(Boolean);

	const viewState = captureColumnViewState(container);
	container.replaceChildren(...columns);
	restoreColumnViewState(container, viewState);
	focusLatestMobileColumn(container);
	const editForm = elements.groupDetailEditForm;
	if (editForm?.dataset.openGroupId) {
		const slot = [...container.querySelectorAll(".feed-column__settings")].find((candidate) => candidate.dataset.groupSettingsSlot === editForm.dataset.openGroupId);
		if (slot) {
			slot.append(editForm);
			slot.hidden = false;
			slot.closest(".feed-column")?.classList.add("feed-column--settings-open");
		} else {
			closeGroupSettingsPanel();
		}
	}
	syncComposer();
	syncCommentComposers();
	syncColumnControlStates();
	refreshIcons();
}

function getColumnComposer(groupId, groupName) {
	let composer = groupComposers.get(groupId);
	if (!composer) {
		composer = elements.composerEl.cloneNode(true);
		composer.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
		groupComposers.set(groupId, composer);
	}
	composer.dataset.groupId = groupId;
	composer.setAttribute("aria-label", `${groupName} için gönderi oluştur`);
	const text = composer.querySelector('[data-composer-field="text"]');
	if (text) text.placeholder = `${groupName} masasında neler oluyor?`;
	return composer;
}

function setupAuxiliaryColumn({ id, element, title }) {
	if (element.dataset.columnReady) return;
	element.classList.remove("timeline", "hidden");
	element.classList.add("feed-column", "feed-column-page");
	element.dataset.columnId = id;
	element.setAttribute("aria-label", `${title} sütunu`);

	const heading = document.createElement("header");
	heading.className = "feed-column__heading";
	heading.dataset.columnId = id;
	heading.draggable = true;

	const titleWrap = document.createElement("div");
	titleWrap.className = "feed-column__title";
	const titleElement = document.createElement("h2");
	titleElement.textContent = title;
	titleWrap.append(titleElement);

	heading.append(titleWrap, createColumnControls(id, title));
	// Başlık sabit kalır; geri kalan her şey tek bir kayan gövdeye alınır.
	const body = document.createElement("div");
	body.className = "feed-column__body";
	body.append(...element.childNodes);
	element.append(heading, body);
	element.dataset.columnReady = "true";
	setupColumnReordering(element, heading, id);
}

export function openGroupFeedColumn(groupId) {
	if (!groupId || !state.groups?.[groupId] || !canViewGroup(groupId)) return false;
	if (!state.openFeedColumns.includes(groupId)) {
		state.openFeedColumns.push(groupId);
		pendingMobileFocusId = groupId;
		window.dispatchEvent(new CustomEvent("feed-columns:focus-mobile", { detail: { id: groupId } }));
		window.dispatchEvent(new Event("feed-columns:updated"));
	}
	return true;
}

function setupBaseFeedColumnReordering() {
	const column = elements.feedColumn;
	const heading = column?.querySelector(".feed-column__heading");
	if (!column || !heading || heading.dataset.reorderReady) return;
	heading.dataset.reorderReady = "true";
	heading.draggable = true;
	setupColumnReordering(column, heading, "");

	heading.querySelector(".feed-column__close")?.addEventListener("click", () => {
		state.openFeedColumns = state.openFeedColumns.filter((id) => id !== "");
		window.dispatchEvent(new Event("feed-columns:updated"));
	});
	heading.querySelectorAll(".feed-column__move").forEach((button) => {
		button.addEventListener("click", () => {
			moveFeedColumn("", Number(button.dataset.move));
		});
	});
}

function createColumnControls(columnId, label) {
	const controls = document.createElement("div");
	controls.className = "feed-column__controls";

	[
		{ direction: -1, icon: "arrow-left", text: "sola" },
		{ direction: 1, icon: "arrow-right", text: "sağa" },
	].forEach(({ direction, icon, text }) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "feed-column__move";
		button.dataset.move = String(direction);
		button.setAttribute("aria-label", `${label} sütununu ${text} taşı`);
		button.title = `${text[0].toUpperCase()}${text.slice(1)} taşı`;
		button.innerHTML = `<span data-lucide="${icon}"></span>`;
		button.addEventListener("click", () => moveFeedColumn(columnId, direction));
		controls.append(button);
	});

	const close = document.createElement("button");
	close.type = "button";
	close.className = "feed-column__close";
	close.setAttribute("aria-label", `${label} sütununu kapat`);
	close.title = "Kapat";
	close.innerHTML = '<span data-lucide="x"></span>';
	close.addEventListener("click", () => {
		const profileUid = profileUidFromColumnId(columnId);
		if (profileUid) {
			closeProfileColumn(profileUid);
			return;
		}
		state.openFeedColumns = state.openFeedColumns.filter((id) => id !== columnId);
		window.dispatchEvent(new Event("feed-columns:updated"));
	});
	controls.append(close);
	return controls;
}

function moveFeedColumn(columnId, direction) {
	const index = state.openFeedColumns.indexOf(columnId);
	const nextIndex = index + direction;
	if (index < 0 || nextIndex < 0 || nextIndex >= state.openFeedColumns.length) return;
	[state.openFeedColumns[index], state.openFeedColumns[nextIndex]] = [state.openFeedColumns[nextIndex], state.openFeedColumns[index]];
	window.dispatchEvent(new Event("feed-columns:updated"));
}

function syncColumnControlStates() {
	elements.groupFeedColumns?.querySelectorAll(".feed-column").forEach((column) => {
		const columnId = column.dataset.columnId || "";
		const index = state.openFeedColumns.indexOf(columnId);
		column.querySelectorAll(".feed-column__move").forEach((button) => {
			const nextIndex = index + Number(button.dataset.move);
			button.disabled = nextIndex < 0 || nextIndex >= state.openFeedColumns.length;
		});
	});
}

function setupColumnReordering(column, heading, columnId) {
	heading.addEventListener("dragstart", (event) => {
		if (!event.dataTransfer) return;
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", columnId || "__feed__");
		column.classList.add("is-dragging");
	});

	heading.addEventListener("dragend", () => {
		column.classList.remove("is-dragging");
		document.querySelectorAll(".feed-column.is-drop-target").forEach((item) => {
			item.classList.remove("is-drop-target");
		});
	});

	column.addEventListener("dragover", (event) => {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
		column.classList.add("is-drop-target");
	});

	column.addEventListener("dragleave", (event) => {
		if (!column.contains(event.relatedTarget)) {
			column.classList.remove("is-drop-target");
		}
	});

	column.addEventListener("drop", (event) => {
		event.preventDefault();
		column.classList.remove("is-drop-target");
		const draggedId = event.dataTransfer?.getData("text/plain");
		if (draggedId == null) return;
		reorderFeedColumn(draggedId === "__feed__" ? "" : draggedId, columnId);
	});
}

function reorderFeedColumn(sourceId, targetId) {
	if (sourceId === targetId) return;
	const sourceIndex = state.openFeedColumns.indexOf(sourceId);
	const targetIndex = state.openFeedColumns.indexOf(targetId);
	if (sourceIndex < 0 || targetIndex < 0) return;
	state.openFeedColumns.splice(sourceIndex, 1);
	const insertIndex = targetIndex - Number(sourceIndex < targetIndex);
	state.openFeedColumns.splice(insertIndex, 0, sourceId);
	window.dispatchEvent(new Event("feed-columns:updated"));
}

window.addEventListener("feed-columns:updated", renderGroupFeedColumns);

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

export function createPostElement(post, options) {
	const commentsOpen = options?.commentsOpen === true;
	const author_ = resolveAuthor(post);
	const article = document.createElement("article");
	article.className = "post";

	// ---- Üst satır: avatar + yazar/meta + (kendi gönderisiyse) sil ----
	const head = document.createElement("header");
	head.className = "post-head";

	const avatar = document.createElement("div");
	avatar.className = "avatar";
	avatar.style.background = author_.color;
	avatar.style.color = getContrastColor(author_.color);
	avatar.textContent = initials(author_.name);
	makeProfileLink(avatar, post.authorId);

	const who = document.createElement("div");
	who.className = "post-who";

	const author = document.createElement("span");
	author.className = "post-author";
	author.textContent = author_.name;
	makeProfileLink(author, post.authorId);

	const meta = document.createElement("div");
	meta.className = "post-meta";

	const time = document.createElement("time");
	time.className = "post-time";
	time.textContent = formatTime(post.createdAt);
	if (post.createdAt) time.dateTime = new Date(post.createdAt).toISOString();
	meta.append(time);

	if (post.groupId) {
		const groupBadge = document.createElement("span");
		groupBadge.className = "post-group-badge";
		const groupIcon = document.createElement("span");
		groupIcon.setAttribute("data-lucide", "grid-2x2");
		groupBadge.append(groupIcon, getGroupName(post.groupId));
		meta.append(groupBadge);
	}

	who.append(author, meta);
	head.append(avatar, who);

	if (state.authUser && post.authorId === state.authUser.uid) {
		const deleteButton = document.createElement("button");
		deleteButton.className = "post-delete";
		deleteButton.type = "button";
		deleteButton.title = "Gönderiyi sil";
		deleteButton.setAttribute("aria-label", "Gönderiyi sil");
		const deleteIcon = document.createElement("span");
		deleteIcon.setAttribute("data-lucide", "trash-2");
		deleteButton.append(deleteIcon);
		deleteButton.addEventListener("click", () => deletePost(post));
		head.append(deleteButton);
	}

	// ---- İçerik: metin tam genişlikte, görsel/anket altında ----
	const body = document.createElement("div");
	body.className = "post-content";

	const text = document.createElement("p");
	text.className = "post-text";
	text.append(createRichTextFragment(post.text || ""));
	body.append(text);

	const mediaEl = post.media?.dataUrl
		? createMediaElement(post.media)
		: post.hasMedia
			? createLazyMediaElement(post)
			: null;
	const pollEl = post.poll ? createPollElement(post) : null;
	if (mediaEl) body.append(mediaEl);
	if (pollEl) body.append(pollEl);

	// ---- Eylem çubuğu ----
	const actions = document.createElement("footer");
	actions.className = "post-actions";

	const likes = post.likes || {};
	const liked = Boolean(state.authUser && likes[state.authUser.uid]);
	const likeCount = Object.keys(likes).length;
	const likeButton = document.createElement("button");
	likeButton.className = `action-button${liked ? " liked" : ""}`;
	likeButton.type = "button";
	likeButton.setAttribute("aria-pressed", String(liked));
	likeButton.setAttribute("aria-label", liked ? "Beğenmekten vazgeç" : "Beğen");
	const likeIcon = document.createElement("span");
	likeIcon.setAttribute("data-lucide", "heart");
	const likeLabel = document.createElement("span");
	likeLabel.className = "action-count";
	likeLabel.textContent = likeCount ? String(likeCount) : "";
	likeButton.append(likeIcon, likeLabel);
	likeButton.addEventListener("click", () => {
		if (!state.authUser) {
			openAuth();
			return;
		}
		toggleLike(post.id, liked);
	});
	actions.append(likeButton);

	if (!post.__fromDiscover) {
		const commentCount = getCommentCount(post);
		const commentButton = document.createElement("button");
		commentButton.className = `action-button${commentsOpen ? " active" : ""}`;
		commentButton.type = "button";
		const commentIcon = document.createElement("span");
		commentIcon.setAttribute("data-lucide", commentsOpen ? "x" : "message-circle");
		commentButton.setAttribute("aria-label", commentsOpen ? "Yorumları kapat" : "Yorumlar");
		commentButton.title = commentsOpen ? "Yorumları kapat" : "Yorumlar";
		const commentLabel = document.createElement("span");
		commentLabel.className = "action-count";
		commentLabel.textContent = !commentsOpen && commentCount ? String(commentCount) : "";
		commentButton.append(commentIcon, commentLabel);
		commentButton.addEventListener("click", () => {
			if (!state.authUser) {
				openAuth();
				return;
			}
			openComments(post.id, article.closest(".feed-column__posts, #postList, #groupDetailPostList, [data-profile-field='posts']"));
		});
		actions.append(commentButton);
	}

	article.append(head, body, actions);
	return article;
}

// Yalnızca gömülü (data:) görselleri göster; harici URL'ler izleme pikseli olarak kullanılabilir.
const SAFE_IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;

function createMediaElement(media) {
	if (!SAFE_IMAGE_DATA_URL.test(String(media?.dataUrl || ""))) return null;
	const wrap = document.createElement("div");
	wrap.className = "post-media";
	const img = document.createElement("img");
	img.src = media.dataUrl;
	img.alt = "Gönderi görseli";
	img.loading = "lazy";
	wrap.append(img);
	return wrap;
}

// Oylar: yeni model poll.votes[uid] = seçenek anahtarı (kullanıcı başına tek oy, kurallarla zorunlu).
// Eski gönderilerdeki options[x].votes[uid] kayıtları yalnızca okunur; yeni oy bunları geçersiz kılar.
function getPollVotes(post) {
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

function createPollElement(post) {
	const wrap = document.createElement("div");
	wrap.className = "post-poll";

	const optionEntries = Object.entries(post.poll?.options || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
	const { counts, total: totalVotes, mine: myVoteKey } = getPollVotes(post);
	const topCount = Math.max(0, ...Object.values(counts));
	wrap.classList.toggle("post-poll--voted", myVoteKey !== undefined);

	optionEntries.forEach(([key, option]) => {
		const count = counts[key] || 0;
		const percent = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
		const voted = myVoteKey === key;

		const button = document.createElement("button");
		button.type = "button";
		button.className = `post-poll-option${voted ? " voted" : ""}${myVoteKey !== undefined && count === topCount && count > 0 ? " leading" : ""}`;
		button.setAttribute("aria-pressed", String(voted));

		const mark = document.createElement("span");
		mark.className = "post-poll-option-mark";
		mark.setAttribute("aria-hidden", "true");
		if (voted) {
			const check = document.createElement("span");
			check.setAttribute("data-lucide", "check");
			mark.append(check);
		}

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

		button.append(fill, mark, label);
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
	meta.textContent = `${totalVotes} oy${myVoteKey === undefined ? " · oy vermek için bir seçeneğe dokun" : ""}`;
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

	try {
		// Tek düğüm = tek oy: aynı kullanıcı birden fazla şıkka oy veremez.
		await set(ref(state.db, `${postPath(postId)}/poll/votes/${uid}`), String(optionKey));
	} catch (error) {
		console.error("Oy kullanılamadı:", error);
	}
}

function createCommentsSection(post) {
	const wrap = document.createElement("div");
	wrap.className = "comments";

	const comments = Object.entries(getComments(post))
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
			const commentAuthor = resolveAuthor(comment);
			avatar.style.background = commentAuthor.color;
			avatar.style.color = getContrastColor(commentAuthor.color);
			avatar.textContent = initials(commentAuthor.name);
			makeProfileLink(avatar, comment.authorId);

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
			commenter.textContent = commentAuthor.name;
			makeProfileLink(commenter, comment.authorId);

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
				const likeRef = ref(state.db, `${commentsPath(post.id)}/${comment.id}/likes/${state.authUser.uid}`);
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
				del.addEventListener("click", () => deleteComment(post.id, comment.id));
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

function createCommentScreen(post, sourceList) {
	watchComments(post.id);
	const container = document.createElement("section");
	container.className = "comments-screen";

	const body = document.createElement("div");

	// Original post preview
	const postPreview = createPostElement(post, { commentsOpen: true });

	// Section heading
	const heading = document.createElement("div");
	heading.className = "comments-section-heading";
	const headingIcon = document.createElement("span");
	headingIcon.setAttribute("data-lucide", "message-circle");
	const headingText = document.createElement("span");
	const commentCount = getCommentCount(post);
	headingText.textContent = commentCount > 0 ? `${commentCount} Yorum` : "Yorumlar";
	heading.append(headingIcon, headingText);

	const comments = createCommentsSection(post);

	body.append(postPreview, heading, comments);
	container.append(body);
	return container;
}

function syncCommentComposers() {
	const activePost = activeCommentPostId ? state.posts[activeCommentPostId] : null;
	document.querySelectorAll(".composer").forEach((composer) => {
		if (composer.dataset.profileCommentComposer === "true") return;
		const groupId = composer.dataset.groupId || "";
		const isTargetComposer = Boolean(activePost) && groupId === (activePost.groupId || "");
		const textarea = composer.querySelector('[data-composer-field="text"]');
		const submit = composer.querySelector('[data-composer-action="submit"]');
		if (!textarea || !submit) return;
		const wasCommentComposer = composer.classList.contains("composer--comment");

		if (!composer.dataset.defaultPlaceholder) {
			composer.dataset.defaultPlaceholder = textarea.placeholder;
		}
		if (!composer.dataset.defaultMaxLength) {
			composer.dataset.defaultMaxLength = String(textarea.maxLength);
		}
		if (!composer.dataset.defaultSubmitLabel) {
			composer.dataset.defaultSubmitLabel = submit.textContent.trim();
		}

		if (isTargetComposer) {
			if (!wasCommentComposer) {
				composer.dataset.savedPostDraft = textarea.value;
				textarea.value = "";
			}
			composer.dataset.commentPostId = activeCommentPostId;
			composer.classList.add("composer--comment");
			textarea.placeholder = "Yorumunu yaz...";
			textarea.maxLength = 180;
			submit.textContent = "Yorum yap";
		} else {
			if (wasCommentComposer) {
				textarea.value = composer.dataset.savedPostDraft || "";
				delete composer.dataset.savedPostDraft;
			}
			delete composer.dataset.commentPostId;
			composer.classList.remove("composer--comment");
			textarea.placeholder = composer.dataset.defaultPlaceholder;
			textarea.maxLength = Number(composer.dataset.defaultMaxLength);
			submit.textContent = composer.dataset.defaultSubmitLabel;
		}
	});
	syncComposer();
}

export function openComments(postId, sourceList) {
	if (!sourceList) return;

	if (sourceList.matches('[data-profile-field="posts"]')) {
		const previous = profileCommentPostIds.get(sourceList);
		if (previous) profileOpenCommentIds.delete(previous);
		if (previous === postId) {
			profileCommentPostIds.delete(sourceList);
		} else {
			profileCommentPostIds.set(sourceList, postId);
			profileOpenCommentIds.add(postId);
		}
		syncCommentWatchers();
		window.dispatchEvent(new Event("profile:refresh"));
		return;
	}

	if (activeCommentPostId === postId) {
		closeComments(sourceList, postId);
		return;
	}
	activeCommentPostId = postId;
	syncCommentWatchers();
	renderPosts();
}

export function closeComments(sourceList, postId) {
	if (sourceList?.matches('[data-profile-field="posts"]')) {
		const openId = profileCommentPostIds.get(sourceList);
		if (!postId || openId === postId) {
			profileCommentPostIds.delete(sourceList);
			if (openId) profileOpenCommentIds.delete(openId);
		}
		syncCommentWatchers();
		window.dispatchEvent(new Event("profile:refresh"));
		return;
	}
	if (!sourceList || !postId || activeCommentPostId === postId) {
		activeCommentPostId = null;
	}
	syncCommentWatchers();
	renderPosts();
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
	await createPost(text, {
		groupId,
		media,
		pollOptions,
	});
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

	const likeRef = ref(state.db, `${postPath(postId)}/likes/${state.authUser.uid}`);
	if (liked) {
		return remove(likeRef);
	}

	const authorId = state.posts[postId]?.authorId;
	const snippet = String(state.posts[postId]?.text || "").slice(0, 100);
	const groupId = state.posts[postId]?.groupId || "";
	return update(ref(state.db, `${postPath(postId)}/likes`), {
		[state.authUser.uid]: true,
	}).then(() => notify(authorId, { type: "like", postId, groupId, snippet }, likeNotificationKey(postId)));
}

export async function createPost(text, { groupId = "", media, pollOptions } = {}) {
	if (!state.authUser) {
		throw new Error("Post atmak için giriş yapmalısınız.");
	}
	if (!state.db) {
		throw new Error("Veritabanı bağlantısı kurulamadı.");
	}
	if (!text) return;

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
		createdAt: serverTimestamp(),
		likes: {},
		groupId: isGroupPost ? groupId : "",
	};

	if (Object.keys(tagMap).length) {
		payload.tags = tagMap;
	}

	if (media?.dataUrl) {
		payload.hasMedia = true; // görselin kendisi post_media altında tutulur
	}
	payload.commentCount = 0;

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

	// Masa gönderileri yalnızca üyelerin okuyabildiği group_posts altına yazılır.
	const postKey = push(ref(state.db, isGroupPost ? `group_posts/${groupId}` : "posts")).key;
	const path = isGroupPost ? `group_posts/${groupId}/${postKey}` : `posts/${postKey}`;

	await set(ref(state.db, path), payload);

	if (media?.dataUrl) {
		const mediaDest = isGroupPost ? `group_post_media/${groupId}/${postKey}` : `post_media/${postKey}`;
		try {
			await set(ref(state.db, mediaDest), { type: "image", dataUrl: media.dataUrl });
		} catch (error) {
			// Görsel yazılamadıysa yarım gönderi bırakma.
			await remove(ref(state.db, path)).catch(() => {});
			throw error;
		}
	}
}

export async function createComment(postId, text) {
	if (!state.authUser) {
		throw new Error("Yorum yapmak için giriş yapmalısınız.");
	}
	if (!state.db) {
		throw new Error("Veritabanı bağlantısı kurulamadı.");
	}
	if (!text) return;

	const commentRef = push(ref(state.db, commentsPath(postId)));
	await set(commentRef, {
		text: text.slice(0, 180),
		authorId: state.authUser.uid,
		createdAt: serverTimestamp(),
	});
	notify(state.posts[postId]?.authorId, {
		type: "comment",
		postId,
		groupId: state.posts[postId]?.groupId || "",
		snippet: text,
	});
	// Sayaç gönderide tutulur; akış yorumları indirmeden sayıyı gösterebilir.
	await set(ref(state.db, `${postPath(postId)}/commentCount`), increment(1)).catch((error) => {
		console.warn("Yorum sayacı güncellenemedi:", error);
	});
}

async function deleteComment(postId, commentId) {
	if (!state.db) return;
	await remove(ref(state.db, `${commentsPath(postId)}/${commentId}`));
	await set(ref(state.db, `${postPath(postId)}/commentCount`), increment(-1)).catch((error) => {
		console.warn("Yorum sayacı güncellenemedi:", error);
	});
}
