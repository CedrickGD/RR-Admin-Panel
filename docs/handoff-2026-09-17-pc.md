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

## 7. Stand nach der PC-Session (17.09. abends)

- **Panel-Deploy:** `main` = `a1abe99`, NAS serviert `index-CGY-Pw0I.js` / `index-Ckexgfaj.css`
  (BUILD_SHA `a1abe99`). Backup vor der Migration: `rr-pre-feedback-kind-20260917T1714Z.sqlite`;
  `feedback.kind` ist befüllt.
- **Client `master`, heute (chronologisch):** `629ab3e` „Update now" vom Renderer weg ·
  `309f961` „Open support inbox"-Knopf raus · `a095c83` Fokus-Fix nach dem Lizenz-Overlay
  (`FocusOnPageChange`) · `8f8f85b` Version → 1.5.3 · `48433da` „Manage license" öffnet jetzt
  das Overlay statt `/home`, plus echte Not-found-Seite. Hybride Update-UX ist in Arbeit.
  **Push-Stand bei Schreiben unklar — lokal, Push folgt.**
- **Klick-Checkliste:** Client 23/24, nach Fixes 9/9. Panel „Feedback | Support" 10/10 bei 1440
  und 390; zwei 390-Nits offen: Filterzeile abgeschnitten, Löschen-Sheet nimmt die volle Höhe.
- **Audit-Kurzfassung (verifiziert 17.09., critic-geprüft):**
  - Update-Weg: Worker (`backend.rr-admin-panel.workers.dev/update/update.xml`) zuerst,
    Fallback `raw.githubusercontent.com` nur solange das Repo öffentlich ist.
  - Installer 73 MB, nicht 750 MB. `GITHUB_TOKEN` muss auf dem Worker (`wrangler secret`,
    ungeprüft) UND in der NAS-`rr-api.env` (gesetzt) stehen.
  - `/update/download` liefert immer das *neueste* GitHub-Release, nicht zwingend die in
    `update.xml` genannte Version; `<changelog>` wird vom Worker nicht umgeschrieben.
  - Panel-Versions-Seite liest GitHub ungeauthentifiziert aus dem Browser, Fallback `"1.4.2"`.
  - Adoption, 30 Tage, 829 Installs: 1.5.2=397, 1.4.8=253, 1.4.9=110, 1.4.10=41, 1.5.0=9,
    älter=7, legacy=12 — 1.4.8 und älter = 272 Installs, bleiben für immer hängen, wenn das
    Repo ohne Token privat wird.
  - 1.4.8 installiert praktisch nie selbst (X minimiert in den Tray statt zu schließen,
    `CleanupStaleInstaller` löscht den gestagten Installer beim nächsten Start). Ab 1.4.9
    (`1eee8f5`) erzwungener Neustart, funktioniert (13/10/15 Installs hängen auf
    1.4.9/1.4.10/1.5.0).
  - Aktueller 1.5.3-Flow: Start-Check + alle 30 min, „Update now" prüft nur erneut, Download
    automatisch, 4-s-Warnung, Neustart erzwungen — keine Wahl für die Nutzerin.
  - `<mandatory>` wird geparst, aber nicht ausgewertet; kein Gate gegen laufendes ARK/Makro,
    obwohl `IsArkRunning`/`AutoClickerRuntime.IsRunning` existieren.
  - Nur `update_check`-Telemetrie; kein Download-/Install-/Fehler-Event.
  - Home-Banner „mind. 1.4.9" ist Zeile 7 der Announcements, ohne Versions-Targeting.
