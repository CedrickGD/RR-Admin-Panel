# Handoff: Panel-Rework, Stand 17. September 2026 (Fortsetzung in neuem Chat)

Für einen neuen Chat im Ordner `C:\Users\cedri\source\repos\CedrickGD\RR-Admin-Panel`. Dieses Dokument
ersetzt die Vorgeschichte; das ältere `docs/handoff-2026-09-12-panel-rework.md` enthält die Paket-Historie
(Abschnitte 2 und 6) und bleibt als Nachschlagewerk gültig. Alle Hashes sind Kurzformen von `main`.

---

## 0. Wie der Besitzer arbeiten will (nicht verhandelbar)

- **Ergebnis vor Erklärung.** Kurze, konkrete Antworten auf Deutsch; Oberfläche bleibt Englisch.
- **Design darf nicht schlechter werden, Farben nicht mehr werden.** Nur bestehende Tokens und
  ds-Primitiven (`ds/PageToolbar`, `ds/Select`, `SegmentedControl` = Filter, `Tabs` = Seitenabschnitte,
  `KpiStatCard` eine Spezifikation, `TableFrame mobileLayout="stack"`, `Badge`, `Button`). Ruhig, kompakt,
  sachlich. Kein horizontales Scrollen bei 390 px; Tabellen müssen bei 1440 (Leiste offen) und 1920 in ihren
  Rahmen passen, **gemessen, nicht geschätzt**.
