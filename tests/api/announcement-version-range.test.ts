/**
 * Announcement version targeting — docs/release-management-design.md §10.
 *
 * What this suite exists to pin down:
 *  - `versionInRange` orders the shapes that actually reach it: the 3-part number an operator
 *    types and `AppVersionInfo.VersionString` sends, the 4-part shape `update.xml` carries, and
 *    the legacy strings older builds report ("v1.4.8", "1.4").
 *  - `ensureAnnouncementsSchema` adds both columns to a database that already has the table, and
 *    is a no-op on every call after that — including a fresh binding, where the ALTER throws
 *    "duplicate column name" and that *is* the success case.
 *  - The admin routes round-trip the bounds and refuse one that `compareVersions` cannot order,
 *    because a silently nulled bound changes who is shown the banner.
 *  - **No `v` matches everything**, exactly as today: the 272 installs on 1.4.8 and older never
 *    send the parameter and must not lose the announcements they already see.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { createAppSessionToken } from "../../functions/_lib/auth";
import { ensureAnnouncementsSchema } from "../../functions/_lib/content";
import { resetRateLimitsForTests } from "../../functions/_lib/ratelimit";
import type { RuntimeEnv } from "../../functions/_lib/types";
import { createUser, ensureAuthSchema } from "../../functions/_lib/users";
import {
  onRequestGet as listAnnouncements,
  onRequestPost as createAnnouncement,
} from "../../functions/api/admin/announcements/index";
import { onRequestPut as updateAnnouncement } from "../../functions/api/admin/announcements/[id]/index";
import { onRequestGet as activeAnnouncements } from "../../functions/api/announcements/active";
import { versionInRange } from "../../shared/releases-contract";

const origin = "https://panel.test";
const MARKER = "2026-09-18-announcement-version-range";
const SCHEMA = readFileSync(locateSchemaFile()!, "utf8");
const MIGRATION = readFileSync(
  new URL("../../tools/migrations/2026-09-18-announcement-version-range.sql", import.meta.url),
  "utf8",
);

/** schema.sql as it was before targeting: the announcements table without the two bounds. */
const SCHEMA_BEFORE_RANGE = SCHEMA.split("\n")
  .filter((line) => !/^\s*(min|max)_version TEXT,/.test(line))
  .join("\n");

let handle: SqliteDatabaseHandle;
let env: RuntimeEnv;
let adminToken: string;

function columns(db: SqliteDatabaseHandle, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
}
function marker(db: SqliteDatabaseHandle): { applied_at: string } | undefined {
  try {
    return db.prepare("SELECT applied_at FROM schema_markers WHERE key = ?").get(MARKER) as
      | { applied_at: string }
      | undefined;
  } catch {
    return undefined;
  }
}
function schemaDump(db: SqliteDatabaseHandle) {
  return db.prepare("SELECT name, sql FROM sqlite_master ORDER BY name").all();
}
function ensure(db: SqliteDatabaseHandle): Promise<void> {
  return ensureAnnouncementsSchema({ DB: createD1Database(db) });
}

function adminHeaders(): Headers {
  return new Headers({
    cookie: `rr_session=${adminToken}`,
    origin,
    "content-type": "application/json",
  });
}

interface AnnouncementBody {
  title?: string;
  body?: string;
  min_version?: string | null;
  max_version?: string | null;
  [key: string]: unknown;
}

async function create(body: AnnouncementBody) {
  const response = await createAnnouncement({
    env,
    request: new Request(`${origin}/api/admin/announcements`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ title: "Update available", body: "Please update.", ...body }),
    }),
  });
  return { status: response.status, payload: (await response.json()) as any };
}

