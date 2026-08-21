#!/bin/sh
# Nightly SQLite backup with 30-day retention. DB path matches the rr-api volume.
set -eu
SRC=/data/db/rr.sqlite
[ -f "$SRC" ] || { echo "no db yet"; exit 0; }
STAMP=$(date +%Y%m%d-%H%M)
sqlite3 "$SRC" ".backup '/backups/rr-$STAMP.sqlite'"
gzip -f "/backups/rr-$STAMP.sqlite"
find /backups -name 'rr-*.sqlite.gz' -mtime +30 -delete
echo "backup ok rr-$STAMP.sqlite.gz"
