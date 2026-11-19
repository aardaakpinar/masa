/** posts feature'ının DOM/view katmanı. Veri okur, action çağırır, DOM üretir. */
import { feedColumnIds, profileUidFromColumnId, state } from "../../state.js";
import { elements } from "../../elements.js";
import { resolveAuthor, canViewGroup, getGroupName } from "../../shared/store/selectors.js";
import { initials, formatTime, createRichTextFragment, getContrastColor } from "../../utils.js";
import { closeProfileColumn, openAuth, syncComposer } from "../../ui.js";
import { closeGroupSettingsPanel } from "../../groups.js";
import {
	SAFE_IMAGE_DATA_URL,
	commentsPath,
	getComments,
	getCommentCount,
	getPollVotes,
	loadMedia,
	watchComments,
	activeCommentPostId,
	setActiveCommentPostId,
	profileCommentPostIds,
	profileOpenCommentIds,
	syncCommentWatchers,
} from "./internal.js";
import {
	toggleLike,
	voteOnPoll,
	deletePost,
	deleteComment,
	setLike,
} from "./actions.js";

function refreshIcons() {
	if (window.lucide && typeof window.lucide.createIcons === "function") {
		window.lucide.createIcons();
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

export function renderPosts() {
	renderGroupFeedColumns();
	if (!elements.postList) return;

	if (elements.postsLoading) elements.postsLoading.remove();
	if (activeCommentPostId && !state.posts[activeCommentPostId]) {
		setActiveCommentPostId(null);
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

// ---- Sütunlar ----

const auxiliaryColumns = [
	{ id: feedColumnIds.search, element: document.querySelector("#search"), title: "Ara" },
	{ id: feedColumnIds.groups, element: document.querySelector("#groupsView"), title: "Masalar" },
	{ id: feedColumnIds.account, element: document.querySelector("#settingsPanel"), title: "Hesap" },
	{ id: feedColumnIds.auth, element: document.querySelector("#authPanel"), title: "Giriş" },
	{ id: feedColumnIds.notifications, element: document.querySelector("#notificationsView"), title: "Bildirimler" },
];

const groupComposers = new Map();
let pendingMobileFocusId = null;
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

export function renderGroupFeedColumns() {
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

// ---- Gönderi kartı ----

export function createPostElement(post, options) {
	const commentsOpen = options?.commentsOpen === true;
	const author_ = resolveAuthor(post);
	const article = document.createElement("article");
	article.className = "post";

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
		if (myVoteKey !== undefined) fill.style.width = `${percent}%`;

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

// ---- Yorum görünümü ----

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
				try {
					await setLike(`${commentsPath(post.id)}/${comment.id}/likes/${state.authUser.uid}`, !liked);
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
	const postPreview = createPostElement(post, { commentsOpen: true });

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
	setActiveCommentPostId(postId);
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
		setActiveCommentPostId(null);
	}
	syncCommentWatchers();
	renderPosts();
}
