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
    emptyOutDir: true
  },
  server: {
    fs: {
      allow: [projectRoot]
    }
  }
});
