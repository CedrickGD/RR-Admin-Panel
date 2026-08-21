import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applySchema,
  bootstrapSchemaIfEmpty,
  countUserTables,
  locateSchemaFile,
  splitSqlStatements,
} from "../../deploy/nas/rr-api/src/bootstrap";
import { createInMemoryDatabase } from "../../deploy/nas/rr-api/src/d1-adapter";

const SCHEMA_PATH = resolve(__dirname, "../../schema.sql");

describe("splitSqlStatements", () => {
  it("splits on semicolons outside strings and drops comments", () => {
    const statements = splitSqlStatements(`
      -- leading comment; with a semicolon
      CREATE TABLE a (x TEXT DEFAULT 'one; two');
      INSERT INTO a VALUES ("x;y");   -- trailing
      PRAGMA foreign_keys = ON
    `);
    expect(statements).toEqual([
      "CREATE TABLE a (x TEXT DEFAULT 'one; two')",
      'INSERT INTO a VALUES ("x;y")',
      "PRAGMA foreign_keys = ON",
    ]);
  });
});

describe("schema bootstrap", () => {
  it("finds schema.sql at the repo root", () => {
    expect(locateSchemaFile()).toBe(SCHEMA_PATH);
    expect(locateSchemaFile(SCHEMA_PATH)).toBe(SCHEMA_PATH);
    expect(locateSchemaFile(resolve(__dirname, "missing.sql"))).toBeNull();
  });

  it("applies schema.sql to an empty database and leaves a populated one alone", () => {
    const handle = createInMemoryDatabase();
    expect(countUserTables(handle)).toBe(0);

    const first = bootstrapSchemaIfEmpty(handle, SCHEMA_PATH);
    expect(first.applied).toBe(true);
    expect(first.statements).toBeGreaterThan(10);
    const tables = handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "telemetry_events",
        "app_sessions",
        "licenses",
        "announcements",
        "feedback",
        "access_suspensions",
        "discord_links",
      ]),
    );

    handle.prepare("INSERT INTO telemetry_counters VALUES ('x', 1, 'now')").run();
    const second = bootstrapSchemaIfEmpty(handle, SCHEMA_PATH);
    expect(second.applied).toBe(false);
    expect(handle.prepare("SELECT counter_value FROM telemetry_counters").get()).toEqual({
      counter_value: 1,
    });
    handle.close();
  });

  it("throws when the DB is empty but schema.sql is missing", () => {
    const handle = createInMemoryDatabase();
    expect(() => bootstrapSchemaIfEmpty(handle, null)).toThrow(/schema\.sql/);
    handle.close();
  });

  it("applySchema is idempotent (CREATE IF NOT EXISTS)", () => {
    const handle = createInMemoryDatabase();
    const sql = readFileSync(SCHEMA_PATH, "utf8");
    applySchema(handle, sql);
    expect(() => applySchema(handle, sql)).not.toThrow();
    handle.close();
  });
});
