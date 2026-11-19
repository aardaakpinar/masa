/** groups feature'ının Firebase canlı abonelikleri. Veriyi repository'den alır, store'a yazar. */
import { feedColumnIds, profileUidFromColumnId, state } from "../../state.js";
import { elements } from "../../elements.js";
import { resolveUserName } from "../../users.js";
import {
	watchGroups,
	watchGroupRequests,
	watchMyJoinRequest,
	stopListener,
} from "../../services/repositories/groups.js";
import {
	getGroups,
	isMember,
	isApprovalGroup,
	loadUsersProfiles,
} from "./internal.js";
import {
	renderGroups,
	renderGroupDetail,
	renderGroupRequests,
	renderGroupDetailMembers,
} from "./view.js";

export function subscribeToGroups() {
	if (!state.db) return;

	stopGroupSubscription();
	state.groups = {};
	const { query: groupsQuery, unsubscribe } = watchGroups(
		(snapshot) => {
			state.groups = snapshot.val() || {};
			void loadUsersProfiles();
			renderGroups();
			if (state.activeGroupId) {
				renderGroupDetail();
			}
		},
		(error) => {
			// Giriş yapılmamış / devre dışı hesaplarda /groups okunamaz: beklenen durum, hata değil.
			if (/permission[_ ]denied/i.test(`${error?.code} ${error?.message}`)) {
				state.groups = {};
				renderGroups();
				return;
			}
			console.error("Masalar yüklenemedi:", error);
		},
	);
	state.groupsRef = { query: groupsQuery, unsubscribe };
}

export function stopGroupSubscription() {
	if (state.db && state.groupsRef) {
		stopListener(state.groupsRef.unsubscribe || state.groupsRef);
	}
	state.groupsRef = null;
}

function pruneUnavailableFeedColumns() {
	const availableGroupIds = new Set(
		getGroups()
			.filter((group) => isMember(group) || group.ownerId === state.authUser?.uid)
			.map(({ id }) => id),
	);
	const fixedColumnIds = new Set(Object.values(feedColumnIds));
	const nextColumns = state.openFeedColumns.filter((id) => !id || fixedColumnIds.has(id) || profileUidFromColumnId(id) || availableGroupIds.has(id));
	if (nextColumns.length === state.openFeedColumns.length) return;
	state.openFeedColumns = nextColumns;
	window.dispatchEvent(new Event("feed-columns:updated"));
}

// Onaylı masalar için istekler canlı dinlenir: sahibi olduğun masalarda tüm istekler,
// üye olmadığın onaylı masalarda yalnızca kendi isteğin.
function syncRefs(refs, wantedIds, watch, onData, onDrop) {
	Object.keys(refs).forEach((id) => {
		if (wantedIds.has(id)) return;
		stopListener(refs[id]);
		delete refs[id];
		onDrop(id);
	});
	wantedIds.forEach((id) => {
		if (refs[id]) return;
		const { unsubscribe } = watch(
			id,
			(value) => {
				onData(id, value);
				renderGroups();
				renderGroupRequests();
			},
			() => onData(id, null),
		);
		refs[id] = unsubscribe;
	});
}

export function syncJoinRequestSubscriptions() {
	if (!state.db) return;
	const uid = state.authUser?.uid;
	const owned = new Set();
	const watching = new Set();

	if (uid) {
		Object.entries(state.groups || {}).forEach(([id, group]) => {
			if (!isApprovalGroup(group)) return;
			if (group.ownerId === uid) owned.add(id);
			else if (!group.members?.[uid]) watching.add(id);
		});
	}

	syncRefs(
		state.groupRequestRefs,
		owned,
		(id, onData, onError) => watchGroupRequests(id, onData, onError),
		(id, value) => {
			state.groupRequests[id] = value || {};
		},
		(id) => {
			delete state.groupRequests[id];
		},
	);
	syncRefs(
		state.myJoinRequestRefs,
		watching,
		(id, onData, onError) => watchMyJoinRequest(id, uid, onData, onError),
		(id, value) => {
			state.myJoinRequests[id] = Boolean(value);
		},
		(id) => {
			delete state.myJoinRequests[id];
		},
	);
}

window.addEventListener("groups:updated", pruneUnavailableFeedColumns);
window.addEventListener("groups:updated", syncJoinRequestSubscriptions);

// Üyelerden biri adını/rengini değiştirince masa listesi ve üye satırları güncellenir.
window.addEventListener("users:updated", () => {
	renderGroups();
	if (state.activeGroupId) {
		const group = state.groups?.[state.activeGroupId];
		if (group && elements.groupDetailMeta) {
			const memberCount = Object.keys(group.members || {}).length;
			elements.groupDetailMeta.textContent = `${memberCount} üye · ${resolveUserName(group.ownerId, group.ownerName)} oluşturdu`;
		}
		renderGroupDetailMembers();
	}
});
