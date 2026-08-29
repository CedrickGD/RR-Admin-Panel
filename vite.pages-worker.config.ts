import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    outDir: path.resolve(projectRoot, "dist"),
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: path.resolve(projectRoot, "deploy/pages/worker.ts"),
      formats: ["es"],
      fileName: () => "_worker.js",
    },
  },
});
