import { beforeEach, describe, expect, it } from "vitest";

import { enforceRateLimit, resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { onRequestPost as accessStatus } from "../../functions/api/access/status";
import { onRequestGet as announcementsActive } from "../../functions/api/announcements/active";
import { onRequestGet as oauthStart } from "../../functions/api/discord/oauth-start";
import { onRequestPost as feedback } from "../../functions/api/feedback/index";
import { onRequest as ingest } from "../../functions/api/ingest";
import { onRequestPost as activateLicense } from "../../functions/api/license/activate";
import { onRequestPost as validateLicense } from "../../functions/api/license/validate";
import { onRequestPost as usageConsume } from "../../functions/api/usage/consume";
import { onRequestGet as usageStatus } from "../../functions/api/usage/status";
import { createMockD1 } from "../helpers/mock-d1";
import { createSyntheticRequest } from "../helpers/request";

const T0 = Date.UTC(2026, 7, 21, 12, 0, 0);
const RULE = { route: "test/route", limit: 3, windowSeconds: 60 };

function requestFrom(ip: string | null, path = "/api/test"): Request {
  return createSyntheticRequest({
    path,
    headers: ip ? { "cf-connecting-ip": ip } : undefined,
  });
}

async function expectTooManyRequests(response: Response | null): Promise<Response> {
  expect(response).not.toBeNull();
  const res = response as Response;
  expect(res.status).toBe(429);
  expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
  await expect(res.json()).resolves.toEqual({
    ok: false,
    error: "Too many requests.",
    details: null,
  });
  return res;
}

beforeEach(() => {
  resetRateLimitsForTests();
});

describe("enforceRateLimit", () => {
  it("allows calls up to the limit and rejects the next one with 429 + retry-after", async () => {
    const request = requestFrom("203.0.113.7");

    expect(enforceRateLimit(request, RULE, T0)).toBeNull();
    expect(enforceRateLimit(request, RULE, T0)).toBeNull();
    expect(enforceRateLimit(request, RULE, T0)).toBeNull();

    const rejected = await expectTooManyRequests(enforceRateLimit(request, RULE, T0));
    expect(rejected.headers.get("retry-after")).toBe("60");
  });

  it("reports the seconds left in the current window in retry-after (never below 1)", async () => {
    const request = requestFrom("203.0.113.7");
    for (let i = 0; i < 3; i += 1) enforceRateLimit(request, RULE, T0);

    const halfway = await expectTooManyRequests(enforceRateLimit(request, RULE, T0 + 30_000));
    expect(halfway.headers.get("retry-after")).toBe("30");

    const almostOver = await expectTooManyRequests(enforceRateLimit(request, RULE, T0 + 59_900));
    expect(almostOver.headers.get("retry-after")).toBe("1");
  });

  it("keeps rejecting for the rest of the window and starts fresh in the next one", async () => {
    const request = requestFrom("203.0.113.7");
    for (let i = 0; i < 3; i += 1) enforceRateLimit(request, RULE, T0);

    await expectTooManyRequests(enforceRateLimit(request, RULE, T0 + 59_999));
    expect(enforceRateLimit(request, RULE, T0 + 60_000)).toBeNull();
    expect(enforceRateLimit(request, RULE, T0 + 60_000)).toBeNull();
    expect(enforceRateLimit(request, RULE, T0 + 60_000)).toBeNull();
    await expectTooManyRequests(enforceRateLimit(request, RULE, T0 + 60_000));
  });

  it("counts each client IP independently", async () => {
    const alice = requestFrom("203.0.113.7");
    const bob = requestFrom("198.51.100.9");
    for (let i = 0; i < 3; i += 1) enforceRateLimit(alice, RULE, T0);

    await expectTooManyRequests(enforceRateLimit(alice, RULE, T0));
    expect(enforceRateLimit(bob, RULE, T0)).toBeNull();
  });

  it("counts each route independently for the same IP", async () => {
    const request = requestFrom("203.0.113.7");
    const other = { ...RULE, route: "other/route" };
    for (let i = 0; i < 3; i += 1) enforceRateLimit(request, RULE, T0);

    await expectTooManyRequests(enforceRateLimit(request, RULE, T0));
    expect(enforceRateLimit(request, other, T0)).toBeNull();
  });

  it("buckets by the explicit key instead of the IP when a rule provides one", async () => {
    const keyed = { ...RULE, key: "LICENSE-KEY-1" };
    const alice = requestFrom("203.0.113.7");
    const bob = requestFrom("198.51.100.9");

    expect(enforceRateLimit(alice, keyed, T0)).toBeNull();
    expect(enforceRateLimit(bob, keyed, T0)).toBeNull();
    expect(enforceRateLimit(alice, keyed, T0)).toBeNull();
    await expectTooManyRequests(enforceRateLimit(bob, keyed, T0));

    // A different key for the same route is a fresh bucket.
    expect(enforceRateLimit(bob, { ...keyed, key: "LICENSE-KEY-2" }, T0)).toBeNull();
  });

  it("shares one 'unknown' bucket for requests without a client IP", async () => {
    const anonymous = requestFrom(null);
    const blank = createSyntheticRequest({
      path: "/api/test",
      headers: { "cf-connecting-ip": "  " },
    });

    expect(enforceRateLimit(anonymous, RULE, T0)).toBeNull();
    expect(enforceRateLimit(blank, RULE, T0)).toBeNull();
    expect(enforceRateLimit(anonymous, RULE, T0)).toBeNull();
    await expectTooManyRequests(enforceRateLimit(blank, RULE, T0));
  });

  it("resetRateLimitsForTests clears every bucket", async () => {
    const request = requestFrom("203.0.113.7");
    for (let i = 0; i < 3; i += 1) enforceRateLimit(request, RULE, T0);
    await expectTooManyRequests(enforceRateLimit(request, RULE, T0));

    resetRateLimitsForTests();

    expect(enforceRateLimit(request, RULE, T0)).toBeNull();
  });

  it("keeps live buckets intact when the table overflows and stale entries are pruned", async () => {
    const victim = requestFrom("203.0.113.7");
    for (let i = 0; i < 3; i += 1) enforceRateLimit(victim, RULE, T0);

    // Fill the table past the prune threshold with buckets that are already two windows old …
    for (let i = 0; i < 10_001; i += 1) {
      enforceRateLimit(requestFrom(`10.0.${Math.floor(i / 256)}.${i % 256}`), RULE, T0 - 200_000);
    }
    // … and with fresh ones: the prune must drop only the stale buckets.
    for (let i = 0; i < 10; i += 1) {
      enforceRateLimit(requestFrom(`10.9.9.${i}`), RULE, T0);
    }

    await expectTooManyRequests(enforceRateLimit(victim, RULE, T0));
  });
});

describe("public routes are rate limited before any other work", () => {
  const db = () => createMockD1().db;

  it("rejects the 31st license/validate call from one IP within a minute", async () => {
    const env: RuntimeEnv = { DB: db() };
    const call = () =>
      validateLicense({
        request: createSyntheticRequest({
          path: "/api/license/validate",
          headers: { "cf-connecting-ip": "203.0.113.50" },
          json: { license_key: "ABCD-EFGH", hwid: "HWID-1" },
        }),
        env,
      });

    for (let i = 0; i < 30; i += 1) {
      expect((await call()).status).toBe(404);
    }
    await expectTooManyRequests(await call());
  });

  it("rejects the 11th license/activate call from one IP within a minute", async () => {
    const env: RuntimeEnv = { DB: db() };
    const call = (key: string) =>
      activateLicense({
        request: createSyntheticRequest({
          path: "/api/license/activate",
          headers: { "cf-connecting-ip": "203.0.113.51" },
          json: { license_key: key, hwid: "HWID-1" },
        }),
        env,
      });

    for (let i = 0; i < 10; i += 1) {
      expect((await call(`KEY-${i}`)).status).toBe(404);
    }
    await expectTooManyRequests(await call("KEY-10"));
  });

  it("rejects the 21st license/activate call for one license key across many IPs per hour", async () => {
    const env: RuntimeEnv = { DB: db() };
    const call = (ip: string) =>
      activateLicense({
        request: createSyntheticRequest({
          path: "/api/license/activate",
          headers: { "cf-connecting-ip": ip },
          json: { license_key: "  SHARED-KEY  ", hwid: "HWID-1" },
        }),
        env,
      });

    for (let i = 0; i < 20; i += 1) {
      expect((await call(`198.51.100.${i}`)).status).toBe(404);
    }
    await expectTooManyRequests(await call("198.51.100.200"));
  });

  const routes: Array<{
    name: string;
    limit: number;
    call: (ip: string) => Promise<Response>;
  }> = [
    {
      name: "access/status",
      limit: 30,
      call: (ip) =>
        accessStatus({
          request: createSyntheticRequest({
            path: "/api/access/status",
            headers: { "cf-connecting-ip": ip },
            json: { hwid: "HWID-1" },
          }),
          env: { DB: db() },
        }),
    },
    {
      name: "feedback",
      limit: 5,
      call: (ip) =>
        feedback({
          request: createSyntheticRequest({
            path: "/api/feedback",
            headers: { "cf-connecting-ip": ip },
            json: { message: "hello" },
          }),
          env: { DB: db() },
        }),
    },
    {
      name: "announcements/active",
      limit: 60,
      call: (ip) =>
        announcementsActive({
          request: createSyntheticRequest({
            path: "/api/announcements/active",
            headers: { "cf-connecting-ip": ip },
          }),
          env: { DB: db() },
        }),
    },
    {
      name: "discord/oauth-start",
      limit: 10,
      call: (ip) =>
        oauthStart({
          request: createSyntheticRequest({
            path: "/api/discord/oauth-start",
            query: { key: "ABCD-EFGH" },
            headers: { "cf-connecting-ip": ip },
          }),
          env: { DB: db() },
        }),
    },
    {
      name: "usage/consume",
      limit: 60,
      call: (ip) =>
        usageConsume({
          request: createSyntheticRequest({
            path: "/api/usage/consume",
            headers: { "cf-connecting-ip": ip },
            json: { hwid: "HWID-1", feature: "desync" },
          }),
          env: { DB: db() },
        }),
    },
    {
      name: "usage/status",
      limit: 60,
      call: (ip) =>
        usageStatus({
          request: createSyntheticRequest({
            path: "/api/usage/status",
            query: { hwid: "HWID-1" },
            headers: { "cf-connecting-ip": ip },
          }),
          env: { DB: db() },
        }),
    },
    {
      name: "ingest (before the credential check)",
      limit: 60,
      call: (ip) =>
        ingest({
          request: createSyntheticRequest({
            path: "/api/ingest",
            headers: { "cf-connecting-ip": ip },
            json: { source: "app", service: "session_active", timestamp: "x", status: "ok" },
          }),
          env: { DB: db(), INGEST_TOKEN: "secret" },
        }),
    },
  ];

  for (const route of routes) {
    it(`rejects call ${route.limit + 1} to ${route.name} from one IP, leaves other IPs alone`, async () => {
      const ip = "203.0.113.99";
      for (let i = 0; i < route.limit; i += 1) {
        expect((await route.call(ip)).status).not.toBe(429);
      }
      await expectTooManyRequests(await route.call(ip));
      expect((await route.call("203.0.113.100")).status).not.toBe(429);
    });
  }
});
