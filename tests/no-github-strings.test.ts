import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Private-flip checklist (docs/release-management-design.md §13): "no `api.github.com` or
 * `raw.githubusercontent.com` string remains in `src/`". `useLatestVersion` and
 * `useReleaseVersions` used to call those hosts directly; they now read
 * `GET /api/admin/releases/versions` through the panel's own API (design §10), and this is the
 * last place a GitHub host name could still leak into the browser bundle.
 */

const FORBIDDEN = ["api.github.com", "raw.githubusercontent.com"];

const root = fileURLToPath(new URL("../src/", import.meta.url));

function sources(dir: string = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sources(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

describe("the browser never talks to GitHub directly", () => {
  const files = sources();

  it("scans a non-trivial number of source files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no api.github.com or raw.githubusercontent.com string under src/", () => {
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return FORBIDDEN.filter((needle) => text.includes(needle)).map(
        (needle) => `${file}: ${needle}`,
      );
    });
    expect(offenders).toEqual([]);
  });
});
