/** auth feature'ının Firebase canlı abonelikleri. Veriyi repository'den alır, store'a yazar. */
import { state } from "../../state.js";
import { renderPosts } from "../../posts.js";
import { renderGroups, stopGroupSubscription } from "../../groups.js";
import { stopUsersSubscription } from "../../users.js";
import { stopNotifications } from "../../notifications.js";
import { syncAuthUi, syncAuthMode } from "../../ui.js";
import { watchAuth } from "../../services/repositories/auth.js";
import { activateUser, enterVerifyStep } from "./actions.js";

export function subscribeToAuth() {
	watchAuth(async (user) => {
		state.authResolved = true;
		if (user && !user.emailVerified) {
			enterVerifyStep(user);
		} else if (user) {
			await activateUser(user);
		} else {
			stopUsersSubscription();
			stopGroupSubscription();
			stopNotifications();
			state.groups = {};
			state.authUser = null;
			state.pendingUser = null;
			state.authStep = "form";
			state.profile = {
				name: "User",
				color: "#2563eb",
			};
			syncAuthMode();
		}
		syncAuthUi();
		renderPosts();
		renderGroups();
	});
}
