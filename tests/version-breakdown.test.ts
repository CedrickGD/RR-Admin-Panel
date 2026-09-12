import { describe, expect, it } from "vitest";

import { topVersionsByUsers } from "../src/utils/versionBreakdown";

describe("Overview active-customers drill-down: version breakdown", () => {
  it("shares add up to 100% across only the rows shown", () => {
    const rows = topVersionsByUsers(
      [
        { version: "1.4.2", users: 120, activeUsers: 40 },
        { version: "1.4.1", users: 30, activeUsers: 5 },
        { version: "legacy", users: 50, activeUsers: 1 },
      ],
      5,
    );

    const totalShare = rows.reduce((acc, row) => acc + row.share, 0);
    expect(totalShare).toBeCloseTo(1, 10);
  });

  it("does not scale shares against a lifetime total bigger than the shown rows", () => {
    // Regression for WP 2.10: previously shares were computed against
    // `lifetimeUsers` while the breakdown only showed the top versions, so a
    // customer base with a large historical churn (many more lifetime users
    // than are represented by current versions) understated every share.
    const rows = topVersionsByUsers(
      [
        { version: "1.4.2", users: 10, activeUsers: 10 },
        { version: "legacy", users: 10, activeUsers: 0 },
      ],
      5,
    );

    for (const row of rows) {
      expect(row.share).toBeCloseTo(0.5, 10);
    }
  });

  it("keeps only the top N versions by user count, sorted descending", () => {
    const rows = topVersionsByUsers(
      [
        { version: "1.0.0", users: 5, activeUsers: 0 },
        { version: "1.4.2", users: 100, activeUsers: 90 },
        { version: "1.3.0", users: 20, activeUsers: 2 },
        { version: "1.2.0", users: 15, activeUsers: 1 },
        { version: "1.1.0", users: 10, activeUsers: 0 },
        { version: "legacy", users: 50, activeUsers: 0 },
      ],
      3,
    );

    expect(rows.map((row) => row.version)).toEqual(["1.4.2", "legacy", "1.3.0"]);
  });

  it("never divides by zero when every shown row has zero users", () => {
    const rows = topVersionsByUsers([{ version: "1.4.2", users: 0, activeUsers: 0 }], 5);
    expect(rows[0].share).toBe(0);
  });
});
