import { describe, expect, it } from "vitest";

import type { LicenseRow } from "../functions/_lib/customer-anchor";
import {
  buildPurchases,
  buildSupportContext,
  maskTail,
  type SupportContextSources,
} from "../functions/_lib/discord-support";
import type { DiagnosticProvider } from "../functions/_lib/feedback-diagnostics";
import type { AppSessionRecord, ErrorEventDetail } from "../functions/_lib/types";

/**
 * The two builders that decide what a Discord bot — and through it an AI model — is told about a
 * customer. They are allow-lists: the point of these cases is that a field nobody listed cannot
 * appear in the answer, however it arrived in the row.
 */

const SESSION = {
  id: "session-1",
  installId: "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13",
  hwid: "A1B2C3D4E5F60718293A4B5C6D7E8F90",
  userLabel: "CEDRIC-PC",
  clientIp: "203.0.113.10",
  clientCountry: "DE",
  clientCity: "Berlin",
  clientTimezone: "Europe/Berlin",
  discordUser: "buyer#1000",
  appVersion: "1.5.3",
  platform: "win32",
  osVersion: "Windows 11",
  lastSeenAt: "2026-09-19T10:00:00.000Z",
} as unknown as AppSessionRecord;

const LICENSE = {
  id: 7,
  license_key: "RR-AAAA-BBBB-CCCC",
  type: "lifetime",
  duration_days: null,
  hwid: "A1B2C3D4E5F60718293A4B5C6D7E8F90",
  max_uses: 2,
  usage_count: 1,
  status: "active",
  custom_options: "{}",
  created_at: "2026-09-01T00:00:00.000Z",
  activated_at: "2026-09-02T00:00:00.000Z",
  expires_at: null,
  order_id: "SH-ORDER-99XYZ",
  customer_name: "Example Customer",
  customer_email: "buyer@example.com",
  customer_discord: "buyer#1000",
  order_source: "sellhub",
  order_note: "note",
  order_meta: '{"body":{"email":"buyer@example.com"}}',
  purchased_at: "2026-09-01T00:00:00.000Z",
} satisfies LicenseRow;

function errorRow(code: string, ts: string, kind = "unhandled"): ErrorEventDetail {
  return {
    id: `e-${code}-${ts}`,
    timestamp: ts,
    receivedAt: ts,
    message: "boom",
    type: "System.NullReferenceException",
    kind,
    code,
    sessionId: "session-1",
    appVersion: "1.5.3",
    source: "desktop",
    extras: {},
    report: null,
  };
}

function sources(overrides: Partial<SupportContextSources> = {}): SupportContextSources {
  return {
    session: SESSION,
    installs: 2,
    license: LICENSE,
    suspended: false,
    errors: [],
    report: null,
    ...overrides,
  };
}

