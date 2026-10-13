import { elements } from "./elements.js";
import { resolveAuthor } from "./users.js";
import { state } from "./state.js";
import { createPostElement } from "./posts.js";
import { createGroupCard, canViewGroup } from "./groups.js";
import { openSearch } from "./ui.js";
import { trLower, extractHashtags, initials, getContrastColor, safeColor } from "./utils.js";

let queryText = "";

const TRENDING_LIMIT = 6;
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

function createSection(title, children, { count, action } = {}) {
	const section = document.createElement("section");
	section.className = "search-block";
	const head = document.createElement("div");
	head.className = "search-block__head";
	const h = document.createElement("h3");
	h.className = "search-block__title";
	h.textContent = title;
	if (count) {
		const badge = document.createElement("span");
		badge.className = "search-block__count";
		badge.textContent = count;
		h.append(badge);
	}
	head.append(h);
	if (action) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "search-block__action";
		button.textContent = action.label;
		button.addEventListener("click", action.onClick);
		head.append(button);
	}
	section.append(head, ...children);
	return section;
}

function createEmpty(text) {
	const empty = document.createElement("div");
	empty.className = "empty-state";
	empty.textContent = text;
	return empty;
}

function allTagCounts(posts) {
	const counts = new Map();
	posts.forEach((post) => {
		extractHashtags(post.text || "").forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
	});
	return counts;
}

function createTagRow(tag, count, rank) {
	const row = document.createElement("button");
	row.type = "button";
	row.className = "tag-row";
	if (rank) {
		const r = document.createElement("span");
		r.className = "tag-row__rank";
		r.textContent = String(rank);
		row.append(r);
	}
	const name = document.createElement("span");
	name.className = "tag-row__name";
	name.textContent = tag;
	const meta = document.createElement("span");
	meta.className = "tag-row__meta";
	meta.textContent = `${count} gönderi`;
	row.append(name, meta);
	row.addEventListener("click", () => applyQuery(tag, { focus: false }));
	return row;
}

function postMatches(post, q, kind) {
	const authorName = trLower(resolveAuthor(post).name || "");
	if (kind === "#") {
		const tagQuery = trLower(q);
		return extractHashtags(post.text || "").some((tag) => trLower(tag).slice(1).startsWith(tagQuery));
	}
	return trLower(post.text || "").includes(q) || authorName.includes(q);
}

function postElements(items) {
	return items.map((post) => createPostElement({ ...post, __fromDiscover: true }));
}

function finish(nodes) {
	elements.searchResults.replaceChildren(...nodes);
	window.lucide?.createIcons();
}

export function renderDiscover() {
	if (!elements.searchResults) return;

	const rawQuery = queryText.trim();
	syncSearchUi();
	setResultsTitle("");

	const kind = PREFIXES.includes(rawQuery[0]) ? rawQuery[0] : "";
	const term = kind ? rawQuery.slice(1).trim() : rawQuery;
	const q = trLower(term);
	const posts = getPosts();

	// ---- Boş sorgu: keşfet ----
	if (!q) {
		if (kind === "@") {
			const people = searchPeople("", 40);
			return finish([createSection("Kişiler", people.length ? [createPeopleSection(people)] : [createEmpty("Henüz kişi yok.")], { count: people.length || "" })]);
		}
		if (kind === "-") {
			const groups = getGroups();
			return finish([
				createSection("Masalar", groups.length ? groups.map((group) => createGroupCard(group, { compact: true })) : [createEmpty("Henüz masa yok.")], { count: groups.length || "" }),
			]);
		}
		if (kind === "#") return finish([]);
		const nodes = [];
		const people = searchPeople("", 4);
		if (people.length) {
			nodes.push(createSection("Önerilen kişiler", [createPeopleSection(people)], { action: { label: "Tümü", onClick: () => applyQuery("@", { focus: false }) } }));
		}
		const recent = posts.slice(0, 5);
		if (recent.length) nodes.push(createSection("Son paylaşımlar", postElements(recent)));
		return finish(nodes);
	}

	// ---- Önekli aramalar ----
	if (kind === "@") {
		const people = searchPeople(term, 40);
		return finish([
			createSection("Kişiler", people.length ? [createPeopleSection(people)] : [createEmpty(`“${term}” adında kişi bulunamadı.`)], { count: people.length || "" }),
		]);
	}
	if (kind === "-") {
		const groups = getGroups().filter((group) => trLower(`${group.name || ""} ${group.description || ""}`).includes(q));
		return finish([
			createSection("Masalar", groups.length ? groups.map((group) => createGroupCard(group, { compact: true })) : [createEmpty(`“${term}” için masa bulunamadı.`)], { count: groups.length || "" }),
		]);
	}

	const tagMatches = [...allTagCounts(posts).entries()]
		.filter(([tag]) => trLower(tag).slice(1).startsWith(kind === "#" ? q : q.replace(/^#/, "")))
		.sort((a, b) => b[1] - a[1]);

	if (kind === "#") {
		const tagPosts = posts.filter((post) => postMatches(post, q, "#"));
		const nodes = [];
		if (tagMatches.length > 1) {
			nodes.push(createSection("Etiketler", tagMatches.slice(0, 6).map(([tag, count]) => createTagRow(tag, count))));
		}
		nodes.push(
			createSection("Gönderiler", tagPosts.length ? postElements(tagPosts) : [createEmpty(`#${term} etiketiyle gönderi bulunamadı.`)], { count: tagPosts.length || "" }),
		);
		return finish(nodes);
	}

	// ---- Tümü: kişiler + masalar + etiketler + gönderiler ----
	const people = searchPeople(term, 40);
	const groups = getGroups().filter((group) => trLower(`${group.name || ""} ${group.description || ""}`).includes(q));
	const found = posts.filter((post) => postMatches(post, q, ""));
	const nodes = [];

	if (people.length) {
		nodes.push(createSection("Kişiler", [createPeopleSection(people.slice(0, 3))], {
			count: people.length,
			action: people.length > 3 ? { label: "Tümü", onClick: () => applyQuery("@" + term, { focus: false }) } : undefined,
		}));
	}
	if (groups.length) {
		nodes.push(createSection("Masalar", groups.slice(0, 3).map((group) => createGroupCard(group, { compact: true })), {
			count: groups.length,
			action: groups.length > 3 ? { label: "Tümü", onClick: () => applyQuery("-" + term, { focus: false }) } : undefined,
		}));
	}
	if (tagMatches.length) {
		nodes.push(createSection("Etiketler", tagMatches.slice(0, 4).map(([tag, count]) => createTagRow(tag, count))));
	}
	if (found.length) nodes.push(createSection("Gönderiler", postElements(found), { count: found.length }));

	if (!nodes.length) return finish([createEmpty(`“${term}” için sonuç bulunamadı.`)]);
	return finish(nodes);
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

function createTrendingList(trending) {
	const wrap = document.createElement("div");
	wrap.className = "tag-list";
	trending.forEach(({ tag, count }, index) => wrap.append(createTagRow(tag, count, index + 1)));
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

		target.replaceChildren(createTrendingList(trending));
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
