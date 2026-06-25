export const storageKeys = {
  config: "masa.firebaseConfig",
  rememberMe: "masa.rememberMe",
};

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
};

export const state = {
  app: null,
  auth: null,
  db: null,
  authUser: null,
  profile: {
    name: "User",
    color: "#2563eb",
  },
  authMode: "login",
  posts: {},
  postsRef: null,
  groups: {},
  groupsRef: null,
  activeGroupId: null,
};
