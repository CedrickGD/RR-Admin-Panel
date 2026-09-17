import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applySchema } from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import {
  appendEvent,
  createDraft,
  deleteDraft,
  ensureReleasesSchema,
  getDraft,
  getDraftByTag,
  listDrafts,
  listEvents,
  RELEASES_SCHEMA_MARKER,
  updateDraft,
} from "../../functions/_lib/releases-store";
import type { D1Database } from "../../functions/_lib/types";
import type { ReleaseDraft } from "../../shared/releases-contract";

const MIGRATION = readFileSync(
  new URL("../../tools/migrations/2026-09-18-release-drafts.sql", import.meta.url),
  "utf8",
);
const OWNER = "owner@example.test";

function fresh(): { handle: SqliteDatabaseHandle; db: D1Database } {
  const handle = createInMemoryDatabase();
  return { handle, db: createD1Database(handle) };
}
async function ready(): Promise<{ handle: SqliteDatabaseHandle; db: D1Database }> {
  const open = fresh();
  await ensureReleasesSchema({ DB: open.db });
  return open;
}
function schemaDump(handle: SqliteDatabaseHandle) {
  return handle.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
}
function marker(handle: SqliteDatabaseHandle): { applied_at: string } | undefined {
  try {
    return handle
      .prepare("SELECT applied_at FROM schema_markers WHERE key = ?")
      .get(RELEASES_SCHEMA_MARKER) as { applied_at: string } | undefined;
  } catch {
    return undefined;
  }
}
/** The one helper that unwraps a result: every assertion below wants the draft or the reason. */
function draftOf(result: { ok: boolean; draft?: ReleaseDraft }): ReleaseDraft {
  expect(result.ok).toBe(true);
  return result.draft!;
}

describe("ensureReleasesSchema", () => {
  it("creates both tables, their indexes and the marker on an empty database", async () => {
    const { handle, db } = await ready();
    const names = (schemaDump(handle) as { name: string }[]).map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "release_drafts",
        "release_events",
        "schema_markers",
        "idx_release_drafts_tag",
        "idx_release_events_draft",
      ]),
    );
    expect(marker(handle)?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The CHECK the design writes: nothing may park a draft in an unknown state.
    const created = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    expect(() =>
      handle.prepare("UPDATE release_drafts SET status='bogus' WHERE id=?").run(created.id),
    ).toThrow(/CHECK/);
    handle.close();
  });

  it("is a no-op on the second call, on a fresh binding and when two run at once", async () => {
    const { handle, db } = await ready();
    await createDraft(db, { version: "1.5.4" }, OWNER);
    const after = schemaDump(handle);
    const applied = marker(handle)!.applied_at;

    await ensureReleasesSchema({ DB: db });
    await ensureReleasesSchema({ DB: createD1Database(handle) });
    await Promise.all([
      ensureReleasesSchema({ DB: createD1Database(handle) }),
      ensureReleasesSchema({ DB: createD1Database(handle) }),
    ]);
    expect(schemaDump(handle)).toEqual(after);
    expect(marker(handle)!.applied_at).toBe(applied);
    expect(await listDrafts(db)).toHaveLength(1);
    handle.close();
  });

  it("refuses a database with no DB binding rather than writing nowhere", async () => {
    await expect(ensureReleasesSchema({})).rejects.toThrow(/DB is required/);
  });

  it("does not poison its per-database cache when the DDL fails", async () => {
    const { handle } = fresh();
    const real = createD1Database(handle);
    let armed = true;
    const flaky: D1Database = {
      prepare(sql: string) {
        if (armed && /CREATE INDEX IF NOT EXISTS idx_release_events_draft/.test(sql)) {
          armed = false;
          const boom = async () => {
            throw new Error("boom");
          };
          const broken = { run: boom, first: boom, all: boom };
          return Object.assign(broken, { bind: () => broken }) as never;
        }
        return real.prepare(sql);
      },
      batch: (statements) => real.batch(statements),
    };
    await expect(ensureReleasesSchema({ DB: flaky })).rejects.toThrow("boom");
    expect(marker(handle)).toBeUndefined();
    // The same binding retries and finishes: the DDL is idempotent all the way down.
    await ensureReleasesSchema({ DB: flaky });
    expect(marker(handle)).toBeDefined();
    handle.close();
  });
});

