import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer360Customer } from "../src/types/customer360";
import { Customer360Overview } from "../src/components/Customer360Overlay";

const permissionState = vi.hoisted(() => ({ allowed: true }));
vi.mock("../src/hooks/usePanelPermission", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/hooks/usePanelPermission")>()),
  usePanelPermission: () => permissionState.allowed,
}));

function customer(): Customer360Customer {
  return {
    anchor: {
      requested_by: "install_id",
      requested_value: "test-install",
      requested_session_id: null,
      identity: "test",
      hwid: null,
      install_id: "test-install",
      confidence: "verified_customer",
    },
    profile: {
      customer_name: "Test Customer",
      user_label: null,
      email: null,
      discord: null,
      verified_discord: null,
      contact: null,
    },
    summary: {
      is_active: false,
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
      first_seen: null,
      last_seen: null,
      total_sessions: 0,
      total_duration_seconds: 0,
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
  };
}
const render = (record: Customer360Customer) =>
  renderToStaticMarkup(<Customer360Overview customer={record} onOpenSection={() => {}} />);

describe("Customer360 CRM overview", () => {
  beforeEach(() => {
    permissionState.allowed = true;
  });
  it("puts account and support context before the technical history", () => {
    const html = render(customer());
    expect(html).toContain("Account at a glance");
    expect(html.indexOf("Account at a glance")).toBeLessThan(html.indexOf("Support focus"));
    expect(html.indexOf("Support focus")).toBeLessThan(html.indexOf("Recent history"));
    expect(html).not.toContain("Alex Morgan");
  });
  it("keeps read feedback open until it is archived", () => {
    const record = customer();
    record.feedback = [
      {
        id: 1,
        status: "read",
        message: "Settings need attention",
        created_at: "2026-09-13T12:00:00Z",
      },
    ];
    const html = render(record);
    expect(html).toContain("Needs attention");
    expect(html).toContain("Settings need attention");
    expect(html).toContain("Open support history");
  });
  it("names the inbox of each report in the recent history", () => {
    const record = customer();
    record.feedback = [
      {
        id: 1,
        kind: "support",
        status: "new",
        message: "Overlay crashes",
        created_at: "2026-09-13T12:00:00Z",
      },
      {
        id: 2,
        kind: "feedback",
        status: "read",
        message: "Pin the kill feed",
        created_at: "2026-09-12T12:00:00Z",
      },
      { id: 3, status: "read", message: "From an old client", created_at: "2026-09-11T12:00:00Z" },
    ];
    const html = render(record);
    expect(html).toContain("Support report received");
    expect(html).toContain("Problem report");
    expect(html).toContain("Feedback received");
    expect(html.match(/Feedback received/g)).toHaveLength(2);
  });
  it("never turns incomplete access or feedback into an all-clear state", () => {
    const record = customer();
    record.section_errors = { access: "Unavailable", feedback: "Unavailable" };
    const html = render(record);
    expect(html).toContain("Incomplete");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("No restriction");
    expect(html).not.toContain("No in-app reports recorded");
  });
  it("does not display protected sections when permissions are absent", () => {
    permissionState.allowed = false;
    const record = customer();
    record.feedback = [
      { status: "new", message: "Private support text", created_at: "2026-09-13T12:00:00Z" },
    ];
    const html = render(record);
    expect(html).not.toContain("Private support text");
    expect(html).not.toContain("Open support history");
    expect(html).not.toContain("<dt>App access</dt>");
    expect(html).not.toContain("<dt>License</dt>");
  });
});
