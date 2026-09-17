import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// Cloudflare Pages reads `_headers` from the build-output root. It is emitted as
// a build asset (not dropped into `static/`) so the cache policy lives next to
// the routes below and stays reviewable as code.
//
// The SPA entry (index.html) must NOT be disk-cached, or a normal reload can boot
// a stale shell (and the old hashed bundle it names) straight from cache while a
// hard reload — which bypasses the disk cache — pulls the current one. That is the
// "stale on reload, fresh on hard-reload" bug. `no-store` forces every navigation
// to re-fetch the tiny current index.html; content-hashed /assets/* stay immutable
// so only ~1 KB of HTML is refetched, not the app. Client-side navigation lives in
// the URL FRAGMENT (#/live) which never reaches the server, so "/" and "/index.html"
// still cover every HTML response without a "/*" catch-all that could shadow /assets/*.
function cloudflareHeaders(): Plugin {
  return {
    name: "emit-cf-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: [
          "/api/*",
          "  Cache-Control: no-store",
          "",
          "/assets/*",
          "  Cache-Control: public, max-age=31536000, immutable",
          "",
          "/index.html",
          "  Cache-Control: no-store",
          "",
          "/",
          "  Cache-Control: no-store",
          "",
          // The manifest is tiny and names the icons; never let a stale copy
          // pin an old icon set or start_url on an installed WebAPK.
          "/manifest.json",
          "  Cache-Control: no-store",
          "",
          // Icons are un-hashed by design (the manifest must point at stable
          // URLs) — a day of caching is plenty and keeps install re-fetches cheap.
          "/icons/*",
          "  Cache-Control: public, max-age=86400",
          "",
          "/apple-touch-icon.png",
          "  Cache-Control: public, max-age=86400",
          "",
        ].join("\n"),
      });
    },
  };
}

// Advanced-mode Pages workers otherwise default to every route. Keep the static
// redirect shell off the Functions quota entirely: only legacy API calls may
// invoke the proxy worker.
export const PAGES_ROUTES = {
  version: 1,
  include: ["/api/*", "/v1/*"],
  exclude: [],
} as const;

function cloudflareRoutes(): Plugin {
  return {
    name: "emit-cf-routes",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_routes.json",
        source: `${JSON.stringify(PAGES_ROUTES, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflareHeaders(), cloudflareRoutes()],
  root: "public",
  // PWA install files (manifest.json, icons/*, apple-touch-icon.png) must land
  // UN-HASHED at the dist root: Chrome identifies the app by manifest `id` and
  // re-fetches the manifest and icon URLs by name, and Caddy/Pages serve the dist
  // root by path. Vite hashes every <link href> it processes into /assets/, and
  // its default publicDir is resolved against `root` ("public/public" — which
  // does not exist), so point publicDir at a dedicated top-level `static/`
  // directory explicitly: Vite copies it verbatim to the dist root and leaves
  // index.html references into it untouched. vite.pages-worker.config.ts keeps
  // publicDir:false so the worker build never re-copies it.
  publicDir: path.resolve(projectRoot, "static"),
  resolve: { alias: { "/src": path.resolve(projectRoot, "src") } },
  build: {
    outDir: path.resolve(projectRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/lucide-react")) {
            return "icons";
          }

          if (id.includes("/src/data/countryMeta.ts")) {
            return "geo-data";
          }

          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
});
