import { describe, expect, it } from "vitest";
import type {
  AdminLicenseRecord,
  Customer360Customer,
  Customer360Feedback,
} from "../src/types/customer360";
import { getCustomer360Overview } from "../src/utils/customer360Overview";

const NOW = Date.parse("2026-09-13T12:00:00Z");
const DAY = 86_400_000;
const at = (offset: number) => new Date(NOW + offset).toISOString();

function customer(overrides: Partial<Customer360Customer> = {}): Customer360Customer {
  return {
    anchor: {
      requested_by: "install_id",
      requested_value: "install-1",
      requested_session_id: null,
      identity: "install-1",
      hwid: null,
      install_id: "install-1",
      confidence: "device_only",
    },
    profile: {
      user_label: "Customer",
      customer_name: null,
      email: null,
      discord: null,
      verified_discord: null,
      contact: null,
    },
    summary: {
      is_active: true,
      license_tier: "free",
      app_version: null,
      display_version: null,
      platform: null,
      os_version: null,
      device_model: null,
      country: null,
      city: null,
      region: null,
      timezone: null,
      first_seen: at(-30 * DAY),
      last_seen: at(0),
      total_sessions: 3,
      total_duration_seconds: 3600,
      error_count: 0,
    },
    settings: { rpc_enabled: null, features: {} },
    diagnostics: null,
    activity: null,
    usage: [],
    orders: [],
    licenses: [],
    access: [],
    discord_links: [],
    feedback: [],
    errors: [],
    installs: [],
    sessions: [],
    section_errors: {},
    ...overrides,
  };
}

function license(overrides: Partial<AdminLicenseRecord> = {}): AdminLicenseRecord {
  return {
    id: 1,
    license_key: "RR-TEST-KEY",
    type: "lifetime",
    duration_days: null,
    hwid: null,
    status: "active",
    custom_options: "",
    created_at: at(-DAY),
    activated_at: at(-DAY),
    expires_at: null,
    usage_count: 1,
    max_uses: 1,
    ...overrides,
  };
}

describe("Customer 360 overview access", () => {
  it("separates a known absence of restrictions from missing or failed data", () => {
    expect(getCustomer360Overview(customer(), NOW).access.label).toBe("No restriction");
    expect(
      getCustomer360Overview(customer({ section_errors: { access: "offline" } }), NOW).access,
    ).toMatchObject({ label: "Unavailable", tone: "muted" });
    const partial = { ...customer(), access: undefined } as unknown as Customer360Customer;
    expect(getCustomer360Overview(partial, NOW).access.label).toBe("Unknown");
  });

  it("prefers the permanent restriction across matching install and hardware records", () => {
    const model = getCustomer360Overview(
      customer({
        access: [
          { mode: "suspend", is_active: 1, banned_until: at(DAY), reason: "Temporary review" },
          { mode: "ban", is_active: 1, banned_until: null, reason: "Account restriction" },
        ],
      }),
      NOW,
    );
    expect(model.access).toEqual({
      label: "Banned",
      tone: "danger",
      detail: "Account restriction. No expiry",
    });
  });

  it("uses the longest active suspension, rather than the newest or first row", () => {
    const model = getCustomer360Overview(
      customer({
        access: [
          { mode: "suspend", is_active: 1, banned_until: at(DAY), reason: "Short rule" },
          { mode: "suspend", is_active: 1, banned_until: at(5 * DAY), reason: "Long rule" },
        ],
      }),
      NOW,
    );
    expect(model.access).toMatchObject({ label: "Suspended", tone: "warning" });
    expect(model.access.detail).toContain("Long rule");
    expect(model.access.detail).toContain("Sep 18, 2026");
  });

  it("ignores lifted rules and suspensions whose end has been reached", () => {
    const model = getCustomer360Overview(
      customer({
        access: [
          { mode: "ban", is_active: 0, banned_until: null },
          { mode: "suspend", is_active: 1, banned_until: at(-DAY) },
          { mode: "suspend", is_active: 1, banned_until: at(0) },
        ],
      }),
      NOW,
    );
    expect(model.access.label).toBe("No restriction");
  });

  it.each([
    { mode: "suspend", is_active: 1, banned_until: "not a date" },
    { mode: "unknown", is_active: 1, banned_until: null },
    { mode: "ban", banned_until: null },
  ])("does not turn malformed access records into a clear status: %j", (row) => {
    expect(getCustomer360Overview(customer({ access: [row] }), NOW).access.label).toBe("Unknown");
  });

  it("does not advertise a definitive restriction when its section is incomplete", () => {
    const model = getCustomer360Overview(
      customer({
        access: [{ mode: "ban", is_active: 1, banned_until: null }],
        section_errors: { access: "partial result" },
      }),
      NOW,
    );
    expect(model.access.label).toBe("Unavailable");
  });
});

