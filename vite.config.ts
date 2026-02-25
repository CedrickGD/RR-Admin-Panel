import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
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
