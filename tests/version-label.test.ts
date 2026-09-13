import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LEGACY_VERSION_LABEL,
  isLegacyVersion,
  versionLabel,
} from "../src/utils/versionLabel";

describe("versionLabel", () => {
  it("spells out the legacy bucket the same way everywhere", () => {
    expect(versionLabel("legacy")).toBe("Legacy (pre-1.4)");
    expect(versionLabel(" Legacy ")).toBe(LEGACY_VERSION_LABEL);
    expect(isLegacyVersion("LEGACY")).toBe(true);
    expect(isLegacyVersion("1.4.0")).toBe(false);
  });

  it("passes real versions through, trimmed", () => {
    expect(versionLabel("1.4.7")).toBe("1.4.7");
    expect(versionLabel(" 1.5.0 ")).toBe("1.5.0");
  });

  it("uses the fallback when there is no version", () => {
    expect(versionLabel(null)).toBe("—");
    expect(versionLabel(undefined)).toBe("—");
    expect(versionLabel("   ")).toBe("—");
    expect(versionLabel(null, "Unknown")).toBe("Unknown");
  });

  it("is the only place the legacy label is written out", () => {
    // The five hand-rolled copies (Customers, Errors, Overview, Versions,
    // InstallsPanel) and the heatmap's raw token all route through the helper.
    for (const file of [
      "../src/pages/CustomersPage.tsx",
      "../src/pages/ErrorsPage.tsx",
      "../src/pages/OverviewPage.tsx",
      "../src/pages/VersionsPage.tsx",
      "../src/pages/HeatmapPage.tsx",
      "../src/components/InstallsPanel.tsx",
    ]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
      expect(source, file).not.toContain("pre-1.4");
      expect(source, file).not.toMatch(/===\s*"legacy"/);
    }
  });
});
