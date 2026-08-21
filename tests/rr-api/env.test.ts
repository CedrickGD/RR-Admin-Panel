import { describe, expect, it } from "vitest";

import { createD1Database, createInMemoryDatabase } from "../../deploy/nas/rr-api/src/d1-adapter";
import { buildRuntimeEnv } from "../../deploy/nas/rr-api/src/env";
import { FixedWindowLimiter, readPositiveInt } from "../../deploy/nas/rr-api/src/ratelimit";

describe("FixedWindowLimiter", () => {
  it("allows `limit` calls per key per window and resets after the window", async () => {
    let now = 1_000_000;
    const limiter = new FixedWindowLimiter({ limit: 3, windowSeconds: 60, now: () => now });
    expect(await limiter.limit({ key: "a" })).toEqual({ success: true });
    expect(await limiter.limit({ key: "a" })).toEqual({ success: true });
    expect(await limiter.limit({ key: "a" })).toEqual({ success: true });
    expect(await limiter.limit({ key: "a" })).toEqual({ success: false });
    expect(await limiter.limit({ key: "b" })).toEqual({ success: true });
    now += 60_000;
    expect(await limiter.limit({ key: "a" })).toEqual({ success: true });
  });

  it("parses positive integers with a fallback", () => {
    expect(readPositiveInt(undefined, 60)).toBe(60);
    expect(readPositiveInt("", 60)).toBe(60);
    expect(readPositiveInt("abc", 60)).toBe(60);
    expect(readPositiveInt("0", 60)).toBe(60);
    expect(readPositiveInt(" 12 ", 60)).toBe(12);
  });
});

describe("buildRuntimeEnv", () => {
  it("passes every string env var through and owns DB/KV/RL/STORAGE_BACKEND", async () => {
    const handle = createInMemoryDatabase();
    const db = createD1Database(handle);
    const env = buildRuntimeEnv(
      {
        APP_SHARED_KEY: "shared",
        INGEST_TOKEN: "ingest",
        DISCORD_BOT_TOKEN: "bot",
        SOME_FUTURE_VAR: "kept",
        STORAGE_BACKEND: "kv",
        RL_INGEST_PER_MINUTE: "2",
        RL_REGISTER_PER_MINUTE: "1",
        UNDEFINED_ONE: undefined,
      },
      db,
    );

    expect(env.DB).toBe(db);
    expect(env.KV).toBeUndefined();
    expect(env.STORAGE_BACKEND).toBe("d1");
    expect(env.APP_SHARED_KEY).toBe("shared");
    expect(env.INGEST_TOKEN).toBe("ingest");
    expect(env.DISCORD_BOT_TOKEN).toBe("bot");
    expect(env.SOME_FUTURE_VAR).toBe("kept");
    expect("UNDEFINED_ONE" in env).toBe(false);

    expect(await env.RL_INGEST.limit({ key: "ip" })).toEqual({ success: true });
    expect(await env.RL_INGEST.limit({ key: "ip" })).toEqual({ success: true });
    expect(await env.RL_INGEST.limit({ key: "ip" })).toEqual({ success: false });
    expect(await env.RL_REGISTER.limit({ key: "ip" })).toEqual({ success: true });
    expect(await env.RL_REGISTER.limit({ key: "ip" })).toEqual({ success: false });
    handle.close();
  });

  it("drops ORIGIN_BASE so the embedded worker can never proxy back to rr-api itself", () => {
    const handle = createInMemoryDatabase();
    const env = buildRuntimeEnv(
      { ORIGIN_BASE: "https://origin.test", ORIGIN_KEY: "k", ORIGIN_HOST: "origin.test" },
      createD1Database(handle),
    );
    expect("ORIGIN_BASE" in env).toBe(false);
    expect(env.ORIGIN_KEY).toBe("k");
    expect(env.ORIGIN_HOST).toBe("origin.test");
    handle.close();
  });

  it("defaults the limiters to 60/min ingest and 5/min register", async () => {
    const handle = createInMemoryDatabase();
    const env = buildRuntimeEnv({}, createD1Database(handle));
    for (let index = 0; index < 60; index += 1) {
      expect((await env.RL_INGEST.limit({ key: "k" })).success).toBe(true);
    }
    expect((await env.RL_INGEST.limit({ key: "k" })).success).toBe(false);
    for (let index = 0; index < 5; index += 1) {
      expect((await env.RL_REGISTER.limit({ key: "k" })).success).toBe(true);
    }
    expect((await env.RL_REGISTER.limit({ key: "k" })).success).toBe(false);
    handle.close();
  });
});
