import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Component/hook tests (.test.tsx) need a DOM; every other test stays on node.
    environmentMatchGlobs: [["tests/**/*.test.tsx", "jsdom"]],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        "functions/_lib/validation.ts": { branches: 100 },
        "functions/_lib/redaction.ts": { branches: 100 },
        "functions/_lib/responses.ts": { branches: 100 },
      },
    },
  },
});
