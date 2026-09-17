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

---

## 9. Nachtrag: Cloud-Session 17.09. (Branch `claude/rr-admin-panel-handoff-gm8xfg`, Stand `a1c0646`)

Diese Fortsetzung lief in einem Cloud-Container (Claude Code Remote): **kein `ssh` zum NAS, kein `adb`,
kein LAN** — deshalb kein Deploy und kein Lauf auf dem echten Handy. Alles unten ist auf dem Branch
`claude/rr-admin-panel-handoff-gm8xfg` gepusht (Basis `7f0826f` = `main`), **nicht** auf `main`.

- **Live-Stand geprüft (indirekt):** `rr-admin-panel.pages.dev` (deployt automatisch von `main`) servierte
  `index-BKWHLXSh.js` / `index-CU2wjcv8.css`; ein lokaler Build von `main` (`7f0826f`) ergibt exakt diese
  Hashes → Frontend live = `70ce13b`. `api.razorreaper.app/api/health` → 200. Container-Status, `BUILD_SHA`
  und Backup-Marke waren von hier nicht prüfbar.
- **Handy-Lauf emuliert** (Headless-Chromium, Touch, 390×844 @3 und 412×915 @3.5 „S-Ultra“, dazu 1440×900
  mit offener Leiste; Erscheinung dark/network/310). Fixture-Preview und Harness neu aufgebaut (siehe unten).
  Bestätigt: Spur/Achse-Kanten Streuung 0,00 px, „Tap …“ am Handy, kein horizontales Scrollen. Neun Befunde,
  jeder von zwei unabhängigen Prüfern gemessen, acht davon behoben:
  `a7284e1` Achsen-Labels kollidierten bei 412 px („00:006:00“) — Budget für die randverankerten Labels;
  `4e09f3e` + `5a7af09` Aufklapp-Chevron saß als Fußzeile unten links (consistency.css-Regel gewann) — wieder
  oben rechts, Karten ~60 px kürzer, Freiraum nur in der Chevron-Zeile;
  `884f22d` Auswahlzeile nach Segment-Tipp einzeilig („Wed 16 · 20:00–≈20:55 · 55m“);
  `bd54689` Mitternachts-Segment ragte 2 px über die Spur — späte Balken hängen rechts;
  `20ef1cd` Hover-Farbe nur bei `(hover: hover)`;
  `bd3bb9a` Customer 360 „Recent history“: Zeitstempel saß unter dem Punkt („5m / ago“) — `RelativeTime`
  trägt jetzt die Klasse, die das Grid erwartet;
  `ae55548` IPv6 „Last IP“ in der Karte brach in 4 Zeilen — volle Zeile;
  `ea0d5d6` Export-Knopf im Verzeichnis 34 → 44 px am Handy;
  `f6c85bf` Achsen-Fallback nimmt kurze Labels.
  **Nicht angefasst (F3):** 6×12-px-Segmentpillen an dichten Tagen überlappen — die neue Intervall-Liste ist
  die lesbare Fläche dafür.
- **Online-Zeiten detailliert** (Wunsch des Besitzers: „nicht nur die 0815-Übersicht“). Drei Prototypen,
  zwei Juroren, Gewinner „Exact online intervals“: `c7b40d4`, `21e0703`, `449fb78`, `94a55a6`, `76351d0`,
  `af2b001`. Unter Legende und Pager ein Kasten mit jeder Online-Phase als Zeile (Start – Ende – Dauer, Mono,
  „≈“ bei Heartbeat-Ende), nach Tag gruppiert; Tageskopf „Wed, 16 Sept 2026 · 3h 24m · 10 intervals ·
  first 09:00 · last ≈20:55“; neueste 7 Aktivtage offen, ältere gefaltet; Datum/Online-Zelle in der Leiste
  springt zum Tag; angetipptes Segment hebt seine Zeile hervor; Mitternacht als „from previous day“ /
  „into next day“; eine Dauerform im ganzen Panel („35m“, nie „35m 0s“); Desktop mehrspaltig
  (1440: 4 Spalten). Light-Theme nimmt `--surface-2` wie die Leiste. Dateien: `src/components/UserActivityPanel.tsx`,
  `src/utils/activityTimeline.ts`, `src/index.css`, `src/theme/operations.css`, Tests in
  `tests/activity-timeline.test.ts`, `tests/user-activity-panel.test.tsx`.