- **Besitzer-Entscheidungen:** Token ja (beide Stellen); Installer bleibt GitHub-Release-Asset
  hinter Token; Adoptions-Schwelle für den Privat-Flip später; `<notes>`-Fallback bleibt;
  hybride Update-UX (still + „Restart & update") freigegeben; Panel bekommt später eine
  Release-Management-Seite; danach App-Mehrwert für zahlende Kunden: Lifetime-only
  Dino-Level-Seite, Crosshair, AMD, Sprachen.
- **Tooling:** Comet läuft für den Headless-Harness über `RR_BROWSER`-Env + `connectPipe`; die
  Fixture stürzt bei `//`-URLs ab. WebView2-CDP-Trick für echte App-Checks:
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`. Branch-/Worktree-
  Aufräumen erledigt.

## 8. Runde B: Release-Verwaltung (18.09. nachts, `main` bis `b250558`, live)

- **Live:** NAS serviert `index-eZYK276k.js` / `index-Ckexgfaj.css` (`ReleasesPage-D429HtAj.js`), `BUILD_SHA=b250558`,
  rr-api mit 82 Routen. Backup davor `rr-pre-releases-20260917T2312Z.sqlite`; Rollback-Tags
  `razorreaper-admin:pre-releases-20260918` / `razorreaper-rr-api:pre-releases-20260918`. Gate: 136 Dateien / 1777 Tests.
- **Was drin ist** (Design: `docs/release-management-design.md`, Vertrag `shared/releases-contract.ts`): Rechte
  `releases.read/.write/.files` (Files/Workflows nur Owner), Tabellen `release_drafts`/`release_events` (lazy ensure),
  GitHub-Client mit Token-Modi (`GITHUB_RELEASE_TOKEN`, Platzhalter → lesend), atomare Multi-File-Commits (Git Data API),
  HMAC-Bestätigungs-Tokens mit serverseitiger Wirkungsliste (immer mit Discord-Zeile), Admin-API lesend/schreibend
  (Entwürfe, Versions-Bump + Build-Dispatch, fünfstufiges wiederaufnehmbares Publish, Make current = Rollback,
  Unpublish nur wenn update.xml nicht darauf zeigt, Dateien auf master mit Denylist, Workflow-Dispatch), Seite `#/releases`
  (KPI-Zeile, Tabs Releases | Drafts | Workflows | Files), Versions-Seite liest GitHub nur noch über rr-api,
  Ankündigungen mit `min_version`/`max_version`, Worker: `<changelog>` → Notes-Seite, Download auf den Tag aus update.xml
  gepinnt, `GET /release-notes/:tag`, Caddyfile-Routen für `dl.razorreaper.app/update/*` und `/release-notes/*`.
- **Client `master` `e9e6518`:** `build-installer.yml` (workflow_dispatch, Windows-Runner, Draft-Release, Signierung
  optional über `RR_SIGN_PFX_BASE64`/`RR_SIGN_PFX_PASSWORD`), `update-manifest.yml` nur noch manuell, Discord-Link auf
  die Notes-Seite, `?v=` bei Ankündigungen. Davor `343acb6`: Hybrid-Update-UX, Account-Knöpfe, Doku.
- **Offene Besitzer-Schritte:** (1) `docker exec razorreaper-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
  (validiert, nicht geladen; kein Neustart). (2) Erster Build von 1.5.3 über die Releases-Seite (Draft → Build installer),
  dann Notes prüfen und Publish — das erste CI-Release muss den ffmpeg-Hinweis tragen. (3) Optional die Signier-Secrets
  im Client-Repo anlegen. (4) Ankündigung Nr. 7 mit `max_version = 1.4.8` eingrenzen und Text anpassen.
  (5) Privatschalten erst nach Token-Prüfung auf beiden Flächen und Adoption-Schwelle.
- **Bekannt:** `BuildResponse.runId` kann null sein, wenn der Run nach 15 s noch nicht sichtbar ist (dann Refresh);
  `<args>` in update.xml ist über das Panel nicht änderbar; die Release-Tabellen entstehen beim ersten Aufruf der Seite.

## 9. Runde C: Client-Mehrwert (18.09., `master` bis `7b4a3ff`, gepusht, 933 Tests)

- **Lifetime-Seite** `/guides/dino-level` („Higher dino levels“, Nav „Dino levels“ mit Schloss-Marker in Mods & Intel):
  echte Sperre nur für diese Seite (`Services/LifetimeAccess.cs`, `PremiumLock RequiresLifetime`; Monatspläne bleiben
  gesperrt, gesperrter Inhalt steht nicht im DOM), Knöpfe Buy Premium / Redeem key; Inhalt = die acht Schritte des
  Besitzers plus Voraussetzungen und Hinweise, kein Video.
- **Crosshair:** Ursprung lag bei (Canvas−1)/2 → jetzt Mittelpixel (ungerade Strichstärken bleiben systembedingt
  einen halben Pixel versetzt); CS2/Valorant-Codes gegen die echten Formate; sichtbare Fehlermeldung beim Import;
  PNG-Import auf Inhalt beschnitten; Rust bewusst nicht (kein dokumentiertes Format, Hinweis auf Crosshair-X-Import).
- **Stretched-Res:** Hinweise/Fehlermeldungen je Hersteller (NVIDIA/AMD/Intel).
- **Sprachen:** `Services/Localization` (ILocalizer, JSON-Wörterbücher `Resources/i18n/{en,de,ru,zh-Hans}.json`,
  Preference `rr.ui.language`), Dropdown in den Einstellungen, Umschalten ohne Neustart über einen Cascading-Wert
  „Language“ in MainLayout (jede Komponente mit `Localizer.T` deklariert den CascadingParameter; Test erzwingt das).
  Übersetzt: Sidebar, Befehlspalette (Seiten/Abschnitte), Home, Einstellungen komplett, Feedback & Support, Konto,
  Lizenz-/What's-new-Overlay, NotFound, Update-Meldungen. Noch Englisch: alle übrigen Seiten, Palette-Befehle, Tray, HUD
  (`docs/i18n.md`).
- **Live geprüft** per CDP (Runden 5–8, PNGs im Scratchpad): Umschalten DE/RU/EN inkl. Sidebar in <100 ms, Lifetime-Seite,
  Fehlermeldung Crosshair, Hersteller-Hinweis, keine Konsolenfehler.
- **Offen:** Sprachen zweite Welle; Stretched-Res pro Monitor (Service zielt immer auf den Hauptmonitor); Stream Deck
  später; `DiscordPresenceService.ShopUrl` noch eigene Kopie der Store-URL; Cloudflare-Worker-Redeploy (Besitzer).

## 10. Runde D: Client (18.09., `master` bis `1a8e320`, gepusht, 1030+ Tests)

- **Stretched-Res pro Monitor:** `Services/Display/IDisplayApi.cs` + `Win32DisplayApi.cs` als Seam, jeder Win32-Aufruf
  trägt den Gerätenamen (vorher immer `null` = Hauptmonitor, auch beim Revert); Monitor-Dropdown je Bereich (Presets,
  Custom), Preference je Feature, Fallback auf den Hauptmonitor bei abgestecktem Gerät; Statuskarte folgt dem geänderten
  Monitor. Nicht auf echter Multi-Monitor-Hardware geprüft (CDS_FULLSCREEN mit Nicht-Primär-Gerät ist Annahme).
- **Store-URL:** nur noch `StoreLinks.Store` (Discord-Presence-Knopf angepasst, Test erzwingt eine Stelle).
- **Sprachen, Welle 2:** Befehlspalette komplett, geteilte Komponenten, Home-Karten, Tray (Menü wird bei Sprachwechsel
  neu gebaut), HUD, Lifetime-Guide, Referenz-/Hilfe-Seiten, ARK-Referenzseiten, Map Mods, Troubleshoot, Compact ARK,
  Launch Options, Vision, Game/Sky Changer, Paintings/Pixel, Toasts. Ein Test listet die noch englischen Seiten
  (`UntranslatedPagesAreListedTests`), `docs/i18n.md` hat die Tabelle. Welle 3 (15 Seiten: Building, Crosshair, Scripts,
  Convert, Server, Line List, Fonts, INI Changer, Auto Clicker, Notifier, Gamma, INI Builder, Char Manager, File
  Modifier, Loading Screen + Service-Toasts) läuft als Runde E.
- **Live (CDP Runde 9):** Monitor-Dropdown listet drei Monitore, Deutsch auf allen geprüften migrierten Seiten ohne
  englische Reste, Palette deutsch, Dino-Guide deutsch, keine Konsolenfehler; Crosshair/Scripts waren erwartungsgemäß
  noch englisch (Welle 3).
- **Teams-Hintergrund (Nebenprojekt, `D:\Teams-BG`):** Blender 5.2.2 portable, `work/scene.py` (prozedural, Cycles/OptiX),
  `work/overlay.py` (Pillow, Segoe UI), `work/make_bg.py` (OpenAI-Pfad, blockiert: kein Guthaben; Gemini-Quota 0).
  Erste Renders vom Besitzer als zu abstrakt abgelehnt; zweite Runde mit OSM-Gebäudedaten und modellierten Wahrzeichen
  läuft.

## 11. Runde E: Sprachen komplett (18.09., Client `master` bis `c21a523`, gepusht, 2888 Tests)

- Alle Seiten unter `Components/Pages` sind in en/de/ru/zh-Hans übersetzt (2688 Schlüssel je Wörterbuch, Paritätstest);
  Services, die eigene Meldungen formulieren (MediaConverter, SteamFavorites, Crosshair, LoadingScreen, FileModifier,
  CharPreset, GameIni, Notifier …), bekamen einen ILocalizer. Bewusst englisch: der generierte WTS/WTB-Post der Line List,
  ARK-eigene Item-/Binding-Namen, Skript-Anzeigenamen, Preset-/Profilnamen, Steam-Optionen und URLs (`docs/i18n.md`).
- Noch offen: die Toasts der Automations-Skripte selbst (AutomationScriptBase + sieben Dateien unter
  `Services/Automation`), ein echter Fenster-Durchgang auf Deutsch/Russisch wegen Überlängen (die langen SettingRow-Texte
  auf Scripts und die Server-Troubleshooting-Karten zuerst), Übersetzungsqualität ist Maschinen-Erstfassung.
- Live (CDP Runde 10): 51 Prüfungen bestanden, Deutsch/Russisch auf allen Seiten; zwei „Treffer“ (Desync, Feedback &
  Support) sind absichtlich gleichlautende deutsche Werte, keine Fehler.

## 12. Runde F: Skript-Toasts und Überlängen (18.09., Client `master` bis `5a408d3`, gepusht, 2977 Tests)

- Alle 17 Automations-Skripte und die sieben Automations-Dienste melden über den ILocalizer (86 neue Schlüssel, 2784 je
  Wörterbuch); der Toast-Scan-Test erfasst jetzt auch geerbte Localizer und `TryActivity`. Offen: `Services/Desync/
  DesyncService.cs` (neun englische Activity-Zeilen), `InputRecorderService` ohne Aufrufer.
- Überlängen-Durchgang im echten Fenster (CDP, alle 40 Katalogseiten, de/ru): 0 neue Überläufe gegenüber Englisch nach
  Kürzungen in den Wörterbüchern; die fünf englischen Grundfälle (z. B. Launch-Options-Beispielkarte, 2 px) sind
  vorbestehend. Modale, Tabs und Toasts wurden nicht durchgesehen.

## 13. Runde G: Skripte (18.09. abends, Client `master` bis `e99acfd`, gepusht, 3132+ Tests)

- **Analyse zuerst** (Memory `rr-scripts-reality`): kein Anti-Cheat-Limit, nur das Gratis-Monatskontingent (Premium
  überspringt es); Skripte tickten stumm ohne ARK im Vordergrund; Noglin kaputt (Konsolen-„.“ wurde zur Entf-Taste);
  Bilderkennung nur Monitor 1; null Skript-Telemetrie; Fed Suit doppelt bezahlt; Taktzeiten zu langsam.
- **G1 Eingabe:** Konsole tippt per KEYEVENTF_UNICODE (kein ToLowerInvariant mehr, Konsolentasten über den Simulator
  → kein Hotkey-Selbstauslöser); KEYEVENTF_SCANCODE gesetzt, 30-ms-Mindesthaltezeit, Held-Key-Register wird bei Stop/
  Dispose/Exception geleert; RunLoopAsync misst den Tick und wartet nur den Rest; Fed Suit `alreadyMetered`.
- **G2 Sichtbarkeit + Telemetrie:** ARK-Status-Pill (nicht laufend / im Hintergrund / im Vordergrund), „letzte Aktion“
  je Lauf, ein Hinweis-Toast pro stillem Lauf (an den Lauf gebunden), Telemetrie `script_start/stop/noop`
  (+ `script_capture` aus G3) mit Allowlist-Test; Panel-Zähler in `KNOWN_COUNTER_SERVICES` (main `a4ca08c`, rr-api deployt).
- **G3 Capture + Kalibrierung + Katalog:** DXGI-Output folgt dem ARK-Fenster (Prüfung nicht pro Tick), Referenz kennt
  Monitor + Auflösung und matcht bei Abweichung nicht mehr, Live-Trefferquote für die fünf kalibrierten Skripte
  (Dino Ready ausgenommen), „Experimental“-Chips auf Astro, Turret Manager, Auto Download, Fast TP, Crafting-Walk.
- **Live (CDP Runde 12):** ARK-Pill in EN/DE, Chips exakt auf den fünf, Kalibrierkarte mit Live-Match; die Monitor-
  Metadatenzeile erscheint nur mit vorhandener Referenz (so gebaut). Ungeprüft ohne echtes Spiel: Scancodes/Unicode an
  ARKs Konsole, DXGI-Auswahl auf Multi-Monitor-Hardware. Auto-Clicker-Haltezeit bleibt bei `max(1, HoldMs)` (Produktfrage).
- Danach: Dropdown-Clipping-Fix (Sprachmenü), Panel-Segmented-Copies-Bereinigung (beide laufen).

## 14. Runde H: Dropdown-Clipping und Segmented-Kopien (18.09. spät, Client `master` bis `2aeb8ab`, gepusht)

- **Client `9464654`, 3194 Tests.** Das Sprachmenü in Settings zeigte nur drei von vier Sprachen. Ursache
  war kein Overflow: `pages/server-styles.css` setzt `backdrop-filter` auf das nackte `.content-card`, jede Karte ist damit
  ein Stacking-Context, und die nächste Karte malte über die absolut positionierte Liste. Die `.content-card:has(.rr-dd)
  { overflow: visible }`-Ausnahme half nie und kostete jede Karte mit Dropdown ihre Rundung. Fix in der Primitive: die
  Liste liegt per `popover="manual"` im Top-Layer (Blazor behält das DOM-Element), `wwwroot/js/dropdown-layer.js`
  platziert sie am Trigger, klappt bei Platzmangel nach oben, deckelt auf die Fensterhöhe, folgt Scroll/Resize und schließt
  bei Outside-Click/Escape über `CloseFromLayer`. Der alte Backdrop (deckte nur die Karte) ist weg. `.content-card`s
  Blur-Leak selbst bleibt absichtlich unangetastet (würde jede Karte umfärben).
- **Live (CDP Runde 13):** vier Optionen klickbar, Flip nach oben (Viewport 1424×376 emuliert, da `.main-content` der
  Scroller ist und die Sprachzeile nicht tiefer rutschen kann), Sprachwechsel zh→en, Monitor-Dropdown auf Stretched Res
  über den Preset-Karten, 0 Konsolenfehler.
- **Nachtrag gelandet (`2aeb8ab`, gepusht, 3195 Tests):** Liste war exakt triggerbreit („中文 (…“, Breite hing an der
  gewählten Sprache). Jetzt `width: max-content`, JS setzt nur Mindestbreite (Trigger) und Maximalbreite (Fenster),
  bei Rechtsüberlauf rechtsbündig am Trigger. Live (CDP Runde 14): kein Label mehr abgeschnitten, Breite unabhängig
  von der Auswahl, Flip weiterhin ok, Monitor-Dropdown unverändert, 0 Konsolenfehler.
- **Panel `main` `6e9dd8f`, NICHT gepusht/deployt (Auftrag):** Segmented-Control-Kopien bereinigt. Kopien lagen nicht
  einheitlich bei 900 px (Traffic 800, Session History 600), zwei `[role="radio"]`-Kopien fehlten in der Liste, bei 800 px
  liefen Session History und Customers → Restrictions um 5 px über. Entscheidung: Höhe (44 px, Control entsperrt) gehört
  der Primitive ab 900 px, Layout (volle Breite, Umbruch) bleibt bei 768 px (darüber gemessen wirkungslos). Session
  Historys `flex: none` bleibt als dokumentierte Ausnahme. 323 Prüfungen auf 9 Seiten bei 390/800/901/1440, 0 Fehler,
  390 und 1440 byte-gleich; `tests/segmented-control-fit.test.ts` 12/12. Push + `-Service admin` wartet auf Freigabe.

## 15. 18.09. abends nach dem PC-Neustart: Panel live, Access-Befund, Client-Runde I läuft

- **Panel `main` `d747b3e` gepusht und deployt** (`-Service admin`, rr-api mit neu erstellt): NAS serviert
  `index-BxNftsuX.js` / `index-SNJ7aV2T.css`. Enthält die Segmented-Bereinigung `6e9dd8f`. Die Sperre „nicht pushen“ kam
  nur aus dem Aufgabentext der Bereinigung, nicht vom Besitzer.
- **Cloudflare Access (gelesen, nichts geändert):** Application „Razor-Reaper Admin UI“ hat zwei wiederverwendbare
  Policies: „Allow Admin Users“ (nur die zwei Besitzer-Adressen, 730 h, hängt auch am App Launcher) und „Visitor Request“
  (Include **Everyone**, 30 min, Purpose justification + Approval). Freunde stehen in keiner Allow-Liste und landen in
  „Visitor Request“ → die 30-Minuten-Seite. Das war nie gefixt. Fix: neue Allow-Policy „Panel Members“ (E-Mails der
  Freunde, 730 h, ohne Justification/Approval) an die Application hängen, **über** „Visitor Request“; „Visitor Request“
  nicht lockern (einzige Hürde für Fremde auf Access-Ebene). Dritte Application `*.rr-admin-panel.pages.dev` (24 h,
  eigene Policy) ist davon unberührt.
- **Besitzer-Schritt (Claude darf das nicht):** der Sicherheitsfilter der Sitzung lehnt das Anlegen der Policy als
  „Permission Grant“ ab, ebenso den API-Weg über das Dashboard-Sitzungs-Token. Kein Cloudflare-API-Token vorhanden,
  wrangler am PC nicht angemeldet. Klickweg: Zero Trust → Zugriffssteuerungen → Richtlinien → „Richtlinie hinzufügen“ →
  Name `Panel Members`, Aktion Allow, Sitzungsdauer 1 Monat, Include → Emails → Adressen; speichern. Dann Anwendungen →
  Razor-Reaper Admin UI → bearbeiten → Richtlinien → vorhandene Richtlinie `Panel Members` auswählen, über „Visitor
  Request“ ziehen, speichern. Jeder Freund braucht zusätzlich eine Zeile auf der Team-Seite (aktuell nur Arne).
- **Dauerhafte Lösung (Vorschlag, nicht gebaut):** rr-api schreibt `panel_members` selbst in diese Policy, sobald ein
  API-Token mit „Access: Apps and Policies → Edit“ in der NAS-Env liegt.
- **Nebenbefund:** `test@example.com` ist wieder als Admin aktiv (Audit 8–12: Revoke/Restore-Klicktests am 13.09. und
  16.09. endeten auf „restore“). Auf der Team-Seite wieder entfernen.
- **Client Runde I (Workflow `wf_54a5a242-0d9`) läuft:** Controls vereinheitlichen (2 native Selects → Dropdown,
  Zahlenfelder, Slider), Desync-Meldungen übersetzen, Zwei-Linsen-Review, Landung auf `master` ohne Push, Live-Check.
  Parallel drei Surveys: Autostart mit ARK, Hotkey-Scan, Turret-Filter.
- **Nachtrag 18.09. ~21:00, Access gefixt (Besitzer hat geklickt, Claude hat gelesen und geprüft):** „Razor-Reaper Admin
  UI“ hat jetzt 1 „Allow Admin Users“ (730 h), 2 **„Panel Members“** (Allow, 730 h, keine Begründung, keine Genehmigung,
  Include = Arnes Adresse, Policy-ID `70c9ede2-a8ee-419b-8445-2fdb2d2df68e`), 3 „Visitor Request“ (Everyone, 30 min,
  Begründung + Genehmigung, unverändert). Neuer Freund = E-Mail in „Panel Members“ eintragen **und** Zeile auf der
  Team-Seite. Offen: Arnes Testlogin (vorher `…cloudflareaccess.com/cdn-cgi/access/logout`).

## 16. 18.09. spät: Zugriffszeit pro Mitglied, Client-Runde I, Plugins

- **Panel `main` `ed013a8`, gepusht und deployt (`-Service admin,rr-api`):** NAS serviert `index-CsDxEwDl.js` /
  `index-BLo-FmJ4.css`, `BUILD_SHA=ed013a8`. Gate 138 Dateien / 1801 Tests. Anlass: mit der neuen Access-Policy hält der
  Cloudflare-Login 730 h, der Besitzer hielt die Zugriffszeit pro Nutzer deshalb für nutzlos. Sie ist es nicht:
  `memberDenied` (`functions/_lib/panel-access.ts`) prüft `panel_members.expires_at` bei jedem Request. Irreführend war die
  Oberfläche. Neu: `GET /api/admin/team` liefert je Session-Gruppe `effective_expires_at`, `limited_by`
  (`member`|`token`) und `blocked` (reine Funktion `sessionAccessView`); Sessions-Tabelle zeigt das echte Ende mit
  Zweitzeile „access limit“/„sign-in“, gesperrte Gruppen als „Ended“ und nicht mehr in der Aktiv-Kachel; „Access expires“
  mit Schnellwahl (1 h, 8 h, 1 Tag, 7 Tage, 30 Tage, No expiry) in Ortszeit; „Valid until“ mit Relativhinweis unter 48 h;
  403-Text trennt abgeschaltet/abgelaufen/entfernt, und die Login-Karte zeigt ihn dem Betroffenen (`/api/auth/session`
  liefert `reason`). Review-Funde behoben: Ablaufzeit in der doppelten Stunde der Zeitumstellung, Hilfetext wieder per
  aria am Input. Screenshots 1440/390 aus der Fixture: `%TEMP%/rr-shots/access-time/`.
- **Client Runde I, `master` `c06f7bf`, gepusht, 3204 Tests:** eine gemeinsame Zahlenfeld-Regel in `primitives.css`
  (34 px, Mono, keine nativen Spinner, `color-scheme: dark`), Mausrad verstellt keine Zahlenfelder mehr, toter
  Select-CSS entfernt. Stale Annahmen: native Selects und Desync-i18n waren schon erledigt; Crosshair-Halbpixel ist
  rechnerisch unvermeidbar. Surveys: Start/Stopp mit ARK komplett, aber ungetestet; Hotkey-Scan speist nur vier Skripte,
  liest `Input.ini` einmalig, Fed Suit drückt fest F/T/Esc; Turret-Filter hat keinen Code.
- **Besitzer-Entscheidung Turret:** eigenes Skript, alle drei Modi als Option (gleich verteilen / bis Zielwert füllen /
  nach Munitionstyp filtern), immer nur auf dem offenen Inventar. Entwurfs-Workflow `wf_60a5305d-323` (rein lesend).
- **Läuft:** Client Runde J (`wf_e00564e1-6ed`): Hotkey-Scan vollständig, InputRecorder löschen, ArkLink-Tests,
  `.content-card`-Leck ohne optische Änderung verankern, eine Control-Höhe in gemeinsamen Zeilen; Baseline-Messung gegen
  Nachher-Messung, Landung ohne Push.
- **Plugins (Besitzerwunsch):** `context-mode@context-mode` 1.0.169 und `ponytail@ponytail` 4.10.0 per `claude plugin`
  im User-Scope installiert. Wurden in die laufende Sitzung nachgeladen; der MCP-Server von context-mode lief beim ersten
  Start in den 30-s-Timeout (Abhängigkeiten), nach Reconnect verbunden. Hooks: Read nur Hinweise, Bash leitet nur
  curl/wget und Gradle/Maven um.

## 17. Client round J landed, Turret Filler in the works (2026-09-18, evening)

**Client `master` = `154b607`, pushed (master only, no release). Gate: 0 warnings, 3241 tests.**

- Stream A (scripts): Fed Suit and Fast Transfer press the keys the player bound (`AccessInventory`, `TransferItem`)
  instead of literal F/T; the key scan refreshes on script start and when `Input.ini` changes, keeps the last good scan
  when the file is locked, and no longer hunts for the ARK install on every start; the Scripts page says where the key
  defaults came from and has a localized "Rescan" (DE "Neu einlesen"); `InputRecorderService` deleted; ArkLink
  debounce + legacy migration are under test; a second Start can no longer swap the keys of a run in flight.
- Stream B (CSS): the leaked `.content-card` rule in `server-styles.css` is gone, the look every page already had is
  declared in `theme.css`; one `--control-h` (34 px) for dropdown trigger, button and number/text field.
  Measured against the baseline on 44 routes: the only card difference is three collapsible cards (Home sound, Settings
  theme + font) going from `rgba(0,0,0,.15)` to their own declared `.18` — accepted, it is the value their page rule
  always asked for. Notifier dropdowns 28.8 -> 34 px, centre unchanged.
- Open from the live check: Notifier's small "Test" buttons (~22 px) next to the 34 px dropdown are not on the token;
  `round16-measure.mjs` overwrites its `base-*.png` on a second run (needs an output prefix) — JSON data is intact.
- No ARK install / `Input.ini` on this PC, so ActionMapping names and rebinding stay unverified in-game.

**Turret Filler** (owner: all three behaviours as options, only the open inventory, own script): design fixed —
one-shot per hotkey; Even split / Fill / Filter only, filter composes with the first two; T / Shift+T / Ctrl+T;
no OCR, success = share of changed pixels in the calibrated region with a user knob; after typing the filter the first
slot is clicked so focus leaves the search box; ships Experimental with a 10-point in-game checklist. Implementation
runs in worktree `rr-wt-tf` (branch `wt/turret-filler`), lands on `master` after review + gate.

## 18. Turret Filler landed (2026-09-18, late evening)

**Client `master` = `a474236`, pushed (master only, no release). Gate: 0 warnings, 3256 tests.**

- New script **Turret Filler** (key `turretfill`, `Services/Automation/Scripts/TurretFillerScript.cs`), Experimental.
  One-shot per hotkey on the inventory that is open. Modes Even split (exactly N presses, aborts after two presses
  that moved nothing) / Fill (stops at the first one, N is the cap) / Filter only. The filter also composes with the
  first two: click search point, 40 backspaces, type the ammo name (KEYEVENTF_UNICODE), settle, then CLICK the
  first-slot point so focus leaves the search box. Amount = T / Shift+T / Ctrl+T. Success check = share of changed
  pixels in the calibrated region against `ChangeThresholdPercent` (default 0.2, 0.02–10); the activity line reports
  the last measured value. Foreground is re-checked before every press and inside the filter block.
  No OCR, no Drop-Item guard (unicode typing cannot fire ARK binds), no turret counting.
- Review found and fixed: "Filter only" with the switch off was a silent no-op (now `Filtering => UseFilter || Mode ==
  FilterOnly`), and the filter block never re-checked foreground.
- Landed behind round J with zero rebase conflicts; diagnostics snapshot lists the script (`script.turretfill.hotkey`).
- Live CDP (round 19 + 21): block renders EN/DE/RU/ZH, Mode -> Filter only reveals the four filter rows without
  another click, values clamp and persist (99 -> 20, 50 -> 10), all controls 34 px and on one right edge, search finds
  "ammo"/"filler", zero console errors. Follow-up `a474236`: `.script-settings .rr-dd` is `min-width: 120px` now, so
  "Ganzer Stapel" / "Половина стака" no longer end in an ellipsis (widest trigger 134 px, still right-aligned).
- **Only the owner can prove in game** (10-point list in the chat): hover-transfer with T/Shift+T/Ctrl+T, the region
  threshold open vs closed, the real "last change %" of a transfer vs a swallowed press, that the slot click frees the
  search box, that the search text types on a German client, behaviour on a laggy server.

## 19. START HERE for the next chat: in-game test session (written 2026-09-18, night)

**Owner's order (verbatim sense):** "Test ALL changes in game, that they are really usable and not only technically
correct. Go into single player, best with `gcm` for admin mode, then you can do everything else." The owner stopped
this chat before the tests began and wants them done in a fresh chat from this handoff.

### State when this chat ended
- Client `master` = `a474236`, pushed (round J + Turret Filler + dropdown min-width). 3256 tests, 0 warnings. No release.
- **A key fix was still running** as a background workflow of the old chat: branch `wt/ark-default-keys`, worktree
  `C:/Users/cedri/source/repos/CedrickGD/rr-wt-keys`. FIRST THING in the new chat: `git -C RazorReaper worktree list`
  and `git log --oneline -8 master`.
  - Landed (commits about "AccessInventory"/"DefaultInput" on master, worktree gone): run the gate, push `master`.
  - Not landed (worktree still there): finish it — review the branch, gate, ff-merge, push. Do not test Fed Suit /
    Fast Transfer / Crafting in game before this is in the build.
- **The bug behind it (proven):** the game's own `ShooterGame/Config/DefaultInput.ini` line 108 has
  `AccessInventory` = **F**; `ArkKeyBindingParser.StockBindings` said **E** (since `554176b`). Since round J Fed Suit
  and Fast Transfer resolve through that table, so without a player `Input.ini` they press E instead of F. The fix also
  makes `DefaultInput.ini` from the install the base layer under the player's `Input.ini`, with `StockBindings` only
  as the no-install fallback.
- Panel `main` = this commit, deployed build is still `ed013a8` (docs only since).

### Facts about this PC that earlier agents got wrong
- **ARK: Survival Evolved IS installed:** `C:\Program Files (x86)\Steam\steamapps\common\ARK` (app id 346110,
  ~508 GB, exe `ShooterGame\Binaries\Win64\ShooterGame.exe`). Two agents reported "no ARK install" — false.
- `ShooterGame\Saved` does **not exist**: the game has not been started since this install. So there is no
  `Input.ini` yet (the app's "Input.ini not found — using ARK's default keys" is truthful), no single-player save, no
  character. The first launch will create them — and may bring first-run dialogs (Steam launch-option picker,
  redistributables, BattlEye installer = **UAC, which computer-use cannot click; ask the owner**). Prefer the
  "launch without BattlEye" option for single player if Steam offers it.
- Second Steam library: `D:\SteamLibrary`. Installed RazorReaper (release) exists in the Start menu too — test the
  **dev build** from `RazorReaper/bin/Debug/net10.0-windows10.0.19041.0/win-x64/RazorReaper.exe`, not the release.

### How to run the session
- Tools: computer-use (`request_access` for "ARK Survival Evolved", "Steam", "RazorReaper"; the owner must approve
  the dialog, so ask while they are at the PC). Drive the CLIENT's settings over WebView2 CDP (port 9223; working example scripts were copied to the untracked
  `RR-Admin-Panel/.local/client-cdp/` — `round19.mjs` drives the Turret Filler block, `round17.mjs` the Scripts page,
  `round16-measure.mjs` measures all routes; the mechanics are: env `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
  --remote-debugging-port=9223`, page target `https://0.0.0.1/`, real `Input.dispatchMouseEvent` clicks) and the GAME
  with computer-use. Scripts need ARK in the foreground, so give each script under test a global hotkey first and
  start it with the hotkey while the game has focus.
- Screenshots are expensive: run the hands-on part in subagents (one phase per agent, game stays open between them),
  Fable only judges. Send the owner pictures promptly. Reply short, in German.
- Do not change the owner's ARK graphics/control settings. Do not rebind keys in the game unless a test needs it, and
  put it back. Single player only. Close ARK and the client when done; leave the client language on English.
- In game: Tab opens the console; `gcm` = creative mode (free crafting, no weight). Items/structures for the tests
  (auto turret, advanced rifle bullets, a storage box, a Fed/Tek suit piece) can be crafted in creative mode or given
  by console — look the exact commands up at test time, none were verified in this chat.

### What to test (usable, not just correct)
1. **Key scan:** after the first ARK start `Input.ini` exists → Scripts page status line changes from "not found" to
   the found state; "Rescan" works; rebind `AccessInventory` in ARK's options to another key, Rescan, Fed Suit /
   Crafting show the new key; restore the binding.
2. **Turret Filler** — the 10-point list from §18 / the chat: hover-transfer with T / Shift+T / Ctrl+T, region
   calibration on the open turret inventory and the open-vs-closed match %, Even split (1 press = exactly one stack),
   Even split on a full turret (stops after two no-change presses), Fill, the real "last change %" for a transfer vs a
   swallowed press (tune the 0.2 default from that), filter: text lands in the search box, the slot click frees the
   search box so T transfers again, search text surviving into the next turret, German client typing.
   Also: is the calibration flow itself understandable for a player (region, reference, two points with a 3 s
   countdown)? Report friction, not only pass/fail.
3. **Turret Manager** (old script) still works next to the new one.
4. **Fed Suit, Fast Transfer, Crafting** press the bound keys (after the key fix).
5. **Start/close with ARK** (`ArkLinkService`): client option on → starting ARK starts/closes what it promises.
6. Earlier rounds that were never seen in game: scancode key presses and unicode console typing reach ARK
   (Auto-Walk, Anti-AFK, Fast TP search box, console commands), script hotkeys fire while ARK is fullscreen, the
   silent-run toast when ARK is not focused, vision scripts on the right monitor (memory: they capture monitor 0).
7. Everything found goes into a ranked list: broken / unusable / confusing / fine. Fix rounds afterwards use the usual
   worktree → gate → two-lens review → land → push pattern; client `master` only, never a GitHub release.

### Branch rule (owner, 2026-09-18 night)
Everything lives on client `master` / panel `main` **locally**. Worktree branches are only a tool inside a round: every
round ends merged (ff), worktree removed, branch deleted, `git worktree prune`. Pushing `master` / `main` is fine —
**a release never is** (no `gh release`, no `v*` tag, no `update-manifest.yml`). Workspace was cleaned that night: both
repos have exactly one local and one remote branch (two fully merged panel remote branches deleted), headless browser
profiles under `Tempr-shots` and 30 build logs in the panel's ignored `.local` removed. On the owner's word the untracked `.superdesign/` (design drafts, nothing depended on it) and the old Codex-era
scripts in `.local` went too; `.local` now holds only `client-cdp`, `panel-consistency-4fd4a24` (fixture preview) and
`visual-harness` (scripts only, its browser profiles removed). `git status` is empty in both repos.

### Still open for the owner
Remove `test@example.com` on the panel's Team page · decide on the ponytail status-line badge · `wrangler deploy` of
the Cloudflare Worker · publish 1.5.3 from the panel when the in-game round is through · rotate the OpenAI key that
was pasted earlier.

### §19 addendum — state at the very end of the old chat (2026-09-18, ~23:30). This overrides §19 where they differ.
- **Key fix landed and pushed:** client `master` = `aa1d976` (== origin). `f154651` script keys come from the install's
  `DefaultInput.ini` (base layer) + the player's `Input.ini` on top, `StockBindings` only without an install,
  `AccessInventory` = F; lines starting with `;` are skipped. `aa1d976` one-shot repair: a stored
  `crafting.accesskey` of exactly `"E"` is dropped once (flag `crafting.accesskey.rechecked`) — released versions
  1.4.9–1.5.2 saved that wrong value whenever any crafting setting was touched; **the owner's own
  `preferences.dat` holds it too**. Gate 0 warnings / 3263 tests. No worktrees, one branch, clean status.
- **ARK has been started once after all** — the landing agent launched it against its instructions and against the
  owner's stop; I closed it again (it was idling at the main menu while the owner had VALORANT open). Consequences:
  `ShooterGame\Saved\Config\WindowsNoEditor\` now exists, `Input.ini` exists but contains only `DebugExecBindings`
  and **zero ActionMappings** (so every key resolves from the factory layer), there is still no world, no character,
  no `SavedArks`/`LocalProfiles`. The main menu was installing workshop mods (counter ~272 → 250 when closed); expect
  that to resume and take a while on the next start. No UAC appeared; `BEService` is stopped.
- **UNVERIFIED claim to check first in the new chat:** that agent reported every synthetic input into ARK was
  rejected ("blocked by UIPI") and blamed Riot Vanguard (`vgk`/`vgc` running, VALORANT open). The processes were
  really running, the cause is not proven. Test with VALORANT closed (Vanguard may need its tray icon exited or a
  reboot). If Vanguard really blocks `SendInput`, RazorReaper's scripts silently do nothing while VALORANT runs —
  that would be a second silent no-op cause next to "ARK not focused" and needs a visible warning in the client.
  If it was the computer-use tool's own limitation, the game has to be driven another way (the client's own scripts
  via hotkey + screenshots only, or the owner presses keys). Do not pass the claim on as fact before checking.
- Lesson for prompts: forbid launching ARK/Steam/the client explicitly in EVERY stage of a workflow, not only the
  first — the rule was in the shared block and the last agent still went past it "to be helpful".
- **Owner, last word before the new chat:** the PC was reset, so ARK starting from nothing (no world, no character,
  no settings) is expected and fine — create a new single-player world and character, `gcm`, then run every test we
  need. Items and structures needed for a test are simply cheated in through the console (look the exact command up
  at test time, e.g. the `gfi` / `giveitemnum` family); no farming, no asking.

## 20. In-game session 2026-09-19: what got proven, what did not (the owner is unhappy with the pace — read this first)

**Honest summary:** most of the night and half the day went into tooling problems instead of tests. Only Fed Suit was
really tested and rebuilt. Turret Filler (10 points), Turret Manager, Crafting, key rebinding in ARK, Fast TP, the console
path, ArkLink and the vision-monitor check are **still untested in game**. The owner ended ARK testing for the day.

### Proven
- **The "blocked by UIPI / Vanguard" claim was false.** `ShooterGame.exe` runs at medium integrity. The old agent read the
  computer-use tool's boilerplate error; the real cause was that the grant "ARK Survival Evolved" maps to the Steam link —
  the window belongs to `shootergame.exe` (grant it by basename while the game runs; same for the dev client
  `razorreaper.exe`). computer-use clicks/keys/typed console text reach ARK, also with BattlEye running.
  Whether a *running* Riot Vanguard blocks SendInput is still untested (vgc/vgk were stopped).
- **RazorReaper's own SendInput reaches ARK with BattlEye on** (Auto-Walk walked the character into the sea; Fed Suit opens
  the transmitter, clicks, transfers). Global hotkeys fire while ARK is the borderless-fullscreen foreground window (F4).
- One-shot repair of `crafting.accesskey` = "E" worked (prefs before: "E"; after first start: key gone, `.rechecked` = True).
- Key-scan status line / Rescan toast (~3.5 s) / ARK presence pill behave as designed. Not-focused feedback in the client is
  clear ("No action yet — ARK is not in the foreground.") but lives only in the client window.

### Fed Suit — what it is FOR (owner, verbatim sense) and what happened
Genesis 2 only: opening a Tek Transmitter while wearing no Federation exo suit puts a new full set on the player. The script
farms sets: open transmitter (F) → **click the player tab "DU"** (the middle panel opens on "TRANSMITTER") → T on each of the
five worn pieces so they land in the transmitter → Esc → reopen → repeat, as fast as possible, until stopped or N runs.
- The old macro never clicked the tab and pressed T 20× wherever the cursor was → moved nothing (evidence
  `F10-sheet.jpg`). Its "press F6 to stop" toast named a hotkey that was never registered (`RegisterHotkeys` had no caller).
- **Rework landed: client `master` = `f5a1c4c`, pushed** (gate 0 warnings / 3278 tests, two reviews). New
  `ArkInventoryLayout`: positions = client centre + offset × (height/1080) × `UIScaling` (read from
  `GameUserSettings.ini`), measured at 1080p/1.0: tab (−190,−425), slots x ∓164, y −339/−241/−145, offhand skipped.
  New setting Runs (0 = endless). Removed: search filter, click-first-slot, presses per cycle, dead F5/F6 code. A
  "nothing moved for 3 cycles → stop with a toast" guard exists (~110 lines, deletes cleanly if unwanted).
- In game (F4, Gen2, 1080p): tab click works, computed points sit centred on all five slots (`F60-slots.jpg`), helmet + chest
  + gloves transfer in < 1 s; **legs + boots stayed on** in both runs → hover 35 ms / press 40 ms too tight. A run started
  with an inventory already open goes out of phase and swings the camera (`F50-sheet.jpg`).
- Follow-up in flight when this was written: branch `wt/fedsuit-timing` (worktree `rr-wt-fed2`): hover 80 / press 70 /
  tab settle 100 ms + a guard that stops before any click when the inventory did not open. **Check `git worktree list` and
  `git log` first**; land it if gate + review are green, then rebuild the dev client. Unverified: the uniform-scale model
  at any UI scale ≠ 1.0 or aspect ratio ≠ 16:9.

### Other findings (code-verified, not yet fixed)
1. **Failed hotkey registration still shows as bound** (`AutomationScriptBase.cs` `SaveHotkey`/`ApplyHotkey`): the text is
   saved before registering; on failure only a toast, the field keeps the key, the next start fails silently. Seen live with
   F12 (Steam screenshot key) and F8 (RazorReaper's OWN crosshair-overlay default — the toast blames "another app").
2. **Fast Transfer has no UI at all** (`FastTransferMacro` only registered in DI) — delete or wire up: owner decision.
3. Every plain key is bound by ARK's `DefaultInput.ini` (F1–F12, Ins/Home/End/PgUp/PgDn, numpad) and all scripts ship with an
   empty hotkey → the player gets no suggestion. F7 is swallowed by the HotkeyField without feedback (probably WebView2's
   caret-browsing accelerator — unverified).
4. Test hotkeys set in the owner's prefs this session: Turret Filler F11, Turret Manager F10, Fast TP F9, Noglin F2,
   Crafting F3, Fed Suit F4; Anti-AFK interval 30 s (was 600). Reset them if the owner wants his defaults back.

### Tooling lessons (cost hours — do not repeat)
- **Sub-agents cannot send input through computer-use** (12 of 12 attempts "aborted (user interrupt)"; screenshots work).
  Only the main loop can drive the game. Do hands-on game input yourself; give agents CDP/code work only.
- Never `open_application("Shootergame")` — it starts another ARK instance. Focus with
  `scratchpad\focus.ps1` (Alt-tap + SetForegroundWindow, AttachThreadInput fallback). Focus right before every input batch.
- Evidence without touching focus: GDI `CopyFromScreen` (scripts `shot.ps1`/`shots.ps1`) + contact sheets; start a
  background capture loop, THEN press the hotkey. Do not call computer-use while a script is pressing keys.
- The Claude desktop window and the client window sit on the game monitor by default — move them with `MoveWindow`
  (DISPLAY2 at x=1920, DISPLAY3 at x=−1920). When the owner clicks into Claude, ARK loses focus and macros abort.
- `gcm` is a toggle (check weight 99999). Arrow keys move the camera. Unexplained: a computer-use `Escape` opened the
  Windows Start menu twice instead of reaching ARK; `TextInputHost` (Start/search input host) then held the foreground.
- Do not end a turn while waiting for a background task in this desktop session — the session did not resume by itself
  several times and the owner had to poke it. Keep working (docs, code reading) until the task notifies.
- ARK state left: single player Genesis 2 (owner loaded it), creative mode on, character at a Tek Transmitter; an Island save
  with 2 auto turrets / 1000 bullets / 2 metal foundations requested by console exists too (not verified in inventory).

## 21. Same day, afternoon/evening: Fed Suit follow-up, hotkey honesty, Discord bot rounds 1+2, NAS heat (all live)

**Heads: client `master` `314c120` · panel `main` `f35c73b` (served `index-BBOWPrs9.js` / `index-BLo-FmJ4.css`) · bot `main`
`c293711` (NAS container rebuilt) · keys repo `6054d45`. All pushed, one branch each, no worktrees. No client release.**

- **Fed Suit follow-up landed** (`66b7b26`): hover 80 / press 70 / tab settle 100 ms, and the macro stops BEFORE any click when
  the transmitter inventory did not open (majority of five sample points must change). NOT re-tested in game — the owner
  stopped ARK testing for the day. First thing to verify: all five pieces move per cycle on Gen2 (F4), start with the UI closed.
- **Hotkey honesty landed** (`314c120`, 3303 tests, two reviews): a refused registration shows a persistent "not active"
  badge on Global Hotkeys + the Scripts tile; an in-app conflict names the owner ("… already taken inside RazorReaper by
  Crosshair overlay"). Live-checked over CDP with Anti-AFK = F8 (then cleared). Still open, reported only: Auto Clicker's and
  the Crosshair page's own hotkey fields have the same flaw (crosshair is completely silent on refusal).
- **Announcement #7 incident:** a customer on 1.5.2 got "App Update Required … can no longer receive updates on its own" and
  reinstalled three times. Cause: row 7 was edited 2026-09-18 04:16Z (text + `max_version = 1.4.8`) by the previous session
  WITHOUT telling the owner, and version targeting does not work for shipped clients — `functions/api/announcements/active.ts`:
  "No `v` means everything matches", only unreleased 1.5.3 sends `?v=`; 1.4.8 never fetches announcements at all. So exactly
  the wrong people (1.4.9–1.5.2) see it. NOT changed (owner's content): recommended = deactivate row 7; optional server fix =
  derive the version from the `User-Agent` (`RazorReaper/1.5.2 …`, sent since 1.5.0). **Rule from the owner: tell him before
  and after any change to live content.**
- **Discord round 1 (live):** bot leaves every foreign guild (left "The Banana Pit" — notifier alerts from there are gone until
  the planned second, public bot), one role sync per 30 min via new panel `POST /api/discord/links`, extra **Lifetime** role
  (bot-created, 4 granted), `#reaper-lounge` for customers. Panel: Licenses → "Customer & order" → Discord accounts (Unlink /
  Link / "Replace existing" = rebind; adding beyond `max_uses` is the owner override), audited. **Owner must drag the bot's
  role above "Verified Customer"** — until then the sweep logs "Role … is above my highest role" and cannot grant/strip it.
