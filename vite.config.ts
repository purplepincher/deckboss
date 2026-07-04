import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves a project repo (no custom domain) at
// https://<org>.github.io/deckboss/ — every asset URL needs that prefix or
// it 404s. HashRouter (see App.tsx) only fixes client-side route paths, not
// this. Once a custom domain is wired up, unset BASE_PATH (or set "/") and
// asset URLs go back to root.
const base = process.env.BASE_PATH ?? "/";

// The root page is now a static landing page; only the /app/ shell should be
// used as the SPA navigation fallback. Exclude the root path (with the
// current base prefix) so that visitors to `/` (or `/deckboss/`) see the
// landing page instead of being pulled into the app shell by the service
// worker. This also keeps an old, previously-precached root app-shell
// index.html from hijacking the new root URL: the fallback never serves the
// root index.html, and Workbox's precache will replace the old entry with the
// new landing-page revision on activation.
const rootPath = base.replace(/\/$/, "");
const rootLandingDeny = new RegExp(
  `^${rootPath.replace(/\//g, "\\/")}\/$`
);

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // A Lighthouse audit found registerSW.js costing ~1s of main-thread
      // blocking time on throttled mobile CPU — competing directly with
      // the record button becoming tappable in the first second, which is
      // the one interaction this app can't afford to feel broken. `defer`
      // lets HTML parsing and the app's own script finish first.
      injectRegister: "script-defer",
      includeAssets: ["icons/icon-192x192.png", "icons/icon-512x512.png"],
      manifest: {
        name: "DeckBoss",
        short_name: "DeckBoss",
        description: "Your boat's memory. Your data. Your shell.",
        theme_color: "#0a1628",
        background_color: "#0a1628",
        display: "standalone",
        orientation: "portrait",
        start_url: "./app/",
        scope: "./app/",
        icons: [
          { src: "icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Audio blobs and Markdown entries live in IndexedDB, not the
        // network cache — the service worker only needs to shell the app.
        globPatterns: ["**/*.{js,css,html,svg,png,ico}"],
        navigateFallback: "app/index.html",
        navigateFallbackDenylist: [/^\/api/, rootLandingDeny],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        app: "app/index.html",
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
