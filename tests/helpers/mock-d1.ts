import type {
  D1AllResult,
  D1Database,
  D1PreparedStatement,
  D1RunResult,
} from "../../functions/_lib/types";

export type MockD1OperationKind = "run" | "first" | "all";
export type SqlMatcher = string | RegExp;

export interface RecordedD1Operation {
  kind: MockD1OperationKind;
  sql: string;
  normalizedSql: string;
  values: readonly unknown[];
}

export interface MockD1Resolver<T> {
  match: SqlMatcher;
  result: T | ((operation: RecordedD1Operation) => T | Promise<T>);
}

export interface MockD1Resolvers {
  run?: readonly MockD1Resolver<D1RunResult>[];
  first?: readonly MockD1Resolver<unknown | null>[];
  all?: readonly MockD1Resolver<D1AllResult<unknown>>[];
}

export interface MockD1 {
  db: D1Database;
  operations: RecordedD1Operation[];
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function matchesSql(matcher: SqlMatcher, normalizedSql: string): boolean {
  if (typeof matcher === "string") {
    return normalizedSql.includes(normalizeSql(matcher));
  }

  matcher.lastIndex = 0;
  return matcher.test(normalizedSql);
}

async function resolveOperation<T>(
  operation: RecordedD1Operation,
  resolvers: readonly MockD1Resolver<T>[] | undefined,
  fallback: T,
): Promise<T> {
  const resolver = resolvers?.find((candidate) =>
    matchesSql(candidate.match, operation.normalizedSql),
  );
  if (!resolver) return fallback;

  return typeof resolver.result === "function"
    ? await (resolver.result as (record: RecordedD1Operation) => T | Promise<T>)(operation)
    : resolver.result;
}

class MockStatement implements D1PreparedStatement {
  constructor(
    private readonly sql: string,
    private readonly operations: RecordedD1Operation[],
    private readonly resolvers: MockD1Resolvers,
    private readonly values: readonly unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new MockStatement(this.sql, this.operations, this.resolvers, values);
  }

  async run<T = D1RunResult>(): Promise<T> {
    const operation = this.record("run");
    const fallback: D1RunResult = {
      success: true,
      meta: { changes: 1, last_row_id: 1 },
    };
    return (await resolveOperation(operation, this.resolvers.run, fallback)) as T;
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const operation = this.record("first");
    const result = await resolveOperation(operation, this.resolvers.first, null);
    if (columnName && result !== null && typeof result === "object") {
      return (result as Record<string, unknown>)[columnName] as T | null;
    }
    return result as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1AllResult<T>> {
    const operation = this.record("all");
    const fallback: D1AllResult<unknown> = { results: [], success: true };
    return (await resolveOperation(operation, this.resolvers.all, fallback)) as D1AllResult<T>;
  }

  private record(kind: MockD1OperationKind): RecordedD1Operation {
    const operation: RecordedD1Operation = {
      kind,
      sql: this.sql,
      normalizedSql: normalizeSql(this.sql),
      values: [...this.values],
    };
    this.operations.push(operation);
    return operation;
  }
}

export function createMockD1(resolvers: MockD1Resolvers = {}): MockD1 {
  const operations: RecordedD1Operation[] = [];
  return {
    db: {
      prepare(query: string): D1PreparedStatement {
        return new MockStatement(query, operations, resolvers);
      },
      async batch<T = D1RunResult>(statements: D1PreparedStatement[]): Promise<T[]> {
        const results: T[] = [];
        for (const statement of statements) {
          results.push(await statement.run<T>());
        }
        return results;
      },
    },
    operations,
  };
}