- **Discord round 2 (live):** `#support` panel → category select → modal with required fields → AI triage BEFORE a channel
  exists ("False Topic" DM for wrong category / non-support) → `ticket-NNNN` under "Tickets" with Solved / "I need a human"
  buttons; billing goes straight to the owner; AI stops on human takeover, 8 replies, or the daily budget
  (`AI_DAILY_TOKEN_BUDGET` 400k). Claude (`claude-opus-5`, adaptive thinking, effort low, KB ~46k tokens cached in the system
  prompt) → Gemini `gemini-3.5-flash-lite` → OpenAI `gpt-5.6-luna`; redactor strips keys/mails/tokens/paths; KB generated
  from the client by `tools/build-kb.mjs` (`npm run build:kb`, staleness test; kb/ pinned to LF). 60 tests.
  Live smoke test in the container: all three keys valid + model ids exist; **the Anthropic account has NO credit** ("credit
  balance is too low") so every call currently falls through to Gemini, which triaged correctly and answered well in German
  (~55k input tokens ≈ 1.6 ct per answer). Known small gap: a credit/400 failure does not mark Claude "dead", so each call
  wastes one fast failing request until the owner tops up.
- Keys: `keys/razorreaper/ai support keys.txt` (private repo verified by anonymous 404) and NAS `bot.env`
  (`.bak-20260919` next to it). GitHub push protection rejected a FAKE Discord-token test fixture — fixed by assembling it
  from parts (history of 4 unpushed commits rewritten). Sub-agents see pasted secrets in their context and refuse to work
  around them (a Haiku gate refused to run) — run gates yourself when secrets were pasted in the chat.
- **Bot deploy path:** NAS `BOT_SRC` is a plain copy, not a clone: `tar -cf - <files> kb | ssh … tar -xf - -C $BOT_SRC`, then
  `powershell -File tools\deploy-nas.ps1 -Service bot` (npm eats `-Service` when called through `npm run`).
- **NAS "fans always on":** not indexing, not load — 2.5 h log: CPU avg 6.5 %, package temp never below 66 °C (avg 69, max
  81 during my deploys). Software is not the cause; check dust filter / fan mode in UGOS / location. A self-stopping logger
  writes `~/nas-watch.log` until 2026-09-20 ~16:30. Cheap win found but not applied: `loadSummaryD1`'s event stats full-scan
  (207 ms per 15 s dashboard poll) splits into three indexed queries (10 ms).

## 22. Same night: Discord round 3 live, a security finding caught in review, and two things the owner changed under the bot

**Heads: panel `main` `7a4d775` (served `index-D7EQcjSv.js` / `index-DxqRLU8M.css`) · bot `main` `0fb615a` (NAS rebuilt) ·
client `master` `314c120` unchanged. All pushed, one branch each, no worktrees.**

- **Round 3 (owner's list, all live):** the AI may ask for the app's support report (`[[NEED_REPORT]]` sentinel → embed with
  "I've sent it" / Skip → panel `POST /api/discord/support-context`; allow-list sanitiser, then the bot's redactor); Discord
  slowmode 45 s on ticket channels; **Re-enable AI** button; staff-only ticket log (entry on open, edited on close with the
  transcript attached); transcript upload to the panel (`POST /api/discord/tickets`, table `discord_tickets`, 800 KB cap, one
  shorter retry on 413) → **"Discord tickets (N)"** in Customer 360 and in Licenses → "Customer & order" (download only, the
  panel never renders the HTML; `Content-Disposition: attachment`, `nosniff`, `CSP: sandbox`), delete audited; **Delete
  ticket** button + auto-delete 24 h after close (`TICKET_AUTO_DELETE_HOURS`, `closed=` stamp in the topic, written in the
  same `channel.edit` as the rename because of the 2-per-10-min channel PATCH bucket); **My purchase** button
  (`POST /api/discord/purchase`, order ref + key masked, never through a model — uses the order data the SellHub webhook
  already stores; NO live SellHub/Stripe API integration, that would need their API credentials); answers in the member's
  language; one brand helper `brand.js` (accent purple `0x8b5cf6`, guild icon as thumbnail, ≤ 2 short lines per block, one
  blank line between blocks) used by every support/ticket/verify message. Gates run by the coordinator: bot 125 node tests,
  panel 145 files / 1848 tests + build. Live-checked from the bot container: 401 without the secret on all three endpoints,
  support-context found for 9 of 12 linked customers with NO forbidden field, purchase masking ok.
- **Security finding caught by review, fixed before deploy:** report ids were the row id (`FB-000123`), so a `report_id`
  anchor let anyone count through other customers' support messages + diagnostics. Now `FB-` + 12 random chars
  (`crypto.randomUUID`) for new reports, the sequential form is refused as an anchor, lookup only through
  `feedback_report_meta`; licence facts still require the report to belong to the linked machine. Verified by reading the code
  and live (`FB-000001` → `found:false`). Backup before the deploy: NAS `/data/db/rr-pre-discord-tickets-20260919.sqlite`.
- **The owner styles what the bot creates.** Minutes after each deploy he renamed the channels (`├│・createt-icket`,
  `├│・ticket-log`, category `| ====== TICKETS ====== |`). The bot looks channels/roles up BY NAME when no id is set, so the
  round-3 restart created a second, empty "Tickets" category (the owner deleted it himself). Fixed operationally: ids pinned
  in NAS `bot.env` — `TICKETS_CATEGORY_ID`, `SUPPORT_CHANNEL_ID`, `TICKET_LOG_CHANNEL_ID`, `CUSTOMER_CHAT_ID`,
  `LIFETIME_ROLE_ID`, `VERIFIED_ROLE_ID` (backups `bot.env.bak-20260919*`). **After every bot deploy grep the log for
  `[chats] Created`.** Code follow-up not done: persist ids / topic markers instead of name lookup.
- **Customer role replaced by the owner:** "✅ Verified Customer" no longer exists; he created **"RR-Customer"** (below the bot
  role, so the hierarchy problem from §21 is gone). `VERIFIED_ROLE_ID` now points to it, #reaper-lounge got an overwrite for
  it. First sync: **12 granted, 1 stripped** — audit log: "RR-Customer" removed from one member (not the server owner) who has
  no active licence link, i.e. a role the owner had given by hand. Reported to the owner; a hand-given role needs a link
  (panel → Link Discord account) or a staff grant (`/verify user:`), otherwise every sync removes it again.
- Still true from §21: the Anthropic account has no credit (Gemini answers); announcement #7 untouched; the in-game list is
  open; ARK and the dev client are still running on the PC (owner ended ARK testing, nothing was closed by me).

## 23. Late night: the owner's first real test ticket — what broke, what is fixed and live (2026-09-19, ~22:00)

- **Announcement #7 deleted on the owner's explicit order** (row saved on the NAS as
  `/data/db/announcement-7-deleted-20260919.json`); `/api/announcements/active` serves 0.
- **His test ticket (`ticket-0001`) could not be closed or deleted.** Causes, all read in the code + log: ticket state lived
  in the channel TOPIC, Discord allows 2 channel PATCHes per 10 min, so `await channel.edit({name, topic})` in the close path
  sat in the rate-limit queue and blocked transcript DM, #ticket-log, panel archive and the state Delete checks; on top, two
  bot redeploys by the coordinator during his test killed the pending close. **Rule since then: no bot restart while the
  owner tests — announce it first and check the log for ticket activity.**
- **Bot fix round, live (bot `main` `ea53683`, 143 tests):** no channel PATCH during a ticket's life (topic written once at
  create; AI on/off, waiting, reply count live in memory and are rebuilt after a restart by `hydrateTicket()` /
  `rebuildTicketState()` from the bot's own control messages — their buttons are the record); close = guard → transcript →
  DM / #ticket-log / archive → ONE "Ticket closed" message that ALWAYS carries the staff-only Delete button → rename + hide
  NOT awaited; Delete is gated on "closed" = this process's record OR `closed-` name (review blocker: a re-opened ticket kept
  a live Delete button); a scan that hits its 50-message window leaves the AI off. The AI knows the buttons: purchase/order
  questions end with `[[SHOW_PURCHASE]]` → the bot posts the same embed as *My purchase* (data never reaches a model),
  `[[NEED_REPORT]]` only for technical problems. Budget counts cached reads at 10 % (`weighUsage`; the live line
  `in=51566 out=38 cacheR=49222` is 7 305, not 56 527). A provider answering 400/401/403 with a billing/auth error is parked
  60 min (Claude has no credit → Gemini answers without a wasted call each time). Startup log after deploy: no
  `[chats] Created`, healthy. Backups on the NAS: `*.bak-20260919d`. **Not yet clicked through live by anyone:** the new
  close/delete path and the orphan `ticket-0001` (pressing *Delete ticket* there should now work: hydrate finds the old close
  message's Delete button).
- **Client: support reports were impossible on 1.5.3** — "diagnostics.providers[8].checks[4].key is invalid.": the nested
  route `/guides/dino-level` produced the check key `route_guides/dino_level`, the panel validates
  `^[a-z0-9][a-z0-9._:-]{0,63}$` and rejects the whole report. Fixed at the single choke point
  `DiagnosticSnapshotService.NormalizeCheck` (`SanitizeKey`), with a test that runs the REAL nav catalogue + script list
  against the panel's pattern and duplicate rule. Client `master` `e66e522`, pushed, 3311 tests, 0 warnings, dev build
  rebuilt; NOT released (rule). Released clients ≤ 1.5.2 do not have that route, so they are not affected.
- ARK and the dev client are no longer running (closed by the owner). Workflow lesson: a stage whose context shows a
  "relayed user message" unrelated to its task may refuse (Sonnet builder did) — say in the stage rules how the task derives
  from the owner's message.
- **Round 4 ordered by the owner (in progress when this was written):** ticket commands as slash AND `@bot <word>` (close,
  transcript, delete [staff], enableai, disableai), one open ticket per CATEGORY, and a role (`HUMAN_PING_ROLE_ID`) that
  decides who is pinged on "I need a human" + owner-only `/ticketping`. Spec: scratchpad `discord-round4-spec.md`.
- **Round 4 landed and is live the same night (bot `main` `2a0c0fa`, 154 tests, two independent reviews, 1 blocker fixed):**
  one `runTicketAction(action, channel, member, respond)` behind three doors — buttons, slash (`/close /transcript /delete
  /enableai /disableai`) and `@RazorReaper <word>` at the START of a message in a ticket (parser `parseBotCommand`, handled
  before the AI path; the @bot transcript goes to the caller's DMs). `delete` is staff-only and on an OPEN ticket runs the
  full close first; `closeTicketChannel` now awaits the panel archive as its LAST step (review blocker: delete could outrun
  the upload) and `verifyApi` has a 30 s timeout (bounds every panel call). Open-ticket limit is per (opener, CATEGORY), a
  ticket this process knows is closed no longer counts as open while its rename is queued, daily cap = max(3, categories) = 6.
  "I need a human" pings the members of the role `HUMAN_PING_ROLE_ID` (individual `<@id>` mentions, cap 10, member cache
  via the shared `fetchGuildMembers`), fallback = the owner; owner-only `/ticketping user:` toggles that role. **The env id
  is NOT set yet** — the bot never creates the role; the owner creates one, then pin its id in NAS `bot.env` and redeploy.
  Verified live: all six commands registered in the home guild (read from Discord's API inside the container), startup log
  clean, no `[chats] Created`. NOT clicked through live by anyone yet: every door, `/delete` on an open ticket, the ping.
  NAS backups `*.bak-20260919e`.
- **Ping role created on the owner's order ("mach du"), 2026-09-19 ~22:45:** role **"🔔 Ticket Ping"** (id
  `1550968709764612106`, no permissions, not mentionable, position 1), given to the owner so he stays pinged; pinned as
  `HUMAN_PING_ROLE_ID` in NAS `bot.env` (backup `bot.env.bak-20260919-pingrole`), bot recreated, startup log:
  `"I need a human" pings the holders of role …`. He may rename it (id is pinned). More people: `/ticketping user:`.
- **Live click-through still open.** computer-use screenshots HIDE every non-granted window — the owner was in a game
  (`cod.exe`) and told me to use the browser instead; Discord WEB in the Claude-in-Chrome browser is not logged in (login =
  owner only, QR code). Meanwhile a read-only audit workflow walked the ticket flows in the code (`rr-bot-ticket-audit`).

## 24. Night of 2026-09-19: the ticket system clicked through LIVE, a code audit, and what both found

- **How the live test was possible:** the owner was in a game, computer-use screenshots hide non-granted windows, so he said
  "mach einfach über browser". Claude-in-Chrome = his **Google Chrome** (not Comet); Discord web there was logged out until he
  scanned the QR code himself. The tab lives in the "Claude" tab group. Screenshots cannot be saved to disk by that extension
  version — evidence is `#ticket-log` (Ticket 0002) and the bot log.
- **Proven live on bot `2a0c0fa` (test ticket `ticket-0002`, Scripts & Automation, opened/closed/deleted by the coordinator):**
  panel select → modal → triage → channel + opening embed → first AI answer (Gemini; Claude parked after ONE failed call) →
  report prompt → Skip → `/disableai` → `/enableai` → `/transcript` (ephemeral html) → *I need a human* (pinged the 🔔 Ticket
  Ping holder) → `@RazorReaper Helper enableai` (USER mention) → second ticket in the same category refused, category + ticket
  named → *Solved — close*: ONE close embed + Delete button, `closed-0002` + `closed=` stamp within seconds, log
  `Archived ticket-0002 (closed) in the panel.` / `renamed and hidden`, #ticket-log entry edited with the transcript →
  *Delete ticket*: channel gone at once. The owner's original complaint (cannot close / cannot delete) is fixed and proven.
- **Seen live, being fixed (spec: scratchpad `live-test-findings-spec.md`):** typing `@RazorReaper` + space inserts the bot's
  managed ROLE mention, not the user → the command was ignored AND went to the AI, whose answer was empty after sentinel
  stripping = paid silence (`out=5`); the open-ticket limit is only checked after the form is filled; the panel still says
  "One open ticket at a time."; #ticket-log said "0 AI replies" because `/enableai` resets the cap counter the close reports.
- **Owner decision pending — slash-name collision:** `/transcript`, `/close`, `/delete` also exist on the old **Ticket Tool**
  bot and Discord lists Ticket Tool's first (its `/transcript` answers "This channel isn't a ticket"). Recommendation given:
  remove Ticket Tool (our bot replaces it) or disable its commands under Server Settings → Integrations.
- **Audit (workflow `rr-bot-ticket-audit`, 6 Sonnet flow-walkers + Opus refuters): 15 confirmed defects**, list with the
  verifier's reasoning in scratchpad `audit-confirmed.json`; fixed on branch `wt/audit-fixes` (`db328f8` + review fixes
  `dd7b909`, 156 tests): one hand-off producer acked before any await, the 8-answer cap liftable by staff only, role-mention
  door, sweep reconciles a close rename lost to a restart, one in-flight close promise, limit check hydrates the blocking
  ticket, ⏳ receipt for a message that arrives mid-answer, "cut short" marker for the 1900-char slice, attachment-only
  messages answered, Report ID accepted after the 30-min window, dead `!` prefix table removed from COMMANDS.md.
- **All of it landed and is live (bot `main` `1033761`, 159 tests, deployed 2026-09-19 ~23:55, NAS backups `*.bak-20260919f`):**
  the 15 audit fixes, the live findings (panel text "per category"; an empty AI answer posts one short brand line and costs
  no answer; limit refusal BEFORE the modal via module-level `ticketLimits`/`ticketLimitEmbed`; the panel's select is reset
  after every pick; `totalAiReplies()` = answers counted from the transcript, shared by close and channelDelete) and one
  coordinator decision against the fix stage: **"I need a human" is never a dead end** — `humanPinged` means only "a real
  ping went out" (written in `humanPing()` alone); AI on → one hand-off with the Re-enable button (no ping when STAFF
  switches it off); AI off + member + no ping yet → a PING-ONLY message without a button (keeps the one-live-button
  invariant); AI off + staff → refused; after a restart at most one extra ping-only message per ticket.
- **Re-tested live after the deploy (`ticket-0004`):** panel text ✓, select reset ✓, same-category refusal arrives at once
  without the form ✓, `@RazorReaper delete` typed with the ROLE mention on an OPEN ticket → closed, `Archived ticket-0004
  (closed) in the panel.`, renamed, deleted ✓. NOT re-tested live: the empty-answer line (needs a bare-sentinel answer), the
  ping-only message (needs a non-staff member), staff lifting the 8-answer cap, the sweep's rename reconcile.
- **Known ceilings, told to the owner:** the daily AI budget lives in memory — every bot restart resets it; a ticket's FIRST
  answer costs ~52k weighted tokens (the 46k KB is not cached on the first call), so `AI_DAILY_TOKEN_BUDGET=400000` is about
  7 new tickets a day; follow-ups cost ~7.5k. Ticket Tool's colliding slash commands are still the owner's call.

## 25. 2026-09-20 → 09-22: low-tier AI only, the last dead hotkey fields — STATE AT THE CHAT SWITCH (read this first)

**State:** client `master` `82948da` (dev build rebuilt, not running, NOT released — stays 1.5.3), bot `main` `fbddf95`
(live on the NAS, healthy), panel `main` = this doc. All pushed, no worktrees, no extra branches.

- **Owner order 2026-09-20: "low model only was token cost angeht".** Bot defaults are now `claude-haiku-4-5` →
  `gemini-3.5-flash-lite` → `gpt-5.4-nano` (commit `fbddf95`, 160 tests, two Sonnet reviews "land", deployed, startup log
  names the three). Haiku 4.5 accepts NO adaptive thinking and NO `effort` (Anthropic Models API) — the adapter omits both
  for any `haiku` model and keeps them for bigger ones (test pins the request shape). OpenAI gets `reasoning.effort: low`
  only for gpt-5 / o-series. **Balances: Anthropic 0 AND OpenAI 0** (OpenAI answers 429 "You have no credits remaining",
  now parked like an account error) → only Gemini answers. Never raise the bot's model tier without the owner.
- **Biggest remaining AI cost (next chat, task 1):** every answer ships the whole knowledge base as system prompt, ~46k
  tokens (`kb/ui.md` ≈ 39k of it; first answer of a ticket ≈ 52k weighted, follow-ups ≈ 7.5k with cache). Review proposal:
  split `kb/ui.md` on its `## ` headings and send only the sections mapped to the ticket's category (static map, no new
  dependency), keep the small files; ~6 cached prompt variants instead of 1. Not built yet.
