import { elements } from "./elements.js";
import { resolveAuthor } from "./users.js";
import { state } from "./state.js";
import { createPostElement } from "./posts.js";
import { createGroupCard, canViewGroup } from "./groups.js";
import { openSearch } from "./ui.js";
import { trLower, extractHashtags, initials, getContrastColor, safeColor } from "./utils.js";

let queryText = "";

const TRENDING_LIMIT = 8;
const TRENDING_SCAN_LIMIT = 150;

const PREFIXES = ["@", "-", "#"];

function stripPrefix(value) {
	const v = value.trimStart();
	return PREFIXES.includes(v[0]) ? v.slice(1) : v;
}

function setResultsTitle(text) {
	if (elements.searchResultsTitle) elements.searchResultsTitle.textContent = text;
}

// Temizle düğmesi, aktif sekme ve gündem bölümünü sorguya göre günceller.
function syncSearchUi() {
	const raw = queryText.trimStart();
	const prefix = PREFIXES.includes(raw[0]) ? raw[0] : "";

	elements.searchClear?.classList.toggle("hidden", !queryText);
	elements.searchTabs?.querySelectorAll(".search-tab").forEach((tab) => {
		const active = tab.dataset.prefix === prefix;
		tab.classList.toggle("active", active);
		tab.setAttribute("aria-selected", String(active));
	});

	const showTrending = !stripPrefix(raw) && (prefix === "" || prefix === "#");
	elements.searchTrendingSection?.classList.toggle("hidden", !showTrending);
}

function applyQuery(value, { focus = true } = {}) {
	queryText = value;
	if (elements.searchInput) {
		elements.searchInput.value = value;
		if (focus) elements.searchInput.focus();
	}
	renderDiscover();
}

