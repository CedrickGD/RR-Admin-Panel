import { describe, expect, it } from "vitest";

import { BACKUP_MARKER, parseBackupMarker } from "../functions/_lib/system-adapter";
import { BACKUP_MAX_AGE_SECONDS } from "../functions/_lib/system-status";
import { composeService, repoFile } from "./helpers/nas-compose";

/*
 * A backup that fails must be visible. Three files agree on one marker for that:
 * backup/backup.sh writes /backups/.last-success only after the copy passed its checks, the
 * backup service's healthcheck in compose.yml reads that file's age, and rr-api reads its line
 * for the System health page (functions/_lib/system-adapter.ts). These are intent pins on the
 * script and the compose block, so a later edit cannot quietly reopen the gap.
 */
const backup = composeService("backup");
const script = repoFile("deploy/nas/backup/backup.sh");
const MARKER_PATH = `/backups/${BACKUP_MARKER}`;
/** The smallest copy the script accepts; the live DB is ~340 MB, its gzip ~35 MB. */
const MIN_BYTES = 1024 * 1024;

/** The `if [ "${1:-}" = "seed" ]; then … fi` block of backup.sh, the part that runs at start. */
function seedBlock(): string {
  const match = /if \[ "\$\{1:-\}" = "seed" \]; then\n([\s\S]*?)\nfi\n/.exec(script);
  if (!match) throw new Error("no seed block in backup.sh");
  return match[1];
}

describe("backup.sh", () => {
  it("writes the success marker last, after the copy proved real and intact and the archive passed gzip -t", () => {
    expect(script).toMatch(/^set -eu$/m);
    expect(script).toContain(`MARKER=${MARKER_PATH}`);
    const steps = [
      `sqlite3 "$SRC" ".backup '$OUT'"`,
      `SIZE=$(wc -c < "$OUT" | tr -d ' ')`,
      `if [ "$SIZE" -lt "$MIN_BYTES" ]; then`,
      `sqlite3 "$OUT" "PRAGMA integrity_check;"`,
      `sqlite3 "$OUT" "SELECT COUNT(*) FROM app_sessions;"`,
      `if [ "$ROWS" -lt 1 ]; then`,
      `gzip -f "$OUT"`,
      `gzip -t "$OUT.gz"`,
      "find /backups -name 'rr-*.sqlite.gz' -mtime +30 -delete",
      `printf '%s rr-%s.sqlite.gz\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STAMP" > "$MARKER"`,
      `echo "backup ok rr-$STAMP.sqlite.gz"`,
    ];
    const positions = steps.map((step) => [step, script.indexOf(step)] as const);
    for (const [step, position] of positions) expect([step, position >= 0]).toEqual([step, true]);
    expect(positions.map(([, position]) => position)).toEqual(
      positions.map(([, position]) => position).sort((a, b) => a - b),
    );
  });

  it("exits non-zero and removes what it produced when a check fails", () => {
    // A half-written .sqlite must not survive a crash, and a failed check must not leave a
    // broken archive in the folder looking like a backup.
    expect(script).toContain(`trap 'rm -f "$OUT"' EXIT`);
    expect(script).toMatch(/if \[ "\$CHECK" != "ok" \]; then\n[^]*?\n\s+exit 1\nfi\n/);
    expect(script).toMatch(
      /if ! gzip -t "\$OUT\.gz"; then\n[^]*?\n\s+rm -f "\$OUT\.gz"\n\s+exit 1\nfi\n/,
    );
  });

  it("refuses a copy below 1 MB or without app sessions, which integrity_check alone would pass", () => {
    // PRAGMA integrity_check answers ok on an empty database, so "verified" needs the copy to be
    // a real one first: a size floor, then a row count read from the copy itself.
    expect(Number(/^MIN_BYTES=(\d+)$/m.exec(script)?.[1])).toBe(MIN_BYTES);
    expect(script).toContain(`SIZE=$(wc -c < "$OUT" | tr -d ' ')`);
    expect(script).toMatch(
      /if \[ "\$SIZE" -lt "\$MIN_BYTES" \]; then\n\s+echo "backup FAILED size[^\n]*"\n\s+exit 1\nfi\n/,
    );
    // The count comes from the copy, not the live DB; a failing query (no such table, not a
    // database) fails the run the same way as a count of 0.
    expect(script).toContain(
      `ROWS=$(sqlite3 "$OUT" "SELECT COUNT(*) FROM app_sessions;" 2>/dev/null) || ROWS=""`,
    );
    expect(script).toMatch(/case "\$ROWS" in\n\s+''\|\*\[!0-9\]\*\) [^\n]*; exit 1 ;;\n\s*esac\n/);
    expect(script).toMatch(
      /if \[ "\$ROWS" -lt 1 \]; then\n\s+echo "backup FAILED app_sessions count[^\n]*"\n\s+exit 1\nfi\n/,
    );
    // Both guards run before gzip, so the EXIT trap still removes the rejected copy.
    expect(script.indexOf('if [ "$ROWS" -lt 1 ]')).toBeLessThan(script.indexOf(`gzip -f "$OUT"`));
    // The table every app session lands in: rr-api's schema owns the name the script counts.
    expect(repoFile("functions/_lib/storage.ts")).toContain(
      "CREATE TABLE IF NOT EXISTS app_sessions (",
    );
  });

  it("keeps the 30-day retention rule and leaves the marker outside of it", () => {
    expect(script).toContain("find /backups -name 'rr-*.sqlite.gz' -mtime +30 -delete");
    // A dotfile: the retention glob never matches it, and neither does the page's file pattern.
    expect(BACKUP_MARKER.startsWith(".")).toBe(true);
    expect(parseBackupMarker(`2026-09-16T03:15:42Z ${BACKUP_MARKER}`)).toBeNull();
  });

  it("writes a line rr-api parses, from the nightly run and from the seed alike", () => {
    // What the nightly printf produces for one run.
    expect(parseBackupMarker("2026-09-16T03:15:42Z rr-20260916-0315.sqlite.gz\n")).toEqual({
      at: "2026-09-16T03:15:42.000Z",
      file: "rr-20260916-0315.sqlite.gz",
    });
    // Both writers date the line with the same UTC format; the seed takes the archive's mtime.
    expect(script.match(/date -u (?:-r "\$ARCHIVE" )?\+%Y-%m-%dT%H:%M:%SZ/g)).toHaveLength(2);
  });

  it("seeds the marker from an intact archive only, and never makes a backup itself", () => {
    const seed = seedBlock();
    expect(seed).toContain(`if [ -e "$MARKER" ]; then exit 0; fi`);
    // Newest first, by the sortable stamp in the name; only a non-empty archive that passes
    // gzip -t (the plain .sqlite is gone, so the nightly size and row-count guards cannot apply).
    expect(seed).toContain("ls -1r /backups/rr-*.sqlite.gz");
    expect(seed).toContain(`if [ -s "$ARCHIVE" ] && gzip -t "$ARCHIVE"`);
    // The marker's content and mtime both say when that archive was written.
    expect(seed).toContain(`date -u -r "$ARCHIVE"`);
    expect(seed).toContain(`touch -r "$ARCHIVE" "$MARKER"`);
    expect(seed).not.toContain("sqlite3");
    expect(seed).not.toContain(".backup");
    // No archive at all: no marker, and the healthcheck's start period covers the first night.
    expect(seed).toMatch(/\n  echo "seed: no intact archive, no marker written"\n  exit 0$/);
  });
});

