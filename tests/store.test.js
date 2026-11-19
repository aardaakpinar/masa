import test from "node:test";
import assert from "node:assert/strict";
import {
	createStore,
	getState,
	dispatch,
	subscribe,
} from "../src/assets/script/shared/store/store.js";

createStore({ posts: {}, groups: {}, authResolved: false, count: 0 });

test("abonelik kurulurken mevcut değerle bir kez çağrılır", () => {
	let calls = 0;
	let last = null;
	const off = subscribe("posts", (posts) => {
		calls += 1;
		last = posts;
	});
	assert.equal(calls, 1);
	assert.deepEqual(last, {});
	off();
});

test("eski kodun doğrudan ataması (Proxy) aboneyi tetikler", () => {
	let calls = 0;
	const off = subscribe("posts", () => { calls += 1; });
	const start = calls;
	getState().posts = { a: 1 };
	assert.equal(calls, start + 1);
	off();
});

test("aynı değer atanınca bildirim olmaz", () => {
	let calls = 0;
	const off = subscribe("groups", () => { calls += 1; });
	const start = calls;
	const value = getState().groups;
	getState().groups = value;
	assert.equal(calls, start);
	off();
});

test("dispatch tek dilim ve çoklu dilim yazar", () => {
	const posts = { p: 1 };
	dispatch("posts", posts);
	assert.equal(getState().posts, posts);

	const groups = { g: 1 };
	dispatch({ posts: { p: 2 }, groups });
	assert.equal(getState().posts.p, 2);
	assert.equal(getState().groups, groups);
});

test("global abone değişen dilimleri görür", () => {
	let slices = null;
	const off = subscribe((_state, changed) => { slices = changed; });
	dispatch("authResolved", true);
	assert.deepEqual(slices, ["authResolved"]);
	off();
});

test("abonelik iptal edilebilir", () => {
	let calls = 0;
	const off = subscribe("posts", () => { calls += 1; });
	const start = calls;
	off();
	dispatch("posts", { x: 1 });
	assert.equal(calls, start);
});

test("abone hatası state yazmasını bozmaz", () => {
	const errors = [];
	const orig = console.error;
	console.error = (...args) => errors.push(args.join(" "));
	try {
		const off = subscribe("count", () => { throw new Error("boom"); });
		dispatch("count", 5);
		assert.equal(getState().count, 5);
		assert.ok(errors.some((e) => e.includes("boom")));
		off();
	} finally {
		console.error = orig;
	}
});

test("abone içinden dispatch (reentrancy) güvenli", () => {
	let ran = false;
	const offA = subscribe("count", (value) => { if (value === 6) ran = true; });
	const offB = subscribe("count", (value) => {
		if (value === 6) dispatch("groups", { reentered: true });
	});
	dispatch("count", 6);
	assert.equal(ran, true);
	assert.deepEqual(getState().groups, { reentered: true });
	offA();
	offB();
});

test("iç içe yazma bildirim üretmez (dokümante kısıt)", () => {
	let calls = 0;
	const off = subscribe("posts", () => { calls += 1; });
	const start = calls;
	getState().posts.nested = true;
	assert.equal(calls, start);
	off();
});