- **PWA / WebAPK** (`8c139cb`, `a1c0646`): `static/manifest.json` (id/start_url/scope „/“, standalone,
  Farben = `--bg` `#050505`), Icons 192/512 „any“ + 512 „maskable“ + Apple-Touch-Icon aus `src/img/logo.ico`,
  `vite.config.ts` `publicDir: static/`, `_headers`-Regeln, `deploy/nas/admin/Dockerfile` kopiert `static/`.
  **Bewusst ohne Service Worker** (Chrome braucht seit 108 keinen; ein Worker könnte das Access-302
  verschlucken). `<link rel="manifest" crossorigin="use-credentials">`, damit das Access-Cookie mitgeht.
  Installation: Android Chrome auf `admin.razorreaper.app` → Menü → „App installieren“ (nicht „Zum
  Startbildschirm“); danach `chrome://webapks`. Falls nur die Verknüpfung angeboten wird: Access-Bypass für
  `/manifest.json` und `/icons/*` erwägen (Punkt in Abschnitt 5).
- **Gate auf `a1c0646`:** Typecheck grün, 107 Testdateien / 1276 Tests grün, Build grün
  (`index-DgX6BsKK.js` / `index-CJe2ghPK.css`), `format:check` grün, Prettier auf allen geänderten
  `src/`-, `tests/`-, `static/`-Dateien grün. Jede Runde hatte eine unabhängige Gegenprüfung (Korrektheit +
  Design) mit eigenen Messskripten.
- **Schritte des Besitzers:** `git fetch origin && git merge --ff-only origin/claude/rr-admin-panel-handoff-gm8xfg`
  auf `main`, push, dann `npm run deploy:nas -- -Service admin,rr-api` (Dockerfile geändert → Image-Rebuild);
  erwartete Hashes `index-DgX6BsKK.js` / `index-CJe2ghPK.css`. Danach der echte Handy-Lauf (`phone.mjs`)
  für Session history (Liste, Tageskopf, Segment-Tipp, Chevron) und Kartentipp — die Emulation ersetzt ihn
  nicht (Schriftrendering, echte Touch-Treffer).
- **Harness:** `.local/` ist gitignored; die in dieser Session gebaute Fixture-Preview (`preview.config.ts`,
  `fixture-api.ts`, typisierte `fixtures.ts`, `harness.mjs`, Szenario- und Messskripte, Font-Cache) wurde als
  `visual-harness-2026-09-17.tgz` an den Besitzer geschickt — nach `.local/visual-harness/` entpacken,
  `bash .local/visual-harness/run.sh` startet die Preview auf 4179 ohne Login; Playwright (`playwright-core`)
  wird per Pfad importiert (`HARNESS_*`-Umgebungsvariablen in `harness.mjs`).
- **Abschnitt 5, vorgeschlagene Reihenfolge:** (1) 1920: Ort statt IP (Einzeiler `col-lg`/`col-xl`);
  (2) Restrictions-Tab: Namenslink auf `RecordOpen`; (3) Lizenzen unter 1502 px; (4) Runde-3-Kleinigkeiten
  (`/api/health` flach, `App.tsx`-Render-Gate, `CF_PAGES_BRANCH`); (5) Bot-Status in System health (braucht
  Bot-Repo, Bot-Neustart ~3 s); (6) Serverseitige Drosselung erst nach dem Client-Release entscheiden;
  (7) Caddy-/Cloudflared-Healthchecks nur mit Okay und Zeitfenster; (8) Arne-Session-Dauer im Zero-Trust-Dashboard
  (nur Besitzer). Client-Release (`fix/client-tidy`) bleibt der Knopf des Besitzers.

## 10. Nachtrag 2: Abschnitt-5-Punkte und Voll-Audit (Cloud-Session, `main` bis `9e6b727`)

Der Besitzer hat den Branch-Umweg aufgehoben („arbeite einfach in production“; Handy-Test „egal, nur
anschaulich“) — seitdem geht alles direkt auf `main`. Pages baut automatisch; das NAS bekommt es erst mit
`npm run deploy:nas -- -Service admin,rr-api` (Dockerfile/Dockerignore geändert → Image-Rebuild).
Erwartete Hashes nach dem Deploy: `index-CKb6aeqR.js` / `index-DtfKblXr.css`.

