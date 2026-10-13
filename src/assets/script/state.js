export const storageKeys = {
  config: "masa.firebaseConfig",
  rememberMe: "masa.rememberMe",
};

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
};

export const feedColumnIds = {
  search: "$search",
  groups: "$groups",
  account: "$account",
  auth: "$auth",
  notifications: "$notifications",
};

const profileColumnPrefix = "$profile:";

export function profileColumnId(uid) {
  return `${profileColumnPrefix}${encodeURIComponent(uid)}`;
}

export function profileUidFromColumnId(columnId) {
  if (!columnId?.startsWith(profileColumnPrefix)) return null;
  try {
    return decodeURIComponent(columnId.slice(profileColumnPrefix.length));
  } catch {
    return null;
  }
}

export const state = {
  app: null,
  auth: null,
  db: null,
  authUser: null,
  authResolved: false,
  profile: {
    name: "User",
    color: "#2563eb",
  },
  authMode: "login",
  authStep: "form", // form | verify (e-posta doğrulaması bekleniyor)
  authEmail: "",
  authNotice: "", // giriş formunda gösterilecek kalıcı bilgi (ör. hesap devre dışı)
  pendingUser: null, // giriş yapmış ama e-postası doğrulanmamış kullanıcı
  posts: {},
  postsRef: null,
  groupPosts: {},
  openFeedColumns: [""],
  groupPostRefs: {},
  groupRequests: {},
  groupRequestRefs: {},
  myJoinRequests: {},
  notifications: {},
  myJoinRequestRefs: {},
  groups: {},
  groupsRef: null,
  users: {},
  activeGroupId: null,
};
