import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/assets/script/shared/store/store.js";
import {
	currentUid,
	canViewGroup,
	getGroupName,
	isGroupMember,
	isGroupOwner,
	resolveAuthor,
	resolveUserName,
	selectFeedPosts,
	selectGroupFeedPosts,
	selectProfilePosts,
	selectSearchPosts,
	selectGroups,
	selectMyGroups,
	selectGroupRequests,
	selectProfileData,
	selectNotifications,
	selectUnreadCount,
	selectTrendingTags,
	selectOpenFeedColumns,
} from "../src/assets/script/shared/store/selectors.js";

createStore({
	authUser: { uid: "u1" },
	profile: { name: "Ben", color: "#ff0000" },
	users: {
		u1: { name: "Eski Ben", color: "#00ff00" },
		u2: { name: "Ali", color: "#0000ff" },
		u3: { name: "Silinmiş", isDisabled: true },
	},
	groups: {
		g1: { id: "g1", name: "Açık Masa", members: { u1: true, u2: true }, createdAt: 2 },
		g2: { id: "g2", name: "Kapalı Masa", members: { u2: true }, createdAt: 1 },
	},
	posts: {
		p1: { id: "p1", authorId: "u1", authorName: "Eski Ben", text: "#merhaba #dünya #MERHABA", createdAt: 10, likes: { u2: true } },
		p2: { id: "p2", authorId: "u2", text: "#gizli", createdAt: 20, groupId: "g2" },
		p3: { id: "p3", authorId: "u2", text: "düz", createdAt: 30, groupId: "g1" },
		p4: { id: "p4", authorId: "u1", text: "eski", createdAt: 5, __extra: true },
	},
	groupRequests: { g1: { u2: { requestedAt: 2 }, u3: { requestedAt: 1 } } },
	notifications: {
		n1: { type: "like", createdAt: 2 },
		n2: { type: "comment", createdAt: 1, read: true },
		n3: { type: "bilinmeyen", createdAt: 3 },
	},
	openFeedColumns: ["", "$search"],
});

const ids = (posts) => posts.map((p) => p.id);

test("kullanıcı ve masa yetkisi", () => {
	assert.equal(currentUid(), "u1");
	assert.equal(canViewGroup(""), true);
	assert.equal(canViewGroup("g1"), true);
	assert.equal(canViewGroup("g2"), false);
	assert.equal(canViewGroup("yok"), false);
	assert.equal(getGroupName("g1"), "Açık Masa");
	assert.equal(getGroupName("yok"), "Masa");
	assert.equal(isGroupMember("g1"), true);
	assert.equal(isGroupOwner("g1"), false);
});

test("yazar çözümlemesi canlı profili kullanır", () => {
	assert.deepEqual(resolveAuthor({ authorId: "u1", authorName: "Eski Ben" }), {
		name: "Ben",
		color: "#ff0000",
	});
	assert.deepEqual(resolveAuthor({ authorId: "u2" }), {
		name: "Ali",
		color: "#0000ff",
	});
	assert.equal(resolveAuthor({ authorId: "u1", authorName: "Anon", isAnonymous: true }).name, "Anon");
	assert.equal(resolveUserName("u2", "yedek"), "Ali");
	assert.equal(resolveUserName("yok", "yedek"), "yedek");
});

test("akış seçicileri görünürlüğe ve __extra'ya göre filtreler", () => {
	// Ana akış yalnızca gruba ait olmayan gönderileri gösterir (grup akışı ayrı).
	assert.deepEqual(ids(selectFeedPosts()), ["p1"]);
	assert.deepEqual(ids(selectGroupFeedPosts("g1")), ["p3"]);
	assert.deepEqual(ids(selectProfilePosts("u1")), ["p1", "p4"]);
	assert.deepEqual(ids(selectSearchPosts()), ["p3", "p1"]);
});

test("grup seçicileri", () => {
	assert.deepEqual(selectGroups().map((g) => g.id), ["g1", "g2"]);
	assert.deepEqual(selectMyGroups().map((g) => g.id), ["g1"]);
	assert.deepEqual(selectGroupRequests("g1").map(([uid]) => uid), ["u3", "u2"]);
});

test("profil seçici devre dışı kullanıcıyı döndürmez", () => {
	assert.deepEqual(selectProfileData("u1"), {
		uid: "u1",
		isMe: true,
		name: "Ben",
		color: "#ff0000",
		createdAt: null,
	});
	assert.equal(selectProfileData("u2").isMe, false);
	assert.equal(selectProfileData("u3"), null);
	assert.equal(selectProfileData("yok"), null);
});

test("bildirim ve etiket seçicileri", () => {
	assert.deepEqual(selectNotifications().map((n) => n.id), ["n1", "n2"]);
	assert.equal(selectUnreadCount(), 1);
	assert.deepEqual(selectTrendingTags(2), [
		{ tag: "#merhaba", count: 1 },
		{ tag: "#dünya", count: 1 },
	]);
	assert.deepEqual(selectOpenFeedColumns(), ["", "$search"]);
});
