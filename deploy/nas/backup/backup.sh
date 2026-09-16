#!/bin/sh
# Nightly SQLite backup with 30-day retention. DB path matches the rr-api volume.
#
# /backups/.last-success records the last VERIFIED backup: one line, "<ISO-8601 UTC> <file name>",
# rewritten only after the copy passed PRAGMA integrity_check and the archive passed gzip -t. Its
# mtime is set at the same moment. Two readers depend on that meaning:
#   - the healthcheck on the backup service (deploy/nas/compose.yml) fails when the marker is
#     missing or its mtime is older than 36 h, so a run that produced a broken file fails it the
#     same way as a run that never happened;
#   - rr-api (functions/_lib/system-adapter.ts) reads the line for the System health page, so the
#     backup age shown there is the time since the last verified success, not since the newest file.
# The marker is a dotfile: the retention `find -name 'rr-*.sqlite.gz'` never touches it and the
# page's file-name pattern never mistakes it for a backup.
set -eu
SRC=/data/db/rr.sqlite
MARKER=/backups/.last-success

# `seed` runs once at container start (compose command) and makes no backup. When there is no
# marker yet it dates one from the newest existing archive that passes gzip -t, so a recreated
# container is not reported unhealthy before its next 03:15 run had a chance. With no intact
# archive at all the marker stays missing and the healthcheck's start period covers the first
# night. gzip -t is a weaker check than the nightly integrity_check (the plain .sqlite is gone).
if [ "${1:-}" = "seed" ]; then
  if [ -e "$MARKER" ]; then exit 0; fi
  # Names carry a sortable YYYYMMDD-HHMM stamp, so reverse name order is newest first.
  for ARCHIVE in $(ls -1r /backups/rr-*.sqlite.gz 2>/dev/null); do
    if gzip -t "$ARCHIVE" 2>/dev/null; then
      printf '%s %s\n' "$(date -u -r "$ARCHIVE" +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$ARCHIVE")" > "$MARKER"
      touch -r "$ARCHIVE" "$MARKER"
      echo "seeded $MARKER from $(basename "$ARCHIVE")"
      exit 0
    fi
    echo "seed: $(basename "$ARCHIVE") failed gzip -t, skipped"
  done
  echo "seed: no intact archive, no marker written"
  exit 0
fi

[ -f "$SRC" ] || { echo "no db yet"; exit 0; }
STAMP=$(date +%Y%m%d-%H%M)
OUT=/backups/rr-$STAMP.sqlite
# A failed or interrupted run must not leave a half-written copy behind looking like a backup.
# gzip -f removes $OUT itself once it succeeds, so the trap is a no-op after that point.
trap 'rm -f "$OUT"' EXIT
sqlite3 "$SRC" ".backup '$OUT'"
# Verify before it counts: a truncated .backup would otherwise sit in the folder looking good.
CHECK=$(sqlite3 "$OUT" "PRAGMA integrity_check;" | head -n 1)
if [ "$CHECK" != "ok" ]; then
  echo "backup FAILED integrity_check: ${CHECK:-no result}"
  exit 1
fi
gzip -f "$OUT"
if ! gzip -t "$OUT.gz"; then
  echo "backup FAILED gzip -t rr-$STAMP.sqlite.gz"
  rm -f "$OUT.gz"
  exit 1
fi
find /backups -name 'rr-*.sqlite.gz' -mtime +30 -delete
printf '%s rr-%s.sqlite.gz\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STAMP" > "$MARKER"
echo "backup ok rr-$STAMP.sqlite.gz"
