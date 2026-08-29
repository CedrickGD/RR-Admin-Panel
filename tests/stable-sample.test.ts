import { describe, expect, it } from "vitest";
import { stableSampleByKey } from "../src/utils/stableSample";

describe("stableSampleByKey", () => {
  const points = Array.from({ length: 1_000 }, (_, index) => ({ key: `user-${index}`, index }));

  it("caps expensive decorative work", () => {
    expect(stableSampleByKey(points, 400)).toHaveLength(400);
  });

  it("keeps the same sample when input order changes", () => {
    const forward = stableSampleByKey(points, 100)
      .map((point) => point.key)
      .sort();
    const reversed = stableSampleByKey([...points].reverse(), 100)
      .map((point) => point.key)
      .sort();

    expect(reversed).toEqual(forward);
  });

  it("preserves every item below the cap", () => {
    expect(stableSampleByKey(points.slice(0, 3), 400)).toEqual(points.slice(0, 3));
  });
});
