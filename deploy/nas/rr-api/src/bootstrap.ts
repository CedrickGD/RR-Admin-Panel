// First-start schema bootstrap: a brand-new NAS can come up without importing a D1 export. Only
// runs when the database has no tables at all (an imported DB is never touched) and only when
// the operator opts in with DB_BOOTSTRAP_SCHEMA=true. The ensure* helpers in the handlers still
// add their newer columns idempotently on first use.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { SqliteDatabaseHandle } from "./d1-adapter";

/** Candidate schema.sql locations: next to the bundle (Docker image), the repo root (dev). */
export function schemaFileCandidates(moduleUrl: string = import.meta.url): string[] {
  const here = dirname(fileURLToPath(moduleUrl));
  return [
    resolve(here, "../schema.sql"), // /app/dist/../schema.sql inside the image
    resolve(here, "../../../../schema.sql"), // deploy/nas/rr-api/src -> repo root
    resolve(here, "../../../../../schema.sql"), // deploy/nas/rr-api/dist (local build)
  ];
}

export function locateSchemaFile(explicitPath?: string): string | null {
  if (explicitPath) {
    return existsSync(explicitPath) ? explicitPath : null;
  }
  return schemaFileCandidates().find((candidate) => existsSync(candidate)) ?? null;
}

export function countUserTables(handle: SqliteDatabaseHandle): number {
  const row = handle
    .prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .get() as { count: number };
  return row.count;
}

/**
 * Splits a SQL script into statements on `;` at end of statement, ignoring `--` comments and
 * string literals. Returns trimmed, non-empty statements.
 */
export function splitSqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString: "'" | '"' | null = null;
  for (let index = 0; index < script.length; index += 1) {
    const char = script[index]!;
    const next = script[index + 1];
    if (inString) {
      current += char;
      if (char === inString) {
        inString = null;
      }
      continue;
    }
    if (char === "-" && next === "-") {
      const end = script.indexOf("\n", index);
      index = end === -1 ? script.length : end;
      current += "\n";
      continue;
    }
    if (char === "'" || char === '"') {
      inString = char;
      current += char;
      continue;
    }
    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** Applies `schemaSql` statement by statement inside one transaction. */
export function applySchema(handle: SqliteDatabaseHandle, schemaSql: string): number {
  const statements = splitSqlStatements(schemaSql);
  // PRAGMA statements cannot run inside a transaction; apply them first on their own.
  const pragmas = statements.filter((statement) => /^PRAGMA\b/i.test(statement));
  const rest = statements.filter((statement) => !/^PRAGMA\b/i.test(statement));
  for (const pragma of pragmas) {
    handle.exec(pragma);
  }
  handle.transaction(() => {
    for (const statement of rest) {
      handle.exec(statement);
    }
  })();
  return statements.length;
}

export interface BootstrapResult {
  applied: boolean;
  statements: number;
  schemaPath: string | null;
}

/** Runs schema.sql when the database is empty; a non-empty database is left exactly as it is. */
export function bootstrapSchemaIfEmpty(
  handle: SqliteDatabaseHandle,
  schemaPath: string | null,
): BootstrapResult {
  if (countUserTables(handle) > 0) {
    return { applied: false, statements: 0, schemaPath };
  }
  if (!schemaPath) {
    throw new Error("DB_BOOTSTRAP_SCHEMA=true but schema.sql was not found (set SCHEMA_PATH).");
  }
  const statements = applySchema(handle, readFileSync(schemaPath, "utf8"));
  return { applied: true, statements, schemaPath };
}
