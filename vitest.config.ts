import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
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