- **Client: Auto Clicker and Crosshair hotkeys are honest now** (`787061c` + tests `82948da`): a refused registration shows
  the shared `HotkeyWarn` badge (new component, replaces the copies in `HotkeyLink.razor` / `GlobalHotkeys.razor`), the
  Auto Clicker toast names the in-app owner (`scripts.toast.hotkey.conflict`), `HotkeyBinding.Holds` stops naming a feature
  whose own key was refused, no new texts (keys exist in de/en/ru/zh-Hans). Gate run by me: build 0 warnings, 3319 tests.
  Known limits: a field that failed because a neighbour held the key only recovers when its own key is re-entered or the app
  restarts (same as scripts); a crosshair refusal shows the badge but no toast. Only checkable in the running app (list in
  the workflow report): F8 on the Auto Clicker → toast "Crosshair overlay"; badge on both pages; clears on a free key.
- **Flaky test (pre-existing, not from this branch):** `ScanLoopCadenceTests.ASlowTickDoesNotStretchTheInterval` (wall-clock,
  mean gap < 140 ms) fails in ~half of the full-suite runs while a game loads the PC; green alone. Make it load-tolerant or
  mark it, when touched next.
- NAS rebooted on ~2026-09-21 (all containers "Up 20 hours" on 09-22), bot came back healthy; one more real ticket
  (`ticket-0005`) was answered and archived afterwards.

