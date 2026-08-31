import { describe, expect, it } from "vitest";

import { isOverviewErrorInWindow } from "../src/utils/overviewErrors";

const CUTOFF = Date.parse("2026-08-31T12:00:00.000Z");

describe("Overview error feed", () => {
  it("keeps recent real errors", () => {
    expect(
      isOverviewErrorInWindow(
        {
          timestamp: "2026-08-31T12:00:00.000Z",
          metrics: { error_kind: "unhandled" },
        },
        CUTOFF,
      ),
    ).toBe(true);
  });

  it("hides background errors and events before the window", () => {
    expect(
      isOverviewErrorInWindow(
        {
          timestamp: "2026-08-31T13:00:00.000Z",
          metrics: { error_kind: "background" },
        },
        CUTOFF,
      ),
    ).toBe(false);
    expect(
      isOverviewErrorInWindow(
        {
          timestamp: "2026-08-31T11:59:59.999Z",
          metrics: {},
        },
        CUTOFF,
      ),
    ).toBe(false);
  });
});
