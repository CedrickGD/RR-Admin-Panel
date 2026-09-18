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
