import { state, storageKeys, firebaseConfig } from "./state.js";
import {
	cleanName,
	sanitizeEmail,
	isValidEmail,
	authMessage,
	validatePassword,
} from "./utils.js";
import {
	createUserWithEmailAndPassword,
	signInWithEmailAndPassword,
	updateProfile,
	onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
	set,
	ref,
	serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { connectToFirebase } from "./firebase.js";
import { saveRememberMe, getRememberedEmail } from "./auth.js";

// Initialize Firebase
// Yapılandırma yalnızca build sırasındaki ortam değişkenlerinden gelir.
connectToFirebase(JSON.stringify(firebaseConfig, null, 2));

// Wait a bit for Firebase to initialize and check auth state
setTimeout(() => {
	if (state.auth) {
		onAuthStateChanged(state.auth, (user) => {
			if (user) {
				window.location.href = "./";
			}
		});
	}
}, 500);

// Elements
const loginModeButton = document.querySelector("#loginModeButton");
const registerModeButton = document.querySelector("#registerModeButton");
const authNameField =
	document.querySelector("#authNameField") ||
	document.querySelector("[id='authNameField']");
const authName = document.querySelector("#authName");
const authEmail = document.querySelector("#authEmail");
const authPassword = document.querySelector("#authPassword");
const rememberMe = document.querySelector("#rememberMe");
const submitAuth = document.querySelector("#submitAuth");
const authError = document.querySelector("#authError");
const passwordHint = document.querySelector("#passwordHint");
const authForm = document.querySelector("#authForm");
const authTitle =
	document.querySelector("#authTitle") || document.querySelector("h2");

function bind(element, eventName, handler) {
	element?.addEventListener(eventName, handler);
}

let currentAuthMode = "login";

// Set remember me checkbox if email was remembered
const rememberedEmail = getRememberedEmail();
if (rememberedEmail && authEmail) {
	authEmail.value = rememberedEmail;
	if (rememberMe) rememberMe.checked = true;
}

// Event listeners
bind(loginModeButton, "click", () => setAuthMode("login"));
bind(registerModeButton, "click", () => setAuthMode("register"));
bind(authForm, "submit", (e) => {
	e.preventDefault();
	submitAuth?.click();
});
bind(authPassword, "keydown", (event) => {
	if (event.key === "Enter") submitAuth?.click();
});
bind(authEmail, "keydown", (event) => {
	if (event.key === "Enter") submitAuth?.click();
});
bind(submitAuth, "click", submitLoginAuth);

function setAuthMode(mode) {
	currentAuthMode = mode;
	const isRegister = mode === "register";

	if (authNameField) {
		authNameField.style.display = isRegister ? "grid" : "none";
	}

	if (authTitle) {
		authTitle.textContent = isRegister ? "Kayıt ol" : "Giriş yap";
	}
	submitAuth.textContent = isRegister ? "Kayıt ol" : "Giriş yap";

	if (authPassword)
		authPassword.autocomplete = isRegister
			? "new-password"
			: "current-password";

	loginModeButton?.classList.toggle("active", !isRegister);
	registerModeButton?.classList.toggle("active", isRegister);
	if (passwordHint) passwordHint.hidden = !isRegister;
	if (authError) authError.textContent = "";
}

async function submitLoginAuth() {
	if (
		!state.auth ||
		!authEmail ||
		!authPassword ||
		!submitAuth ||
		!authError
	) {
		return;
	}

	const email = sanitizeEmail(authEmail.value.trim());
	const password = authPassword.value;
	const name = cleanName(
		(authName?.value || "").trim() || email.split("@")[0] || "User",
	);
	const shouldRemember = Boolean(rememberMe?.checked);

	if (!email || !isValidEmail(email)) {
		authError.textContent = "Geçerli bir e-posta adresi gir.";
		return;
	}

	const passwordProblem = validatePassword(password, {
		strict: currentAuthMode === "register",
	});
	if (passwordProblem) {
		authError.textContent = passwordProblem;
		return;
	}

	submitAuth.disabled = true;

	try {
		if (currentAuthMode === "register") {
			if (!(authName?.value || "").trim()) {
				throw new Error("Kayıt yaparken görünen ad gereklidir.");
			}
			const credential = await createUserWithEmailAndPassword(
				state.auth,
				email,
				password,
			);
			await updateProfile(credential.user, { displayName: name });
			await set(ref(state.db, `users/${credential.user.uid}`), {
				name,
				color: "#2563eb",
				createdAt: serverTimestamp(),
				isDisabled: false,
			});
			saveRememberMe(email, shouldRemember);
			window.location.href = "./";
		} else {
			await signInWithEmailAndPassword(state.auth, email, password);
			saveRememberMe(email, shouldRemember);
			window.location.href = "./";
		}
	} catch (error) {
		authError.textContent = authMessage(error.code);
	} finally {
		submitAuth.disabled = false;
	}
}

const passwordInput = document.getElementById("authPassword");
const togglePassword = document.getElementById("togglePassword");

togglePassword.addEventListener("click", () => {
	const isHidden = passwordInput.type === "password";

	passwordInput.type = isHidden ? "text" : "password";

	togglePassword.innerHTML = isHidden
		? '<i data-lucide="eye-off"></i>'
		: '<i data-lucide="eye"></i>';

	togglePassword.setAttribute(
		"aria-label",
		isHidden ? "Şifreyi gizle" : "Şifreyi göster",
	);

	lucide.createIcons();
});

// Initial setup
setAuthMode("login");