async function update(id: number, body: AnnouncementBody) {
  const response = await updateAnnouncement({
    env,
    params: { id: String(id) },
    request: new Request(`${origin}/api/admin/announcements/${id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    }),
  });
  return { status: response.status, payload: (await response.json()) as any };
}

async function list() {
  const response = await listAnnouncements({
    env,
    request: new Request(`${origin}/api/admin/announcements`, { headers: adminHeaders() }),
  });
  return (await response.json()) as { ok: boolean; announcements: any[] };
}

/** The public poll. `version` omitted is the pre-targeting client: no `v` on the query at all. */
async function active(version?: string): Promise<{ titles: string[]; keys: string[] }> {
  resetRateLimitsForTests();
  const url = new URL(`${origin}/api/announcements/active`);
  if (version !== undefined) url.searchParams.set("v", version);
  const response = await activeAnnouncements({ env, request: new Request(url) });
  const payload = (await response.json()) as { ok: boolean; announcements: any[] };
  expect(response.status).toBe(200);
  return {
    titles: payload.announcements.map((a) => a.title),
    keys: [...new Set(payload.announcements.flatMap((a) => Object.keys(a)))].sort(),
  };
}

beforeEach(async () => {
  resetRateLimitsForTests();
  handle = createInMemoryDatabase();
  applySchema(handle, SCHEMA_BEFORE_RANGE);
  env = {
    DB: createD1Database(handle),
    AUTH_MODE: "app",
    JWT_SECRET: "announcement-version-range-tests-secret-only-for-testing",
  };
  await ensureAuthSchema(env);
  await createUser(env, "admin@test.example", "admin", "unused");
  adminToken = (await createAppSessionToken(env.JWT_SECRET!, "admin@test.example", "admin")).token;
});
afterEach(() => handle.close());

describe("versionInRange", () => {
  const open = { minVersion: null, maxVersion: null };

  it("matches everything when the client sends no version — the pre-targeting build", () => {
    expect(versionInRange(null, open)).toBe(true);
    expect(versionInRange(null, { minVersion: "1.5.0", maxVersion: null })).toBe(true);
    expect(versionInRange(null, { minVersion: null, maxVersion: "1.4.8" })).toBe(true);
  });

  it("matches everything when neither bound is set", () => {
    for (const version of ["1.0", "1.4.8", "1.5.3.0", "2.0.0"]) {
      expect(versionInRange(version, open)).toBe(true);
    }
  });

  it.each([
    ["3-part below the cap", "1.4.7", true],
    ["3-part on the cap — inclusive", "1.4.8", true],
    ["3-part above the cap", "1.4.9", false],
    // The 4-part shape update.xml pins (x.y.z.0); AppVersionInfo.VersionString itself is 3-part.
    ["4-part on the cap", "1.4.8.0", true],
    // A non-zero fourth part sorts *above* the 3-part cap. Recorded rather than worked around:
    // the client reports 3 parts and update.xml pins x.y.z.0, so nothing in the fleet sends one —
    // and a bound that quietly swallowed a build number would be the surprising rule, not this.
    ["4-part build past the cap", "1.4.8.2", false],
    ["legacy 2-part", "1.4", true],
    ["legacy v-prefixed", "v1.4.8", true],
  ])("max_version = 1.4.8: %s", (_label, version, expected) => {
    expect(versionInRange(version, { minVersion: null, maxVersion: "1.4.8" })).toBe(expected);
  });

  it.each([
    ["below the floor", "1.4.9", false],
    ["on the floor", "1.5.0", true],
    ["4-part on the floor", "1.5.0.0", true],
    ["above the floor", "1.5.3", true],
    ["double-digit minor sorts numerically, not as text", "1.10.0", true],
  ])("min_version = 1.5.0: %s", (_label, version, expected) => {
    expect(versionInRange(version, { minVersion: "1.5.0", maxVersion: null })).toBe(expected);
  });

  it("a closed range is inclusive at both ends", () => {
    const range = { minVersion: "1.4.0", maxVersion: "1.4.8" };
    expect(["1.3.9", "1.4.0", "1.4.8", "1.4.9"].map((v) => versionInRange(v, range))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });
});

describe("ensureAnnouncementsSchema version-range columns", () => {
  it("adds both columns to a database that already has the table, and records the marker", async () => {
    expect(columns(handle, "announcements")).not.toContain("min_version");
    expect(marker(handle)).toBeUndefined();

    await ensure(handle);
    expect(columns(handle, "announcements")).toEqual(
      expect.arrayContaining(["min_version", "max_version"]),
    );
    expect(marker(handle)?.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const after = schemaDump(handle);

    // The cached promise, a fresh binding (the ALTER hits duplicate column), and two at once.
    const same = createD1Database(handle);
    await ensureAnnouncementsSchema({ DB: same });
    await ensureAnnouncementsSchema({ DB: same });
    await Promise.all([ensure(handle), ensure(handle)]);
    expect(schemaDump(handle)).toEqual(after);
    expect(columns(handle, "announcements").filter((c) => c === "min_version")).toHaveLength(1);
  });

  it("leaves existing rows open-ended, so they keep reaching every client", async () => {
    handle
      .prepare(
        "INSERT INTO announcements(title, body, level, is_active, created_at, updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        "Legacy",
        "Written before targeting",
        "info",
        1,
        "2026-08-01T00:00:00Z",
        "2026-08-01T00:00:00Z",
      );

    await ensure(handle);
    const row = handle
      .prepare("SELECT min_version, max_version FROM announcements WHERE title = 'Legacy'")
      .get() as { min_version: string | null; max_version: string | null };
    expect(row).toEqual({ min_version: null, max_version: null });
    expect((await active("1.4.8")).titles).toEqual(["Legacy"]);
    expect((await active()).titles).toEqual(["Legacy"]);
  });

  it("creates the table with both columns on a database with no tables at all", async () => {
    const fresh = createInMemoryDatabase();
    await ensure(fresh);
    expect(columns(fresh, "announcements")).toEqual(
      expect.arrayContaining(["min_version", "max_version"]),
    );
    expect(marker(fresh)).toBeDefined();
    await ensure(fresh);
    expect(columns(fresh, "announcements").filter((c) => c === "max_version")).toHaveLength(1);
    fresh.close();
  });
});

describe("tools/migrations/2026-09-18-announcement-version-range.sql", () => {
  const withoutAlters = splitSqlStatements(MIGRATION).filter(
    (statement) => !/^ALTER TABLE/i.test(statement),
  );

  it("migrates a database the app never touched, and the app finds nothing left to do", async () => {
    applySchema(handle, MIGRATION);
    expect(columns(handle, "announcements")).toEqual(
      expect.arrayContaining(["min_version", "max_version"]),
    );
    expect(marker(handle)).toBeDefined();
    const before = schemaDump(handle);

    await ensure(handle);
    expect(schemaDump(handle)).toEqual(before);
  });

  it("aborts at the first ALTER on a migrated database, and the documented tail is a no-op", async () => {
    await ensure(handle);
    const before = { schema: schemaDump(handle), marker: marker(handle) };

    // The whole file: wrangler stops at the ALTER; applySchema's transaction rolls it back.
    expect(() => applySchema(handle, MIGRATION)).toThrow(/duplicate column name/);
    for (const statement of withoutAlters) handle.exec(statement);
    for (const statement of withoutAlters) handle.exec(statement);
    expect({ schema: schemaDump(handle), marker: marker(handle) }).toEqual(before);
  });
});

describe("admin announcements API", () => {
  it("round-trips both bounds, and reports them on the list", async () => {
    const created = await create({ title: "Stranded", min_version: null, max_version: "1.4.8" });
    expect(created.status).toBe(200);

    const rows = (await list()).announcements;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Stranded", min_version: null, max_version: "1.4.8" });

    // A partial update that never mentions the bounds leaves them alone (the active toggle).
    expect((await update(rows[0].id, { is_active: false })).status).toBe(200);
    expect((await list()).announcements[0]).toMatchObject({
      is_active: 0,
      max_version: "1.4.8",
    });

    // Cleared back to "any version": an empty string is the editor's open-ended state.
    expect((await update(rows[0].id, { min_version: "", max_version: "" })).status).toBe(200);
    expect((await list()).announcements[0]).toMatchObject({
      min_version: null,
      max_version: null,
    });
  });

  it("normalises a v-prefixed bound and trims it", async () => {
    await create({ min_version: " v1.5.0 " });
    expect((await list()).announcements[0]).toMatchObject({ min_version: "1.5.0" });
  });

  it.each([
    ["a bound compareVersions cannot order", { min_version: "1.5.x" }, "Minimum version"],
    ["an unorderable maximum", { max_version: "latest" }, "Maximum version"],
    [
      "an inverted range",
      { min_version: "1.5.0", max_version: "1.4.8" },
      "must not be higher than",
    ],
  ])("refuses %s with a 400 and writes nothing", async (_label, body, expected) => {
    const refused = await create(body);
    expect(refused.status).toBe(400);
    expect(refused.payload.error).toContain(expected);
    expect((await list()).announcements).toHaveLength(0);
  });

  it("validates the merged range on a PUT, not only the field that was sent", async () => {
    const { payload } = await create({ max_version: "1.4.8" });
    const refused = await update(payload.id, { min_version: "1.5.0" });
    expect(refused.status).toBe(400);
    expect(refused.payload.error).toContain("must not be higher than");
    expect((await list()).announcements[0]).toMatchObject({
      min_version: null,
      max_version: "1.4.8",
    });
  });
});

describe("GET /api/announcements/active?v=", () => {
  beforeEach(async () => {
    await create({ title: "Everyone", min_version: null, max_version: null });
    await create({ title: "Stranded", min_version: null, max_version: "1.4.8" });
    await create({ title: "Modern", min_version: "1.5.0", max_version: null });
    await create({ title: "Window", min_version: "1.4.0", max_version: "1.4.8" });
  });

  it("without v: every active announcement, exactly as before targeting", async () => {
    expect((await active()).titles.sort()).toEqual(["Everyone", "Modern", "Stranded", "Window"]);
    // An empty v is the same case — a client that sent the parameter with nothing in it.
    expect((await active("")).titles.sort()).toEqual(["Everyone", "Modern", "Stranded", "Window"]);
  });

  it.each([
    ["1.3.0", ["Everyone", "Stranded"]],
    ["1.4.8", ["Everyone", "Stranded", "Window"]],
    ["1.4.9", ["Everyone"]],
    ["1.5.3", ["Everyone", "Modern"]],
    // The 4-part string AnnouncementService actually appends.
    ["1.4.8.0", ["Everyone", "Stranded", "Window"]],
    ["1.5.3.0", ["Everyone", "Modern"]],
  ])("v=%s sees %j", async (version, expected) => {
    expect((await active(version)).titles.sort()).toEqual([...expected].sort());
  });

  it("never puts the targeting bounds on the public wire", async () => {
    expect((await active("1.5.3")).keys).toEqual([
      "body",
      "created_at",
      "expires_at",
      "id",
      "level",
      "starts_at",
      "title",
    ]);
  });
});