- **Abschnitt 5 erledigt** (`64bf15c`, `164fb45`, `d9c7782`, `89e8630`): 1920 mit offener Leiste zeigt
  **Ort statt IP** (beide zusammen bräuchten 1722 px bei 1610 px Rahmen — gemessen; `col-lg`-Schwelle
  1537 → 1560 px, 1440 unverändert); Restrictions-Namenszelle ist jetzt `RecordOpen` wie im Verzeichnis
  (Kartenkopf = Tippziel, 44 px); `RuntimeEnv.CF_PAGES_BRANCH` entfernt (kein Leser).
- **Voll-Audit** (Fixtures erweitert: 44 Kunden, Feedback/Announcements/Team/System/Errors gefüllt; 14 Seiten ×
  1440/1920/390/412, Light-Theme, Touch, statische Design-Regeln, Code-Review des Diffs seit `7f0826f`,
  Deploy-Konfiguration): 47 Rohbefunde → 44 gegengeprüft (Repro-Linse je Gruppe + Besitzer-Linse), 41 bestätigt,
  **28 Commits** (`02bac58`…`9e6b727`), Gate grün (Typecheck, 107 Dateien / 1289 Tests, Build, Prettier),
  Design-Review „ship“; Korrektheits-Review hat alle 26 Fixes nachgemessen (14 Seiten ohne Regression), aber
  seinen Abschlussbericht nicht abgesetzt (Transkript liegt im Workflow-Ordner der Session).
  Wichtigste Fixes: Issue-license-Dialog deckend statt halbtransparent; 44-px-Dialogknöpfe/-Eingaben bei
  grobem Zeiger; Restrictions-Toolbar 44 px; Errors-Tabelle passte bei 1440 nicht in den Rahmen (jetzt
  1130/1130), Fehler-Chips brechen am Handy unter die Meldung; Announcement-Karten schnitten das
  „Until“-Datum ab; Berechtigungsmatrix im Mitglieder-Dialog scrollte 450 px seitlich (jetzt gestapelte
  Karten, Eingabe volle Breite); Karten-Zoom-Icons im Light-Theme weiß auf weiß; „offline“-Label 2,3:1 →
  5,8:1; 76 ungeschützte `:hover`-Regeln unter `@media (hover: hover)` (Karten/Kacheln/Buttons blieben nach
  Tipp „angefasst“); Scrollbar-Farbe aus dem Token; Fokus-Rückgabe nach „Back“ am Handy; Light-Theme-Flächen
  der Fehlergruppen und Achsenbeschriftungen (≥ 4,5:1); Session-history-Pager bleibt in der Karte.
- **Deploy-Änderungen, die man kennen sollte:** `tools/deploy-nas.ps1` holt vor der Origin-Prüfung `git fetch`,
  prüft Exit-Codes, räumt nach dem Build **nur dangling Images** (`docker image prune -f`) und scheitert nicht
  mehr am Status-`grep`; Root-`.dockerignore` ist jetzt für beide Images ein brauchbarer Fallback (behält
  `public/`, `src/`; schließt `.local/`, `.superdesign/` aus); Admin-Caddyfile cached `/icons/*` und das
  Apple-Icon einen Tag; Pages-`_headers` sendet dieselben Security-Header wie der Admin-Host; alles in
  `tests/nas-admin-deployment.test.ts` festgenagelt. **cloudflared/caddy unangetastet.**
- **Entscheidungen des Besitzers (aus der Besitzer-Linse, nicht umgesetzt):** Admin-only-Deploy ohne
  rr-api-Neustart (`--no-deps`)? · Customer-360-Leiste am Handy im Stuck-Zustand ohne die drei Aktionsknöpfe? ·
  Traffic: fünfte KPI-Kachel am Handy volle Breite (heute so) oder gleiche Anatomie? · Accent-Swatches in
  Settings 29 px — Trefferfläche vergrößern? · Segment-Beschriftung `--on-accent` statt Weiß (ändert die
  Balken bei dunklem Akzent)? · Einheitliches `<details>`-Idiom (Chevron-Mehrheit) statt vier Varianten? ·
  Eine Liste grober-Zeiger-Größen in consistency.css statt verstreuter Regeln · Customer-360-Tabs auf
  `ds/Tabs`? · Vier `btn`-klassige Roh-Buttons auf `ds/Button`? · exakte Token-Duplikate mechanisch
  ersetzen? · Achsen-Ticks an DST-Tagen (2 % Drift) · Healthchecks für `docker-gateway`/`docker-proxy`
  (ohne Tunnel-Neustart möglich) — Caddy/Cloudflared weiterhin nur mit Okay.
