import { defineConfig } from "vite";
import { resolve } from "path";
import { createHash } from "crypto";

const isGithubActions = process.env.GITHUB_ACTIONS === "true";

// Build sırasında HTML'e Content-Security-Policy ekler.
// Satır içi <script> blokları otomatik olarak hash ile izinlendirilir.
function cspPlugin() {
  return {
    name: "masa-csp",
    apply: "build",
    transformIndexHtml(html) {
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
        (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
      );

      const firebase = [
        "https://*.googleapis.com",
        "https://*.firebaseio.com",
        "wss://*.firebaseio.com",
        "https://*.firebasedatabase.app",
        "wss://*.firebasedatabase.app",
      ];

      const policy = [
        "default-src 'self'",
        `script-src 'self' https://www.gstatic.com https://www.google.com/recaptcha/ https://unpkg.com https://scripts.simpleanalyticscdn.com ${hashes.join(" ")}`.trim(),
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https://queue.simpleanalyticscdn.com",
        `connect-src 'self' ${firebase.join(" ")} https://www.google.com/recaptcha/ https://www.gstatic.com https://unpkg.com https://scripts.simpleanalyticscdn.com https://queue.simpleanalyticscdn.com`,
        "frame-src https://*.firebaseapp.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");

      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-prepend",
        },
        {
          tag: "meta",
          attrs: { name: "referrer", content: "strict-origin-when-cross-origin" },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  root: "src",
  base: isGithubActions ? "/masa/" : "",
  plugins: [cspPlugin()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    minify: "terser",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/index.html"),
        login: resolve(__dirname, "src/login.html"),
      },
    },
  },
});