describe("Customer 360 overview licenses", () => {
  it("uses actual active lifetime and trial records", () => {
    expect(getCustomer360Overview(customer({ licenses: [license()] }), NOW).license).toMatchObject({
      label: "Lifetime",
      tone: "success",
    });
    const trial = getCustomer360Overview(
      customer({ licenses: [license({ type: "trial", expires_at: at(DAY) })] }),
      NOW,
    );
    expect(trial.license).toMatchObject({ label: "Trial", tone: "success" });
    expect(trial.license.detail).toContain("Sep 14, 2026");
  });

  it("expires an active license at the exact expiry boundary", () => {
    const model = getCustomer360Overview(
      customer({ licenses: [license({ expires_at: at(0) })] }),
      NOW,
    );
    expect(model.license).toMatchObject({ label: "Expired", tone: "warning" });
  });

  it("keeps revoked licenses revoked even with a future or absent expiry", () => {
    const model = getCustomer360Overview(
      customer({ licenses: [license({ status: "revoked", expires_at: at(DAY) })] }),
      NOW,
    );
    expect(model.license).toMatchObject({ label: "Revoked", tone: "danger" });
  });

  it("prefers a real active grant over old expired or revoked licenses", () => {
    const model = getCustomer360Overview(
      customer({
        licenses: [
          license({ status: "revoked" }),
          license({ status: "expired" }),
          license({ type: "trial", expires_at: at(DAY) }),
        ],
      }),
      NOW,
    );
    expect(model.license.label).toBe("Trial");
  });

  it("does not invent a license kind from a premium summary", () => {
    const source = customer();
    source.summary.license_tier = "premium";
    expect(getCustomer360Overview(source, NOW).license).toMatchObject({
      label: "Unknown",
      tone: "muted",
    });
    expect(getCustomer360Overview(source, NOW).license.detail).toContain("Premium tier reported");
    expect(getCustomer360Overview(customer(), NOW).license.label).toBe("Free");
  });

  it("does not let free or premium summary data conceal failed license loading", () => {
    const source = customer({ licenses: [license()], section_errors: { licenses: "offline" } });
    expect(getCustomer360Overview(source, NOW).license.label).toBe("Unavailable");
    expect(
      getCustomer360Overview(customer({ section_errors: { summary: "offline" } }), NOW).license
        .label,
    ).toBe("Unavailable");
  });

  it("keeps absent and malformed license data unknown", () => {
    const absent = { ...customer(), licenses: undefined } as unknown as Customer360Customer;
    expect(getCustomer360Overview(absent, NOW).license.label).toBe("Unknown");
    expect(
      getCustomer360Overview(customer({ licenses: [license({ expires_at: "not a date" })] }), NOW)
        .license.label,
    ).toBe("Unknown");
    expect(
      getCustomer360Overview(customer({ licenses: [license({ status: "unrecognized" })] }), NOW)
        .license.label,
    ).toBe("Unknown");
  });
});

describe("Customer 360 overview reports and contact", () => {
  const report = (id: number, status: string, offset: number): Customer360Feedback => ({
    id,
    status,
    created_at: at(offset),
    message: `Report ${id}`,
  });

  it("keeps new and read reports open, while archived reports are completed", () => {
    const source = customer({
      feedback: [report(1, "new", -3 * DAY), report(2, "read", -DAY), report(3, "archived", 0)],
    });
    const model = getCustomer360Overview(source, NOW);
    expect(model.openReports.map((item) => item.id)).toEqual([2, 1]);
    expect(model.latestReport?.id).toBe(3);
    expect(model.latestContact).toBe(at(0));
    expect(model.reportsUnavailable).toBe(false);
  });

  it("uses created_at, never telemetry last seen or report updated_at, as contact time", () => {
    const source = customer({
      feedback: [
        { id: 1, status: "read", created_at: at(-10 * DAY), updated_at: at(DAY) },
        { id: 2, status: "new", created_at: "invalid", updated_at: at(2 * DAY) },
      ],
    });
    const model = getCustomer360Overview(source, NOW);
    expect(model.latestReport?.id).toBe(1);
    expect(model.latestContact).toBe(at(-10 * DAY));
    expect(getCustomer360Overview(customer(), NOW).latestContact).toBeNull();
  });

  it("cannot label an undated report as the latest contact", () => {
    const model = getCustomer360Overview(
      customer({ feedback: [{ id: 1, status: "new", updated_at: at(0) }] }),
      NOW,
    );
    expect(model.openReports).toHaveLength(1);
    expect(model.latestReport).toBeNull();
    expect(model.latestContact).toBeNull();
  });

  it("marks failed or missing feedback as unavailable while preserving known partial reports", () => {
    const known = report(1, "new", -DAY);
    const model = getCustomer360Overview(
      customer({ feedback: [known], section_errors: { feedback: "one store unavailable" } }),
      NOW,
    );
    expect(model.reportsUnavailable).toBe(true);
    expect(model.openReports).toEqual([known]);
    const missing = { ...customer(), feedback: undefined } as unknown as Customer360Customer;
    expect(getCustomer360Overview(missing, NOW)).toMatchObject({
      reportsUnavailable: true,
      latestContact: null,
    });
  });

  it("does not silently count an unknown report status as completed", () => {
    const model = getCustomer360Overview(
      customer({ feedback: [{ id: 1, status: "unrecognized", created_at: at(0) }] }),
      NOW,
    );
    expect(model.reportsUnavailable).toBe(true);
    expect(model.openReports).toEqual([]);
  });

  it("does not mutate source arrays when ordering reports and active restrictions", () => {
    const older = report(1, "new", -DAY),
      newer = report(2, "read", 0);
    const source = customer({
      feedback: [older, newer],
      licenses: [license(), license({ type: "trial", expires_at: at(DAY) })],
    });
    Object.freeze(source.feedback);
    Object.freeze(source.licenses);
    getCustomer360Overview(source, NOW);
    expect(source.feedback).toEqual([older, newer]);
    expect(source.licenses[0].type).toBe("lifetime");
  });
});