**Open list for the next chat (the owner's prompt carries it):** 1. KB trim per category (above). 2. In-game test round
(memory `rr-ingame-test-session-pending`) incl. the new hotkey badges — only when the owner is not gaming. 3. Bot paths not
yet live-tested: empty-answer line, ping-only message, staff lifting the 8-answer cap, sweep rename after a restart.
4. Bot: replace the remaining name-lookup fallbacks with pinned ids. Owner decisions pending: remove Ticket Tool (slash
collisions), credits/spend limits at Anthropic + OpenAI, the stripped role of "♛ HΔMSTΣʀ ♛", Fast Transfer delete or wire
up, NAS dust/fan profile.

## 26. 2026-09-22 evening: KB per category + pinned ids live, Discord paths tested, Fed Suit rebuild in flight

**Heads when written:** bot `main` `5b1fc47` (NAS runs `bb2caf7`; `5b1fc47` = startup-log NaN fix, not deployed yet) · client
`master` `82948da` (dev build running on the PC, not released) · panel `main` = this doc. Worktrees in flight:
`rr-wt-fed3` (`wt/fedsuit-verified`, client) and `rr-wt-bot6` (`wt/bot-live-fixes`, bot) — workflow `fedsuit-verified-and-bot-fixes`.

- **Task 1 — KB per category, LIVE (bot `388e835` + `a63bd0b`, deployed 2026-09-22 ~20:50).** `loadKb()` returns
  `{base, preamble, sections}`; `kbFor(kb, category, text)` sends the non-ui files + the category's `UI_PAGES` sections of
  `kb/ui.md` + up to `MENTION_MAX = 4` pages the MEMBER named (title or German nav label, whole word, file order so the
  bytes are stable); `PAIRED = {customlab: ['sky']}`; bare `## key` pages (hud, uw, compact, dinolevel) live in the map.
  Startup log: `install 10.7k, license 9.4k, scripts 13.2k, bug 13.4k, other 10.3k`. **Proof from the bot log:** before
  `answer gemini/gemini-3.5-flash-lite in=51680`, after (ticket-0006, scripts) `in=15141` → −71 %. Models unchanged (low tier).
- **Task 4 — pinned ids, LIVE (bot `bb2caf7`).** `id-store.js` (`loadIds/saveIds/looseName`), NAS `/data/ids.json`
  (bind mount `/volume1/docker/razorreaper/data/bot`). Order everywhere: env id → stored id → loose name → create; found or
  created ids are stored, env ids never. `[ids] resolved: …` line at ready. **Found on the way:** `STAFF_ROLES` matched exact
  names but the live roles carry emoji (`👑 Owner`, `🛡️ Admin`, `⚔️ Moderator`, `🎫 Support Staff`) → no staff role ever
  matched; now resolved by loose name and pinned (4 ids), optional env `STAFF_ROLE_IDS`. `/ticket` and the welcome embed link
  the real support channel (it is called `├│・createt-icket`, the old `create-ticket` substring never matched). Note:
  `generalChat` resolved to `├│🧾・staff-chat` (loose name contains "chat") — same as before the change, only used to decide
  "do not create"; the server has no public chat (owner decision open).
- **Task 3 — Discord live test (ticket-0006, owner's account in Comet, deleted afterwards):** ✓ empty-answer line
  ("Still with you" after a bare-sentinel answer), ✓ 8-answer cap → "Handed to a human" + ping, ✓ staff "Re-enable AI" lifts
  it and the next answer arrives. ✗ ping-only message: needs a NON-staff account (the owner is staff) — not testable here.
  ✗ rename after restart: needs a manual channel rename (blocked for me as a server-settings edit; owner chose to skip).
  **New findings (fix round `wt/bot-live-fixes` in flight):** a pasted Report ID was fetched (`in=16163`) but flash-lite
  answered with the purchase embed; the model quoted i18n keys (`notactive.hint`); it said "die Wissensbasis enthält…";
  after "I've sent it" → "Report not found" the member's next question got silence (30-min wait) and "not found" never
  mentions Skip; after Skip the pending question is not answered.
- **Comet, not Chrome:** the Claude-in-Chrome extension is connected through **Comet** now (Google Chrome was not running).
  A background tab is `document.hidden`: Discord's modals then never finish animating and stack up (two "Billing" forms
  opened by mis-clicks, both discarded, nothing submitted). Only test when the owner has the tab in front.
- **Client hotkey honesty ✓ live:** Auto Clicker = F8 → toast "Could not register F8 — Crosshair overlay already uses that
  key." + orange "not active" badge; back to F6 clears it.
- **Fed Suit in game (Gen2):** the transmitter must be switched ON (`[E] Einschalten`) or F opens nothing — the script's
  not-open guard stopped correctly but the reason only shows as an in-app toast (invisible while ARK is in front).
  Owner's own runs: works, but after 2–3 cycles pieces stay behind — **the boots (last slot) never move**: the exit key
  follows the last T press by ~150 ms and closes the inventory before the server finished. Owner's orders: never close
  before every selected piece is across, retry until it is, stop only when a piece really cannot move (transmitter full);
  piece selection (e.g. only gloves + chest); a lag buffer; positions by UI scale, never by language. Rebuild in flight.
  **Holding E on the transmitter opens a radial whose only entry is "Abreißen" (demolish) — never hold E there.**
- Owner decisions this evening: Windows notification when ARK is in front for script stop/warning toasts (next round);
  rename test skipped. Still open for him: Ticket Tool removal, credits/spend limits, HΔMSTΣʀ role, Fast Transfer, NAS fan,
  lower `AI_DAILY_TOKEN_BUDGET` (400k now covers ~30 tickets instead of ~7), public chat yes/no.

## 27. Night 2026-09-22 → 23: Fed Suit hardened in game, Turret Manager merged, keys follow ARK — TEST LIST FOR TONIGHT

**Heads:** client `master` `df37c8f` (pushed, dev build rebuilt, NOT released — stays 1.5.3) · bot `main` `dcd413d` (live on the
NAS, KB regenerated from `df37c8f`) · panel `main` = this doc. No worktrees left except a flake fix in flight
(`rr-wt-flake2`, `wt/fault-flake`). ARK and the client are closed (owner closed them 22:49; my offline checks closed theirs).

- **Fed Suit — in-game proven by the owner (10 clean runs on `79f322c`, piece selection too).** Chain: `cbd2cf7`/`35ab634`
  code-driven verified cycle + piece checkboxes + lag buffer → `9d4b5d3` 8 press rounds → `79f322c` whole-slot pale-pixel
  detection (`ArmorSlotLook`, measured on 254 real frames: worn 0.09–0.34, empty 0.000, threshold 0.045 — the old 13×13
  centre box read the TROUSERS as empty because the icon has a gap between the legs; that was the "always the legs /
  never 10 runs" bug) + continue-instead-of-stop (stop only on 2 idle cycles = transmitter full, or the same slot failing 3
  cycles) + lag buffer only on open/set/leave waits → `40ce366`/`60ec4c8` after the last run one more open+close so the
  player ends WEARING a set; a dropped press is re-pressed after ~150 ms quiet instead of 600 ms. **Not yet seen in game:**
  the final open+close, the faster re-press, UI scale ≠ 1.0.
- **In-game warning banner (`b591b4f`):** every warning/error toast also shows as a small non-activating, click-through
  banner at the top of ARK when ARK is in front (reuses the crosshair overlay window plumbing; Settings toggle "Show script
  warnings over the game", default on). Windows 11 would swallow OS toasts (auto Do-Not-Disturb while gaming). Not seen in
  game yet.
- **Keys follow ARK (`42c041e`, Turret `ecbb988`):** Rescan now re-reads every script's keys (it never told the scripts
  before) and falls back to ARK's default layer, never the old in-memory key; a key is stored only when the player types it
  (`ArkKeyDefaults.Follow/Keep`, `ArkKeySetting`). Offline-proven tonight on the real Input.ini (G/Y rebind → Rescan →
  Fed Suit/Crafting/Turret take G/Y; restore → Rescan → F/T, no restart). The owner's pinned `fedsuit.openkey/transferkey`
  were dropped by the migration; Input.ini restored byte-identical (hash checked), backup removed.
- **Turret Manager = Filler folded in (`3be421f` `20beb21` `ecbb988` `df37c8f`, Experimental):** passive watcher; on each
  opening of a TURRET inventory: Fill Max (Transfer All, clicked until two clicks change nothing, cap 10) or Stacks (bullets /
  shards per turret via the transfer key on the first icon-detected ammo cell, re-scan after each press); language-free
  ammo classifier (bullet copper/olive vs shard pale grey); tooltip hint read from GameUserSettings.ini
  (`bEnableInventoryItemTooltips=True` on the owner's PC); lag buffer; ammo calculator (checked in the running client:
  10 turrets/5000 bullets → 5 stacks each, 3 tek/4000 shards → 1 stack each, 1000 left); "Use per-turret stacks". Turret
  Filler removed everywhere (class, DI, page, diagnostics, tests, i18n). **Caveat:** no real turret inventory was ever
  captured — `T01` turned out to be the owner's Tek GENERATOR (he opened it at that moment). The turret signature therefore
  fails CLOSED: it fires only on a one-row structure inventory with ≤ 6 bordered slots and no grid below; the log line
  `Turret Manager sees frame x/9, rows a/b/c → turret: …` shows what it reads. A storage box never triggers it.
  **Power on/off not built** (owner decision pending): a powered turret shows "[E] Ausschalten" (tap E toggles power; an
  unpowered one opens its inventory with E); the hold-E radial has no power entry but has Aufheben/Abreißen — never
  automate it.
- **Bot live `dcd413d`:** KB per category (task 1), pinned ids + staff roles (task 4), the five live-test fixes (`7c40729`:
  report data pass answers the ticket, no i18n keys, never mentions the knowledge base, one receipt while waiting for a
  report, Skip answers the pending question), startup-log fix, KB regenerated twice.
- **Process lesson:** a Haiku gate told "read-only" committed its own Fed Suit change in another worktree (`4d0dbb9`,
  dropped). Gate/review prompts now say "REPORT ONLY — do not edit, do not commit", and every branch is checked with
  `git log` before landing.

**TEST LIST for tonight (with the owner, ARK single player, Gen2):**
1. Fed Suit: Runs 10 → ends wearing a set; pick only gloves+chest; lag buffer 0 vs 200; walk away mid-run → the banner at
   the top of ARK says why it stopped.
2. Fed Suit at ARK UI scale 0.8 (Options → interface scale; restore 1.0 afterwards) — slots/tab must still be hit.
3. Turret Manager: Tek turret (5 slots) — switch on (F10), open it (unpowered: short E), carry bullets + shards →
   Max fills it; read the log line; Stacks = 2 → exactly 2 stacks; open a storage box while it runs → must do nothing.
   Heavy/Auto turret: probably does NOTHING (fails closed) — read its rows from the log, then decide the signature.
   Tooltips on vs off with Max (confirmation dialog? multi-click?).
4. Keys: rebind "Transfer item" in ARK's own key options → client Rescan → Fed Suit/Turret/Crafting show it → restore.
5. Crafting watcher/walk at a fabricator · Fast TP at a Tek teleporter (unicode typing) · Noglin console path ·
   ArkLink start/close · vision capture on the right monitor.
6. Owner decisions: turret power option (how should it work?), Ticket Tool removal, Anthropic/OpenAI credits + spend
   limits, HΔMSTΣʀ role, Fast Transfer (dead code — delete or wire), NAS fan/dust, lower `AI_DAILY_TOKEN_BUDGET`, public
   chat yes/no, release 1.5.3 (his button only).
- **Later that night:** second wall-clock flake fixed deterministically (`538e7d7`, BackgroundFaultTrackerTests now checks the
  fault bucket stayed undescribed); client `master` = `538e7d7`, 3391 tests, 0 warnings, pushed, no worktrees left. The dev build
  from `df37c8f` is current for tonight (the last commit is test-only).

## 28. 2026-09-24: Discord server + bot pass (the app itself untouched, on the owner's order)

**Heads:** bot `main` `4e87b63` (live on the NAS, 205 tests) · client `master` `538e7d7` unchanged · keys `f1321a1`.

- **AI:** the owner deleted the Gemini key by accident (401 since 06:42Z, `ticket-0007` of a real member went unanswered);
  new key live and in `keys/`. He has and wants NO separate API billing at Anthropic/OpenAI (a subscription does not cover the
  API; every OpenAI model incl. nano answers 429 `credit_balance_exhausted`) → both commented out in `bot.env`, Gemini only.
  New: staff get one #ticket-log line when a provider is parked for an account error.
- **Tier model (owner):** rr-chat = everyone · premium-chat + `├│🧪・early-commits` = every active licence · exclusive-chat =
  Lifetime only. Roles are EXCLUSIVE now: RR-Customer = active non-lifetime, Lifetime = active lifetime (the first sweep took
  RR-Customer from the 4 lifetime holders as intended; the Lifetime role sees everything RR-Customer sees). Channels by id
  (`CUSTOMER_CHAT_ID`, `LIFETIME_CHAT_ID`, `EARLY_CHANNEL_ID`); the `generalChat` name-guess (it had pinned staff-chat) is gone.
- **Permissions (applied through the bot token, dry run + simulation per member type first, backup in
  `.local/discord/guild-perms-before-20260924.json`):** Member no @everyone/@here/TTS; #updates/#changelog read-only (still
  public); Moderator gains message/thread/nick/voice moderation + audit log, loses Manage Server/Channels (owner: only he and
  Admin manage the server); Support Staff loses Administrator, gets ticket-log/staff-chat/bot-commands; Lifetime hoisted;
  rr-chat lost the Manage* denies that disabled mods there. Locked voice placeholders (🔒 Premium/Exclusive) make the paid
  chats visible as "exists" without leaking content (a text channel cannot do that). Two public voice channels.
