import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
