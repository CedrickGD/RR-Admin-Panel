import { describe, expect, it } from "vitest";

import {
  attachCloudflareContext,
  readCloudflareProperties,
} from "../../deploy/nas/rr-api/src/cf-request";
import { readRequestContext } from "../../shared/telemetry-contract";

type RequestWithCf = Request & { cf?: Record<string, unknown> };

describe("attachCloudflareContext", () => {
  it("builds request.cf from the tunnel headers", () => {
    const request = attachCloudflareContext(
      new Request("https://api.test/api/ingest", {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.7",
          "cf-ipcountry": "DE",
          "cf-ipcity": "Berlin",
          "cf-region": "Berlin",
          "cf-iplatitude": "52.52000",
          "cf-iplongitude": "13.40500",
          "cf-timezone": "Europe/Berlin",
          "cf-ipcontinent": "EU",
          "cf-ray": "8f1a2b3c4d5e6f70-FRA",
        },
        body: "{}",
      }),
    ) as RequestWithCf;

    expect(request.cf).toEqual({
      country: "DE",
      city: "Berlin",
      region: "Berlin",
      latitude: "52.52000",
      longitude: "13.40500",
      timezone: "Europe/Berlin",
      continent: "EU",
      ray: "8f1a2b3c4d5e6f70-FRA",
      colo: "FRA",
    });
    expect(Object.keys(request)).not.toContain("cf");
    expect(request.headers.get("cf-connecting-ip")).toBe("203.0.113.7");

    const context = readRequestContext(request);
    expect(context.clientIp).toBe("203.0.113.7");
    expect(context.country).toBe("DE");
    expect(context.city).toBe("Berlin");
    expect(context.latitude).toBeCloseTo(52.52);
    expect(context.longitude).toBeCloseTo(13.405);
    expect(context.timezone).toBe("Europe/Berlin");
  });

  it("does not throw without headers and leaves cf empty", () => {
    const request = attachCloudflareContext(
      new Request("https://api.test/health"),
    ) as RequestWithCf;
    expect(request.cf).toEqual({});
    expect(readRequestContext(request).country).toBeNull();
  });

  it("ignores blank header values", () => {
    expect(
      readCloudflareProperties(new Headers({ "cf-ipcity": "  ", "cf-ipcountry": "US" })),
    ).toEqual({ country: "US" });
  });

  it("keeps the same Request instance (body stream untouched)", async () => {
    const original = new Request("https://api.test/x", { method: "POST", body: "payload" });
    const attached = attachCloudflareContext(original);
    expect(attached).toBe(original);
    expect(await attached.text()).toBe("payload");
  });
});
