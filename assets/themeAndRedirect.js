const userTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.setAttribute("data-theme", userTheme);
document.getElementById("welcomeTime").innerText = new Date(Date.now()).toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
function redirectToEditor(redirect) {
    if (redirect.startsWith("dm/")) {
        redirect = "@" + redirect.substring(3);
    }
    window.location.href = `?replyTo=${redirect}`;
}
function profileUidLoad(username) {
    window.location.href = `?u=${username}`;
}
