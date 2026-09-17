# Handoff: Panel-Rework, Stand 17. September 2026 (Fortsetzung in neuem Chat)

Für einen neuen Chat im Ordner `C:\Users\cedri\source\repos\CedrickGD\RR-Admin-Panel` (Haupt-Checkout,
Branch `main`). Dieses Dokument ersetzt die Vorgeschichte; `docs/handoff-2026-09-12-panel-rework.md` enthält
die Paket-Historie (Abschnitte 2 und 6) und bleibt Nachschlagewerk. Jede Behauptung hier wurde am 17.09.
gegen Repo, Client-Repo und NAS geprüft. Hashes sind Kurzformen von `main`.

---

## 0. Wie der Besitzer arbeiten will (nicht verhandelbar)

- **Ergebnis vor Erklärung.** Kurze, konkrete Antworten auf Deutsch; die Oberfläche bleibt Englisch.
  Sichtbare Ergebnisse zeitnah als Bilder schicken (`SendUserFile`).
- **Design darf nicht schlechter werden, Farben nicht mehr werden.** Nur bestehende Tokens und die
  Primitiven unter `src/components/ds/` (`PageToolbar`, `Select`, `SegmentedControl` = Filter, `Tabs` =
  Seitenabschnitte, `TableFrame mobileLayout="stack"`, `Badge`, `Button`) sowie `src/components/KpiStatCard.tsx`
  (eine Kachel-Spezifikation). Ruhig, kompakt, sachlich. Kein horizontales Scrollen bei 390 px; Tabellen
  müssen bei 1440 (Leiste offen) und 1920 in ihren Rahmen passen — **gemessen, nicht geschätzt** (Harness,
  Abschnitt 7).
