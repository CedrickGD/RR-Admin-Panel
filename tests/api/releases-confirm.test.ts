/**
 * `functions/_lib/release-confirm.ts` — the HMAC confirm tokens §6 and §11 describe, and the
 * server-generated effect list they carry. The invariant this file exists to pin down: a publish
 * or make-current confirm **always** carries exactly one `kind: "discord"` line, whatever the
 * workflow file says or fails to say.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONFIRM_TOKEN_TTL_SECONDS,
  ConfirmEffectsError,
  ConfirmSecretError,
  DISCORD_RELEASE_WORKFLOW_PATH,
  assertDiscordEffect,
  burnConfirmToken,
  discordEffectForMakeCurrent,
  discordEffectForPublish,
  effectsDigest,
  mintConfirmToken,
  resetConfirmTokenStateForTests,
  verifyConfirmToken,
  type WorkflowFileReader,
} from "../../functions/_lib/release-confirm";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { hasDiscordEffect, type ConfirmEffect } from "../../shared/releases-contract";

const ENV: RuntimeEnv = { JWT_SECRET: "panel-test-secret" };
const ACTOR = "owner@example.test";
const NOW = Date.parse("2026-09-18T12:00:00.000Z");
const TTL_MS = CONFIRM_TOKEN_TTL_SECONDS * 1000;

const PUBLISH_DISCORD =
  "Discord: a release post goes to the updates channel and the RIP webhook " +
  "(discord-release.yml, on release published).";

const EFFECTS: ConfirmEffect[] = [
  { kind: "github", text: "GitHub: release v1.5.4 moves from draft to published." },
  { kind: "manifest", text: "update.xml: 1.5.3 → 1.5.4." },
  { kind: "discord", text: PUBLISH_DISCORD },
];

function expectation(overrides: Partial<{ action: never; subject: string; actor: string }> = {}) {
  return { action: "publish" as const, subject: "7", actor: ACTOR, ...overrides };
}

beforeEach(() => {
  resetConfirmTokenStateForTests();
});

afterEach(() => {
  resetConfirmTokenStateForTests();
});

describe("mint and verify", () => {
  it("mints a token the matching expectation verifies, and returns the effects verbatim", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    expect(minted.ok).toBe(true);
    expect(minted.effects).toEqual(EFFECTS);
    expect(minted.expiresAt).toBe(new Date(NOW + TTL_MS).toISOString());

    const verified = await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW + 1_000);
    expect(verified).toEqual({
      ok: true,
      action: "publish",
      subject: "7",
      actor: ACTOR,
      issuedAt: new Date(NOW).toISOString(),
    });
  });

  it("refuses a token minted for another action, subject or actor", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    for (const wrong of [
      { ...expectation(), action: "unpublish" as const },
      expectation({ subject: "8" }),
      expectation({ actor: "admin@example.test" }),
    ]) {
      resetConfirmTokenStateForTests();
      expect(await verifyConfirmToken(ENV, minted.token, wrong, {}, NOW)).toEqual({
        ok: false,
        reason: "mismatch",
      });
    }
  });

  it("refuses a tampered payload and unreadable rubbish", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    const [payload, signature] = minted.token.split(".");
    const forged = `${btoa(
      JSON.stringify({ a: "publish", s: "7", c: ACTOR, i: NOW, n: "n", e: "e" }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${signature}`;

    expect(await verifyConfirmToken(ENV, forged, expectation(), {}, NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(await verifyConfirmToken(ENV, `${payload}.wrong`, expectation(), {}, NOW)).toEqual({
      ok: false,
      reason: "signature",
    });
    for (const rubbish of ["", "no-dot", "!!!.???", `${btoa("not json")}.sig`]) {
      expect(await verifyConfirmToken(ENV, rubbish, expectation(), {}, NOW)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("refuses a token minted under a different secret", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    const other = await verifyConfirmToken(
      { JWT_SECRET: "another-secret" },
      minted.token,
      expectation(),
      {},
      NOW,
    );
    expect(other).toEqual({ ok: false, reason: "signature" });
  });

  it("needs JWT_SECRET on both sides", async () => {
    await expect(
      mintConfirmToken({}, { action: "build", subject: "7", actor: ACTOR, effects: [] }, NOW),
    ).rejects.toBeInstanceOf(ConfirmSecretError);
    expect(await verifyConfirmToken({}, "anything", expectation(), {}, NOW)).toEqual({
      ok: false,
      reason: "no-secret",
    });
  });
});

describe("expiry", () => {
  it("lives for exactly 120 seconds", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    const justInside = await verifyConfirmToken(
      ENV,
      minted.token,
      expectation(),
      { burn: false },
      NOW + TTL_MS - 1,
    );
    expect(justInside.ok).toBe(true);

    expect(await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW + TTL_MS)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(
      await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW + TTL_MS + 60_000),
    ).toEqual({ ok: false, reason: "expired" });
  });
});

describe("single use", () => {
  it("burns the token on a successful verify and refuses the replay", async () => {
    const minted = await mintConfirmToken(
      ENV,
      {
        action: "make-current",
        subject: "4242",
        actor: ACTOR,
        effects: [discordEffectForMakeCurrent()],
      },
      NOW,
    );
    const spec = { action: "make-current" as const, subject: "4242", actor: ACTOR };
    expect((await verifyConfirmToken(ENV, minted.token, spec, {}, NOW)).ok).toBe(true);
    expect(await verifyConfirmToken(ENV, minted.token, spec, {}, NOW + 1)).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("does not burn a token a failed verify rejected", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    // A replayed copy aimed at the wrong subject must not be able to kill the live token.
    expect(
      await verifyConfirmToken(ENV, minted.token, expectation({ subject: "8" }), {}, NOW),
    ).toEqual({
      ok: false,
      reason: "mismatch",
    });
    expect((await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW)).ok).toBe(true);
  });

  it("keeps a publish token usable across a resumed sequence, until it is burnt explicitly", async () => {
    // PublishRequest.confirmToken is re-sent to resume at failedStep, so the publish handler
    // verifies without burning and burns once it records the last step.
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    for (const step of [0, 1, 2]) {
      const verified = await verifyConfirmToken(
        ENV,
        minted.token,
        expectation(),
        { burn: false },
        NOW + step,
      );
      expect(verified.ok).toBe(true);
    }
    burnConfirmToken(minted.token, NOW + 3);
    expect(await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW + 4)).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("is re-mintable: two mints for the same action differ and both verify", async () => {
    const input = { action: "publish" as const, subject: "7", actor: ACTOR, effects: EFFECTS };
    const first = await mintConfirmToken(ENV, input, NOW);
    const second = await mintConfirmToken(ENV, input, NOW);
    expect(second.token).not.toBe(first.token);
    expect((await verifyConfirmToken(ENV, first.token, expectation(), {}, NOW)).ok).toBe(true);
    expect((await verifyConfirmToken(ENV, second.token, expectation(), {}, NOW)).ok).toBe(true);
  });

  it("forgets a burnt token once it could not have been valid anyway", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    expect((await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW)).ok).toBe(true);
    // Past the TTL the clock refuses it, so the burnt set no longer has to remember it.
    expect(await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW + TTL_MS)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("the effects the token carries", () => {
  it("accepts a recomputed list that still digests the same", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    const verified = await verifyConfirmToken(
      ENV,
      minted.token,
      { ...expectation(), expectedEffects: [...EFFECTS] },
      {},
      NOW,
    );
    expect(verified.ok).toBe(true);
  });

  it("reports a changed or reordered effect list, and does not burn the token for it", async () => {
    const minted = await mintConfirmToken(
      ENV,
      { action: "publish", subject: "7", actor: ACTOR, effects: EFFECTS },
      NOW,
    );
    const changed = [
      EFFECTS[0]!,
      { kind: "manifest" as const, text: "update.xml: 1.5.2 → 1.5.4." },
      EFFECTS[2]!,
    ];
    expect(
      await verifyConfirmToken(
        ENV,
        minted.token,
        { ...expectation(), expectedEffects: changed },
        {},
        NOW,
      ),
    ).toEqual({ ok: false, reason: "effects-changed" });

    const reordered = [EFFECTS[2]!, EFFECTS[1]!, EFFECTS[0]!];
    expect(
      await verifyConfirmToken(
        ENV,
        minted.token,
        { ...expectation(), expectedEffects: reordered },
        {},
        NOW,
      ),
    ).toEqual({ ok: false, reason: "effects-changed" });

    expect((await verifyConfirmToken(ENV, minted.token, expectation(), {}, NOW)).ok).toBe(true);
  });

  it("digests kind and text together, so a line that only moved kind is a different list", async () => {
    const a = await effectsDigest([{ kind: "note", text: "x" }]);
    const b = await effectsDigest([{ kind: "discord", text: "x" }]);
    expect(a).not.toBe(b);
    expect(await effectsDigest([{ kind: "note", text: "x" }])).toBe(a);
  });
});

describe("the Discord invariant", () => {
  /** The shape the client repo's discord-release.yml carries today. */
  const WIRED = `name: Discord Notify

on:
  push:
    branches:
      - master
  release:
    types:
      - published
      - prereleased

jobs:
  notify:
    if: \${{ github.event_name != 'release' || github.event.release.tag_name != 'v1.5.0' }}
    runs-on: ubuntu-latest
    steps:
      - name: Send Discord notification
        run: |
          # release: types: [deleted]
          content="- a bullet that is not YAML"
`;

  function reader(content: string | null, options: { throws?: boolean } = {}): WorkflowFileReader {
    return {
      async getContent(path: string) {
        expect(path).toBe(DISCORD_RELEASE_WORKFLOW_PATH);
        if (options.throws) throw new Error("GitHub is unreachable.");
        return content === null ? null : { path, sha: "blob1", size: content.length, content };
      },
    };
  }

  it("promises the post while the workflow is wired", async () => {
    const effect = await discordEffectForPublish(reader(WIRED), "v1.5.4");
    expect(effect).toEqual({ kind: "discord", text: PUBLISH_DISCORD });
  });

  it("reflects the live tag guard for that tag only", async () => {
    expect((await discordEffectForPublish(reader(WIRED), "v1.5.0")).text).toBe(
      "Discord: nothing is posted for v1.5.0 — discord-release.yml skips that tag (tag_name != 'v1.5.0').",
    );
    expect((await discordEffectForPublish(reader(WIRED), "v1.5.1")).text).toBe(PUBLISH_DISCORD);
  });

  it("says nothing is posted once the release trigger is gone", async () => {
    const unwired = "on:\n  push:\n    branches:\n      - master\n";
    expect((await discordEffectForPublish(reader(unwired), "v1.5.4")).text).toBe(
      "Discord: nothing is posted — discord-release.yml no longer runs on a release event.",
    );
  });

  it("warns anyway when the workflow cannot be read — a surprise post is the worse outcome", async () => {
    for (const unreadable of [reader(null), reader(null, { throws: true })]) {
      const effect = await discordEffectForPublish(unreadable, "v1.5.4");
      expect(effect).toEqual({ kind: "discord", text: PUBLISH_DISCORD });
    }
  });

  it("is a discord effect in every branch, which is what makes the invariant hold", async () => {
    const readers = [reader(WIRED), reader(null), reader("on:\n  push:\n")];
    for (const each of readers) {
      for (const tag of ["v1.5.0", "v1.5.4"]) {
        expect(hasDiscordEffect([await discordEffectForPublish(each, tag)])).toBe(true);
      }
    }
  });

  it("tells make-current that nothing is posted", () => {
    expect(discordEffectForMakeCurrent()).toEqual({
      kind: "discord",
      text: "Discord: nothing is posted — update.xml only.",
    });
  });

  it("refuses to mint a publish or make-current confirm without the line", async () => {
    const naked = [{ kind: "github" as const, text: "GitHub: release v1.5.4 is published." }];
    for (const action of ["publish", "make-current"] as const) {
      await expect(
        mintConfirmToken(ENV, { action, subject: "7", actor: ACTOR, effects: naked }, NOW),
      ).rejects.toBeInstanceOf(ConfirmEffectsError);
      expect(() => assertDiscordEffect(action, naked)).toThrow(/discord effect/);
    }
  });

  it("does not demand the line from the actions that fire no release event", async () => {
    for (const action of ["build", "commit", "dispatch", "unpublish"] as const) {
      expect(() => assertDiscordEffect(action, [])).not.toThrow();
      const minted = await mintConfirmToken(
        ENV,
        { action, subject: "7", actor: ACTOR, effects: [] },
        NOW,
      );
      expect(minted.effects).toEqual([]);
    }
  });
});
