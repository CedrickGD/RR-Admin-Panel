import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_PROVIDER_IDS,
  MAX_DIAGNOSTICS_BYTES,
  storeFeedbackDiagnostics,
  validateFeedbackDiagnostics,
} from "../../functions/_lib/feedback-diagnostics";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import { onRequestPost as submitFeedback } from "../../functions/api/feedback/index";
import { resetInstallsSchemaStateForTests } from "../../shared/installs-store";
import {
  generateInstallKeyPair,
  signedHeaders,
  type InstallKeyPair,
} from "../helpers/install-signer";
import { createMockD1 } from "../helpers/mock-d1";

const INSTALL_ID = "6f1d2c9a-9b2e-4a5d-8d77-2f4e1c0a9b13";
const HWID = "A1B2C3D4E5F60718293A4B5C6D7E8F90";
let keys: InstallKeyPair;

beforeAll(async () => {
  keys = await generateInstallKeyPair();
});

beforeEach(() => {
  resetRateLimitsForTests();
  resetInstallsSchemaStateForTests();
});

function diagnostics(detail = "healthy") {
  return {
    schema_version: 1,
    generated_at: "2026-09-03T12:00:00.000Z",
    consent: true,
    providers: DIAGNOSTIC_PROVIDER_IDS.map((provider) => ({
      provider,
      version: "1.5.0",
      status: "ok",
      duration_ms: 4,
      summary: `${provider} ready`,
      checks: [
        {
          key: "ready",
          label: "Ready",
          status: "pass",
          value: true as string | number | boolean | null,
          detail,
        },
      ],
    })),
  };
}

function maximumSizedDiagnostics() {
  const report = diagnostics("");
  for (const provider of report.providers) {
    provider.summary = "";
    provider.checks[0].detail = "";
    provider.checks[0].value = "";
  }

  const encoder = new TextEncoder();
  const fields = report.providers.flatMap((provider) => [
    { max: 500, set: (value: string) => (provider.summary = value) },
    { max: 500, set: (value: string) => (provider.checks[0].detail = value) },
    {
      max: 256,
      set: (value: string) => (provider.checks[0].value = value),
    },
  ]);
  for (const field of fields) {
    const currentBytes = encoder.encode(JSON.stringify(report)).byteLength;
    const remaining = MAX_DIAGNOSTICS_BYTES - currentBytes;
    if (remaining <= 0) break;
    field.set("x".repeat(Math.min(field.max, remaining)));
  }
  return report;
}

describe("feedback diagnostics v1 validation", () => {
  it("accepts one isolated record for every contracted provider and redacts secrets", () => {
    const result = validateFeedbackDiagnostics(
      diagnostics("authorization: Bearer this-must-never-be-stored"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok || !result.value) return;
    expect(result.value.providers).toHaveLength(12);
    expect(result.value.providers.map((provider) => provider.provider)).toEqual(
      DIAGNOSTIC_PROVIDER_IDS,
    );
    expect(result.value.providers[0].checks[0].detail).toContain("[REDACTED]");
    expect(result.value.providers[0].checks[0].detail).not.toContain("this-must-never-be-stored");
  });

  it("rejects missing, duplicate, unknown, overfull, and oversized reports", () => {
    const missing = diagnostics();
    missing.providers.pop();
    expect(validateFeedbackDiagnostics(missing).ok).toBe(false);

    const duplicate = diagnostics();
    duplicate.providers[11].provider = duplicate.providers[0].provider;
    expect(validateFeedbackDiagnostics(duplicate).ok).toBe(false);

    const unknown = diagnostics() as unknown as { providers: Array<Record<string, unknown>> };
    unknown.providers[0].provider = "unknown_provider";
    expect(validateFeedbackDiagnostics(unknown).ok).toBe(false);

    const tooManyChecks = diagnostics();
    tooManyChecks.providers[0].checks = Array.from({ length: 33 }, (_, index) => ({
      key: `check_${index}`,
      label: `Check ${index}`,
      status: "pass" as const,
      value: true,
      detail: "ok",
    }));
    expect(validateFeedbackDiagnostics(tooManyChecks).ok).toBe(false);

    const oversized = diagnostics("x".repeat(MAX_DIAGNOSTICS_BYTES));
    expect(validateFeedbackDiagnostics(oversized).ok).toBe(false);
  });

  it("stores each provider separately instead of one opaque report blob", async () => {
    const mock = createMockD1();
    const parsed = validateFeedbackDiagnostics(diagnostics());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || !parsed.value) return;

    await storeFeedbackDiagnostics(
      mock.db,
      42,
      "FB-000042",
      "signed",
      INSTALL_ID,
      parsed.value,
      "2026-09-03T12:01:00.000Z",
    );

    const providers = mock.operations.filter((operation) =>
      operation.normalizedSql.startsWith("INSERT INTO feedback_diagnostic_providers"),
    );
    expect(providers).toHaveLength(12);
    expect(providers.map((operation) => operation.values[2])).toEqual(DIAGNOSTIC_PROVIDER_IDS);
  });
});