describe("buildSupportContext: an allow-list, not a deny-list", () => {
  it("emits exactly the contract's fields", () => {
    const context = buildSupportContext(sources());

    expect(Object.keys(context).sort()).toEqual([
      "app_version",
      "errors",
      "installs",
      "last_seen_at",
      "licence",
      "os_version",
      "platform",
      "report",
    ]);
    expect(Object.keys(context.licence!).sort()).toEqual([
      "expiresAt",
      "lifetime",
      "plan",
      "status",
      "suspended",
    ]);
    expect(context).toMatchObject({
      app_version: "1.5.3",
      platform: "win32",
      os_version: "Windows 11",
      last_seen_at: "2026-09-19T10:00:00.000Z",
      installs: 2,
      licence: { plan: "lifetime", status: "active", expiresAt: null, lifetime: true },
    });
  });

  it("never carries an identifier, a contact or a location out of the row it read", () => {
    const serialized = JSON.stringify(buildSupportContext(sources()));

    for (const forbidden of [
      SESSION.hwid,
      SESSION.installId,
      SESSION.userLabel,
      SESSION.clientIp,
      "Berlin",
      "Europe/Berlin",
      "buyer@example.com",
      "Example Customer",
      LICENSE.license_key,
      LICENSE.order_id,
    ]) {
      expect(serialized).not.toContain(String(forbidden));
    }
  });

  it("withholds the licence entirely when the caller did not establish ownership", () => {
    expect(buildSupportContext(sources({ license: null })).licence).toBeNull();
  });

  it("counts each error code once, newest first, and drops the background loop", () => {
    const context = buildSupportContext(
      sources({
        errors: [
          errorRow("RR-E1003", "2026-09-19T12:00:00.000Z", "background"),
          errorRow("RR-E1000", "2026-09-19T09:00:00.000Z"),
          errorRow("RR-E1000", "2026-09-19T11:00:00.000Z"),
          errorRow("RR-E1001", "2026-09-19T10:00:00.000Z"),
        ],
      }),
    );

    expect(context.errors).toEqual([
      { code: "RR-E1000", count: 2, last_at: "2026-09-19T11:00:00.000Z" },
      { code: "RR-E1001", count: 1, last_at: "2026-09-19T10:00:00.000Z" },
    ]);
  });

  it("flattens a diagnostics provider to lines and redacts a key a customer pasted", () => {
    const provider = {
      provider: "identity_license_access",
      version: null,
      status: "warning",
      duration_ms: 12,
      summary: "License present",
      checks: [
        { key: "activated", label: "Activated", status: "pass", value: true, detail: null },
        {
          key: "tier",
          label: "Tier",
          status: "pass",
          value: "lifetime",
          detail: "seat 1 of 2",
        },
      ],
    } as DiagnosticProvider;

    const context = buildSupportContext(
      sources({
        report: {
          report_id: "FB-ABCDEF123456",
          created_at: "2026-09-19T10:05:00.000Z",
          message: `my key RR-AAAA-BBBB-CCCC does not work`,
          providers: [provider],
        },
      }),
    );

    expect(context.report).toMatchObject({
      report_id: "FB-ABCDEF123456",
      created_at: "2026-09-19T10:05:00.000Z",
      diagnostics: [
        {
          provider: "identity_license_access",
          status: "warning",
          lines: ["License present", "Activated: true", "Tier: lifetime — seat 1 of 2"],
        },
      ],
    });
    expect(context.report!.message).not.toContain("RR-AAAA-BBBB-CCCC");
  });
});

describe("buildPurchases: the customer's own order, masked", () => {
  it("returns the contract's fields and no identity", () => {
    const [purchase] = buildPurchases([LICENSE]);

    expect(Object.keys(purchase).sort()).toEqual([
      "activatedAt",
      "durationDays",
      "expiresAt",
      "keyLast4",
      "lifetime",
      "orderRef",
      "plan",
      "purchasedAt",
      "seatsMax",
      "seatsUsed",
      "source",
      "status",
    ]);
    expect(purchase).toEqual({
      plan: "lifetime",
      durationDays: null,
      status: "active",
      lifetime: true,
      purchasedAt: "2026-09-01T00:00:00.000Z",
      activatedAt: "2026-09-02T00:00:00.000Z",
      expiresAt: null,
      source: "sellhub",
      orderRef: "••••9XYZ",
      keyLast4: "CCCC",
      seatsUsed: 1,
      seatsMax: 2,
    });
    const serialized = JSON.stringify(purchase);
    expect(serialized).not.toContain(LICENSE.order_id);
    expect(serialized).not.toContain(LICENSE.license_key);
    expect(serialized).not.toContain("buyer@example.com");
    expect(serialized).not.toContain(LICENSE.hwid);
  });

  it("masks a short order id completely rather than printing it whole", () => {
    expect(maskTail("AB12")).toBe("••••");
    expect(maskTail("XAB12")).toBe("••••AB12");
    expect(maskTail("  ")).toBeNull();
  });
});
