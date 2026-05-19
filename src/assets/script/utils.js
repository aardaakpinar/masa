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
    "auth/operation-not-allowed": "Firebase Console'da Email/Password girişini açmalısın.",
    "auth/too-many-requests": "Çok fazla başarısız deneme. Lütfen daha sonra tekrar deneyin.",
  };

  return messages[code] || "İşlem tamamlanamadı. Firebase ayarlarını kontrol et.";
}
