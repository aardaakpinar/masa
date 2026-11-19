import { dispatch } from "../shared/store/store.js";
import { firebaseConfig } from "../state.js";
import { initFirebase } from "../services/firebase.js";
import { subscribeToAuth } from "../auth.js";
import { subscribeToPosts, stopPostSubscription } from "../posts.js";
import { stopGroupSubscription } from "../groups.js";
import { syncAuthUi, syncComposer } from "../ui.js";
import { setupActionDelegation } from "./events.js";

/**
 * Uygulama başlatma: altyapıyı kurar, sonuçları store'a yazar ve canlı
 * abonelikleri bağlar. Eski `firebase.js` içindeki feature bağımlılıkları
 * buraya taşındı; altyapı katmanı artık hiçbir feature bilmiyor.
 */
export function startApp() {
	// Tek click dinleyicisi; feature'lar registerAction() ile handler ekler.
	setupActionDelegation();
	dispatch({ authResolved: false });

	try {
		// Yeniden başlatmalarda (HMR) eski dinleyiciler sızmasın.
		stopPostSubscription();
		stopGroupSubscription();

		const connections = initFirebase(firebaseConfig);
		dispatch(connections);

		subscribeToAuth();
		subscribeToPosts();
	} catch (error) {
		dispatch({
			app: null,
			auth: null,
			db: null,
			authUser: null,
			authResolved: true,
		});
		console.warn("Firebase bağlantı hatası: " + error.message);
	}

	syncAuthUi();
	syncComposer();
}
