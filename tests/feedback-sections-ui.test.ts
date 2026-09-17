import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const page = source("../src/pages/FeedbackPage.tsx");
const pageMeta = source("../src/pageMeta.ts");
const navbar = source("../src/components/Navbar.tsx");
const app = source("../src/App.tsx");
const overlay = source("../src/components/Customer360Overlay.tsx");
const replies = source("../src/components/FeedbackReplies.tsx");
const glue = source("../src/theme/app-glue.css");

describe("Feedback & support page", () => {
  it("keeps its key and names both inboxes in the rail", () => {
    expect(pageMeta).toMatch(
      /feedback:\s*\{\s*group:\s*"Communication",\s*label:\s*"Feedback & support"\s*\}/,
    );
    expect(page).toContain('page="feedback"');
  });

  it("uses ds/Tabs for the two sections and the SegmentedControl for the status filter", () => {
    expect(page).toContain('aria-label="Feedback sections"');
    expect(page).toContain('const SECTIONS: FeedbackSection[] = ["feedback", "support"]');
    expect(page).toContain('aria-label="Filter by status"');
    expect(page).toContain("<PageToolbar");
    // Same address contract as Customers' Directory | Restrictions.
    expect(page).toContain('const SECTION_PARAM = "section"');
    expect(page).toContain("window.history.replaceState(window.history.state");
    expect(page).toContain('window.addEventListener("popstate", follow)');
  });

  it("shows the unread total on the rail item from the dashboard summary", () => {
    expect(app).toContain("counts={{ feedback: summary?.feedbackUnread?.total }}");
    expect(navbar).toContain('className="sb-count"');
    expect(glue).toContain(".sb-item .sb-count {");
    // Tokens only: no colour literal in the new rule.
    const rule = glue.slice(
      glue.indexOf(".sb-item .sb-count {"),
      glue.indexOf(".sb-item.active .sb-count {"),
    );
    expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  it("labels the kind with the existing Badge tones in the replies dialog and Customer 360", () => {
    expect(replies).toMatch(/support:\s*\{\s*label:\s*"Support",\s*tone:\s*"info"\s*\}/);
    expect(replies).toMatch(/feedback:\s*\{\s*label:\s*"Feedback",\s*tone:\s*"muted"\s*\}/);
    expect(overlay).toContain("FEEDBACK_KIND_BADGE[item.kind].tone");
    expect(overlay).toContain(
      'item.kind === "support" ? "Support report received" : "Feedback received"',
    );
  });
});