describe("POST /api/feedback diagnostics compatibility", () => {
  function mockDatabase(options: { failMetadata?: boolean } = {}) {
    return createMockD1({
      run: [
        {
          match: /^INSERT INTO feedback /,
          result: { success: true, meta: { changes: 1, last_row_id: 42 } },
        },
        ...(options.failMetadata
          ? [
              {
                match: /CREATE TABLE IF NOT EXISTS feedback_report_meta/,
                result: () => {
                  throw new Error("migration not deployed");
                },
              },
            ]
          : []),
      ],
      first: [
        {
          match: /FROM installs WHERE install_id = \?/,
          result: {
            install_id: INSTALL_ID,
            public_key_jwk: JSON.stringify(keys.publicKeyJwk),
            hwid: HWID,
            app_version: "1.5.0",
            created_at: "2026-09-01T00:00:00.000Z",
            last_seen_at: null,
            revoked_at: null,
            license_id: null,
          },
        },
      ],
    });
  }

  async function signedRequest(payload: Record<string, unknown>): Promise<Request> {
    const body = JSON.stringify(payload);
    const headers = await signedHeaders(keys.privateKey, {
      installId: INSTALL_ID,
      method: "POST",
      pathname: "/api/feedback",
      timestamp: String(Math.floor(Date.now() / 1000)),
      bodyText: body,
    });
    headers.set("content-type", "application/json");
    return new Request("https://admin.test/api/feedback", { method: "POST", headers, body });
  }

  it.each([undefined, null, "", "  \t\n", "Automatic diagnostics report (no message supplied)."])(
    "rejects reports without a written description (%s) before storing feedback or diagnostics",
    async (message) => {
      const mock = mockDatabase();
      const response = await submitFeedback({
        request: await signedRequest({ message, diagnostics: diagnostics() }),
        env: { DB: mock.db },
      });
      expect(response.status).toBe(400);
      expect(
        mock.operations.some((operation) =>
          operation.normalizedSql.startsWith("INSERT INTO feedback"),
        ),
      ).toBe(false);
    },
  );

  it("keeps the existing feedback INSERT fields and adds a report id response", async () => {
    const mock = mockDatabase();
    const response = await submitFeedback({
      request: await signedRequest({
        message: "Technical diagnostics report",
        hwid: HWID,
        install_id: INSTALL_ID,
        diagnostics: diagnostics(),
      }),
      env: { DB: mock.db },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      message: "Feedback received. Thank you!",
      report_id: "FB-000042",
    });
    const insert = mock.operations.find((operation) =>
      operation.normalizedSql.startsWith("INSERT INTO feedback "),
    );
    expect(insert?.normalizedSql).toContain(
      "(message, contact, hwid, install_id, license_key, machine_name, app_version, platform, status, created_at)",
    );
    expect(
      mock.operations.filter((operation) =>
        operation.normalizedSql.startsWith("INSERT INTO feedback_diagnostic_providers"),
      ),
    ).toHaveLength(12);
  });

  it("accepts a 12 KiB diagnostic report together with a 4,000-character multibyte message", async () => {
    const report = maximumSizedDiagnostics();
    const message = "診".repeat(4000);
    const payload = {
      message,
      hwid: HWID,
      install_id: INSTALL_ID,
      machine_name: "DESKTOP",
      app_version: "1.5.0",
      platform: "win32",
      diagnostics: report,
    };
    const encoder = new TextEncoder();
    expect(encoder.encode(JSON.stringify(report)).byteLength).toBe(MAX_DIAGNOSTICS_BYTES);
    expect(validateFeedbackDiagnostics(report).ok).toBe(true);
    const totalBytes = encoder.encode(JSON.stringify(payload)).byteLength;
    expect(totalBytes).toBeGreaterThan(16 * 1024);
    expect(totalBytes).toBeLessThan(48 * 1024);

    const mock = mockDatabase();
    const response = await submitFeedback({
      request: await signedRequest(payload),
      env: { DB: mock.db },
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, report_id: "FB-000042" });
    const insert = mock.operations.find((operation) =>
      operation.normalizedSql.startsWith("INSERT INTO feedback "),
    );
    expect(insert?.values[0]).toBe(message);
  });

  it("requires a verified install for diagnostics but not for legacy message-only feedback", async () => {
    const mock = mockDatabase({ failMetadata: true });
    const diagnosticResponse = await submitFeedback({
      request: new Request("https://admin.test/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "report", diagnostics: diagnostics() }),
      }),
      env: { DB: mock.db },
    });
    expect(diagnosticResponse.status).toBe(401);

    const legacyResponse = await submitFeedback({
      request: new Request("https://admin.test/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "different-ip" },
        body: JSON.stringify({ message: "legacy report" }),
      }),
      env: { DB: mock.db },
    });
    expect(legacyResponse.status).toBe(201);
    expect(await legacyResponse.json()).toMatchObject({ ok: true, report_id: "FB-000042" });
    expect(
      mock.operations.some((operation) =>
        operation.normalizedSql.startsWith("DELETE FROM feedback"),
      ),
    ).toBe(false);
  });
});
