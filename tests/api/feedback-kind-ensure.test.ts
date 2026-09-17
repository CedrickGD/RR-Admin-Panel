import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applySchema,
  locateSchemaFile,
  splitSqlStatements,
} from "../../deploy/nas/rr-api/src/bootstrap";
import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import { ensureFeedbackSchema, loadFeedbackUnread } from "../../functions/_lib/content";
import { ensureFeedbackDiagnosticsSchema } from "../../functions/_lib/feedback-diagnostics";
import { FEEDBACK_REPLIES_DDL } from "../../functions/_lib/feedback-replies";
import type { D1Database, D1PreparedStatement } from "../../functions/_lib/types";

const MARKER = "2026-09-17-feedback-kind";
const SCHEMA = readFileSync(locateSchemaFile()!, "utf8");
const MIGRATION = readFileSync(
  new URL("../../tools/migrations/2026-09-17-feedback-kind.sql", import.meta.url),
  "utf8",
);

/** schema.sql as it was before the kind column: no column, no kind index. */
const KIND_COLUMN = /^\s*kind TEXT NOT NULL DEFAULT 'feedback'/;
const KIND_INDEX = /idx_feedback_kind_status/;
const MARKER_TABLE = /CREATE TABLE IF NOT EXISTS schema_markers \([^;]*\);\n/;
function schemaWithout(...lines: RegExp[]): string {
  return SCHEMA.split("\n")
    .filter((line) => !lines.some((pattern) => pattern.test(line)))
    .join("\n");
}
const SCHEMA_BEFORE_KIND = schemaWithout(KIND_COLUMN, KIND_INDEX).replace(MARKER_TABLE, "");
/** The column is there, but nothing recorded the backfill: the pre-marker ensure did it. */
const SCHEMA_WITHOUT_MARKER_TABLE = SCHEMA.replace(MARKER_TABLE, "");

