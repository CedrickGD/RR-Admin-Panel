import { describe, expect, it } from "vitest";
import { describeAuditEntry } from "../src/utils/auditEntry";

// Locale-free day format, so the expectations do not depend on the machine running the tests.
const day = (iso: string) => iso.slice(0, 10);
const row = (action: string, detail: unknown, target = "device-3") => ({
  action,
  target,
  actor: "owner@example.test",
  detail: typeof detail === "string" ? detail : JSON.stringify(detail),
});

describe("customer access entries read as sentences", () => {
  it("names a permanent ban and a timed suspension, with the customer and the reason", () => {
    const ban = describeAuditEntry(
      row("customer-suspend", {
        customer: "Mara Feldt",
        type: "permanent",
        until: null,
        reason: "Chargeback",
      }),
      day,
    );
    expect(ban).toEqual({
      kind: "customer-restrict",
      title: "Customer banned",
      subject: "Mara Feldt (device-3)",
      lines: ["Permanent ban", "Reason: Chargeback"],
      raw: null,
    });

    const suspension = describeAuditEntry(
      row("customer-suspend", {
        customer: null,
        type: "temporary",
        until: "2026-10-01T00:00:00Z",
        reason: null,
      }),
      day,
    );
    expect(suspension.title).toBe("Customer suspended");
    expect(suspension.subject).toBe("device-3");
    expect(suspension.lines).toEqual(["Suspended until 2026-10-01"]);
  });

  it("shows a change as before → after", () => {
    const change = describeAuditEntry(
      row("customer-suspend-change", {
        customer: "Mara Feldt",
        type: "permanent",
        until: null,
        reason: "Chargeback",
        previous: { type: "temporary", until: "2026-09-30T00:00:00Z", reason: "Under review" },
      }),
      day,
    );
    expect(change.title).toBe("Customer restriction changed");
    expect(change.lines).toEqual([
      "Suspended until 2026-09-30 → Permanent ban",
      "Reason: Chargeback",
    ]);
  });

  it("says what a lift ended", () => {
    const lift = describeAuditEntry(
      row("customer-lift", { customer: "Kai", type: "temporary", until: "2026-10-01T00:00:00Z" }),
      day,
    );
    expect(lift).toMatchObject({
      kind: "customer-lift",
      title: "Customer restriction lifted",
      subject: "Kai (device-3)",
      lines: ["Was: suspended until 2026-10-01"],
    });
  });

  it("never throws on a malformed detail", () => {
    expect(describeAuditEntry(row("customer-lift", "{not json"), day)).toMatchObject({
      title: "Customer restriction lifted",
      subject: "device-3",
      lines: ["Was: suspended"],
    });
  });
});

describe("panel member entries keep their labels and raw permission detail", () => {
  it("labels the known actions and pretty-prints the JSON", () => {
    const save = describeAuditEntry(row("save", { role: "support" }, "member@example.test"));
    expect(save).toEqual({
      kind: "member",
      title: "Access updated",
      subject: "member@example.test",
      lines: [],
      raw: JSON.stringify({ role: "support" }, null, 2),
    });
    expect(describeAuditEntry(row("kick", "", "m@example.test")).raw).toBeNull();
    expect(describeAuditEntry(row("something-new", "", "m@example.test")).title).toBe(
      "Access change",
    );
  });
});