describe("createDraft", () => {
  it("fills in the design's defaults and normalises version and tag", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "v1.5.4" }, OWNER));
    expect(draft).toMatchObject({
      version: "1.5.4",
      tag: "v1.5.4",
      title: "RazorReaper 1.5.4",
      commitMessage: "release: 1.5.4",
      notesCustomer: "",
      notesFullMd: "",
      mandatory: false,
      prerelease: false,
      status: "draft",
      githubReleaseId: null,
      githubRunId: null,
      assetName: null,
      assetSize: null,
      createdBy: OWNER,
      publishedAt: null,
    });
    expect(draft.createdAt).toBe(draft.updatedAt);
    handle.close();
  });

  it("keeps the fields the caller did supply", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(
      await createDraft(
        db,
        {
          version: "1.6.0",
          tag: "1.6.0",
          title: "RazorReaper 1.6",
          notesCustomer: "The first conversion downloads ffmpeg.",
          notesFullMd: "## 1.6.0\n\nffmpeg is downloaded on first use.",
          commitMessage: "release: the big one",
          mandatory: true,
          prerelease: true,
        },
        OWNER,
      ),
    );
    expect(draft).toMatchObject({
      tag: "v1.6.0",
      title: "RazorReaper 1.6",
      commitMessage: "release: the big one",
      mandatory: true,
      prerelease: true,
    });
    handle.close();
  });

  it("refuses a tag another draft already holds, however it is spelled", async () => {
    const { handle, db } = await ready();
    await createDraft(db, { version: "1.5.4" }, OWNER);
    expect(await createDraft(db, { version: "1.5.4" }, OWNER)).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(await createDraft(db, { version: "1.5.4", tag: "v1.5.4" }, OWNER)).toEqual({
      ok: false,
      reason: "duplicate",
    });
    // Two creates that both pass the pre-check: the unique index is the guard that holds.
    const [first, second] = await Promise.all([
      createDraft(db, { version: "1.7.0" }, OWNER),
      createDraft(db, { version: "1.7.0" }, OWNER),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(await listDrafts(db)).toHaveLength(2);
    handle.close();
  });
});

describe("reading drafts", () => {
  it("lists newest first and finds one by id or tag", async () => {
    const { handle, db } = await ready();
    const older = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    const newer = draftOf(await createDraft(db, { version: "1.5.5" }, OWNER));
    expect((await listDrafts(db)).map((d) => d.tag)).toEqual(["v1.5.5", "v1.5.4"]);
    expect(await getDraft(db, older.id)).toEqual(older);
    expect((await getDraftByTag(db, "1.5.5"))?.id).toBe(newer.id);
    expect((await getDraftByTag(db, "v1.5.5"))?.id).toBe(newer.id);
    expect(await getDraft(db, 9999)).toBeNull();
    expect(await getDraftByTag(db, "v9.9.9")).toBeNull();
    handle.close();
  });
});

