// Type surface of recompute-session-error-counts.mjs for the vitest suite
// (tests/recompute-session-error-counts.test.ts) and for restore-session-error-counts.mjs,
// which imports the proof helpers so the two scripts agree on what "proven" means.
import type { Database } from "better-sqlite3";

export const RETENTION_DAYS: number;
export const DEFAULT_BATCH_SIZE: number;
export const LEGACY_SESSION_ID_PREFIX: string;
export const SESSION_START_SERVICE: string;
/** How far before its session_start a session's own retained events may lie and still be its prelude. */
export const SESSION_START_PRELUDE_MS: number;
/** The coverage rule in one line, as both scripts' reports and --help print it. */
export const COVERAGE_PROOF: string;

/** reason -> how many sessions were left untouched, and the error_count still standing on them. */
export type RefusalBreakdown = Record<string, { sessions: number; errors: number }>;

/** One retained telemetry event, reduced to what the status proof reads off it. */
export interface RetainedEvent {
  service: string;
  status: string;
  background: boolean;
}

/** What telemetry_events still holds, read once and shared by both scripts. */
export interface EvidenceIndex {
  now: Date;
  oldestRetainedEventAt: string | null;
  retentionFloor: string;
  /** session_id -> retained real (non-background) app_error rows. */
  realErrors: Map<string, number>;
  /** session ids whose own session_start anchors their history: provably intact, prelude included. */
  covered: Set<string>;
  /** session ids with at least one retained event. */
  seen: Set<string>;
  /** session ids with retained events the rule does not cover -> the one reason (legacy ids excluded). */
  uncovered: Map<string, string>;
  newestEvent: Map<string, RetainedEvent>;
  newestNonBackgroundEvent: Map<string, RetainedEvent>;
  hasStatusEvidence: boolean;
}

export function buildEvidenceIndex(
  db: Database,
  options?: { now?: Date; statusEvidence?: boolean },
): EvidenceIndex;

/** null when the session's whole history is provably retained; otherwise why it is not. */
export function coverageGap(index: EvidenceIndex, sessionId: string): string | null;

export function countTargetFor(index: EvidenceIndex, sessionId: string): number;

export function statusRepairFor(
  index: EvidenceIndex,
  sessionId: string,
): { ok: true; lastStatus: string; lastEvent: string } | { ok: false; reason: string };

export interface RecomputeResult {
  dryRun: boolean;
  repairStatus: boolean;
  runStartedAt: string;
  retentionFloor: string;
  oldestRetainedEventAt: string | null;
  sessionsTotal: number;
  sessionsScanned: number;
  sessionsProven: number;
  sessionsUnknownHistory: number;
  counts: {
    changed: number;
    refused: RefusalBreakdown;
    sumBefore: number;
    /** Projected from what this run changed. */
    sumAfter: number;
    /** Re-read from the database after a successful --apply; null on a dry run. */
    sumAfterObserved: number | null;
    errorsOnUnknownHistory: number;
    sessionsWithErrorsOnUnknownHistory: number;
  };
  status: {
    candidates: number;
    changed: number;
    refused: RefusalBreakdown;
  };
}

export function recomputeSessionErrorCounts(
  db: Database,
  options?: {
    apply?: boolean;
    repairStatus?: boolean;
    batchSize?: number;
    now?: Date;
  },
): RecomputeResult;

export function formatReport(result: RecomputeResult, dbPath: string): string[];

export function parseArgs(argv: readonly string[]): {
  apply: boolean;
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
