import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// GitHub Pages serves a project repo (no custom domain) at
// https://<org>.github.io/deckboss/ — every asset URL needs that prefix or
// it 404s. HashRouter (see App.tsx) only fixes client-side route paths, not
// this. Once a custom domain is wired up, unset BASE_PATH (or set "/") and
// asset URLs go back to root.
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192x192.png", "icons/icon-512x512.png"],
      manifest: {
        name: "DeckBoss",
        short_name: "DeckBoss",
        description: "Your boat's memory. Your data. Your shell.",
        theme_color: "#0a1628",
        background_color: "#0a1628",
        display: "standalone",
        orientation: "portrait",
        start_url: ".",
        scope: ".",
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
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
});
