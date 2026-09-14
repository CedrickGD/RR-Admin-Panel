// Type surface of recompute-session-error-counts.mjs for the vitest suite
// (tests/recompute-session-error-counts.test.ts).
import type { Database } from "better-sqlite3";

export const RETENTION_DAYS: number;
export const DEFAULT_BATCH_SIZE: number;
export const LEGACY_SESSION_ID_PREFIX: string;

/** reason -> how many sessions were left untouched, and the error_count still standing on them. */
export type RefusalBreakdown = Record<string, { sessions: number; errors: number }>;

export interface RecomputeResult {
  dryRun: boolean;
  repairLegacyCounts: boolean;
  repairStatus: boolean;
  runStartedAt: string;
  retentionFloor: string;
  premise: {
    retainedAppErrors: number;
    retainedRealErrors: number;
    proven: boolean;
    provenVersions: number;
  };
  sessionsTotal: number;
  sessionsScanned: number;
  sessionsOutsideRetention: number;
  counts: {
    changed: number;
    changedFromRetainedHistory: number;
    changedFromVersionPremise: number;
    changedFromDeploymentPremise: number;
    refused: RefusalBreakdown;
    sumBefore: number;
    sumAfter: number;
  };
  status: {
    candidates: number;
    changed: number;
    changedFromRetainedEvent: number;
    changedFromPremise: number;
    refused: RefusalBreakdown;
  };
}

export function recomputeSessionErrorCounts(
  db: Database,
  options?: {
    apply?: boolean;
    repairLegacyCounts?: boolean;
    repairStatus?: boolean;
    batchSize?: number;
    now?: Date;
  },
): RecomputeResult;

export function formatReport(result: RecomputeResult, dbPath: string): string[];

export function parseArgs(argv: readonly string[]): {
  apply: boolean;
  repairLegacyCounts: boolean;
  repairStatus: boolean;
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