- **Jede Runde:** `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check`; Screenshots
  vorher/nachher bei 1440 und 390 mit der Besitzer-Erscheinung (dark, Hintergrund „network", Hue 310); bei
  großen Layoutänderungen vorher ein Mock zeigen.
- **Nach jedem Push auf `main`: `npm run deploy:nas`** und die servierten Hashes nennen („ohne Deploy sehe ich
  nichts"). Sichtbare Ergebnisse zeitnah zeigen (Screenshots per Datei schicken).
- **Tabu ohne ausdrückliches Okay:** `cloudflared` und `caddy` neu starten (Produktionstunnel; ~10 s 502 auf
  allen öffentlichen Adressen). Deploys nennen die Dienste explizit: `-Service admin,rr-api[,backup,docker-gateway]`.
- **Vor jedem Schreibzugriff auf die Live-Datenbank ein Backup** (`sqlite3 $DB ".backup '…'"`), Skripte erst
  als Probelauf, dann `--apply`, danach Summen nachlesen.
- **Handy (Samsung S26 Ultra, Wireless-adb):** nur Chrome-Tabs mit `http://127.0.0.1:4179`, nie andere Tabs
  oder Apps, nie selbst entsperren/pairen, nach einem Lauf `svc power stayon false`. Pairing-Codes nie selbst
  eingeben, nur den Befehl nennen.
- **Geheimnisse maskieren,** nie Env-Werte oder Kundendaten (IPs, E-Mails, HWIDs, Namen) ausgeben; nur
  Aggregate.
- **Arbeitsteilung:** Hauptschleife orchestriert, Hands-on in Subagenten/Workflows; gestufte Modelle
  (Umsetzung stark, Umfragen/Screenshots/Reviews günstiger). Jede Umsetzung bekommt eine unabhängige
  Gegenprüfung (Korrektheit + Design), bevor etwas live geht. Bei Session-/Wochenlimit: Workflow mit
  `resumeFromRunId` fortsetzen, fertige Agenten kommen aus dem Cache.

## 1. Live-Stand

- **NAS** (UGREEN, `192.168.2.201`, SSH `cedrick.grabe`, Key `~/.ssh/id_ed25519`): Compose-Projekt in
  `/volume1/docker/razorreaper/src/RR-Admin-Panel/deploy/nas` (Git-Checkout von `main`). Dienste: `admin`
  (Caddy + Vite-Build), `rr-api` (Node 22, better-sqlite3), `bot`, `caddy`, `cloudflared`, `backup`,
  `docker-proxy`, `docker-gateway`. Daten `/volume1/docker/razorreaper/data` (DB `data/db/rr.sqlite`, Env
  `data/env/*.env`), Backups `/volume1/docker/razorreaper/backups`.
- **`main` = `78e248d`** (Code-Stand `5e18004`), serviert `index-pvi9cMyQ.js` / `index-gYbs9gbr.css`,
  `BUILD_SHA=5e18004` im rr-api-Container. Alle Container gesund, `backup` mit Healthcheck und Erfolgsmarke
  `/backups/.last-success`.
- **Prüfen:**
  ```bash
  ssh -i ~/.ssh/id_ed25519 cedrick.grabe@192.168.2.201 'docker ps --filter name=razorreaper --format "{{.Names}} {{.Status}}"; docker exec razorreaper-admin-1 ls /srv/admin/assets | grep -E "^index-"; docker exec razorreaper-rr-api-1 printenv BUILD_SHA'
  ```
- **Deploy** (aus dem Haupt-Checkout, HEAD muss `origin/main` sein, sonst bricht das Skript mit Exit 0 ab):
  ```bash
  npm run deploy:nas -- -Service admin,rr-api
  ```
  Fallen: `scp` in `/tmp` des NAS scheitert (sftp-Root); Dateien per `cat file | ssh … 'cat > /volume1/docker/razorreaper/tmp/…'`
  oder per `docker cp` aus dem NAS-Checkout übertragen. Ein `-Service admin`-Deploy erzeugt `rr-api` mit
  (unverändertes Image), `/tmp` im Container ist danach leer.

## 2. Was in dieser Session passiert ist (16./17.09.)

1. **Review-Runde (Runde 2), live `c106047`:** 11 bestätigte Befunde plus zwei Co-Review-Korrekturen.
   Eine gemeinsame Fehler-Regel `src/utils/errorEvents.ts` (Wächter-Test `tests/error-events.test.ts`);
   Customer 360 mit getrennten Budgets für echte/Hintergrundfehler; System health unterscheidet ausgefallene
   von fehlenden Quellen, zeigt Stale-Zustand und Neustarts als „—"; **Docker-Gateway**
   (`deploy/nas/docker-gateway/Caddyfile`) lässt nur `GET /containers/json` und `…/stats` durch, jedes
   `inspect`/`archive`/`logs`/POST → 403 (Grund: `inspect` liefert `Config.Env` aller Container, auch
   `admin.env` mit `ORIGIN_KEY` und `rr-api.env` mit 35 Schlüsseln); `BUILD_SHA` aus dem Image-ENV (leere
   Zeile in `rr-api.env` entfernt, Sicherung `rr-api.env.bak-20260914`).
2. **Sitzungszähler:** `deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs` fasst nur Sitzungen an,
   deren eigenes `session_start` erhalten ist (Vorlauf ≤ 10 min erlaubt; `--repair-status` nie ohne eigenen
   Probelauf). `restore-session-error-counts.mjs` hat die vom schwächeren Lauf (13.09.) genullten,
   unbeweisbaren Zähler zurückgeholt: 9 Sitzungen, +3.344, Summe 902 → 4.246; `updated_at` unterscheidet
   Skript- von Betriebsschreibungen. Backups: `rr-pre-errors-20260913.sqlite`, `rr-pre-round2-20260916T1852Z.sqlite`.
3. **Runde 3, live `fea1cce`:** Melde-Vertrag v2 (`fault_source`, `report_kind`, `occurrences`, `top_frame`;
   „Background faults" summiert Vorkommen, gruppiert nach Herkunft und oberstem eigenen Frame; alte Clients
   weiterhin verstanden); Container-Cache ≥ Abfragetakt; `/api/admin/health` gekürzt; Kartenkopf am Handy
   öffnet Customer 360; Lizenztabelle passt bei 1440; `backup.sh` prüft die Kopie (gzip, ≥ 1 MB,
   `app_sessions`-Zeilen) und schreibt die Erfolgsmarke, Healthcheck < 36 h, System health zeigt das Alter der
   letzten *geprüften* Sicherung.
4. **Kundenverzeichnis, live `5e18004`:** Spalte „Last IP" (Zusammenfassung trägt IP der neuesten Sitzung +
   Adresszahl; die Daten lagen immer in `app_sessions.client_ip`), Customer 360 zeigt IP/Ort/Anzahl, neuer
   **Excel-Export** des gefilterten Verzeichnisses (`rr-customers-<Datum>.xlsx`), „Client IP" im Export der
   Session history; die gestapelte Spalte „App access / Support" ist durch **eine Statusspalte** ersetzt
   (Badges nur bei Auffälligkeit, sonst „—"; `directoryStatus` in `src/utils/userDirectory.ts` teilt die Regel
   mit „Needs attention"). Breite: bei 1920 (Leiste offen) IP statt Ort, bei 1440 IP ausgeblendet (Karte,
   Export, Customer 360 haben sie).
5. **Desktop-Client (Repo `C:\Users\cedri\source\repos\CedrickGD\RazorReaper`):** Branch
   **`fix/client-tidy`** (`e572c90`, auf GitHub, Review „ship", 0 Warnungen, 367 Tests) behebt die
   RR-E1003-Ursachen: abbrechbare UDP-Abfragen (`ServerQueryService`), `RenderDispatch`-Schleuse statt
   ~60 verworfener `InvokeAsync`, kein `async void` mehr (vier `System.Threading.Timer`-Rückrufe konnten den
   Prozess beenden), thread-sichere Benachrichtigungen, gedrosselte Meldung (eine Zeile je Fehlerart pro
   Sitzung + 5-min-Sammelzeilen, mit oberstem eigenen Frame), Unterdrückung auf die Discord-Pipe eingegrenzt.
   **Nicht veröffentlicht, keine Version/`update.xml` geändert — das ist der Knopf des Besitzers.**

## 3. Client-Release (bereit, sobald der Besitzer will)

- Das Panel versteht den neuen Vertrag seit `fea1cce`; Reihenfolge eingehalten (Panel zuerst).
- Vor dem Release wissen: **Eine Komponente, die zehnmal hintereinander beim Neuzeichnen fehlschlägt, hört für
  den Rest der Sitzung auf, sich zu aktualisieren** (bewusst, gegen eine echte BlazorWebView noch nicht
  verifiziert). Release-Prozess wie bisher (Version, `update.xml`, Installer) liegt beim Besitzer.
- Danach im Panel beobachten: Errors → Background faults (Spalten Herkunft/Top frame, Summen), die
  NullReference-Familie sollte jetzt einen Frame tragen; SocketException 995 sollte verschwinden.
- Client-Branches außer `fix/client-tidy` sind Zwischenstände und können gelöscht werden. Junctions
  `C:\Users\cedri\rr*` (MAX_PATH-Umgehung) ggf. mit `cmd /c rmdir` entfernen.

## 4. Unmittelbar offen: Session history am Handy (Branch `fix/session-history-phone`)

Aus drei echten Handy-Screenshots des Besitzers (Seite `src/pages/WorkersPage.tsx`,
`src/theme/session-history-workspace.css`, seine Umgestaltung `de18d5d`/`4d509d5`):
1. Die Tageszeitleiste zeigt nur 00:00–02:00 statt 24 h, Achsenbeschriftung kollidiert („00:0002:00"),
   Balken sind abgeschnittene Streifen.
2. Hinweis „Hover, focus, or select a segment …" auf einem Touch-Gerät.
3. Buttons „Map" und „Customer workspace" rechts untereinander in verschiedenen Breiten.
4. Kennzahlen als Großbuchstaben-Labels über Mono-Werten, fünf Zahlen füllen einen Bildschirm.
5. „Hardware ID" und „Identity" zeigen denselben Wert zweimal, dreizeilig umbrochen.
6. Filter „With errors" allein in der zweiten Zeile.

Ein Lauf dazu war beim Übergabezeitpunkt in Arbeit (Worktree `…/scratchpad/wt-sesshist`, Screenshots in
`…/scratchpad/shots/session-history/before|after`). **Zuerst prüfen:** `git log --oneline main..fix/session-history-phone`.
Gibt es Commits mit grünem Gate, mergen und `-Service admin` deployen; sonst die sechs Punkte neu
umsetzen (gemessen bei 390 und 1440), Gegenprüfung, Deploy.

## 5. Offene Punkte und Entscheidungen des Besitzers

- **Caddy- und Cloudflared-Healthchecks** (Plan vorhanden): je ein Neustart, ~10 s 502 auf allen öffentlichen
  Adressen — nur mit ausdrücklichem Okay und Zeitfenster.
- **Arne (15-Minuten-Sessions):** Cloudflare Zero Trust → Access-Application: Allow-Policy mit seiner E-Mail,
  keine „Temporary authentication", längere Session-Dauer. Nur im Dashboard möglich.
- **Bot-Status in System health** (Guild/Reconcile): braucht `/health`-Erweiterung im Bot-Repo hinter dem
  `NOTIFIER_TOKEN`; der NAS-Bot ist **nicht** abgedriftet (Unterschied war nur CRLF). Ein Bot-Deploy startet
  ihn neu (~3 s, SSE-Clients fallen ab).
- **Serverseitige Drosselung** identischer Hintergrundfehler beim Speichern: nach dem Client-Release
  vermutlich unnötig; alte Clients (1.4.8.11/1.4.9) fluten weiter, solange sie nicht updaten.
- **1920: Ort oder IP in der Tabelle** (heute IP) — Einzeiler in den Spaltenklassen.
- **Restrictions-Tab:** Namenslink noch alt (`CustomerRestrictions.tsx`), gleiche `RecordOpen`-Behandlung wie
  das Verzeichnis wäre konsequent.
- **Echtes-Handy-Lauf** für Kartentipp/Zurück im Verzeichnis (`phone.mjs`) steht noch aus.
- **Lizenzen:** Dauer/Nutzung unter ~1502 px Rahmen nur unter „Device details" (Entscheidung, ob das bleibt).
- **Übergangsartefakt:** Zeilen alter Clients erscheinen in „Background faults" ohne Frame neben den
  1.5.3-Gruppen derselben Ausnahme, bis die Clients aktualisiert sind.
- **Nicht zurückgerechnet:** `telemetry_counters` (Lifetime-Zähler pro Dienst), bisher ohne Leser in der UI.
- Kleinere Entscheidungen aus Runde 3: Pages-`/api/health` flache Form oder gekürztes Objekt; ob `App.tsx`
  weiter auf `health` als Render-Gate wartet; `RuntimeEnv.CF_PAGES_BRANCH` ohne Leser.

## 6. Aufräumen (gefahrlos)

- Viele Worktrees liegen im Sitzungs-Scratchpad (`C:\Users\cedri\AppData\Local\Temp\claude\…\scratchpad\wt-*`,
  `gwfix`, `round2b`) und unter `.claude\worktrees\`. Wenn der Scratchpad weg ist: `git worktree prune`.
  Alle Branches außer `fix/session-history-phone` sind in `main` enthalten (auch `fix/round-2` ist überholt)
  und können gelöscht werden.
- `.local/` ist gitignored und enthält die Werkzeuge (siehe 7); Kopien liegen in den Worktrees.

## 7. Werkzeuge

- **Fixture-Preview** (ganzes Panel ohne Login, Port 4179):
  `node_modules/.bin/vite --config .local/panel-consistency-4fd4a24/preview.config.ts --port 4179 --strictPort`
  (Konfiguration nie ändern, solange der Server läuft).
- **Headless-Harness** `.local/visual-harness/` (`harness.mjs` mit `connect/gotoClean/shot/waitReady/apiCapture`;
  Beispiele `shots-errors.mjs` + `errors-fixture.mjs` mit Besitzer-Erscheinung, Viewports 1440×900 und
  390×844, Overflow-Messung; `shots-round3.mjs`, `measure-tiles.mjs`, `phone.mjs smoke|scenarios|heatmap`).
- **Handy:** adb aus winget `Google.PlatformTools`, Gerät `192.168.2.210:36401`; `adb reverse tcp:4179 tcp:4179`
  und `adb forward tcp:9223 localabstract:chrome_devtools_remote` gehen bei Reconnect verloren (leere Seite mit
  hängendem Ladebalken = neu setzen).
- **Datenbank:** `sqlite3 -readonly` auf dem NAS-Host; `telemetry_events.ts` ist ISO-Text
  (`…T…Z`), nie `datetime('now')` vergleichen, sondern ISO-Literale oder `strftime('%Y-%m-%dT%H:%M:%fZ', …)`.
- **Skripte im Container:** `docker cp deploy/nas/rr-api/scripts/<x>.mjs razorreaper-rr-api-1:/tmp/` und
  `docker exec -w /app razorreaper-rr-api-1 node /tmp/<x>.mjs …` (Backups sind unter `/backups` read-only
  gemountet).
- **Worktrees ohne `npm install`:** `cmd /c mklink /J "<worktree>\node_modules" "<checkout>\node_modules"`
  (auch für `deploy\nas\rr-api\node_modules`; better-sqlite3-Binary liegt dort).

## 8. Startprompt für den neuen Chat

> Lies `docs/handoff-2026-09-17-session.md` im RR-Admin-Panel-Repo (alles Wichtige steht dort; das ältere
> `docs/handoff-2026-09-12-panel-rework.md` nur bei Bedarf) und die Memories `rr-admin-panel-deploy-path`,
> `rr-admin-panel-user-expectations`, `rr-admin-panel-handoff-2026-09-17`. Halte dich an Abschnitt 0.
> Prüfe zuerst den Live-Stand (Abschnitt 1) und den Branch `fix/session-history-phone` (Abschnitt 4): wenn
> dort ein grüner Stand liegt, merge und deploye ihn, sonst setze die sechs Handy-Punkte der Session history
> um. Danach die offenen Punkte aus Abschnitt 5 in dieser Reihenfolge vorschlagen — Tunnel/Caddy nur mit
> meinem Okay. Hands-on in Subagenten/Workflows mit unabhängiger Gegenprüfung, pro Runde Gate + Screenshots
> bei 1440 und 390, nach jedem Push `npm run deploy:nas` und die Hashes nennen. Zeig mir zeitnah sichtbare
> Ergebnisse als Bilder.
