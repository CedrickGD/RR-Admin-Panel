// Type surface of restore-session-error-counts.mjs for the vitest suite
// (tests/restore-session-error-counts.test.ts).
import type { Database } from "better-sqlite3";

import type { RefusalBreakdown } from "./recompute-session-error-counts.d.mts";

export interface RestoreResult {
  dryRun: boolean;
  runStartedAt: string;
  retentionFloor: string;
  sessionsLive: number;
  sessionsInBackup: number;
  sessionsScanned: number;
  counts: {
    /** Rows the strict rule cannot prove: the pre-run error_count went back. */
    restored: number;
    errorsRestored: number;
    /** Rows the strict rule proves: they keep the recomputed error_count. */
    provenKept: number;
    errorsProvenDropped: number;
    /** Unprovable rows held back because ingest wrote them after the backup was taken. */
    notRestoredIngestWrote: number;
    errorsNotRestoredIngestWrote: number;
    refused: RefusalBreakdown;
    sumBefore: number;
    /** Projected from what this run restored. */
    sumAfter: number;
    /** Re-read from the database after a successful --apply; null on a dry run. */
    sumAfterObserved: number | null;
  };
  status: {
    /** Rows that were last_event='app_error' AND last_status<>'ok' in the backup. */
    subjects: number;
    restored: number;
    provenKept: number;
    /** Unprovable subjects held back because ingest wrote them after the backup was taken. */
    notRestoredIngestWrote: number;
    refused: RefusalBreakdown;
  };
}

/**
 * null when the live row has not been written since the backup (so any difference between the two
 * is the recompute run's doing), otherwise the reason it may not be rolled back.
 */
export function ingestWriteSince(
  liveUpdatedAt: unknown,
  backupUpdatedAt: string | null,
): string | null;

export function restoreSessionErrorCounts(
  db: Database,
  backup: Database,
  options?: { apply?: boolean; batchSize?: number; now?: Date },
): RestoreResult;

export function formatReport(result: RestoreResult, dbPath: string, backupPath: string): string[];

export function parseArgs(argv: readonly string[]): {
  apply: boolean;
  dbPath: string | null;
  backupPath: string | null;
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
): RestoreResult | null;
