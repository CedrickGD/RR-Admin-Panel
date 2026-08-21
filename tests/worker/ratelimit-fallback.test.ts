import { describe, expect, it } from "vitest";

import {
  canonicalEvent,
  createWorkerHarness,
  dispatch,
  legacyKeyHeaders,
  workerRequest,
} from "./helpers";

async function postIngest(
  harness: ReturnType<typeof createWorkerHarness>,
  clientIp: string,
): Promise<number> {
  const response = await dispatch(
    harness,
    workerRequest({
      method: "POST",
      path: "/api/ingest",
      headers: legacyKeyHeaders(),
      json: canonicalEvent({ service: "session_active" }),
      clientIp,
    }),
  );
  return response.status;
}

describe("in-isolate fallback rate limit", () => {
  it("returns 429 from the 61st ingest request of one IP in a window even when the platform binding always allows", async () => {
    const harness = createWorkerHarness();
    const statuses: number[] = [];
    for (let index = 0; index < 61; index += 1) {
      statuses.push(await postIngest(harness, "198.51.100.10"));
    }
    expect(statuses.slice(0, 60).every((status) => status !== 429)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it("keeps limiting per IP: another IP is unaffected", async () => {
    const harness = createWorkerHarness();
    for (let index = 0; index < 61; index += 1) {
      await postIngest(harness, "198.51.100.11");
    }
    expect(await postIngest(harness, "198.51.100.11")).toBe(429);
    expect(await postIngest(harness, "198.51.100.12")).not.toBe(429);
  });

  it("caps registration at 5 per IP per window", async () => {
    const harness = createWorkerHarness();
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await dispatch(
        harness,
        workerRequest({
          method: "POST",
          path: "/api/install/register",
          json: { install_id: "x" },
          clientIp: "198.51.100.20",
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 5).every((status) => status === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
