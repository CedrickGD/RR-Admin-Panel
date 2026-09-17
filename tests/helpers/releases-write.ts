/**
 * The database and confirm-token plumbing the release **write** route tests share.
 *
 * `createMockD1`'s resolvers are stateless by default, which is fine for a read but wrong for a
 * sequence: publish updates the draft row, appends a `release_events` row per completed step and
 * then resumes by reading those rows back. `releasesDb` therefore keeps one draft row, one event
 * log and one audit log in memory and applies the statements the store actually issues — including
 * the `WHERE id = ? AND updated_at = ?` guard, so the lost-update behaviour under test is the real
 * one rather than a stub that always succeeds.
 */
import { mintConfirmToken } from "../../functions/_lib/release-confirm";
import type { PanelMember } from "../../functions/_lib/panel-access";
import type { D1Database, RuntimeEnv } from "../../functions/_lib/types";
import type { ConfirmAction, ConfirmEffect } from "../../shared/releases-contract";
import {
  createMockD1,
  type MockD1,
  type MockD1Resolvers,
  type RecordedD1Operation,
} from "./mock-d1";
import { PANEL_MEMBER_SQL, panelMemberRow } from "./releases-api";

export interface RecordedEvent {
  id: number;
  draftId: number | null;
  kind: string;
  actor: string;
  detail: string;
  createdAt: string;
}

export interface RecordedAudit {
  actor: string;
  target: string;
  action: string;
  detail: string;
}

export interface ReleasesDb {
  mock: MockD1;
  db: D1Database;
  /** The draft row as it stands, or null once it has been deleted. */
  draft(): Record<string, unknown> | null;
  events(): RecordedEvent[];
  eventDetails(): string[];
  audits(): RecordedAudit[];
}

export interface ReleasesDbOptions {
  draft?: Record<string, unknown> | null;
  member?: PanelMember;
  /** Merged in front of the built-in resolvers, so a case can answer its own query. */
  resolvers?: MockD1Resolvers;
}

const UPDATE_PATTERN = /^UPDATE release_drafts SET (.+?) WHERE id = \? AND updated_at = \?$/;
const INSERT_PATTERN = /^INSERT INTO release_drafts \(([^)]+)\) VALUES/;

function assignedColumns(sql: string): string[] | null {
  const assignments = UPDATE_PATTERN.exec(sql)?.[1];
  if (!assignments) return null;
  return assignments.split(", ").map((part) => part.split(" = ")[0]!.trim());
}

/** The columns a fresh row carries that the INSERT does not name. */
const NEW_ROW_DEFAULTS: Record<string, unknown> = {
  status: "draft",
  github_release_id: null,
  github_run_id: null,
  asset_name: null,
  asset_size: null,
  published_at: null,
};

/**
 * One draft row, one event log and one audit log, wired to the statements
 * `functions/_lib/releases-store.ts` and `auditPanel` issue.
 */