function columns(handle: SqliteDatabaseHandle, table: string): string[] {
  return (handle.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
}
function indexes(handle: SqliteDatabaseHandle): string[] {
  return (
    handle.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((row) => row.name);
}
function kinds(handle: SqliteDatabaseHandle): [number, string][] {
  return (handle.prepare("SELECT id, kind FROM feedback ORDER BY id").all() as any[]).map((row) => [
    row.id,
    row.kind,
  ]);
}
function marker(handle: SqliteDatabaseHandle): { applied_at: string } | undefined {
  try {
    return handle.prepare("SELECT applied_at FROM schema_markers WHERE key = ?").get(MARKER) as
      | { applied_at: string }
      | undefined;
  } catch {
    return undefined;
  }
}
function schemaDump(handle: SqliteDatabaseHandle) {
  return handle.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
}
function addSnapshot(handle: SqliteDatabaseHandle, feedbackId: number, at: string) {
  handle
    .prepare(
      "INSERT INTO feedback_diagnostics(feedback_id, schema_version, generated_at, consent, received_at) VALUES(?, 1, ?, 1, ?)",
    )
    .run(feedbackId, at, at);
}
/** Rows 1 and 3 came with a diagnostics snapshot, row 2 did not. */
function seed(handle: SqliteDatabaseHandle) {
  const insert = handle.prepare(
    "INSERT INTO feedback(message, status, created_at) VALUES(?, ?, ?)",
  );
  insert.run("with snapshot", "new", "2026-09-01T00:00:00.000Z");
  insert.run("plain", "new", "2026-09-02T00:00:00.000Z");
  insert.run("with snapshot, archived", "archived", "2026-09-03T00:00:00.000Z");
  addSnapshot(handle, 1, "2026-09-01T00:00:00.000Z");
  addSnapshot(handle, 3, "2026-09-03T00:00:00.000Z");
}
function database(schema: string): SqliteDatabaseHandle {
  const handle = createInMemoryDatabase();
  applySchema(handle, schema);
  seed(handle);
  return handle;
}
const ensure = (handle: SqliteDatabaseHandle) =>
  ensureFeedbackSchema({ DB: createD1Database(handle) });

/** A binding whose first statement matching `pattern` fails, like a dropped D1 request would. */
function failingOnce(handle: SqliteDatabaseHandle, pattern: RegExp): D1Database {
  const real = createD1Database(handle);
  let armed = true;
  const boom = async () => {
    throw new Error("boom");
  };
  const broken = { run: boom, first: boom, all: boom } as unknown as D1PreparedStatement;
  Object.assign(broken, { bind: () => broken });
  return {
    prepare(sql: string) {
      if (armed && pattern.test(sql)) {
        armed = false;
        return broken;
      }
      return real.prepare(sql);
    },
    batch: (statements) => real.batch(statements),
  };
}

describe("ensureFeedbackSchema kind backfill marker", () => {
  it("adds the column to a database from before the field, backfills once and records it", async () => {
    const handle = database(SCHEMA_BEFORE_KIND);
    expect(columns(handle, "feedback")).not.toContain("kind");
    expect(marker(handle)).toBeUndefined();

    await ensure(handle);
    expect(columns(handle, "feedback").filter((c) => c === "kind")).toHaveLength(1);
    expect(indexes(handle)).toContain("idx_feedback_kind_status");
    expect(kinds(handle)).toEqual([
      [1, "support"],
      [2, "feedback"],
      [3, "support"],
    ]);
    expect(marker(handle)?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(() => handle.prepare("UPDATE feedback SET kind='bogus' WHERE id=1").run()).toThrow(
      /CHECK/,
    );
    const after = schemaDump(handle);

    // Same binding twice (the cached promise), fresh bindings (the ALTER hits duplicate column),
    // and two at once: nothing changes any more.
    const same = createD1Database(handle);
    await ensureFeedbackSchema({ DB: same });
    await ensureFeedbackSchema({ DB: same });
    await Promise.all([ensure(handle), ensure(handle)]);
    expect(schemaDump(handle)).toEqual(after);
    expect(await loadFeedbackUnread(createD1Database(handle))).toEqual({
      feedback: 1,
      support: 1,
      total: 2,
    });
    handle.close();
  });

  it("does not run the backfill again once the marker is there", async () => {
    const handle = database(SCHEMA_BEFORE_KIND);
    await ensure(handle);
    const applied = marker(handle)!.applied_at;

    // A snapshot that arrives later for a feedback row, and a support row moved to feedback:
    // both are exactly what the one-time backfill would flip.
    addSnapshot(handle, 2, "2026-09-04T00:00:00.000Z");
    handle.prepare("UPDATE feedback SET kind='feedback' WHERE id=3").run();
    await ensure(handle);
    await Promise.all([ensure(handle), ensure(handle)]);
    expect(kinds(handle)).toEqual([
      [1, "support"],
      [2, "feedback"],
      [3, "feedback"],
    ]);
    expect(marker(handle)!.applied_at).toBe(applied);
    handle.close();
  });

  it.each([
    ["schema.sql as-is (an empty marker table)", SCHEMA],
    [
      "no marker table at all (the pre-marker ensure added the column)",
      SCHEMA_WITHOUT_MARKER_TABLE,
    ],
  ])("column present without a marker: backfills once — %s", async (_state, schema) => {
    const handle = database(schema);
    expect(columns(handle, "feedback")).toContain("kind");
    // Explicitly filed as support without a snapshot: the backfill never touches it either way.
    handle.prepare("UPDATE feedback SET kind='support' WHERE id=2").run();
    expect(marker(handle)).toBeUndefined();

    await ensure(handle);
    expect(kinds(handle)).toEqual([
      [1, "support"],
      [2, "support"],
      [3, "support"],
    ]);
    expect(marker(handle)).toBeDefined();

    handle.prepare("UPDATE feedback SET kind='feedback' WHERE id=3").run();
    await ensure(handle);
    expect(kinds(handle)).toEqual([
      [1, "support"],
      [2, "support"],
      [3, "feedback"],
    ]);
    handle.close();
  });

  it.each([
    ["backfill", /UPDATE feedback SET kind/],
    ["index", /CREATE INDEX IF NOT EXISTS idx_feedback_kind_status/],
  ])(
    "ALTER went through but the %s failed: the call fails and the next one backfills",
    async (_step, pattern) => {
      const handle = database(SCHEMA_BEFORE_KIND);
      const flaky = failingOnce(handle, pattern);
      await expect(ensureFeedbackSchema({ DB: flaky })).rejects.toThrow("boom");
      expect(columns(handle, "feedback")).toContain("kind");
      expect(kinds(handle)).toEqual([
        [1, "feedback"],
        [2, "feedback"],
        [3, "feedback"],
      ]);
      expect(marker(handle)).toBeUndefined();

      // The same binding retries (no poisoned cache) and now hits the duplicate-column path.
      await ensureFeedbackSchema({ DB: flaky });
      expect(indexes(handle)).toContain("idx_feedback_kind_status");
      expect(kinds(handle)).toEqual([
        [1, "support"],
        [2, "feedback"],
        [3, "support"],
      ]);
      expect(marker(handle)).toBeDefined();
      handle.close();
    },
  );

  it("creates the table with the column and the marker on a database with no tables at all", async () => {
    const handle = createInMemoryDatabase();
    await ensure(handle);
    expect(columns(handle, "feedback")).toContain("kind");
    expect(indexes(handle)).toEqual(
      expect.arrayContaining(["idx_feedback_status", "idx_feedback_kind_status"]),
    );
    expect(marker(handle)).toBeDefined();
    // The diagnostics and replies DDL after it: the FK to feedback(id) works.
    const db = createD1Database(handle);
    await ensureFeedbackDiagnosticsSchema(db);
    await db.batch(FEEDBACK_REPLIES_DDL.map((sql) => db.prepare(sql)));
    await ensure(handle);
    expect(columns(handle, "feedback").filter((c) => c === "kind")).toHaveLength(1);
    handle.close();
  });

  it("records the marker on a database that never saw a diagnostics table", async () => {
    const handle = createInMemoryDatabase();
    handle.exec(`CREATE TABLE feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, message TEXT NOT NULL, contact TEXT, hwid TEXT,
      install_id TEXT, license_key TEXT, machine_name TEXT, app_version TEXT, platform TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived')),
      created_at TEXT NOT NULL)`);
    handle
      .prepare("INSERT INTO feedback(message, created_at) VALUES(?, ?)")
      .run("legacy", "2026-09-01T00:00:00.000Z");
    await ensure(handle);
    expect(kinds(handle)).toEqual([[1, "feedback"]]);
    expect(marker(handle)).toBeDefined();
    await ensure(handle);
    handle.close();
  });
});

describe("tools/migrations/2026-09-17-feedback-kind.sql", () => {
  const withoutAlter = splitSqlStatements(MIGRATION).filter(
    (statement) => !/^ALTER TABLE/i.test(statement),
  );
  function applyTail(handle: SqliteDatabaseHandle) {
    for (const statement of withoutAlter) handle.exec(statement);
  }

  it("migrates a database the app never touched, and the app finds nothing left to do", async () => {
    const handle = database(SCHEMA_BEFORE_KIND);
    applySchema(handle, MIGRATION);
    expect(columns(handle, "feedback")).toContain("kind");
    expect(indexes(handle)).toContain("idx_feedback_kind_status");
    expect(kinds(handle)).toEqual([
      [1, "support"],
      [2, "feedback"],
      [3, "support"],
    ]);
    expect(marker(handle)).toBeDefined();

    handle.prepare("UPDATE feedback SET kind='feedback' WHERE id=3").run();
    await ensure(handle);
    expect(kinds(handle)).toEqual([
      [1, "support"],
      [2, "feedback"],
      [3, "feedback"],
    ]);
    handle.close();
  });

  it("aborts at the ALTER on a migrated database, and the documented tail is a safe no-op", async () => {
    const handle = database(SCHEMA_BEFORE_KIND);
    await ensure(handle);
    handle.prepare("UPDATE feedback SET kind='feedback' WHERE id=3").run();
    const before = { schema: schemaDump(handle), kinds: kinds(handle), marker: marker(handle) };

    // The whole file: wrangler stops at the ALTER; applySchema's transaction rolls it back.
    expect(() => applySchema(handle, MIGRATION)).toThrow(/duplicate column name/);
    // Everything after the ALTER: idempotent, and the marker keeps the backfill from re-sorting.
    applyTail(handle);
    applyTail(handle);
    expect({ schema: schemaDump(handle), kinds: kinds(handle), marker: marker(handle) }).toEqual(
      before,
    );
    handle.close();
  });

  it.each([
    ["schema.sql as-is", SCHEMA],
    ["no marker table (the pre-marker ensure added the column)", SCHEMA_WITHOUT_MARKER_TABLE],
  ])(
    "the tail backfills once on a database with the column but no marker — %s",
    (_state, schema) => {
      const handle = database(schema);
      applyTail(handle);
      expect(kinds(handle)).toEqual([
        [1, "support"],
        [2, "feedback"],
        [3, "support"],
      ]);
      expect(marker(handle)).toBeDefined();
      handle.prepare("UPDATE feedback SET kind='feedback' WHERE id=3").run();
      applyTail(handle);
      expect(kinds(handle)).toEqual([
        [1, "support"],
        [2, "feedback"],
        [3, "feedback"],
      ]);
      handle.close();
    },
  );
});
