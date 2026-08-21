#!/usr/bin/env bash
# Post-deploy probes for the hardened backend (W1 Task 11). Read-only except
# intentionally-rejected POSTs. Usage: tools/probe-live.sh [worker-origin] [pages-origin]
set -u
W="${1:-https://backend.rr-admin-panel.workers.dev}"
P="${2:-https://rr-admin-panel.pages.dev}"
pass=0; fail=0
check() { # name, expected-substring, actual
  if printf '%s' "$3" | grep -q -- "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1  (got: $(printf '%s' "$3" | head -c 160))"; fail=$((fail+1)); fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
hdr()  { curl -s -D - -o /dev/null "$@"; }

check "worker: unsigned ingest -> 401"         "401" "$(code -X POST -H 'content-type: application/json' -d '{}' "$W/api/ingest")"
check "worker: /api/health 200"                "200" "$(code "$W/api/health")"
check "worker: /api/health has no counts"      "ok"  "$(curl -s "$W/api/health" | grep -v lifetimeEvents | head -c 20)"
cors=$(hdr -X OPTIONS "$W/api/ingest" | tr 'A-Z' 'a-z' | grep -c 'access-control-allow-origin')
check "worker: no CORS on /api/ingest"         "0"   "$cors"
check "worker: media keeps CORS"               "access-control-allow-origin" "$(hdr "$W/media/rr-connection-test.txt" | tr 'A-Z' 'a-z')"
check "worker: register bad body -> 400"       "400" "$(code -X POST -H 'content-type: application/json' -d '{"install_id":"x"}' "$W/api/install/register")"
burst=0; for i in $(seq 1 70); do c=$(code -X POST -H 'content-type: application/json' -d '{}' "$W/api/ingest"); if [ "$c" = "429" ]; then burst=1; break; fi; done
check "worker: burst of 70 hits 429"           "1"   "$burst"
check "pages: /api/admin/data -> 302 (Access)" "302" "$(code "$P/api/admin/data")"
check "pages: forged jwt still 302"            "302" "$(code -H 'cf-access-jwt-assertion: forged' "$P/api/admin/data")"
check "pages: access/status GET -> 405"        "405" "$(code "$P/api/access/status?hwid=PROBE")"
check "pages: usage/status unsigned -> 401"    "401" "$(code "$P/api/usage/status?hwid=PROBE")"
check "pages: announcements 200"               "200" "$(code "$P/api/announcements/active")"
check "pages: feedback bad json -> 400"        "400" "$(code -X POST -H 'content-type: application/json' -d 'nope' "$P/api/feedback")"
echo "----"; echo "passed=$pass failed=$fail"; [ "$fail" -eq 0 ]
