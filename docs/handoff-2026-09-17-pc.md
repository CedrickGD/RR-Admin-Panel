# Handoff: Stand 17. September 2026, abends — Fortsetzung am PC

Für einen neuen Chat im Ordner `C:\Users\cedri\source\repos\CedrickGD\RR-Admin-Panel` (Haupt-Checkout, `main`)
mit dem Client-Repo daneben (`…\CedrickGD\RazorReaper`, `master`). Dieses Dokument ist der Einstieg; die
Vorgeschichte des Tages steht in `docs/handoff-2026-09-17-session.md` (Abschnitte 9–11 = Cloud-Session), die
Paket-Historie in `docs/handoff-2026-09-12-panel-rework.md`. Hashes sind Kurzformen.

---

## 0. Regeln des Besitzers (unverändert, plus drei Ergänzungen von heute)

- Ergebnis vor Erklärung, kurz, auf Deutsch; Oberfläche Englisch; sichtbare Ergebnisse zeitnah als Bilder.
- Design darf nicht schlechter werden, keine neuen Farben; nur Tokens und die Primitiven unter
  `src/components/ds/`; ruhig, kompakt, sachlich; kein horizontales Scrollen bei 390 px; Tabellen bei 1440
  (Leiste offen) und 1920 im Rahmen — **gemessen, nicht geschätzt**.
- Jede Runde: `npm run typecheck`, `npm test`, `npm run build`, `npm run format:check` und
  `npx prettier --check <geänderte src-Dateien>`; Screenshots 1440 und 390 (dark, „network“, Hue 310).
- Nach jedem Push auf `main`: `npm run deploy:nas -- -Service …`, servierte Hashes nennen.
- Tabu ohne Okay: `cloudflared`/`caddy` neu starten; Deploys nennen Dienste explizit; vor DB-Schreibzugriffen Backup.
- Git: nie `git add -A`/`git add .` (`.claude/`, `.superdesign/` untracked); Commits mit `Co-Authored-By`.
- Geheimnisse und Kundendaten nie ausgeben.
- Arbeitsteilung: Hauptschleife orchestriert, Hands-on in Subagenten/Workflows mit unabhängiger Gegenprüfung.
- **Neu (17.09.):** direkt auf `main`/`master` arbeiten („ist wurscht, bin eh nur ich“); Handy-Tests sind optional
  (Emulation reicht, „es geht nur darum, dass es anschaulich ist“); der Client-Release (Version, `update.xml`,
  Installer) bleibt der Knopf des Besitzers.

## 1. Live-Stand

- **Panel `main` = `4dd2872`** (plus dieses Dokument). **NAS serviert noch `70ce13b`** — heute wurde nichts deployt
  (Cloud-Session ohne SSH). Erster Schritt am PC: `git pull`, dann
  `npm run deploy:nas -- -Service admin,rr-api` (Dockerfile/Dockerignore geändert → Image-Rebuild). Erwartete Hashes
  `index-CGY-Pw0I.js` / `index-Ckexgfaj.css` (falls der Build der Docs-Commits andere Hashes ergibt: `npm run build`
  lokal, `ls dist/assets`). Beim ersten Request legt `ensureFeedbackSchema` `feedback.kind` und `schema_markers` an
  und sortiert Diagnose-Zeilen nach Support — kein manueller Migrationslauf nötig, `sqlite3 -readonly` danach:
  `SELECT kind, count(*) FROM feedback GROUP BY kind`. Vorher Backup wie immer.
- **Client `master` = `629ab3e`** = `fix/client-tidy` (47 Commits über 1.5.2: Tidy-Branch + heutige zwei Runden),
  **unveröffentlicht und in der Cloud nie kompiliert**. Erster Schritt: `dotnet build RazorReaper/RazorReaper.csproj`
  und `dotnet test tests/RazorReaper.UnitTests`; Compile-Fehler sind möglich (Risikostellen: Abschnitt 3).
  `fix/client-tidy` kann danach gelöscht werden (identisch mit `master`); die sieben alten `fix/*` ebenso.
