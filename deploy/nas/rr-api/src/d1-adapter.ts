// D1 → better-sqlite3 adapter. The Pages Functions and the standalone worker only ever use
// `prepare().bind().run()/first()/all()` and `batch()`, so this is the whole surface. SQL is
// passed through untouched (D1 *is* SQLite); the adapter only translates bind values, result
// shapes and error timing (D1 rejects lazily, better-sqlite3 throws in `prepare()`).
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type {
  D1AllResult,
  D1Database,
  D1PreparedStatement,
  D1RunResult,
} from "../../../../functions/_lib/types";

export type SqliteDatabaseHandle = Database.Database;

type SqliteBindValue = null | number | string | bigint | Buffer;

const STATEMENT_CACHE_LIMIT = 256;

interface SqliteExecutionMeta {
  changes: number;
  last_row_id: number;
  rows_read?: number;
  rows_written: number;
  duration: number;
}

interface SqliteRunOutcome extends D1RunResult {
  success: true;
  meta: SqliteExecutionMeta;
  results?: unknown[];
}

class StatementCache {
  private readonly cache = new Map<string, Database.Statement>();

  constructor(private readonly handle: SqliteDatabaseHandle) {}

  get(sql: string): Database.Statement {
    const cached = this.cache.get(sql);
    if (cached) {
      // Refresh recency: delete + set keeps the Map in LRU order.
      this.cache.delete(sql);
      this.cache.set(sql, cached);
      return cached;
    }

    const statement = this.handle.prepare(sql);
    if (this.cache.size >= STATEMENT_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(sql, statement);
    return statement;
  }
}

function toBindValue(value: unknown, index: number): SqliteBindValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") {
    if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number(value);
    }
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(
    `Unsupported bind value at position ${index + 1}: ${Object.prototype.toString.call(value)}`,
  );
}

function toRowId(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

class SqliteStatement implements D1PreparedStatement {
  constructor(
    private readonly cache: StatementCache,
    private readonly sql: string,
    private readonly values: readonly SqliteBindValue[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteStatement(
      this.cache,
      this.sql,
      values.map((value, index) => toBindValue(value, index)),
    );
  }

  async run<T = D1RunResult>(): Promise<T> {
    return this.executeSync() as T;
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const statement = this.cache.get(this.sql);
    if (!statement.reader) {
      statement.run(...this.values);
      return null;
    }
    const row = statement.get(...this.values) as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    if (columnName !== undefined) {
      return (row[columnName] ?? null) as T | null;
    }
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<D1AllResult<T>> {
    const outcome = this.executeSync();
    const result: D1AllResult<T> & { meta: SqliteExecutionMeta } = {
      results: (outcome.results ?? []) as T[],
      success: true,
      meta: outcome.meta,
    };
    return result;
  }

  /** Synchronous core shared by `run()` and `batch()` so a batch can stay inside one transaction. */
  executeSync(): SqliteRunOutcome {
    const startedAt = performance.now();
    const statement = this.cache.get(this.sql);
    if (statement.reader) {
      const results = statement.all(...this.values);
      return {
        success: true,
        results,
        meta: {
          changes: 0,
          last_row_id: 0,
          rows_read: results.length,
          rows_written: 0,
          duration: performance.now() - startedAt,
        },
      };
    }
    const info = statement.run(...this.values);
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: toRowId(info.lastInsertRowid),
        rows_written: info.changes,
        duration: performance.now() - startedAt,
      },
    };
  }
}

export function createD1Database(handle: SqliteDatabaseHandle): D1Database {
  const cache = new StatementCache(handle);
  const runBatch = handle.transaction((statements: SqliteStatement[]) =>
    statements.map((statement) => statement.executeSync()),
  );

  return {
    prepare(query: string): D1PreparedStatement {
      return new SqliteStatement(cache, query);
    },
    async batch<T = D1RunResult>(statements: D1PreparedStatement[]): Promise<T[]> {
      for (const statement of statements) {
        if (!(statement instanceof SqliteStatement)) {
          throw new TypeError("batch() only accepts statements prepared by this adapter.");
        }
      }
      return runBatch(statements as SqliteStatement[]) as T[];
    },
  };
}

function applyPragmas(handle: SqliteDatabaseHandle, options: { wal: boolean }): void {
  if (options.wal) {
    handle.pragma("journal_mode = WAL");
  }
  handle.pragma("busy_timeout = 5000");
  handle.pragma("foreign_keys = ON");
}

/** Opens (or creates) the SQLite file at `path`, creating its directory, with WAL + busy timeout. */
export function openDatabase(path: string): SqliteDatabaseHandle {
  mkdirSync(dirname(path), { recursive: true });
  const handle = new Database(path);
  applyPragmas(handle, { wal: true });
  return handle;
}

/** Fresh in-memory database with the same pragmas (WAL is meaningless in memory and skipped). */
export function createInMemoryDatabase(): SqliteDatabaseHandle {
  const handle = new Database(":memory:");
  applyPragmas(handle, { wal: false });
  return handle;
}
