import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createD1Database,
  createInMemoryDatabase,
  type SqliteDatabaseHandle,
} from "../../deploy/nas/rr-api/src/d1-adapter";
import type { D1Database, D1PreparedStatement } from "../../functions/_lib/types";

let handle: SqliteDatabaseHandle;
let db: D1Database;

beforeEach(() => {
  handle = createInMemoryDatabase();
  db = createD1Database(handle);
  handle.exec(
    `CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, flag INTEGER, note TEXT)`,
  );
});

afterEach(() => {
  handle.close();
});

describe("createInMemoryDatabase", () => {
  it("applies the runtime pragmas", () => {
    expect(handle.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(handle.pragma("busy_timeout", { simple: true })).toBe(5000);
  });
});

describe("run()", () => {
  it("reports changes and last_row_id like D1", async () => {
    const result = await db.prepare("INSERT INTO items (name) VALUES (?)").bind("a").run();
    expect(result.success).toBe(true);
    expect(result.meta?.changes).toBe(1);
    expect(result.meta?.last_row_id).toBe(1);
    expect(result.meta?.rows_written).toBe(1);

    const update = await db
      .prepare("UPDATE items SET note = ? WHERE name = ?")
      .bind("n", "zzz")
      .run();
    expect(update.meta?.changes).toBe(0);
  });

  it("binds booleans as 0/1 and undefined as NULL", async () => {
    await db
      .prepare("INSERT INTO items (name, flag, note) VALUES (?, ?, ?)")
      .bind("bool", true, undefined)
      .run();
    const row = await db
      .prepare("SELECT flag, note FROM items WHERE name = ?")
      .bind("bool")
      .first();
    expect(row).toEqual({ flag: 1, note: null });

    await db.prepare("INSERT INTO items (name, flag) VALUES (?, ?)").bind("off", false).run();
    expect(
      await db.prepare("SELECT flag FROM items WHERE name = ?").bind("off").first("flag"),
    ).toBe(0);
  });

  it("binds safe bigints as numbers", async () => {
    await db.prepare("INSERT INTO items (name, flag) VALUES (?, ?)").bind("big", 42n).run();
    expect(
      await db.prepare("SELECT flag FROM items WHERE name = ?").bind("big").first("flag"),
    ).toBe(42);
  });

  it("rejects (instead of throwing synchronously) when the SQL is invalid", async () => {
    const statement = db.prepare("SELECT nope FROM missing_table");
    await expect(statement.run()).rejects.toThrow(/no such table/);
    await expect(statement.first()).rejects.toThrow(/no such table/);
    await expect(statement.all()).rejects.toThrow(/no such table/);
  });

  it("executes SELECT statements through run() without throwing", async () => {
    await db.prepare("INSERT INTO items (name) VALUES (?)").bind("a").run();
    const result = await db.prepare("SELECT name FROM items").run();
    expect(result.success).toBe(true);
  });
});

describe("first()", () => {
  it("returns the first row, a single column, or null", async () => {
    await db.prepare("INSERT INTO items (name, note) VALUES (?, ?)").bind("a", "first").run();
    await db.prepare("INSERT INTO items (name, note) VALUES (?, ?)").bind("b", "second").run();

    expect(await db.prepare("SELECT name, note FROM items ORDER BY id").first()).toEqual({
      name: "a",
      note: "first",
    });
    expect(await db.prepare("SELECT note FROM items ORDER BY id").first("note")).toBe("first");
    expect(
      await db.prepare("SELECT note FROM items WHERE name = ?").bind("zzz").first(),
    ).toBeNull();
    expect(
      await db.prepare("SELECT note FROM items WHERE name = ?").bind("zzz").first("note"),
    ).toBeNull();
  });

  it("returns null (not a throw) for statements that return no rows", async () => {
    expect(await db.prepare("INSERT INTO items (name) VALUES (?)").bind("x").first()).toBeNull();
  });

  it("keeps bind() immutable so a prepared statement can be reused with new values", async () => {
    const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
    await insert.bind("a").run();
    await insert.bind("b").run();
    const count = await db
      .prepare("SELECT COUNT(*) AS count FROM items")
      .first<{ count: number }>();
    expect(count?.count).toBe(2);
  });
});

describe("all()", () => {
  it("returns every row with success + meta", async () => {
    await db.prepare("INSERT INTO items (name) VALUES (?), (?)").bind("a", "b").run();
    const result = await db.prepare("SELECT name FROM items ORDER BY name").all<{ name: string }>();
    expect(result.success).toBe(true);
    expect(result.results).toEqual([{ name: "a" }, { name: "b" }]);
    expect((result as { meta?: unknown }).meta).toBeDefined();
  });

  it("returns an empty results array for statements that return no rows", async () => {
    const result = await db.prepare("DELETE FROM items").all();
    expect(result.results).toEqual([]);
  });
});

describe("batch()", () => {
  it("runs every statement inside one transaction and returns the results in order", async () => {
    const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
    const results = await db.batch([
      insert.bind("a"),
      insert.bind("b"),
      db.prepare("SELECT COUNT(*) AS count FROM items"),
    ]);
    expect(results).toHaveLength(3);
    expect(results[0]?.meta?.changes).toBe(1);
    expect(results[1]?.meta?.last_row_id).toBe(2);
    expect((results[2] as { results?: Array<{ count: number }> }).results?.[0]?.count).toBe(2);
  });

  it("rolls the whole batch back when one statement fails", async () => {
    const insert = db.prepare("INSERT INTO items (name) VALUES (?)");
    await insert.bind("dup").run();
    await expect(
      db.batch([insert.bind("fresh"), insert.bind("dup"), insert.bind("never")]),
    ).rejects.toThrow(/UNIQUE/);
    const rows = await db.prepare("SELECT name FROM items ORDER BY name").all<{ name: string }>();
    expect(rows.results).toEqual([{ name: "dup" }]);
    expect(handle.inTransaction).toBe(false);
  });

  it("refuses statements that did not come from this adapter", async () => {
    const foreign = {
      bind: () => foreign,
      run: async () => ({}),
      first: async () => null,
      all: async () => ({ results: [] }),
    };
    await expect(db.batch([foreign as unknown as D1PreparedStatement])).rejects.toThrow(/adapter/);
  });
});