- Pages (`rr-admin-panel.pages.dev`) baut automatisch von `main`.

## 2. Was heute passiert ist (Kurzfassung, Details in `handoff-2026-09-17-session.md` §9–11)

1. **Handy-Runde (emuliert):** 8 Befunde behoben (Achse bei 412, Chevron, Auswahlzeile, Mitternacht, Hover,
   Customer-360-Zeitstempel, IPv6, Export-Knopf).
2. **Online-Zeiten:** „Exact online intervals“ unter der Tagesleiste (jede Phase mit Start/Ende/Dauer, Tageskopf,
   Faltung, Sprung aus der Leiste, Light-Theme).
3. **PWA:** Manifest + Icons, ohne Service Worker; Installation: Chrome → „App installieren“.
4. **Abschnitt-5-Punkte:** 1920 Ort statt IP, Restrictions-Namenszelle `RecordOpen`, `CF_PAGES_BRANCH` weg.
5. **Voll-Audit:** 41 bestätigte Befunde, 28 Commits (Dialoge deckend/44 px, Errors-Tabelle, Announcements,
   Berechtigungsmatrix, Hover-Schutz, Light-Theme-Kontraste, Scrollbar-Token, Fokus-Rückgabe, Deploy-Skript,
   Dockerignore, Pages-Security-Header).
6. **Feedback | Support:** Vertrag `kind` (Client sendet `"kind"`, Server-Default „Diagnose → support“), Tabs im Panel,
   je Bereich Mark read/Archive/Delete, Zähler im Rail, Customer 360 zeigt die Art.
7. **Client:** Lizenz-Overlay aus der Sidebar-Statuszeile (Home ohne Lizenz-/Support-Karte, Aktivierung nur im
   Overlay), `/feedback` = Feedback | Support, Postbox → Glocke mit Punkt/Puls/Plopp, „What's new & inbox“-Overlay
   mit „Update now“.

## 3. Erste Schritte am PC (Reihenfolge)

1. Beide Repos `git pull`. Panel: `npm ci`, Gate, Deploy (Abschnitt 1).
2. Client: `dotnet build` + `dotnet test`. Risikostellen, falls es hakt: `Components/Pages/Feedback.razor`
   (`[Parameter] [SupplyParameterFromQuery] Section` nach dem Muster des bestehenden `Source`),
   `IFeedbackService.SubmitAsync` gibt jetzt `FeedbackSubmissionResult` zurück (Aufrufer lesen `.Success`),
   `wwwroot/js/license-overlay.js` (zwei Runtimes: license + whatsNew, Tab-Falle), `<audio id="inbox-plop-audio">`
   + `window.playInboxPlop` in `index.html`, `Navigation/NavCatalog.cs` („Feedback & Support“),
   `LicenseOverlay.razor`/`WhatsNewOverlay.razor`/`NotificationIndicator.razor` (Dispose/RenderDispatch-Regeln
   der Source-Scanning-Tests), `AutoUpdateManager.CheckNowAsync`.
3. Client starten und klicken: Statuszeile unten links → Lizenz-Overlay (X, Esc, Fokus zurück, Freemium-Aktivierung
   mit Enter/Activate, Erfolg schließt das Overlay und spielt die Feier); Home ohne Lizenz-/Support-Karte;
   Sidebar „Feedback & Support“ → `/feedback` (beide Bereiche, Pflichttext, Deep-Link `?section=support` aus
   Troubleshoot/Credits); Glocke: Punkt bei ungelesener Antwort/neuer Version, Plopp bei neuer Antwort (Ton-Master
   an), Overlay „What's new“ mit Notes und Inbox-Vorschau; Fenster < 900 px: Overlays einspaltig.
4. Panel prüfen: `#/feedback` Tabs, Aktionen in beiden Bereichen, Rail-Zähler; Customer 360 „Support & history“.
5. Optional: echter Handy-Lauf (`.local/visual-harness/phone.mjs`), Besitzer sagt „egal“.
6. Client-Release, wenn zufrieden (Version in csproj (5 Felder), `installer/RazorReaper.iss`, Release anlegen —
   `update-manifest.yml` schreibt `update.xml`, Discord-Notify läuft). Panel-Deploy muss davor liegen.