describe("backup service (compose)", () => {
  it("runs the seed before crond and tolerates its failure", () => {
    expect(backup).toContain(
      `command: sh -c "apk add --no-cache sqlite >/dev/null && (sh /backup.sh seed || true) && echo '15 3 * * * sh /backup.sh' > /etc/crontabs/root && crond -f -l 2"`,
    );
  });

  it("declares a healthcheck that fails on a missing or stale marker", () => {
    const test = /test: \["CMD-SHELL", "(.*)"\]/.exec(backup)?.[1];
    // busybox find prints the path only when the file exists AND is younger than 36 h; grep -q
    // turns an empty result into exit 1. No `$` for compose interpolation to mangle.
    expect(test).toBe(`find ${MARKER_PATH} -mmin -2160 2>/dev/null | grep -q .`);
    expect(2160 * 60).toBeGreaterThan(BACKUP_MAX_AGE_SECONDS);
    expect(backup).toMatch(/interval: 5m\n\s+timeout: 10s\n\s+retries: 2\n\s+start_period: \d+h\n/);
  });

  it("gives a fresh volume a full night before the first verdict", () => {
    // No archive to seed from means the marker can only appear after the first 03:15 run, so
    // the start period must be at least a day from any start time.
    const hours = Number(/start_period: (\d+)h/.exec(backup)?.[1]);
    expect(hours).toBeGreaterThanOrEqual(24);
  });

  it("mounts the same folder rr-api reads the marker from", () => {
    const rrApi = composeService("rr-api");
    expect(backup).toContain("${BACKUP_DIR}:/backups\n");
    expect(rrApi).toContain("${BACKUP_DIR}:/backups:ro");
    expect(rrApi).toContain("BACKUP_DIR=/backups");
  });
});
