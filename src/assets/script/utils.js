export function cleanName(name) {
  const normalized = (name || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 50) || "User";
}

export function initials(name) {
  return cleanName(name)
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function getContrastColor(hexColor) {
  const hex = (hexColor || "#2563eb").replace("#", "").trim();
  const normalized =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "#ffffff";

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);

  // Relative luminance (WCAG yaklaşık formülü)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  return luminance > 0.55 ? "#0f1419" : "#ffffff";
}

export function formatTime(timestamp) {
  if (!timestamp) return "şimdi";

  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function sanitizeEmail(email) {
  return email.trim().toLowerCase();
}

export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

export function authMessage(code) {
  const messages = {
    "auth/email-already-in-use": "Bu e-posta zaten kayıtlı.",
    "auth/invalid-email": "E-posta adresi geçerli değil.",
    "auth/invalid-credential": "E-posta veya şifre hatalı.",
    "auth/weak-password": "Şifre daha güçlü olmalı.",
    "auth/network-request-failed": "Ağ bağlantısı kurulamadı.",
    "auth/operation-not-allowed":
      "Firebase Console'da Email/Password girişini açmalısın.",
    "auth/too-many-requests":
      "Çok fazla başarısız deneme. Lütfen daha sonra tekrar deneyin.",
  };

  return (
    messages[code] || "İşlem tamamlanamadı. Firebase ayarlarını kontrol et."
  );
}

const TOKEN_REGEX = /(https?:\/\/[^\s]+|#[\p{L}\p{N}_]+)/gu;

export function createRichTextFragment(text) {
  const fragment = document.createDocumentFragment();
  const value = String(text || "");
  let lastIndex = 0;

  for (const match of value.matchAll(TOKEN_REGEX)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      fragment.append(value.slice(lastIndex, index));
    }

    if (token.startsWith("http://") || token.startsWith("https://")) {
      const link = document.createElement("a");
      link.href = token;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = token;
      fragment.append(link);
    } else if (token.startsWith("#")) {
      const hashtag = document.createElement("button");
      hashtag.type = "button";
      hashtag.className = "inline-hashtag";
      hashtag.textContent = token;
      hashtag.addEventListener("click", () => {
        window.dispatchEvent(
          new CustomEvent("search:query", { detail: { query: token } }),
        );
      });
      fragment.append(hashtag);
    }

    lastIndex = index + token.length;
  }

  if (lastIndex < value.length) {
    fragment.append(value.slice(lastIndex));
  }

  return fragment;
}
