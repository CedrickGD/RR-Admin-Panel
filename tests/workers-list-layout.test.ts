import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workersPage = readFileSync(
  fileURLToPath(new URL("../src/pages/WorkersPage.tsx", import.meta.url)),
  "utf8",
);

describe("Workers list layout", () => {
  it.each(["All Users", "Recent Sessions"])("keeps %s permanently open", (title) => {
    expect(workersPage).toMatch(new RegExp(`title="${title}"\\s+collapsible=\\{false\\}`));
  });

  it("keeps row-level user and session expansion controls", () => {
    expect(workersPage).toContain("toggleUserExpanded(user.identity)");
    expect(workersPage).toContain("toggleSessionExpanded(session.id)");
    expect(workersPage.match(/aria-label=\{isExpanded \? "Collapse" : "Expand"\}/g)).toHaveLength(
      2,
    );
  });

  it("opens Customer 360 without replacing the existing session expansion", () => {
    expect(workersPage).toContain("<Customer360Overlay");
    expect(workersPage).toContain("setCustomer360Session(session)");
    expect(workersPage).toContain("Open Customer 360 for ${displaySessionUser(session)}");
    expect(workersPage).toContain("toggleSessionExpanded(session.id)");
  });
});