describe("updateDraft", () => {
  it("writes only the fields it is given and moves updated_at", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    const saved = draftOf(
      await updateDraft(db, draft.id, { notesCustomer: "One bullet", mandatory: true }),
    );
    expect(saved).toMatchObject({
      notesCustomer: "One bullet",
      mandatory: true,
      title: "RazorReaper 1.5.4",
      status: "draft",
    });
    expect(saved.updatedAt > draft.updatedAt).toBe(true);
    expect(saved.createdAt).toBe(draft.createdAt);
    handle.close();
  });

  it("advances updated_at even when two saves land in the same millisecond", async () => {
    const { handle, db } = await ready();
    const at = "2026-09-18T10:00:00.000Z";
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER, at));
    const first = draftOf(await updateDraft(db, draft.id, { title: "A" }, {}, at));
    const second = draftOf(await updateDraft(db, draft.id, { title: "B" }, {}, at));
    // Without this the second editor's expectedUpdatedAt would match a row it never saw.
    expect(new Set([draft.updatedAt, first.updatedAt, second.updatedAt]).size).toBe(3);
    expect(first.updatedAt > draft.updatedAt).toBe(true);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    handle.close();
  });

  it("refuses a stale expectedUpdatedAt and hands back the row as it stands", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    const saved = draftOf(await updateDraft(db, draft.id, { title: "Saved by the other tab" }));

    const result = await updateDraft(db, draft.id, {
      title: "Saved by this tab",
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(result).toEqual({ ok: false, reason: "stale", draft: saved });
    expect((await getDraft(db, draft.id))?.title).toBe("Saved by the other tab");
    // With the timestamp the editor now holds it goes through.
    expect(
      draftOf(
        await updateDraft(db, draft.id, {
          title: "Saved by this tab",
          expectedUpdatedAt: saved.updatedAt,
        }),
      ).title,
    ).toBe("Saved by this tab");
    handle.close();
  });

  it("refuses a published draft to the editor and allows publish's own last step", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    const published = draftOf(
      await updateDraft(
        db,
        draft.id,
        { status: "published", publishedAt: "2026-09-18T12:00:00.000Z", githubReleaseId: 821 },
        { allowPublished: true },
      ),
    );
    expect(published).toMatchObject({
      status: "published",
      publishedAt: "2026-09-18T12:00:00.000Z",
      githubReleaseId: 821,
    });

    const refused = await updateDraft(db, draft.id, { notesCustomer: "too late" });
    expect(refused).toEqual({ ok: false, reason: "published", draft: published });
    expect((await getDraft(db, draft.id))?.notesCustomer).toBe("");
    // A resumed publish still writes to it.
    expect(
      draftOf(
        await updateDraft(
          db,
          draft.id,
          { assetName: "RazorReaper-Setup.exe" },
          { allowPublished: true },
        ),
      ).assetName,
    ).toBe("RazorReaper-Setup.exe");
    handle.close();
  });

  it("refuses a tag another draft already holds, and a row that is gone", async () => {
    const { handle, db } = await ready();
    const first = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    const second = draftOf(await createDraft(db, { version: "1.5.5" }, OWNER));
    const result = await updateDraft(db, second.id, { tag: "v1.5.4" });
    expect(result).toEqual({ ok: false, reason: "duplicate", draft: second });
    expect((await getDraft(db, second.id))?.tag).toBe("v1.5.5");
    expect((await getDraft(db, first.id))?.tag).toBe("v1.5.4");
    expect(await updateDraft(db, 9999, { title: "nobody" })).toEqual({
      ok: false,
      reason: "not-found",
    });
    handle.close();
  });

  it("rejects a status the schema would not accept before it reaches the database", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    await expect(updateDraft(db, draft.id, { status: "shipping" as never })).rejects.toThrow(
      /Unknown release draft status/,
    );
    expect((await getDraft(db, draft.id))?.status).toBe("draft");
    handle.close();
  });
});

describe("deleteDraft", () => {
  it("drops a draft or a failed one and leaves its timeline in place", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    await appendEvent(db, { draftId: draft.id, kind: "draft_created", actor: OWNER });

    expect(draftOf(await deleteDraft(db, draft.id)).tag).toBe("v1.5.4");
    expect(await getDraft(db, draft.id)).toBeNull();
    expect(await listEvents(db, { draftId: draft.id })).toHaveLength(1);
    expect(await deleteDraft(db, draft.id)).toEqual({ ok: false, reason: "not-found" });

    const failed = draftOf(await createDraft(db, { version: "1.5.5" }, OWNER));
    await updateDraft(db, failed.id, { status: "failed" });
    expect((await deleteDraft(db, failed.id)).ok).toBe(true);
    handle.close();
  });

  it("refuses a draft that is building, built or published", async () => {
    const { handle, db } = await ready();
    for (const status of ["building", "built", "published"] as const) {
      const draft = draftOf(await createDraft(db, { version: `1.5.${status.length}` }, OWNER));
      await updateDraft(db, draft.id, { status }, { allowPublished: true });
      const result = await deleteDraft(db, draft.id);
      expect([status, result.ok]).toEqual([status, false]);
      expect(result.ok === false && result.reason).toBe("not-deletable");
      expect(await getDraft(db, draft.id)).not.toBeNull();
    }
    handle.close();
  });
});