function getPosts() {
	return Object.entries(state.posts || {})
		.map(([id, post]) => ({ id, ...post }))
		.filter((post) => !post.__extra && canViewGroup(post.groupId))
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Kullanıcı (profil) araması: ada göre; adı sorguyla başlayanlar öne gelir.
function searchPeople(term, limit) {
	const needle = trLower(term.trim());
	const list = Object.entries(state.users || {})
		.filter(([, user]) => user?.name && !user.isDisabled && user.name !== "Silinmiş kullanıcı")
		.filter(([, user]) => !needle || trLower(user.name).includes(needle))
		.map(([uid, user]) => ({ uid, ...user }))
		.sort((a, b) => {
			const aStarts = needle && trLower(a.name).startsWith(needle) ? 0 : 1;
			const bStarts = needle && trLower(b.name).startsWith(needle) ? 0 : 1;
			return aStarts - bStarts || a.name.localeCompare(b.name, "tr");
		});
	return limit ? list.slice(0, limit) : list;
}

function createPersonRow(user) {
	const row = document.createElement("button");
	row.type = "button";
	row.className = "person-row";

	const avatar = document.createElement("div");
	avatar.className = "avatar person-row__avatar";
	avatar.textContent = initials(user.name);
	avatar.style.background = safeColor(user.color);
	avatar.style.color = getContrastColor(safeColor(user.color));

	const info = document.createElement("div");
	info.className = "person-row__info";
	const name = document.createElement("span");
	name.className = "person-row__name";
	name.textContent = user.name + (user.uid === state.authUser?.uid ? " (sen)" : "");
	info.append(name);
	if (user.createdAt) {
		const meta = document.createElement("span");
		meta.className = "person-row__meta";
		meta.textContent = `${new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(user.createdAt))} tarihinde katıldı`;
		info.append(meta);
	}

	row.append(avatar, info);
	row.addEventListener("click", () => {
		window.dispatchEvent(new CustomEvent("profile:open", { detail: { uid: user.uid } }));
	});
	return row;
}

function createPeopleSection(users, title) {
	const wrap = document.createElement("div");
	wrap.className = "people-section";
	if (title) {
		const heading = document.createElement("div");
		heading.className = "search-section__title";
		heading.textContent = title;
		wrap.append(heading);
	}
	users.forEach((user) => wrap.append(createPersonRow(user)));
	return wrap;
}

function getGroups() {
	return Object.entries(state.groups || {})
		.map(([id, group]) => ({ id, ...group }))
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function renderGroupResults(groupQuery) {
	const q = trLower(groupQuery.trim());
	const groups = getGroups().filter((group) => {
		if (!q) return true;
		const source = trLower(`${group.name || ""} ${group.description || ""}`);
		return source.includes(q);
	});

	if (!groups.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = q ? `“${groupQuery.trim()}” için masa bulunamadı.` : "Henüz masa yok.";
		setResultsTitle("");
		elements.searchResults.replaceChildren(empty);
		return;
	}

	setResultsTitle(q ? `${groups.length} masa` : "Tüm masalar");
	elements.searchResults.replaceChildren(
		...groups.map((group) => createGroupCard(group, { compact: true })),
	);

	if (window.lucide) {
		window.lucide.createIcons();
	}
}

// Bir gönderinin (post) ya da yorumun ilgili sorguyla eşleşip eşleşmediğini
// doğrudan post-text (ve yorum metni) içeriğine bakarak kontrol eder.
function matchesQuery(item, q, qWithoutHash, qWithoutAt) {
	const { text } = item;
	const authorName = resolveAuthor(item).name;
	if (q.startsWith("@")) {
		return trLower(authorName || "").includes(qWithoutAt);
	}

	const body = trLower(text || "");
	const authorSource = trLower(authorName || "");

	if (q.startsWith("#")) {
		// Match hashtag tokens only; searching raw text here also matches unrelated words.
		const tags = extractHashtags(text || "");
		const tagQuery = trLower(qWithoutHash.trim());
		return tags.some((tag) => tag.slice(1).startsWith(tagQuery));
	}

	return body.includes(q) || authorSource.includes(q);
}

export function renderDiscover() {
	if (!elements.searchResults) return;

	const rawQuery = queryText.trim();
	syncSearchUi();

	if (rawQuery.startsWith("-")) {
		renderGroupResults(rawQuery.slice(1));
		return;
	}

	// "@" / Kişiler sekmesi: yalnızca kişiler (profil araması).
	if (rawQuery.startsWith("@")) {
		const term = rawQuery.slice(1);
		const people = searchPeople(term, 40);
		if (!people.length) {
			const empty = document.createElement("div");
			empty.className = "empty-state";
			empty.textContent = term.trim() ? `“${term.trim()}” adında kişi bulunamadı.` : "Henüz kişi yok.";
			setResultsTitle("");
			elements.searchResults.replaceChildren(empty);
			return;
		}
		setResultsTitle(term.trim() ? `${people.length} kişi` : "Tüm kişiler");
		elements.searchResults.replaceChildren(createPeopleSection(people));
		return;
	}

	const posts = getPosts();
	const q = trLower(rawQuery);
	const qWithoutHash = q.startsWith("#") ? q.slice(1) : q;
	const qWithoutAt = q.startsWith("@") ? q.slice(1) : q;

	let results = [];

	if (q) {
		posts.forEach((post) => {
			if (matchesQuery(post, q, qWithoutHash, qWithoutAt)) {
				results.push({
					...post,
					__fromDiscover: true,
				});
			}

			Object.values(post.comments || {}).forEach((comment) => {
				if (matchesQuery(comment, q, qWithoutHash, qWithoutAt)) {
					results.push({
						...comment,
						id: `${post.id}-${comment.createdAt}`,
						createdAt: comment.createdAt,
						likes: comment.likes || {},
						comments: {},
						__fromDiscover: true,
						__isComment: true,
					});
				}
			});
		});
	} else {
		results = posts.slice(0, 8).map((post) => ({
			...post,
			__fromDiscover: true,
		}));
	}

	// Düz aramada (önek yok) eşleşen kişiler de en üstte gösterilir.
	const people = q && !q.startsWith("#") ? searchPeople(rawQuery, 3) : [];

	if (!results.length && !people.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = `“${rawQuery}” için sonuç bulunamadı.`;
		setResultsTitle("");
		elements.searchResults.replaceChildren(empty);
		return;
	}

	setResultsTitle(q ? (results.length ? `${results.length} sonuç` : "") : "Son paylaşımlar");
	elements.searchResults.replaceChildren(
		...(people.length ? [createPeopleSection(people, "Kişiler")] : []),
		...results.map((item) => createPostElement(item)),
	);

	if (window.lucide) {
		window.lucide.createIcons();
	}
}

// Görüntülenebilir tüm gönderilerin metninden etiketleri toplayıp
// en çok kullanılanları (gündemi) döndürür.
export function getTrendingTags(limit = TRENDING_LIMIT) {
	const counts = new Map();

	getPosts()
		.slice(0, TRENDING_SCAN_LIMIT)
		.forEach((post) => {
			extractHashtags(post.text || "").forEach((tag) => {
				counts.set(tag, (counts.get(tag) || 0) + 1);
			});
		});

	return Array.from(counts.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([tag, count]) => ({ tag, count }));
}

function createTrendingCloud(trending) {
	const wrap = document.createElement("div");
	wrap.className = "tag-cloud";

	const counts = trending.map(({ count }) => count);
	const min = Math.min(...counts);
	const max = Math.max(...counts);

	trending.forEach(({ tag, count }) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "tag-cloud__item";
		button.textContent = tag;
		button.title = `${count} gönderi`;

		// Kullanım sıklığına göre yazı boyutu (Blogger'daki etiket bulutu gibi).
		const ratio = max === min ? 1 : (count - min) / (max - min);
		const size = 12 + ratio * 10; // 12px – 22px
		button.style.fontSize = `${size.toFixed(1)}px`;
		button.style.fontWeight = ratio > 0.6 ? "800" : ratio > 0.3 ? "700" : "600";

		button.addEventListener("click", () => {
			window.dispatchEvent(
				new CustomEvent("search:query", { detail: { query: tag } }),
			);
		});

		wrap.append(button);
	});

	return wrap;
}

export function renderTrending() {
	const trending = getTrendingTags();
	const targets = [elements.searchTrendingList].filter(Boolean);

	targets.forEach((target) => {
		if (!trending.length) {
			const empty = document.createElement("div");
			empty.className = "empty-state empty-state--compact";
			empty.textContent = "Henüz gündemde bir etiket yok.";
			target.replaceChildren(empty);
			return;
		}

		target.replaceChildren(createTrendingCloud(trending));
	});
}

export function setupDiscover() {
	window.addEventListener("users:updated", () => {
		if (queryText) renderDiscover();
	});

	let timer;
	elements.searchInput?.addEventListener("input", (event) => {
		queryText = event.target.value || "";
		syncSearchUi();
		clearTimeout(timer);
		timer = setTimeout(renderDiscover, 120);
	});

	elements.searchInput?.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && queryText) applyQuery("");
	});

	elements.searchClear?.addEventListener("click", () => applyQuery(""));

	elements.searchTabs?.addEventListener("click", (event) => {
		const tab = event.target.closest(".search-tab");
		if (!tab) return;
		applyQuery(tab.dataset.prefix + stripPrefix(queryText));
	});

	window.addEventListener("posts:updated", () => {
		renderDiscover();
		renderTrending();
	});
	window.addEventListener("search:query", (event) => {
		openSearch();
		applyQuery(event.detail?.query || "", { focus: false });
	});

	syncSearchUi();
}
