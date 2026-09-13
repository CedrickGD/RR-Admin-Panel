// Type surface of recompute-session-error-counts.mjs for the vitest suite
// (tests/recompute-session-error-counts.test.ts).
import type { Database } from "better-sqlite3";

export const RETENTION_DAYS: number;
export const DEFAULT_BATCH_SIZE: number;

export interface RecomputeResult {
  dryRun: boolean;
  runStartedAt: string;
  retentionFloor: string;
  sessionsTotal: number;
  sessionsRecomputed: number;
  sessionsOutsideRetention: number;
  sessionsChanged: number;
  sessionsSkippedUpdatedDuringRun: number;
  errorSumRecomputedBefore: number;
  errorSumRecomputedAfter: number;
  errorSumAllBefore: number;
  errorSumAllAfter: number;
}

export function recomputeSessionErrorCounts(
  db: Database,
  options?: { dryRun?: boolean; batchSize?: number; now?: Date },
): RecomputeResult;

export function formatReport(result: RecomputeResult, dbPath: string): string[];

export function parseArgs(argv: readonly string[]): {
  dryRun: boolean;
  dbPath: string | null;
  batchSize: number;
  help: boolean;
};

export function main(
  argv: readonly string[],
  options?: {
    log?: (line: string) => void;
    env?: Record<string, string | undefined>;
    openDatabase?: (path: string, options: { readonly: boolean }) => Database;
    now?: Date;
  },
): RecomputeResult | null;
