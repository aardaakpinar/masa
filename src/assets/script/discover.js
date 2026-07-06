import { elements } from "./elements.js";
import { state } from "./state.js";
import { createPostElement } from "./posts.js";
import { createGroupCard, canViewGroup } from "./groups.js";
import { openSearch } from "./ui.js";
import { trLower, extractHashtags } from "./utils.js";

let queryText = "";

const TRENDING_LIMIT = 8;
const TRENDING_SCAN_LIMIT = 150;

function getPosts() {
	return Object.entries(state.posts || {})
		.map(([id, post]) => ({ id, ...post }))
		.filter((post) => canViewGroup(post.groupId))
		.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
		empty.textContent = "Masa bulunamadı.";
		elements.searchResults.replaceChildren(empty);
		return;
	}

	elements.searchResults.replaceChildren(
		...groups.map((group) => createGroupCard(group, { compact: true })),
	);

	if (window.lucide) {
		window.lucide.createIcons();
	}
}

// Bir gönderinin (post) ya da yorumun ilgili sorguyla eşleşip eşleşmediğini
// doğrudan post-text (ve yorum metni) içeriğine bakarak kontrol eder.
function matchesQuery({ text, authorName }, q, qWithoutHash, qWithoutAt) {
	if (q.startsWith("@")) {
		return trLower(authorName || "").includes(qWithoutAt);
	}

	const body = trLower(text || "");
	const authorSource = trLower(authorName || "");

	if (q.startsWith("#")) {
		// Etiket araması: gönderi metninin içindeki gerçek #etiketlere bak,
		// ayrıca parçalı yazımı da (örn. "#den") desteklemek için ham metinde de ara.
		const tags = extractHashtags(text || "");
		const tagMatch = tags.some((tag) => tag.startsWith(qWithoutHash ? `#${qWithoutHash}` : "#"));
		return tagMatch || body.includes(q) || body.includes(qWithoutHash);
	}

	return body.includes(q) || authorSource.includes(q);
}

export function renderDiscover() {
	if (!elements.searchResults) return;

	const rawQuery = queryText.trim();

	if (rawQuery.startsWith("-")) {
		renderGroupResults(rawQuery.slice(1));
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

	if (!results.length) {
		const empty = document.createElement("div");
		empty.className = "empty-state";
		empty.textContent = "Sonuç bulunamadı.";
		elements.searchResults.replaceChildren(empty);
		return;
	}

	elements.searchResults.replaceChildren(
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
	const targets = [elements.trendingList, elements.searchTrendingList].filter(
		Boolean,
	);

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
	elements.searchInput?.addEventListener("input", (event) => {
		queryText = event.target.value || "";
		renderDiscover();
	});

	window.addEventListener("posts:updated", () => {
		renderDiscover();
		renderTrending();
	});
	window.addEventListener("search:query", (event) => {
		openSearch();
		queryText = event.detail?.query || "";
		if (elements.searchInput) {
			elements.searchInput.value = queryText;
		}
		renderDiscover();
	});
}
