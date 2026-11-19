import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scriptRoot = join(root, "src", "assets", "script");

function walk(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : [full];
	});
}

const files = walk(scriptRoot).filter((f) => f.endsWith(".js"));
const read = (rel) => readFileSync(join(scriptRoot, rel), "utf8");

test("Firebase SDK import'u yalnızca services/ katmanında", () => {
	const offenders = files
		.filter((file) => !relative(scriptRoot, file).startsWith("services"))
		.filter((file) => readFileSync(file, "utf8").includes("gstatic.com/firebasejs"))
		.map((file) => relative(scriptRoot, file));
	assert.deepEqual(offenders, []);
	assert.match(read("services/firebase-sdk.js"), /firebase-app\.js/);
	assert.match(read("services/firebase-sdk.js"), /firebase-auth\.js/);
	assert.match(read("services/firebase-sdk.js"), /firebase-database\.js/);
});

test("state tek store üzerine kurulu ve eski API korunuyor", () => {
	const state = read("state.js");
	assert.match(state, /export const store = createStore\(/);
	assert.match(state, /export const state = getState\(\)/);
	assert.match(state, /export const firebaseConfig/);
	assert.match(state, /export function profileColumnId/);
});

test("başlatma bootstrap içinde, altyapı saf", () => {
	const bootstrap = read("app/bootstrap.js");
	assert.match(bootstrap, /export function startApp\(/);
	assert.match(bootstrap, /setupActionDelegation\(\)/);
	assert.match(bootstrap, /initFirebase\(firebaseConfig\)/);
	assert.doesNotMatch(bootstrap, /gstatic\.com/);

	const firebaseService = read("services/firebase.js");
	assert.match(firebaseService, /export function initFirebase\(/);
	assert.doesNotMatch(firebaseService, /from "\.\.\/auth\.js"/);
	assert.doesNotMatch(firebaseService, /state\./);
});

test("eski firebase.js kaldırıldı, kimse import etmiyor", () => {
	assert.equal(existsSync(join(scriptRoot, "firebase.js")), false);
	for (const file of files) {
		assert.doesNotMatch(
			readFileSync(file, "utf8"),
			/from ["']\.\.?\/firebase\.js["']/,
			relative(scriptRoot, file),
		);
	}
});

test("paylaşılan seçiciler feature'ların ortak veri kaynağı", () => {
	const selectors = read("shared/store/selectors.js");
	for (const name of ["canViewGroup", "getGroupName", "resolveAuthor", "resolveUserName"]) {
		assert.match(selectors, new RegExp(`export function ${name}\\(`));
	}
	const users = read("users.js");
	assert.match(users, /export \{ resolveAuthor, resolveUserName \} from ".\/shared\/store\/selectors\.js"/);
	const groups = read("features/groups/index.js");
	assert.match(groups, /canViewGroup/);
	assert.match(groups, /getGroupName/);
});

test("posts feature'ı katmanlara bölündü", () => {
	assert.match(read("posts.js"), /export \* from "\.\/features\/posts\/index\.js"/);
	for (const name of ["internal", "actions", "view", "subscription", "index"]) {
		assert.ok(
			existsSync(join(scriptRoot, "features", "posts", `${name}.js`)),
			`features/posts/${name}.js eksik`,
		);
	}
	const repo = read("services/repositories/posts.js");
	assert.match(repo, /export function watchPublicPosts/);
	assert.match(repo, /export async function fetchOwnPosts/);
	assert.doesNotMatch(repo, /from ["']\.\.\/\.\.\/features/);
	const subscription = read("features/posts/subscription.js");
	assert.match(subscription, /export function subscribeToPosts/);
	const actions = read("features/posts/actions.js");
	assert.match(actions, /export async function createPost/);
	const view = read("features/posts/view.js");
	assert.match(view, /export function createPostElement/);
});

test("auth/groups/notifications feature'ları katmanlara bölündü", () => {
	for (const name of ["auth", "groups", "notifications"]) {
		assert.match(
			read(`${name}.js`),
			new RegExp(`export \\* from "\\.\\/features\\/${name}\\/index\\.js"`),
			`${name}.js barrel değil`,
		);
		for (const part of ["internal", "actions", "view", "subscription", "index"]) {
			assert.ok(
				existsSync(join(scriptRoot, "features", name, `${part}.js`)),
				`features/${name}/${part}.js eksik`,
			);
		}
		const repo = read(`services/repositories/${name}.js`);
		assert.doesNotMatch(repo, /from ["']\.\.\/\.\.\/features/, `${name} repository feature import ediyor`);
	}
});

test("ince render: posts görünümü store aboneliğinden güncellenir", () => {
	const subscription = read("features/posts/subscription.js");
	assert.match(subscription, /subscribe\("posts"/);
	assert.match(subscription, /ensurePostsViewSubscription\(\)/);
	const internal = read("features/posts/internal.js");
	assert.match(internal, /dispatch\("posts", merged\)/);
});

test("event delegation altyapısı bağlı", () => {
	const events = read("app/events.js");
	assert.match(events, /export function registerAction\(/);
	assert.match(events, /export function setupActionDelegation\(/);
	const app = read("app.js");
	assert.match(app, /registerAction\("nav-search"/);
	assert.doesNotMatch(app, /bind\(elements\.searchButton/);
	const html = readFileSync(join(root, "src", "index.html"), "utf8");
	assert.match(html, /data-action="nav-search"/);
});