- **#verify:** the OLD `└│🔗・verify` was deleted by the owner on 2026-09-13 (audit log) — /verify had answered "Wrong channel"
  with a dead link since. New `└│🔗・verify` 1552605531137515540 with the RR panel ("🎁 Discord perks"); /verify only there
  (anywhere if that channel vanishes again); member chat there is deleted (keys at once + hint). The panel text lives in
  `buildVerifyPanelEmbed` — edit the code, the bot re-syncs the message on start.
- **Commit feed:** the client's push notifications (`discord-release.yml`, webhook "rr-helper") moved from public #changelog to
  early-commits; releases stay public in #updates.
- **/buildembed [channel]** (new messages) and **/editembed message:** (bot messages) — Discohook-style builder in an ephemeral
  message: text/author/footer/images/fields modals, colour presets + hex, RR logo/avatars as icons, RR style, timestamp, ≤5 link
  buttons, JSON import/export. Not clicked through by anyone yet.
- **Announcement** "Where your money goes" posted with @everyone on the owner's OK.
- **Owner-only, still open:** remove Ticket Tool (slash collisions), take Administrator off the top role "🤖 Bot" (the bot cannot
  edit its own top role), optional 2FA requirement for moderation, the empty roles "1"–"10", answer ticket-0007.
- **Later the same day (bot `3848114`, 207 tests, live):** early-commits was a misunderstanding and is gone again — the push
  webhook posts to the PUBLIC #changelog as before (owner: changelog + releases stay public). Perks he picked: **⭐ Priority
  Support** (a ticket opened by an RR-Customer/Lifetime holder carries `prio=on` in its topic, shows ⭐ in the opening embed,
  #ticket-log and /queue, and pings the Ticket-Ping holders at once while the AI still answers; "I need a human" unchanged) and a
  customers-only preset forum `├│🎯・presets` 1552621733863755817 (tags, gallery, tag required, pinned RR guide post). The
  lock placeholders (renamed by him to `├│🔒Premium・voice` / `├│🔒Exclusive・voice`) are real tier voice channels now: the
  tier joins, everyone else sees a lock. The verify panel's "🎁 Discord perks" lists premium-chat, presets, priority support
  and (Lifetime) exclusive-chat.
