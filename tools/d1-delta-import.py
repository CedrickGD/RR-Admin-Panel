# Delta import for the cut-over: rows present in the T1 export but not (verbatim) in the T0 export.
#  - worker-written tables (NAS received writes since the worker flip): INSERT OR IGNORE (NAS wins);
#    telemetry_events additionally drops the autoincrement id (event_id UNIQUE dedups).
#  - Pages-only tables (D1 authoritative until the Pages flip): INSERT OR REPLACE (D1 wins) —
#    only for rows that actually changed/appeared in D1 between T0 and T1.
#  - DDL / PRAGMA / sqlite_sequence lines are dropped.
import sys, re
t0, t1, dst = sys.argv[1], sys.argv[2], sys.argv[3]
IGNORE = {"telemetry_events"}
REPLACE = {"licenses", "access_suspensions", "discord_links", "feature_usage", "feedback", "announcements", "admin_users", "app_sessions", "installs", "telemetry_counters"}
ins = re.compile(r'^INSERT INTO "?([A-Za-z_]+)"?\s')
seen = set()
with open(t0, encoding="utf-8") as f:
    for line in f:
        if ins.match(line):
            seen.add(line)
counts, out_lines = {}, []
with open(t1, encoding="utf-8") as f:
    for line in f:
        m = ins.match(line)
        if not m or line in seen:
            continue
        t = m.group(1)
        if t == "sqlite_sequence":
            continue
        if t in REPLACE:
            line = line.replace("INSERT INTO", "INSERT OR REPLACE INTO", 1)
        else:
            line = line.replace("INSERT INTO", "INSERT OR IGNORE INTO", 1)
            if t == "telemetry_events":
                # drop the leading "id" column + its value so autoincrement assigns a fresh id
                line = line.replace('("id","event_id"', '("event_id"', 1)
                line = re.sub(r'VALUES\(\d+,', 'VALUES(', line, count=1)
        counts[t] = counts.get(t, 0) + 1
        out_lines.append(line)
with open(dst, "w", encoding="utf-8", newline="\n") as out:
    out.write("PRAGMA foreign_keys=OFF;\nBEGIN;\n")
    out.writelines(out_lines)
    out.write("COMMIT;\n")
print(f"delta statements: {len(out_lines)}")
for t, n in sorted(counts.items()):
    print(f"  {t:<24} {n}  ({'REPLACE' if t in REPLACE else 'IGNORE'})")