## 4. Offene Entscheidungen

- **Release-Seite im Panel** (Vorschlag in `handoff-2026-09-17-session.md` §11): (a) Installer künftig auf einem
  GitHub-Windows-Runner bauen — hängt Lokales am Build? (b) Fine-grained-Token (Actions + Contents read/write auf
  `CedrickGD/RazorReaper`) in `rr-api.env`. Danach: Notes-Entwurf, freie Versionswahl, „Release auslösen“,
  Lauf-Status, Historie; CI-Workflow mit `version` + `notes`.
- Glocke: der Punkt leuchtet auch nach einer frischen Installation einmal für die Notes der laufenden Version
  (`WhatsNewService.cs:37`, `<` → `<=` schaltet das ab, Test `TheRunningVersionsOwnNotesCountAsNewOnceAfterAnUpdate`
  dann entfernen).
- Audit-Entscheidungen (§10 des Tagesdokuments): Customer-360-Leiste am Handy im Stuck-Zustand, fünfte Traffic-Kachel,
  Accent-Swatches, Segment-Ink `--on-accent`, ein `<details>`-Idiom, Customer-360-Tabs auf `ds/Tabs`, Roh-Buttons,
  Token-Duplikate, DST-Ticks, Healthchecks docker-gateway/-proxy; Caddy/Cloudflared nur mit Okay.
- Panel-Tabs: Zähler als Text („Support · 2“) wie bei Customers oder als Pille (`ds/Tabs count`).
- Abschnitt 5 alt: Arne-Session-Dauer (Zero-Trust-Dashboard), Bot-Status in System health, serverseitige Drosselung
  nach dem Client-Release, Lizenzen unter 1502 px, Pages-`/api/health`-Form, `App.tsx`-Render-Gate.

## 5. Werkzeuge

- **Harness** (`.local/`, gitignored): der Besitzer hat `visual-harness-2026-09-17b.tgz` (Fixture-Preview ohne Login
  auf 4179, typisierte Fixtures mit 44 Kunden/Feedback/Team/System, `harness.mjs` mit Profilen desktop1440/1920,
  phone390, sultra, alle Szenario-/Mess-Skripte des Tages, Font-Cache, Client-Mock-Builder unter
  `visual-harness/client-mocks/`). Entpacken nach `.local/visual-harness/`, `bash .local/visual-harness/run.sh`;
  `playwright-core` liegt beim Besitzer unter `node_modules` oder per `HARNESS_PW`-Pfad (siehe Kopf von `harness.mjs`).
- Client-Mocks: `client-mocks/build.mjs` rendert Overlay/Foot/What's-new-HTML mit dem echten CSS und schießt PNGs.
- Deploy: `tools/deploy-nas.ps1` prüft jetzt `git fetch` vor der Origin-Prüfung, räumt nur dangling Images.

## 6. Startprompt für den neuen Chat

> Lies `docs/handoff-2026-09-17-pc.md` im RR-Admin-Panel-Repo (Einstieg; `docs/handoff-2026-09-17-session.md`
> §9–11 nur bei Bedarf) und die Memories `rr-admin-panel-handoff-2026-09-17`, `rr-admin-panel-deploy-path`,
> `rr-admin-panel-user-expectations`. Halte dich an Abschnitt 0. Zuerst Abschnitt 3: Panel pullen, Gate, Deploy
> und Hashes nennen; Client pullen, `dotnet build` + `dotnet test`, Compile-Fehler fixen, dann die Klick-Checkliste.
> Danach Abschnitt 4: frag mich die zwei Release-Fragen und schlag die Reihenfolge der offenen Punkte vor.
> Hands-on in Subagenten/Workflows mit unabhängiger Gegenprüfung, pro Runde Gate + Screenshots 1440 und 390,
> Bilder zeitnah, kurz und auf Deutsch.
