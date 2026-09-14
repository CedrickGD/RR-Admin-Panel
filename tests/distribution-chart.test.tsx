import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildDistribution, DistributionChart } from "../src/components/charts/DistributionChart";

function render(props: Partial<Parameters<typeof DistributionChart>[0]> = {}) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    <DistributionChart
      title="Test distribution"
      data={[
        { label: "A", value: 3 },
        { label: "B", value: 1 },
      ]}
      {...props}
    />,
  );
  return host;
}

describe("shared distribution charts", () => {
  it("merges duplicate identities, retains the denominator, and does not mutate input", () => {
    const input = [
      { label: " A ", value: 2 },
      { label: "A", value: 3 },
      { label: "B", value: 1 },
    ];
    const result = buildDistribution(input);
    expect(result.total).toBe(6);
    expect(result.items.map(({ label, value }) => [label, value])).toEqual([
      ["A", 5],
      ["B", 1],
    ]);
    expect(input[0]).toEqual({ label: " A ", value: 2 });
  });
  it("groups the positive tail without dropping its counts or zero categories", () => {
    const result = buildDistribution(
      [
        { label: "A", value: 8 },
        { label: "B", value: 4 },
        { label: "C", value: 2 },
        { label: "Unknown", value: 0 },
      ],
      2,
    );
    expect(result.total).toBe(14);
    expect(result.items.map(({ value }) => value)).toEqual([8, 6, 0]);
    expect(result.items[1].label).toBe("Other (2 categories)");
    expect(result.items[2].label).toBe("Unknown");
  });
  it("does not collide with a supplied Other label", () => {
    const result = buildDistribution(
      [
        { label: "Other (2 categories)", value: 10 },
        { label: "B", value: 2 },
        { label: "C", value: 1 },
      ],
      2,
    );
    expect(new Set(result.items.map((item) => item.label)).size).toBe(2);
    expect(result.total).toBe(13);
  });
  it.each([NaN, Infinity, -1])(
    "treats an invalid count %s as unavailable, never a measured zero",
    (value) => {
      const host = render({ data: [{ label: "Broken", value }] });
      expect(host.textContent).toContain("Chart data unavailable");
      expect(host.querySelector(".distribution-total")).toBeNull();
    },
  );
  it("makes overflow and invalid item limits safe", () => {
    expect(
      buildDistribution([
        { label: "A", value: Number.MAX_VALUE },
        { label: "B", value: Number.MAX_VALUE },
      ]).valid,
    ).toBe(false);
    expect(buildDistribution([{ label: "A", value: 1 }], NaN).total).toBe(1);
  });
  it("renders precise accessible counts and denominator-based percentages", () => {
    const host = render();
    expect(host.querySelector("ul")?.getAttribute("aria-label")).toBe(
      "Test distribution breakdown",
    );
    expect(
      [...host.querySelectorAll(".distribution-count small")].map((item) => item.textContent),
    ).toEqual(["75%", "25%"]);
    expect(
      [...host.querySelectorAll<HTMLElement>(".distribution-bar")].map((bar) => bar.style.width),
    ).toEqual(["100%", "33.33333333333333%"]);
    expect(host.querySelector("button")).toBeNull();
  });
  it("draws only positive donut segments and keeps zero labels accessible", () => {
    const host = render({
      variant: "donut",
      data: [
        { label: "A", value: 3 },
        { label: "B", value: 1 },
        { label: "Unknown", value: 0 },
      ],
    });
    expect(host.querySelectorAll(".distribution-ring-segment")).toHaveLength(2);
    expect(host.querySelectorAll(".distribution-row")).toHaveLength(3);
    expect(host.querySelector(".distribution-ring-segment")?.getAttribute("stroke-dasharray")).toBe(
      "75 25",
    );
    expect(host.querySelector("svg")?.getAttribute("role")).toBe("img");
  });
  it("shows a neutral real zero rather than a full success ring", () => {
    const host = render({ variant: "donut", data: [{ label: "Active", value: 0 }] });
    expect(host.textContent).toContain("No records in this selection");
    expect(host.querySelectorAll(".distribution-ring-segment")).toHaveLength(0);
    expect(host.querySelectorAll(".distribution-count small")).toHaveLength(0);
    expect(host.querySelector(".distribution-total strong")?.textContent).toBe("0");
  });
  it("respects unavailable even when stale data was supplied", () => {
    const host = render({ unavailable: true, variant: "donut" });
    expect(host.textContent).toContain("Chart data unavailable");
    expect(host.querySelector("svg")).toBeNull();
    expect(host.querySelector(".distribution-total")).toBeNull();
  });
  it("keeps category colors stable when ranks change", () => {
    const first = buildDistribution([
      { label: "Windows", value: 10 },
      { label: "Linux", value: 2 },
    ]);
    const next = buildDistribution([
      { label: "Windows", value: 1 },
      { label: "Linux", value: 20 },
    ]);
    expect(first.items.find((item) => item.label === "Windows")?.color).toBe(
      next.items.find((item) => item.label === "Windows")?.color,
    );
  });
  it("does not round tiny nonzero shares into a reported zero", () => {
    expect(
      render({
        data: [
          { label: "A", value: 10000 },
          { label: "B", value: 1 },
        ],
      }).textContent,
    ).toContain("<0.1%");
  });
});
