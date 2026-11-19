/**
 * Minimal store: tek state ağacı + dilim (slice) bazlı abonelik.
 *
 * Neden Proxy?
 * - Mevcut feature'lar `state.foo = value` şeklinde yazmaya devam ediyor.
 * - Proxy bu atamaları yakalayıp abonelere bildirir; böylece 5000 satırlık kod
 *   tek seferde değiştirilmeden store'un üzerine kademeli olarak taşınabilir.
 *
 * Kısıt (şimdilik): sadece üst seviye atamalar bildirim üretir.
 * `state.posts[id] = post` gibi iç içe yazmalar bildirmez; ilgili feature
 * store'a geçirildiğinde `dispatch("posts", ...)` ile yazılacak.
 */

const sliceListeners = new Map();
const anyListeners = new Set();

let state = null;
let flushing = false;
const pending = new Set();

function callSafely(listener, args) {
	try {
		listener(...args);
	} catch (error) {
		// Bir abonenin hatası state yazma işlemini bozmasın.
		console.error("[store] abone hatası:", error);
	}
}

function flush() {
	flushing = true;
	try {
		while (pending.size) {
			const batch = [...pending];
			pending.clear();

			anyListeners.forEach((listener) => callSafely(listener, [state, batch]));

			batch.forEach((slice) => {
				const listeners = sliceListeners.get(slice);
				if (!listeners) return;
				// Kopya: abone kendi aboneliğini iptal ederse döngü bozulmaz.
				[...listeners].forEach((listener) =>
					callSafely(listener, [state[slice], state]),
				);
			});
		}
	} finally {
		flushing = false;
	}
}

function notify(slice) {
	pending.add(slice);
	if (!flushing) flush();
}

function makeReactive(initial) {
	return new Proxy(initial, {
		set(target, key, value, receiver) {
			const changed = target[key] !== value;
			const result = Reflect.set(target, key, value, receiver);
			if (changed) notify(key);
			return result;
		},
	});
}

export function createStore(initialState) {
	state = makeReactive(initialState);
	return { getState, dispatch, subscribe };
}

export function getState() {
	return state;
}

/** `dispatch("posts", data)` veya `dispatch({ posts: data, groups: other })`. */
export function dispatch(patch, value) {
	const entries =
		typeof patch === "string" ? [[patch, value]] : Object.entries(patch || {});
	entries.forEach(([key, next]) => {
		state[key] = next;
	});
	return state;
}

/**
 * `subscribe("posts", fn)` -> sadece posts değişince çalışır.
 * `subscribe(fn)` -> her değişimde çalışır.
 * Her iki hâlde de abonelik anında bir kez mevcut değerle çağrılır.
 * Dönen fonksiyon aboneliği iptal eder.
 */
export function subscribe(sliceOrListener, listener) {
	if (typeof sliceOrListener === "function") {
		anyListeners.add(sliceOrListener);
		callSafely(sliceOrListener, [state, []]);
		return () => anyListeners.delete(sliceOrListener);
	}

	const slice = sliceOrListener;
	if (!sliceListeners.has(slice)) sliceListeners.set(slice, new Set());
	sliceListeners.get(slice).add(listener);
	callSafely(listener, [state[slice], state]);
	return () => sliceListeners.get(slice)?.delete(listener);
}