- **Jede Runde:** `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check`; Screenshots
  vorher/nachher bei 1440 und 390 mit der Besitzer-Erscheinung (dark, Hintergrund „network", Hue 310); bei
  großen Layoutänderungen vorher ein Mock. Achtung: `format:check` deckt nur `functions/**`,
  `backend-worker/**`, `shared/**` und `tests/**/*.ts` ab — geänderte Dateien unter `src/` mit
  `npx prettier --check <datei>` prüfen.
- **Nach jedem Push auf `main`: `npm run deploy:nas -- -Service …`** und die servierten Hashes nennen
  („ohne Deploy sehe ich nichts").
- **Tabu ohne ausdrückliches Okay:** `cloudflared` und `caddy` neu starten (Produktionstunnel, ~10 s 502 auf
  allen öffentlichen Adressen). Deploys nennen die Dienste explizit (`admin`, `rr-api`, `backup`,
  `docker-gateway`), nie `docker compose up` ohne Dienstliste.
- **Vor jedem Schreibzugriff auf die Live-Datenbank ein Backup** (`sqlite3 $DB ".backup '…'"`), Skripte
  erst als Probelauf, dann `--apply`, danach Summen nachlesen.
- **Git-Hygiene:** `.claude/` (inkl. `.claude/worktrees/`) und `.superdesign/` sind untracked und **nicht**
  gitignored — nie `git add -A` oder `git add .`; Dateien einzeln stagen. Commits enden mit
  `Co-Authored-By: Claude … <noreply@anthropic.com>`.
- **Handy (Samsung S26 Ultra, Wireless-adb):** nur Chrome-Tabs mit `http://127.0.0.1:4179`, nie andere Tabs
  oder Apps, nie selbst entsperren/pairen (Pairing-Codes nie eingeben, nur den Befehl nennen), nach einem
  Lauf `svc power stayon false`. Beim Übergabezeitpunkt ist **kein Gerät verbunden** (`adb devices` leer);
  der Besitzer muss Wireless-Debugging neu verbinden, der Port (zuletzt 36401) kann sich ändern.
- **Geheimnisse maskieren,** nie Env-Werte oder Kundendaten (IPs, E-Mails, HWIDs, Namen) ausgeben; nur
  Aggregate.
- **Arbeitsteilung:** Hauptschleife orchestriert, Hands-on in Subagenten/Workflows (Umsetzung stark,
  Umfragen/Screenshots/Reviews günstiger). Jede Umsetzung bekommt vor dem Deploy eine unabhängige
  Gegenprüfung (Korrektheit + Design). Bei Session-/Wochenlimit: Workflow mit `resumeFromRunId`
  fortsetzen; fertige Agenten kommen aus dem Cache.

## 1. Live-Stand

- **NAS** (UGREEN, `192.168.2.201`, SSH `cedrick.grabe`, Key `~/.ssh/id_ed25519`): Compose-Projekt in
  `/volume1/docker/razorreaper/src/RR-Admin-Panel/deploy/nas` (Git-Checkout von `main`). Dienste: `admin`
  (Caddy + Vite-Build), `rr-api` (Node 22, better-sqlite3), `bot`, `caddy`, `cloudflared`, `backup`,
  `docker-proxy`, `docker-gateway`. Daten `/volume1/docker/razorreaper/data` (DB `data/db/rr.sqlite`, Env
  `data/env/*.env`), Backups `/volume1/docker/razorreaper/backups` (im rr-api-Container read-only unter
  `/backups`), Ablage `/volume1/docker/razorreaper/tmp`.
- **Code-Stand `70ce13b`** (danach nur Docs-Commits auf `main`), serviert `index-BKWHLXSh.js` / `index-CU2wjcv8.css`, `BUILD_SHA=70ce13b` im rr-api-Container. Alle
  acht Container „Up"; die vier mit Healthcheck (`admin`, `rr-api`, `bot`, `backup`) melden „healthy",
  `caddy`, `cloudflared`, `docker-gateway`, `docker-proxy` haben keinen Healthcheck. Backup-Erfolgsmarke
  `/backups/.last-success` (zuletzt `rr-20260917-0315.sqlite.gz`).
- **Prüfen:**
  ```bash
  ssh -i ~/.ssh/id_ed25519 cedrick.grabe@192.168.2.201 'docker ps --filter name=razorreaper --format "{{.Names}} {{.Status}}"; docker exec razorreaper-admin-1 ls /srv/admin/assets | grep -E "^index-"; docker exec razorreaper-rr-api-1 printenv BUILD_SHA; cat /volume1/docker/razorreaper/backups/.last-success'
  ```
- **Deploy** (aus dem Haupt-Checkout; das Skript verlangt `HEAD == origin/main`, sonst Exit 1 mit „HEAD …
  is not origin/main … Push first"):
  ```bash
  npm run deploy:nas -- -Service admin,rr-api
  ```
  Das Skript zieht den NAS-Checkout auf `origin/main`, baut die genannten Dienste mit `BUILD_SHA=$(git
  rev-parse --short HEAD)` und druckt die servierten Hashes. Fallen: `scp` nach `/tmp` des NAS scheitert
  (sftp-Root) — Dateien per `cat file | ssh … 'cat > /volume1/docker/razorreaper/tmp/…'` oder per
  `docker cp` aus dem NAS-Checkout; ein `-Service admin`-Deploy erzeugt `rr-api` mit (gleiches Image),
  `/tmp` im Container ist danach leer.

## 2. Was in dieser Session passiert ist (16./17.09.)

1. **Review-Runde (Runde 2), live `c106047`:** 11 bestätigte Befunde plus zwei Co-Review-Korrekturen.
   Eine gemeinsame Fehler-Regel `src/utils/errorEvents.ts` (Wächter-Test `tests/error-events.test.ts`
   fällt bei jeder Kopie); Customer 360 mit getrennten Budgets für echte/Hintergrundfehler; System health
   unterscheidet ausgefallene von fehlenden Quellen, zeigt den Stale-Zustand und Neustarts als „—";
   **Docker-Gateway** (`deploy/nas/docker-gateway/Caddyfile`, Service `docker-gateway`) lässt nur
   `GET /containers/json` (auf das Compose-Projekt gefiltert) und `GET /containers/razorreaper-<svc>-<n>/stats`
   durch, alles andere → 403 (Grund: `inspect` liefert `Config.Env` aller Container, auch `admin.env` mit
   `ORIGIN_KEY` und `rr-api.env` mit 35 Schlüsseln); `BUILD_SHA` kommt aus dem Image-ENV (leere Zeile in
   `rr-api.env` entfernt, Sicherung `data/env/rr-api.env.bak-20260914`).
2. **Sitzungszähler:** `deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs` fasst nur Sitzungen an,
   deren eigenes `session_start` erhalten ist (Vorlauf ≤ 10 min erlaubt, `SESSION_START_PRELUDE_MS`);
   Probelauf ist Standard, `--apply` schreibt, `updated_at` wird nie angefasst; `--repair-status` nie ohne
   eigenen Probelauf. `restore-session-error-counts.mjs --backup /backups/rr-pre-errors-20260913.sqlite` hat
   die vom schwächeren Lauf (13.09.) genullten, unbeweisbaren Zähler zurückgeholt: 9 Sitzungen, +3.344,
   Summe 902 → 4.246 (Stand 16.09., bewegt sich mit dem Betrieb; nachlesen mit
   `sqlite3 -readonly $DB "SELECT count(*), sum(error_count) FROM app_sessions"`). Backups:
   `rr-pre-errors-20260913.sqlite`, `rr-pre-round2-20260916T1852Z.sqlite`.
3. **Runde 3, live `fea1cce`:** Melde-Vertrag v2 (`shared/telemetry-contract.ts`: `fault_source`,
   `report_kind`, `occurrences`, `top_frame`, `top_frames`; „Background faults" summiert Vorkommen, gruppiert
   nach Herkunft und oberstem eigenen Frame; alte Clients weiterhin verstanden); Container-Cache ≥
   Abfragetakt; `/api/admin/health` auf die gelesene Sonde gekürzt; Kartenkopf am Handy öffnet Customer 360;
   Lizenztabelle passt bei 1440; `deploy/nas/backup/backup.sh` prüft die Kopie (`gzip -t`, ≥ 1 MB,
   `app_sessions`-Zeilen) und schreibt `/backups/.last-success`; Healthcheck `find … -mmin -2160` (36 h),
   `start_period` 26 h; System health zeigt das Alter der letzten *geprüften* Sicherung.
4. **Kundenverzeichnis, live `5e18004`:** Spalte „Last IP" (die Zusammenfassung in `functions/_lib/stats.ts`
   trägt IP der neuesten Sitzung + Adresszahl; die Daten lagen immer in `app_sessions.client_ip`), Customer
   360 zeigt IP/Ort/Anzahl, neuer **Excel-Export** des gefilterten Verzeichnisses
   (`rr-customers-<yyyy-mm-dd>.xlsx`, Knopf in der Kopfzeile, alle Seiten), „Client IP" im Export der
   Session history; die gestapelte Spalte „App access / Support" ist durch **eine Statusspalte** ersetzt
   (Badges nur bei Auffälligkeit, sonst „—"; `directoryStatus` in `src/utils/userDirectory.ts` teilt die
   Regel mit „Needs attention"). Breite: bei 1920 (Leiste offen) IP statt Ort, bei 1440 IP ausgeblendet
   (Karte, Export und Customer 360 haben sie).
5. **Session history am Handy, live `70ce13b`:** aus drei echten Handy-Screenshots des Besitzers —
   Tageszeitleiste zeigt jetzt alle 24 h mit Ticks 00/06/12/18/24 und Online-Zeit je Tag, gewähltes Segment
   nennt seine Zeit inline; Touch-Geräte bekommen „Tap …" statt „Hover …" (`src/hooks/useMediaQuery.ts`);
   Kennzahlen als kompaktes Raster; „Map" und „Customer workspace" in einer Reihe; Hardware-ID nur einmal
   mit Kopierknopf; Filter-Pillen ohne verwaiste zweite Zeile (Label „Errors“ statt „With errors“, auch am
   Desktop); kompakte Zeilen mit festen Seitenspalten (44 px / 50 px), damit Spuren und Achse dieselben
   Kanten haben — nachgemessen: Streuung 0,00 px bei 390. Dateien: `src/pages/WorkersPage.tsx`,
   `src/components/UserActivityPanel.tsx`, `src/utils/activityTimeline.ts`,
   `src/theme/session-history-workspace.css` (Ursprung der Probleme: Umgestaltung `de18d5d`).
   **Noch ohne Lauf auf dem echten Handy** — siehe Abschnitt 4.
6. **Desktop-Client (Repo `C:\Users\cedri\source\repos\CedrickGD\RazorReaper`):** Branch
   **`fix/client-tidy`** (`e572c90`, auf GitHub, 32 Commits vor `master`, Review „ship") behebt die
   RR-E1003-Ursachen: abbrechbare UDP-Abfragen (`ServerQueryService`), `RenderDispatch`-Schleuse statt ~60
   verworfener `InvokeAsync`, kein `async void` mehr (vier `System.Threading.Timer`-Rückrufe konnten den
   Prozess beenden), thread-sichere Benachrichtigungen, gedrosselte Meldung (eine Zeile je Fehlerart pro
   Sitzung + 5-min-Sammelzeilen, mit oberstem eigenen Frame), Unterdrückung auf die Discord-Pipe eingegrenzt.
   Zahlen aus dem letzten Lauf (367 Tests, 0 Warnungen) liegen in keinem Log — vor einer Aussage
   `dotnet test tests/RazorReaper.UnitTests` selbst laufen lassen. **Nicht veröffentlicht, keine
   Version/`update.xml` geändert — das ist der Knopf des Besitzers.**

## 3. Client-Release (bereit, sobald der Besitzer will)

- Das Panel versteht den neuen Vertrag seit `fea1cce`; Reihenfolge (Panel zuerst) ist eingehalten.
- Vor dem Release wissen: **Eine Komponente, die zehnmal hintereinander beim Neuzeichnen fehlschlägt, hört
  für den Rest der Sitzung auf, sich zu aktualisieren** (bewusst; gegen eine echte BlazorWebView nicht
  verifiziert). Release-Prozess (Version, `update.xml`, Installer) wie bisher beim Besitzer.
- Danach im Panel beobachten: Errors → Background faults (Spalten Herkunft/Top frame, Summen); die
  NullReference-Familie trägt dann einen Frame, SocketException 995 sollte verschwinden. Übergangsweise
  erscheinen Zeilen alter Clients ohne Frame neben den 1.5.3-Gruppen derselben Ausnahme.
- Die anderen sieben `fix/*`-Branches im Client-Repo sind Vorfahren von `fix/client-tidy` und können
  gelöscht werden. Junctions `C:\Users\cedri\rri|rrm|rrt|rrwt|rrwtc` (MAX_PATH-Umgehung) zeigen in den
  Sitzungs-Scratchpad und hängen, sobald der weg ist — `cmd /c rmdir <junction>` entfernt nur den Link.

## 4. Unmittelbar als Nächstes

1. **Echtes-Handy-Lauf** (`.local/visual-harness/phone.mjs`, siehe Abschnitt 7) für die Session history
   (Zeitleiste, Segment-Tipp, aufgeklappte Zeile) und den Kartentipp im Kundenverzeichnis; vorher muss der
   Besitzer das Gerät neu verbinden.
2. Danach die offenen Punkte aus Abschnitt 5 vorschlagen und nach Zustimmung abarbeiten.

## 5. Offene Punkte und Entscheidungen des Besitzers

- **Caddy- und Cloudflared-Healthchecks** (Plan vorhanden: cloudflared `--metrics` + `/ready`, Caddy-Liveness):
  je ein Neustart, ~10 s 502 auf allen öffentlichen Adressen — nur mit ausdrücklichem Okay und Zeitfenster.
- **Arne (15-Minuten-Sessions):** Cloudflare Zero Trust → Access-Application: Allow-Policy mit seiner E-Mail,
  keine „Temporary authentication", längere Session-Dauer. Nur im Dashboard möglich.
- **Bot-Status in System health** (Guild/Reconcile): braucht eine `/health`-Erweiterung im Bot-Repo hinter dem
  `NOTIFIER_TOKEN`; der NAS-Bot ist **nicht** abgedriftet (Unterschied war nur CRLF). Ein Bot-Deploy startet
  ihn neu (~3 s, SSE-Clients fallen ab).
- **Serverseitige Drosselung** identischer Hintergrundfehler beim Speichern: nach dem Client-Release
  vermutlich unnötig; alte Clients (1.4.8.11/1.4.9) fluten weiter, bis sie aktualisieren.
- **1920: Ort oder IP in der Tabelle** (heute IP) — Einzeiler in den Spaltenklassen (`col-lg`/`col-xl`).
- **Restrictions-Tab:** Namenslink noch alt (`src/components/CustomerRestrictions.tsx`), gleiche
  `RecordOpen`-Behandlung wie das Verzeichnis wäre konsequent.
- **Lizenzen:** Dauer/Nutzung unter ~1502 px Rahmen nur unter „Device details" (`src/theme/app-glue.css`).
- **Nicht zurückgerechnet:** `telemetry_counters` (Lifetime-Zähler pro Dienst), ohne Leser in `src/`.
- Kleinere Entscheidungen aus Runde 3: Pages-`/api/health` flache Form oder gekürztes Objekt; ob `App.tsx`
  weiter auf `health` als Render-Gate wartet; `RuntimeEnv.CF_PAGES_BRANCH` ohne Leser.

## 6. Aufräumen (gefahrlos)

- **Alle lokalen Branches sind in `main` enthalten** (auch die `fix/*`- und `r3/*`-Zwischenstände).
  Ausnahme in der Form: `fix/round-2` besteht nur aus Merge-Commits, deren Inhalt in `main` liegt — kein
  Vorfahr, daher `git branch -D`.
- **Worktrees:** 21 im Sitzungs-Scratchpad
  `C:\Users\cedri\AppData\Local\Temp\claude\C--Users-cedri-source-repos-CedrickGD-RR-Admin-Panel\45426ab3-c2f4-4ad6-9e38-0ef177ecd6c8\scratchpad\`
  (`wt-*`, `gwfix`, `round2b`, `wt-tlcheck`) und 6 unter `.claude\worktrees\`. Reihenfolge: `git worktree remove <pfad>`
  (oder `git worktree prune`, wenn der Scratchpad weg ist), erst dann die Branches löschen — ein Branch, der
  in einem Worktree ausgecheckt ist, lässt sich nicht löschen.
- `.local/` ist gitignored und liegt nur im Haupt-Checkout (die Harness-Skripte aus den Worktrees wurden am
  17.09. dorthin gerettet).

## 7. Werkzeuge

- **Fixture-Preview** (ganzes Panel ohne Login, Port 4179):
  `node_modules/.bin/vite --config .local/panel-consistency-4fd4a24/preview.config.ts --port 4179 --strictPort`
  (Konfiguration nie ändern, solange der Server läuft).
- **Headless-Harness** `.local/visual-harness/`: `harness.mjs` (exportiert `connect`, `gotoClean`, `shot`,
  `waitReady`, `apiCapture`, `warmup`, `PROBE`); Beispiele `shots-errors.mjs` + `errors-fixture.mjs`
  (Besitzer-Erscheinung, Viewports 1440×900 und 390×844, Overflow-Messung), `shots-round3.mjs` +
  `round3-fixtures.mjs`, `shots-directory.mjs` + `directory-fixture.mjs`, `shots-session-history.mjs`,
  `measure-tiles.mjs`; Muster: Preview starten, `BASE` auf den Port zeigen, Skript schreibt PNGs +
  `overflow.json` (`scrollWidth` vs `clientWidth`) + `notes.json`.
- **Handy:** adb aus winget `Google.PlatformTools`, Gerät zuletzt `192.168.2.210:36401`;
  `adb reverse tcp:4179 tcp:4179` und `adb forward tcp:9223 localabstract:chrome_devtools_remote` gehen bei
  Reconnect verloren (leere Seite mit hängendem Ladebalken = neu setzen). `phone.mjs smoke|scenarios|heatmap`.
- **Datenbank:** `sqlite3 -readonly` auf dem NAS-Host; `telemetry_events.ts` ist ISO-Text (`…T…Z`), nie
  `datetime('now')` vergleichen, sondern ISO-Literale oder `strftime('%Y-%m-%dT%H:%M:%fZ', …)`.
- **Skripte im Container:** `docker cp deploy/nas/rr-api/scripts/<x>.mjs razorreaper-rr-api-1:/tmp/` und
  `docker exec -w /app razorreaper-rr-api-1 node /tmp/<x>.mjs …`.
- **Worktrees ohne `npm install`:** `cmd /c mklink /J "<worktree>\node_modules" "<checkout>\node_modules"`
  (ebenso `deploy\nas\rr-api\node_modules`; das better-sqlite3-Binary liegt dort).

## 8. Startprompt für den neuen Chat

> Lies `docs/handoff-2026-09-17-session.md` im RR-Admin-Panel-Repo (alles Wichtige steht dort;
> `docs/handoff-2026-09-12-panel-rework.md` nur bei Bedarf) und die Memories
> `rr-admin-panel-handoff-2026-09-17`, `rr-admin-panel-deploy-path`, `rr-admin-panel-user-expectations`.
> Halte dich an Abschnitt 0. Prüfe zuerst den Live-Stand (Abschnitt 1) und melde ihn mir kurz. Dann
> Abschnitt 4: Ich verbinde das Handy, du machst den Echtes-Handy-Lauf für Session history und Kartentipp und
> behebst, was dabei auffällt. Danach schlägst du die offenen Punkte aus Abschnitt 5 in sinnvoller
> Reihenfolge vor — Tunnel/Caddy nur mit meinem Okay, Client-Release ist mein Knopf. Hands-on in
> Subagenten/Workflows mit unabhängiger Gegenprüfung, pro Runde Gate + Screenshots bei 1440 und 390, nach
> jedem Push `npm run deploy:nas` und die Hashes nennen. Zeig mir zeitnah sichtbare Ergebnisse als Bilder,
> antworte kurz und auf Deutsch.
