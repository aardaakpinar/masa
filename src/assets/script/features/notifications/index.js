/**
 * notifications feature'ının genel API'si. Diğer modüller yalnızca bu dosyayı import eder;
 * feature içi dosyalar (view/actions/subscription/internal) dışarı açılmaz.
 */
export { getNotificationList, getUnreadCount, likeNotificationKey } from "./internal.js";
export { startNotifications, stopNotifications } from "./subscription.js";
export { notify, markRead, markAllRead, clearAll } from "./actions.js";
export { renderNotifications, openNotifications, setupNotifications } from "./view.js";