describe("release events", () => {
  it("records a draft's timeline newest first", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    const created = await appendEvent(db, {
      draftId: draft.id,
      kind: "draft_created",
      actor: OWNER,
      detail: "v1.5.4",
    });
    await appendEvent(db, { draftId: draft.id, kind: "version_bumped", actor: OWNER });
    await appendEvent(db, { draftId: draft.id, kind: "build_dispatched", actor: OWNER });

    expect(created.id).toBeGreaterThan(0);
    expect(created).toMatchObject({ draftId: draft.id, kind: "draft_created", detail: "v1.5.4" });
    const events = await listEvents(db, { draftId: draft.id });
    expect(events.map((e) => e.kind)).toEqual([
      "build_dispatched",
      "version_bumped",
      "draft_created",
    ]);
    expect(events.at(-1)).toEqual(created);
    handle.close();
  });

  it("separates a draft's rows from the repo-wide ones, and lists both when asked for neither", async () => {
    const { handle, db } = await ready();
    const draft = draftOf(await createDraft(db, { version: "1.5.4" }, OWNER));
    await appendEvent(db, { draftId: draft.id, kind: "published", actor: OWNER });
    // A Files-tab commit belongs to no release.
    await appendEvent(db, { kind: "file_committed", actor: OWNER, detail: "README.md" });
    await appendEvent(db, { draftId: null, kind: "workflow_dispatched", actor: OWNER });

    expect((await listEvents(db, { draftId: draft.id })).map((e) => e.kind)).toEqual(["published"]);
    expect((await listEvents(db, { draftId: null })).map((e) => e.kind)).toEqual([
      "workflow_dispatched",
      "file_committed",
    ]);
    expect(await listEvents(db)).toHaveLength(3);
    expect((await listEvents(db, { draftId: 9999 })).length).toBe(0);
    handle.close();
  });

  it("caps how much of a timeline one call returns", async () => {
    const { handle, db } = await ready();
    for (let i = 0; i < 12; i += 1)
      await appendEvent(db, { draftId: 1, kind: "error", actor: OWNER, detail: `#${i}` });
    expect(await listEvents(db, { draftId: 1, limit: 5 })).toHaveLength(5);
    expect((await listEvents(db, { draftId: 1, limit: 5 }))[0].detail).toBe("#11");
    // Out-of-range limits are clamped, never passed through to SQL.
    expect(await listEvents(db, { draftId: 1, limit: 0 })).toHaveLength(1);
    expect(await listEvents(db, { draftId: 1, limit: 10_000 })).toHaveLength(12);
    handle.close();
  });
});

describe("tools/migrations/2026-09-18-release-drafts.sql", () => {
  it("builds the same schema the app's ensure does, and the app then finds nothing to do", async () => {
    const migrated = fresh();
    applySchema(migrated.handle, MIGRATION);
    const ensured = await ready();

    // sqlite_master keeps the statement verbatim, so the two differ only in indentation:
    // compare the SQL with its whitespace collapsed, and the columns through the pragma.
    const strip = (rows: unknown[]) =>
      (rows as { name: string; sql: string | null }[])
        .filter((row) => !row.name.startsWith("sqlite_"))
        .map((row) => ({ name: row.name, sql: row.sql?.replace(/\s+/g, " ").trim() ?? null }));
    expect(strip(schemaDump(migrated.handle))).toEqual(strip(schemaDump(ensured.handle)));
    for (const table of ["release_drafts", "release_events", "schema_markers"])
      expect(migrated.handle.pragma(`table_info(${table})`)).toEqual(
        ensured.handle.pragma(`table_info(${table})`),
      );
    expect(marker(migrated.handle)?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const before = schemaDump(migrated.handle);
    await ensureReleasesSchema({ DB: migrated.db });
    expect(schemaDump(migrated.handle)).toEqual(before);
    expect(draftOf(await createDraft(migrated.db, { version: "1.5.4" }, OWNER)).tag).toBe("v1.5.4");
    migrated.handle.close();
    ensured.handle.close();
  });

  it("is safe to run twice, and over a database the app already set up", async () => {
    const { handle, db } = await ready();
    await createDraft(db, { version: "1.5.4" }, OWNER);
    await appendEvent(db, { draftId: 1, kind: "draft_created", actor: OWNER });
    const before = {
      schema: schemaDump(handle),
      drafts: (await listDrafts(db)).map((d) => d.tag),
      events: (await listEvents(db)).length,
      marker: marker(handle),
    };

    applySchema(handle, MIGRATION);
    applySchema(handle, MIGRATION);
    expect({
      schema: schemaDump(handle),
      drafts: (await listDrafts(db)).map((d) => d.tag),
      events: (await listEvents(db)).length,
      marker: marker(handle),
    }).toEqual(before);
    handle.close();
  });
});
