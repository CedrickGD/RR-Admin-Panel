import { describe, expect, it } from "vitest";
import type { SuspensionRecord } from "../src/types/telemetry";
import {
  DEFAULT_RESTRICTION_FILTERS,
  filterRestrictions,
  isDefaultRestrictionFilters,
  remainingTime,
  restrictionState,
  summarizeRestrictions,
  toRestrictionEntries,
} from "../src/utils/restrictions";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

let nextId = 1;
function record(overrides: Partial<SuspensionRecord>): SuspensionRecord {
  const id = nextId++;
  return {
    id,
    identity: `device-${id}`,
    hwid: `device-${id}`,
    install_id: `install-${id}`,
    user_label: null,
    mode: "ban",
    reason: null,
    banned_until: null,
    is_active: 1,
    had_paid_license: 0,
    paid_license_keys: null,
    created_by: "owner@example.test",
    created_at: at(-10 * DAY),
    updated_at: at(-10 * DAY),
    lifted_at: null,
    lifted_by: null,
    ...overrides,
  };
}
const nobody = () => ({ name: null, discord: null });

describe("restriction state", () => {
  it("is active for a permanent ban and a suspension inside its window", () => {
    expect(restrictionState(record({ mode: "ban" }), NOW)).toBe("active");
    expect(restrictionState(record({ mode: "suspend", banned_until: at(DAY) }), NOW)).toBe(
      "active",
    );
  });

  it("is lifted once is_active is 0, and expired when the window ran out on its own", () => {
    expect(restrictionState(record({ is_active: 0, lifted_at: at(-DAY) }), NOW)).toBe("lifted");
    expect(restrictionState(record({ mode: "suspend", banned_until: at(-DAY) }), NOW)).toBe(
      "expired",
    );
    // Same rule as the server: an unreadable end date is not in force.
    expect(restrictionState(record({ mode: "suspend", banned_until: "not a date" }), NOW)).toBe(
      "expired",
    );
  });
});

describe("restriction entries", () => {
  const oldBan = record({ updated_at: at(-9 * DAY) });
  const newBan = record({ mode: "suspend", banned_until: at(5 * DAY), updated_at: at(-DAY) });
  const liftedLongAgo = record({
    is_active: 0,
    created_at: at(-60 * DAY),
    updated_at: at(-40 * DAY),
    lifted_at: at(-40 * DAY),
  });
  const liftedRecently = record({
    is_active: 0,
    created_at: at(-20 * DAY),
    updated_at: at(-2 * DAY),
    lifted_at: at(-2 * DAY),
    lifted_by: "support@example.test",
  });
  const ranOut = record({ mode: "suspend", banned_until: at(-5 * DAY), updated_at: at(-12 * DAY) });
  const entries = toRestrictionEntries(
    [liftedLongAgo, oldBan, ranOut, liftedRecently, newBan],
    nobody,
    NOW,
  );

  it("sorts active first by newest issued, then the rest by most recently ended", () => {
    expect(entries.map((entry) => entry.record.id)).toEqual([
      newBan.id,
      oldBan.id,
      liftedRecently.id,
      ranOut.id,
      liftedLongAgo.id,
    ]);
  });

  it("dates an active row by its last write and a lifted row by its first issue", () => {
    const [active, , lifted, expired] = entries;
    expect(active.issuedAt).toBe(newBan.updated_at);
    expect(active.endedAt).toBeNull();
    expect(lifted.issuedAt).toBe(liftedRecently.created_at);
    expect(lifted.endedAt).toBe(liftedRecently.lifted_at);
    expect(expired.endedAt).toBe(ranOut.banned_until);
  });

  it("filters by view and type", () => {
    const view = (v: "active" | "lifted" | "all") =>
      filterRestrictions(entries, { ...DEFAULT_RESTRICTION_FILTERS, view: v }).map(
        (entry) => entry.state,
      );
    expect(view("active")).toEqual(["active", "active"]);
    expect(view("lifted")).toEqual(["lifted", "expired", "lifted"]);
    expect(view("all")).toHaveLength(5);
    expect(
      filterRestrictions(entries, { view: "all", type: "suspend", query: "" }).map(
        (entry) => entry.record.id,
      ),
    ).toEqual([newBan.id, ranOut.id]);
  });

  it("summarizes what is in force and what was lifted in the last 30 days", () => {
    expect(summarizeRestrictions(entries, NOW)).toEqual({
      permanent: 1,
      temporary: 1,
      nextEnd: newBan.banned_until,
      liftedRecently: 1,
    });
  });
});

describe("restriction search", () => {
  const row = record({
    user_label: "Label On Record",
    reason: "Chargeback on order #48120",
    created_by: "issuer@example.test",
    hwid: "HWID-ABC-123",
  });
  const [entry] = toRestrictionEntries(
    [row],
    () => ({ name: "Mara Feldt", discord: "@mara" }),
    NOW,
  );
  const find = (query: string) =>
    filterRestrictions([entry], { ...DEFAULT_RESTRICTION_FILTERS, query }).length;

  it("prefers the resolved name and stores Discord without its @", () => {
    expect(entry.name).toBe("Mara Feldt");
    expect(entry.discord).toBe("mara");
  });

  it.each([
    ["mara feldt"],
    ["@mara"],
    ["label on record"],
    ["hwid-abc"],
    ["chargeback"],
    ["issuer@"],
  ])("matches %s", (query) => {
    expect(find(query)).toBe(1);
  });

  it("finds nothing for an unrelated term", () => {
    expect(find("zz-no-such-customer")).toBe(0);
  });

  it("falls back to the record's label, then to no name at all", () => {
    const [labelled] = toRestrictionEntries([record({ user_label: " Ilse " })], nobody, NOW);
    const [unnamed] = toRestrictionEntries([record({})], nobody, NOW);
    expect(labelled.name).toBe("Ilse");
    expect(unnamed.name).toBeNull();
  });

  it("knows when the toolbar is back at its defaults", () => {
    expect(isDefaultRestrictionFilters(DEFAULT_RESTRICTION_FILTERS)).toBe(true);
    expect(isDefaultRestrictionFilters({ ...DEFAULT_RESTRICTION_FILTERS, query: "  " })).toBe(true);
    expect(isDefaultRestrictionFilters({ ...DEFAULT_RESTRICTION_FILTERS, view: "all" })).toBe(
      false,
    );
    expect(isDefaultRestrictionFilters({ ...DEFAULT_RESTRICTION_FILTERS, type: "ban" })).toBe(
      false,
    );
  });
});

describe("remaining time", () => {
  it("counts down in days, then hours", () => {
    expect(remainingTime(at(17.6 * DAY), NOW)).toBe("17 days left");
    expect(remainingTime(at(30 * 3_600_000), NOW)).toBe("30 hours left");
    expect(remainingTime(at(3_600_000), NOW)).toBe("1 hour left");
    expect(remainingTime(at(60_000), NOW)).toBe("less than an hour left");
    expect(remainingTime(at(-60_000), NOW)).toBe("ended");
  });
});