- **Nits (nur notiert):** Verzeichnis-Ellipsen bei 1920 (Device/OS, Ort) und 1440 (Kontakt); Versions-KPI-
  Unterzeile bricht bei 1440; Weltkarten-Menü überragt das Regional-load-Panel am Handy; Lizenztabelle
  reflowt beim Öffnen von Details; Karten-Basemap-Palette und Settings-Vorschauen mit Hex-Literalen;
  Fehler-Occurrence-Zeile 11 px über dem Chip bei 390 (vorbestehend).

## 11. Nachtrag 3: Feedback | Support, Client-Overlays, Release-Vorschlag (Panel `main` bis `deef024`, Client `fix/client-tidy` bis `629ab3e`)

- **Vertrag `kind`** (`shared/feedback-contract.ts`): `POST /api/feedback` nimmt optional `"kind": "feedback" | "support"`;
  fehlt/ungültig → `support`, wenn ein Diagnose-Snapshot dabei ist, sonst `feedback` (alte Clients landen richtig).
  `GET /api/admin/feedback[?kind=…]` liefert `kind` je Datensatz und `unread: { feedback, support, total }`;
  `PUT …/:id { status }` und `DELETE …/:id` für beide Arten. Spalte `feedback.kind` kommt beim ersten Aufruf
  per Ensure (Backfill Diagnose-Zeilen → support, Marker in `schema_markers`); Migration
  `tools/migrations/2026-09-17-feedback-kind.sql` optional. Rail-Eintrag „Feedback & support“, Tabs Feedback | Support
  (`?section=support`), je Bereich Inbox/New/Read/Archived, Mark read, Archive, Replies, Delete; Customer 360 zeigt die Art.
  Gate: 111 Dateien / 1330 Tests. **Deploy:** `npm run deploy:nas -- -Service admin,rr-api` (Hashes danach
  `index-CGY-Pw0I.js` / `index-Ckexgfaj.css`).
- **Client (`fix/client-tidy`, 15 Commits über `e572c90`, nichts veröffentlicht):** Lizenz-Widget und Support-Karte
  von Home entfernt; Sidebar-Statuszeile (Premium/Freemium) ist ein Button → `LicenseOverlay` (Vollfenster, rotes X,
  Esc, Fokusfalle, Aktivierung nur noch dort, keine Bewegungsanimation; Freemium rot wie die Statuszeile);
  `/feedback` = „Feedback & Support“ mit zwei Bereichen (Pflichttext), `?section=support` als Deep-Link,
  `SendDiagnosticsButton` navigiert dorthin; Payload trägt `kind`; Postbox-Link entfernt, stattdessen
  `NotificationIndicator` (Glocke neben der Statuszeile: Punkt bei ungelesener Antwort oder neuer Version, endlicher
  Puls, `inbox-plop.wav` bei neuer Antwort unter „Enable UI sounds“) → `WhatsNewOverlay` (Notes aus `update.xml`,
  „Update now“ über den AutoUpdateManager, Inbox-Vorschau, `rr.whatsnew.lastseenrelease`). **Kein dotnet in der
  Cloud-Session:** alles nur per Inspektion und statischen HTML-Mocks mit dem echten CSS geprüft — vor dem Anfassen
  `dotnet build RazorReaper/RazorReaper.csproj` und `dotnet test tests/RazorReaper.UnitTests`; Checkliste in den
  Commit-Texten. Reihenfolge bleibt: Panel deployen, dann Client-Release (Version/`update.xml`/Installer = Besitzer).
- **Release-Seite im Panel (vorgeschlagen, wartet auf zwei Antworten):** (1) Installer künftig auf einem
  GitHub-Windows-Runner bauen (dotnet 10 preview + MAUI-Workload + Inno Setup) statt lokal — hängt Lokales am Build?
  (2) Fine-grained GitHub-Token (Actions + Contents read/write auf `CedrickGD/RazorReaper`) in `rr-api.env`.
  Plan: `workflow_dispatch` mit `version` + `notes` schreibt csproj/iss/`update.xml`, baut, legt den Release an;
  `update-manifest.yml` und Discord-Notify laufen wie heute weiter. Panel: Notes-Entwurf, freie Versionswahl,
  „Release auslösen“, Lauf-Status, Historie.
