import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

// Cloudflare Pages reads `_headers` from the build-output root. It cannot be a
// static passthrough file here: `root` is "public", so Vite's publicDir resolves
// to the non-existent "public/public" and never copies anything. Emit it as a
// build asset instead.
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
        ].join("\n"),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflareHeaders()],
  root: "public",
  build: {
    outDir: path.resolve(projectRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/recharts")) {
            return "charts";
          }

          if (id.includes("node_modules/maplibre-gl")) {
            return "map";
          }

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
      allow: [projectRoot]
    }
  }
});
