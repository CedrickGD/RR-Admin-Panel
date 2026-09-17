import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `KNOWN_COUNTER_SERVICES` is declared twice — once for the Pages Functions, once for the
 * standalone worker — because the two builds share no module. A name known to one side only is
 * silently counted as "other" by the other, which is the kind of drift nobody notices until a
 * chart is wrong, so the two lists are compared here rather than trusted to stay in step.
 */
function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function knownCounterServices(code: string): string[] {
  const block = /const KNOWN_COUNTER_SERVICES = new Set\(\[([\s\S]*?)\]\);/.exec(code)?.[1];
  expect(block, "KNOWN_COUNTER_SERVICES literal").toBeDefined();
  // Comments go first: the prose beside these entries quotes event names too.
  const entries = block!.replace(/\/\/.*$/gm, "");
  return [...entries.matchAll(/"([^"]+)"|^\s*([A-Z_]+),/gm)].map((match) => match[1] ?? match[2]);
}

const PAGES = knownCounterServices(source("../functions/_lib/storage.ts"));
const WORKER = knownCounterServices(source("../backend-worker/index.js"));

describe("KNOWN_COUNTER_SERVICES", () => {
  it("counts the updater's own funnel, which the client now emits", () => {
    for (const service of ["update_download", "update_install", "update_applied"]) {
      expect(PAGES, `functions/_lib/storage.ts: ${service}`).toContain(service);
      expect(WORKER, `backend-worker/index.js: ${service}`).toContain(service);
    }
  });

  it("is the same set, in the same order, on both sides", () => {
    expect(PAGES.length).toBeGreaterThan(3);
    expect(WORKER).toEqual(PAGES);
  });
});