export function releasesDb(options: ReleasesDbOptions = {}): ReleasesDb {
  let row: Record<string, unknown> | null =
    options.draft === undefined ? null : options.draft ? { ...options.draft } : null;
  const events: RecordedEvent[] = [];
  const audits: RecordedAudit[] = [];

  const applyUpdate = (operation: RecordedD1Operation): boolean => {
    const columns = assignedColumns(operation.normalizedSql);
    if (!columns || !row) return false;
    const values = [...operation.values];
    const expectedUpdatedAt = values[values.length - 1];
    const id = values[values.length - 2];
    if (row.id !== id || row.updated_at !== expectedUpdatedAt) return false;
    columns.forEach((column, index) => {
      row![column] = values[index] ?? null;
    });
    return true;
  };

  const resolvers: MockD1Resolvers = {
    first: [
      { match: PANEL_MEMBER_SQL, result: options.member ?? null },
      {
        match: /FROM release_drafts WHERE id = \?/,
        result: (operation: RecordedD1Operation) =>
          row && row.id === operation.values[0] ? { ...row } : null,
      },
      {
        match: /FROM release_drafts WHERE tag = \?/,
        result: (operation: RecordedD1Operation) =>
          row && row.tag === operation.values[0] ? { ...row } : null,
      },
      ...(options.resolvers?.first ?? []),
    ],
    all: [
      {
        match: /FROM release_events/,
        result: (operation: RecordedD1Operation) => {
          const scoped = operation.normalizedSql.includes("WHERE draft_id = ?")
            ? events.filter((event) => event.draftId === operation.values[0])
            : events;
          return {
            success: true,
            results: [...scoped].reverse().map((event) => ({
              id: event.id,
              draft_id: event.draftId,
              kind: event.kind,
              actor: event.actor,
              detail: event.detail,
              created_at: event.createdAt,
            })),
          };
        },
      },
      ...(options.resolvers?.all ?? []),
    ],
    run: [
      {
        match: /^INSERT INTO release_events/,
        result: (operation: RecordedD1Operation) => {
          const [draftId, kind, actor, detail, createdAt] = operation.values;
          events.push({
            id: events.length + 1,
            draftId: (draftId as number | null) ?? null,
            kind: String(kind),
            actor: String(actor),
            detail: String(detail),
            createdAt: String(createdAt),
          });
          return { success: true, meta: { changes: 1, last_row_id: events.length } };
        },
      },
      {
        match: /^INSERT INTO panel_audit/,
        result: (operation: RecordedD1Operation) => {
          const [actor, target, action, detail] = operation.values;
          audits.push({
            actor: String(actor),
            target: String(target),
            action: String(action),
            detail: String(detail),
          });
          return { success: true, meta: { changes: 1, last_row_id: audits.length } };
        },
      },
      {
        match: INSERT_PATTERN,
        result: (operation: RecordedD1Operation) => {
          const columns = (INSERT_PATTERN.exec(operation.normalizedSql)?.[1] ?? "")
            .split(",")
            .map((column) => column.trim());
          const inserted: Record<string, unknown> = { id: 1, ...NEW_ROW_DEFAULTS };
          columns.forEach((column, index) => {
            inserted[column] = operation.values[index] ?? null;
          });
          row = inserted;
          return { success: true, meta: { changes: 1, last_row_id: 1 } };
        },
      },
      {
        match: UPDATE_PATTERN,
        result: (operation: RecordedD1Operation) => ({
          success: true,
          meta: { changes: applyUpdate(operation) ? 1 : 0, last_row_id: 0 },
        }),
      },
      {
        match: /^DELETE FROM release_drafts WHERE id = \?/,
        result: (operation: RecordedD1Operation) => {
          const changed = row?.id === operation.values[0];
          if (changed) row = null;
          return { success: true, meta: { changes: changed ? 1 : 0, last_row_id: 0 } };
        },
      },
      ...(options.resolvers?.run ?? []),
    ],
  };

  const mock = createMockD1(resolvers);
  return {
    mock,
    db: mock.db,
    draft: () => (row ? { ...row } : null),
    events: () => [...events],
    eventDetails: () => events.map((event) => event.detail),
    audits: () => [...audits],
  };
}

export { panelMemberRow };

/** The effect list a confirm route would have minted — enough to satisfy the Discord invariant. */
export function effectsFor(action: ConfirmAction): ConfirmEffect[] {
  if (action === "publish") {
    return [
      { kind: "github", text: "GitHub: the release is published." },
      { kind: "discord", text: "Discord: a release post goes to the updates channel." },
    ];
  }
  if (action === "make-current") {
    return [
      { kind: "manifest", text: "update.xml: 1.5.3 → 1.5.2." },
      { kind: "discord", text: "Discord: nothing is posted — update.xml only." },
    ];
  }
  return [{ kind: "github", text: "GitHub: one call is made." }];
}

/** A live token for `action` on `subject`, minted the way `POST …/confirm` mints one. */
export async function confirmTokenFor(
  env: RuntimeEnv,
  action: ConfirmAction,
  subject: string,
  actor: string,
): Promise<string> {
  const minted = await mintConfirmToken(env, {
    action,
    subject,
    actor,
    effects: effectsFor(action),
  });
  return minted.token;
}
