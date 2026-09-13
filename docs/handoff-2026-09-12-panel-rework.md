# Handoff: Panel-Rework (Stand 12. September 2026, Abschluss 13. September → Abschnitt 6)

Für einen neuen Chat. Dieses Dokument ist so geschrieben, dass der nächste Chat ohne die
Vorgeschichte arbeiten kann. Alle Datei-Zeilen-Angaben stammen vom Working Tree bei Commit
`30b7ad2` (= `main` = `design-audit/phase-1-2`).

---

## 0. Worum es geht

Die Design-Audit-Roadmap (`docs/design-audit-2026-09-07.md`, 72 Findings) ist vollständig
umgesetzt und liegt auf `main` (zehn Commits, `6127e49..30b7ad2`). Sie war fast ausschließlich
Konsistenz- und Aufräumarbeit (Tokens, tote CSS-Regeln, Cascade, Container-Queries) und musste
per Pixel-Vergleich weitgehend **unsichtbar** bleiben. Genau das ist das Problem: Der Nutzer wollte
von Anfang an „ein ordentliches Panel" und bewertet den Stand als „hat sich nicht viel geändert,
es ist alles komplett Arsch".

Die Messlatte des Nutzers, in seinen Worten:

- einheitliches Design für Suchleisten, Buttons, Regler, Knöpfe, „für alles"
- nicht übertreiben mit den Farben
- Platzierung/Spacing muss „um einiges besser" werden, nichts darf „verschoben" wirken
- nicht „3000 Filter überall verteilt", sondern pro Seite ein ordentlicher Ort dafür
- kompakter, aber: „nicht am Design nachlassen, es muss hinterher gut aussehen"
- auf dem Handy benutzbar (aktuell: „komplett absolut nicht nutzbar")

Der nächste Chat soll **sichtbare, benutzbare Verbesserungen** liefern, nicht weitere
Cascade-Hygiene. Wo Aufräumen nötig ist, um etwas Sichtbares sauber zu bauen, ist es Mittel, nicht
Ziel.

---

## 1. Ausgangslage, die man kennen muss

### 1.1 Wo was läuft (Stand 12.09.2026, nach dem Umbau auf einen Git-Checkout)

**Domains und Dienste**

| Adresse | Was | Wo |
|---|---|---|
| `admin.razorreaper.app` | das Panel (SPA) + same-origin `/api`-Gateway | NAS, Container `admin` (Caddy), hinter Cloudflare Access |
| `api.razorreaper.app`, `origin.razorreaper.app` | Backend `rr-api` (die Pages-Functions + Worker-Code auf SQLite) | NAS, Container `rr-api` |
| `rr-admin-panel.pages.dev` | Legacy-Hülle: statische SPA + `/api`-Proxy nach `origin.` | Cloudflare Pages, deployt automatisch von `main`, benutzt niemand |
| `backend.rr-admin-panel.workers.dev` | Legacy-Ingest-Proxy für alte App-Clients | Cloudflare Worker |
| `bot.razorreaper.app` | Discord-Bot + Notifier (separates Repo `razorreaper-bot`) | NAS, Container `bot` |
| `media.` / `dl.razorreaper.app` | Media und Downloads | NAS, Container `caddy` |

Alles auf dem NAS (UGREEN DXP2800, 192.168.2.201) hängt am Cloudflare-Tunnel `rr-nas`
(Container `cloudflared`); dazu `backup` (nächtliches SQLite-Backup). Übersicht in
`deploy/nas/README.md`, Compose in `deploy/nas/compose.yml`. Cut-over des Backends war am
21.08.2026; der Nutzer sagt, das Panel selbst sollte nie mit aufs NAS, nur das Backend (siehe 2.1).

**Login:** `AUTH_MODE=access`, `ACCESS_ENFORCEMENT=strict`
(`/volume1/docker/razorreaper/data/env/rr-api.env`). Also nur Cloudflare-Access-Login (E-Mail +
One-time PIN), **kein** In-App-Passwort mehr. Das Passwort gab es im früheren `AUTH_MODE=app`,
dessen `admin_users`-Tabelle noch existiert (`/api/auth/session` meldet `hasUsers: true`).
`ACCESS_ALLOWED_EMAIL` enthält nur die zwei Owner-Adressen, `ACCESS_ADMIN_EMAIL` die
Outlook-Adresse.

**Deploy, neuer Standard seit 12.09.:**

- `/volume1/docker/razorreaper/src/RR-Admin-Panel` ist ein **echter Git-Clone** von `main`. Vorher
  war es ein per Robocopy gefüllter SMB-Spiegel ohne `.git` (deshalb scheiterte `git pull` mit
  „not a git repository"); der Spiegel liegt als `RR-Admin-Panel.mirror-20260912` daneben (enthält
  auch einen `git-2.47.0`-Quellbaum) und kann gelöscht werden.
- **Ein Push auf `main` allein ändert das Panel nicht.** Deploy vom PC: `npm run deploy:nas`
  (`tools/deploy-nas.ps1`, Commit `3dd93c7`): prüft, dass HEAD gepusht ist, macht auf dem NAS
  `git pull --ff-only origin main` und `docker compose up -d --build admin`. Backend mit:
  `npm run deploy:nas -- -Service admin,rr-api`. Von Hand:

  ```bash
  ssh cedrick.grabe@192.168.2.201
  cd /volume1/docker/razorreaper/src/RR-Admin-Panel && git pull --ff-only origin main
  cd deploy/nas && docker compose up -d --build admin        # oder: admin rr-api
  ```

- `deploy/nas/.env` (DATA_DIR, BOT_SRC, …) ist git-ignored und überlebt Pulls; Secrets liegen unter
  `${DATA_DIR}/env`, nie im Checkout.
- SSH von diesem PC: `~/.ssh/id_ed25519` (Kommentar `antigravity-rr-nas`, von Antigravity angelegt),
  Benutzer `cedrick.grabe`, in der `docker`-Gruppe. Frühere Fehlversuche lagen am falschen
  Benutzernamen, nicht am Key.
- Verifizieren nur per SSH (Access blockt von außen sogar `/api/health`):
  `docker exec razorreaper-admin-1 ls /srv/admin/assets` zeigt die ausgelieferten Hashes.
- Rückfall: Images `razorreaper-admin:backup-20260912-pre-audit` und
  `razorreaper-rr-api:backup-20260912-pre-audit` (Stand 6. September). Zurück = in `compose.yml`
  das `image:` vorübergehend auf den Backup-Tag setzen, `docker compose up -d admin` ohne `--build`.
- **Verifikationsnotiz 12.09.:** Vorher lief der Build vom 6. September (`index-8KvkaB73.js`,
  `index-DctCS8Wf.css`, also **vor** dem Audit-Basis-Commit `6127e49`). Nach Clone-Swap und
  `docker compose up -d --build rr-api admin` (Log: beide Images gebaut, rr-api recreated und healthy,
  dann admin) liefert `razorreaper-admin-1` genau den lokalen Build von `main`:
  `index-D3Rlnpms.js` / `index-Dm1YJ1-n.css`, CSS enthält `--fs-figure`, Gateway `/api/health`
  antwortet, `admin.razorreaper.app` zeigt von außen unverändert die Access-Weiterleitung,
  `rr-admin-panel.pages.dev/api/health` erreicht das neu gestartete rr-api. Checkout auf dem NAS:
  `main @ 3dd93c7`, sauber. Der Nutzer muss im Browser nur neu laden (Shell ist `no-store`).

### 1.2 Repo-Zustand

- `main` = `30b7ad2`; Branch `design-audit/phase-1-2` ist identisch und kann gelöscht werden.
- Prüfkette pro Änderung: `npm run typecheck`, `npm test` (820 Tests), `npm run build`
  (= `vite build` + `vite build --config vite.pages-worker.config.ts`).
- CSS-Cascade (kein `@layer`, später gewinnt): `src/index.css` → `src/theme/styles.css`
  (tokens/*, css/*) → `app-glue.css` → `workspace.css` → `operations.css` → `consistency.css`.
  Die meisten sichtbaren Werte kommen aus `workspace.css`/`consistency.css`, nicht aus den
  DS-Dateien in `src/theme/css/`. Das ist der Grund, warum frühere „Verkleinerungen" nichts
  bewirkt haben (siehe 2.4).
- Design-System-Primitives in `src/components/ds/`: `Button`, `IconButton`, `Modal`, `Tabs`,
  `SegmentedControl`, `Input`, `Field`, `Select` (Fassade über `GlassDropdown`), `SearchInput`,
  `DataTable`/`SortHeader`, `Skeleton`, `PageHeader`, `Badge`, `EmptyState`.
- Routing ist Hash-basiert in `src/App.tsx`; kein react-router. Seiten-Metadaten (Gruppe, Label,
  Breadcrumb, Tab-Titel) in `src/pageMeta.ts`. Berechtigungen in `shared/panel-policy.ts`.

### 1.3 Werkzeuge auf diesem PC (gitignored, nur lokal)

- **Fixture-Preview ohne Login**: `.local/panel-consistency-4fd4a24/preview.config.ts`, starten mit
  `node_modules/.bin/vite --config .local/panel-consistency-4fd4a24/preview.config.ts --port 4179 --strictPort`.
  Die Config während eines Laufs **nicht editieren** (Vite startet neu, Port fällt weg). Enthält
  Fixtures für alle Seiten inkl. fünf Suspensions.
- **Visual-Harness** (Chrome-DevTools-Protocol) in `.local/visual-harness/`: `harness.mjs`,
  `shots2.mjs` (4 Sets × 15 Seiten, Full-Page), `scenarios2.mjs` (43 Interaktionsszenarien mit
  harten Assertions), `pixdiff.ps1`, `verify-generic.sh` (stash → record → before → pop → after →
  diff), `colfit.mjs` (Tabellenbreiten messen). Fallen, die frühere „pixel-identisch"-Läufe
  falsch gemacht haben, stehen in der Memory `rr-admin-panel-visual-regression`.
- Nutzer-Appearance, mit der geprüft werden sollte (entspricht seinen Einstellungen): dark, Hue 310,
  Background `network`, dim 35, sidebarTransparency 25 (`APPEAR` in `shots2.mjs`). Viele Beschwerden
  („durchsichtig", „verschoben") sollten mit **genau dieser** Appearance reproduziert werden, nicht
  mit `plain`.

### 1.4 Arbeitsweise, die der Nutzer erwartet

- Fable orchestriert, **Hands-on-Arbeit (Edits, Checks, Reviews) läuft auf Opus-Subagenten**
  (Memory `dispatch-work-to-opus`). Parallelisieren, wo möglich; bei Session-Limits sequenziell.
- Kein PR; direkt auf `main` pushen, aber vorher `npm run build`. Und dann den NAS-Rebuild
  ansprechen (1.1), sonst sieht der Nutzer nichts.
- Nicht fragen, ob man weitermachen soll. Fragen nur da, wo unten „Entscheidung nötig" steht.
- Deutsch mit dem Nutzer, Code-Kommentare Englisch.

---

## 2. Arbeitspakete

Reihenfolge ist ein Vorschlag nach Dringlichkeit aus Nutzersicht („sehr wichtig": Panel Access;
„am wichtigsten": einheitliches Design und Platzierung). Jedes Paket hat: Beschwerde, Befund
(was der Code heute tut, mit Zeilen), Richtung, offene Entscheidung.

### 2.1 Deploy-Pfad klären (Voraussetzung für alles andere)

**Beschwerde:** „Es hat sich noch nicht viel an meinem Panel geändert."

**Befund:** siehe 1.1. Das NAS servierte bis zum 12.09. den Build vom 6. September; der Nutzer
hat `git pull` auf dem NAS versucht, was im damaligen SMB-Spiegel nicht gehen konnte. Am 12.09.
wurde das Verzeichnis durch einen Git-Clone ersetzt und `rr-api` + `admin` aus `main` neu gebaut
(Verifikationsnotiz in 1.1). Der Nutzer sagt außerdem, die Panel-Migration aufs NAS sei nie
gewollt gewesen, nur das Backend.

**Richtung:** Pro Runde `npm run deploy:nas` (oder der Handweg aus 1.1) und dem Nutzer sagen, dass
er neu laden muss. Mittelfristig entscheiden, ob das Panel zurück auf Cloudflare Pages soll
(Custom Domain `admin.razorreaper.app` auf das Pages-Projekt, Access-Application davor; Pages-Shell
proxyt `/api` bereits nach `origin.razorreaper.app`). Dann wäre Push = Deploy, wie der Nutzer es
erwartet. Gegenargument aus `deploy/nas/README.md:57-60`: das Pages-Functions-Tageskontingent, weil
jeder `/api`-Aufruf des Panels durch den Pages-Worker geht.

**Entscheidung nötig:** Panel auf dem NAS lassen oder zurück auf Pages.

### 2.2 Panel Access / Team-Seite

**Beschwerde:** „Sechs aktive Sessions, vier Member, da ist ein Testaccount drin. Wenn ich auf
End Access gehe, kann ich den nicht rausmachen, der ist permanent drin." Und: Kollege Arne bekommt
beim Login das Cloudflare-Fenster „Zugriff beantragen für 15 oder 30 Minuten", ist danach wieder
draußen. Gewollt: Er loggt sich ein, der Owner gibt Rechte, und er darf sich so lange bewegen, wie
der Owner es erlaubt, mit den Rollen, die er hat.

**Befund (Code):**

- Seite `src/pages/TeamPage.tsx`: Tabs Members / Active sessions / Access history (`:86-90`).
  „Aktive Sessions" = `data.sessions.length` (`:211-229`). „End session" (`:381`) und „kick"
  (`:700-703`) posten an `POST /api/admin/team` (`:148-174`). Es gibt keine Einladung und
  **keine Aktion „Mitglied entfernen"**; nirgends im Repo ein `DELETE FROM panel_members`.
- Handler `functions/api/admin/team.ts`: owner-only (`:30-36`). Sessions =
  `SELECT * FROM panel_sessions WHERE expires_at > now AND revoked_at IS NULL LIMIT 300`
  (`:80-100`). `end-session` setzt nur `revoked_at` auf **die eine Zeile** (`:185-192`); `kick`
  setzt `panel_members.revoked_before` und revoked alle offenen Sessions (`:174-184`).
- Session-Tracking `functions/_lib/panel-access.ts`: Session-ID = SHA-256 des Bearer-Tokens
  (`:67-72`), bei `AUTH_MODE=access` ist das der `cf-access-jwt-assertion`. `trackPanelSession`
  läuft bei **jedem** Request (`:82-116`), `expires_at` kommt aus dem `exp`-Claim des Tokens
  (`:74-81`, `:111`).
- **Warum der Testaccount nicht weggeht, drei Mechanismen:**
  1. Access stellt beim nächsten Request ein neues JWT aus → anderer Hash → **neue Session-Zeile**.
     `end-session` blockiert nur die alte ID (`panel-access.ts:96-99`). `kick` schützt über
     `revoked_before` nur gegen Tokens mit `iat <= revoked_before` (`:94`), ein Token eine Sekunde
     später kommt durch.
  2. `GET /api/admin/team` **re-seedet `panel_members` bei jedem Aufruf** (`team.ts:40-79`): alle
     `admin_users`, alle Adressen aus `ACCESS_ALLOWED_EMAIL` (`:51-61`) und den Actor per
     `INSERT OR IGNORE`. Ein aus der DB gelöschter Testaccount, der noch in der Env-Liste oder in
     `admin_users` steht, ist beim nächsten Öffnen der Seite wieder da.
  3. Eine `panel_members`-Zeile **überstimmt** die Env-Allowlist (`functions/_lib/admin.ts:127-130`).
- **Arnes 15/30-Minuten-Fenster ist kein Panel-Code.** Das ist Cloudflare Access
  („Temporary authentication" / Purpose justification in der Policy der Access-Application). Der
  Panel-Code sieht nur ein gültiges JWT und dessen `exp`. Zwei Gates hintereinander:
  (a) Cloudflare-Access-Policy (Zero Trust Dashboard, außerhalb des Repos), (b) im Panel
  `ACCESS_ALLOWED_EMAIL` (`deploy/nas/rr-api/.env` auf dem NAS; leer = alle abgelehnt,
  `functions/_lib/http.ts:167-175`) bzw. eine `panel_members`-Zeile. Rollen/Permissions dann in
  `panel_members.role/overrides_json` (`shared/panel-policy.ts`), Erzwingung in
  `requireDashboardAccess` (`admin.ts:48-111`). Public-Bypass-Pfade, die in der Access-Policy
  ausgenommen sein müssen: `SETUP-ACCESS-DISCORD.md:26-40`.
- Nebenbefund: Suspend/Lift schreiben **keine `panel_audit`-Zeile** (`CustomersPage.tsx:769-771`).
- **Konkret auf dem NAS (12.09.):** `ACCESS_ALLOWED_EMAIL` enthält nur die zwei Owner-Adressen.
  Der Testaccount und Arne kommen also **nicht** aus der Env-Liste, sondern aus `admin_users`
  (Reste des früheren Passwort-Modus, werden von `team.ts:40-79` bei jedem Öffnen der Team-Seite
  wieder als `panel_members` eingetragen) oder wurden über „Add member" angelegt. Arne kommt am
  Panel-Gate nur vorbei, weil seine `panel_members`-Zeile die Allowlist überstimmt
  (`admin.ts:127-130`). Testaccount entfernen = Zeile in `admin_users` löschen **und**
  `panel_members` deaktivieren (SQLite unter `/volume1/docker/razorreaper/data/db`, vorher Backup).

**Richtung:**

- Team-Seite bekommt eine echte Aktion **„Zugang entziehen"** = Mitglied `enabled=0` +
  `revoked_before` + alle Sessions revoken + **Ausschluss vom Re-Seed** (Seed darf disabled/removed
  Zeilen nicht anfassen; heute überlebt nur `enabled=0`, nicht Löschung). Dazu eine sichtbare
  Konsequenz-Erklärung: Solange die Adresse in `ACCESS_ALLOWED_EMAIL` oder der Access-Policy steht,
  kommt die Person bis zur Access-Login-Maske.
- „Aktive Sessions" nicht mehr pro Token-Hash zählen (jedes Access-JWT ist eine neue Zeile),
  sondern pro (E-Mail, auth_mode, User-Agent) zusammenfassen oder als „zuletzt aktiv" am Mitglied
  zeigen.
- Für Arne: Access-Policy im Zero-Trust-Dashboard prüfen. Erwartung: eine **Allow**-Policy mit
  seiner E-Mail (One-time PIN), **ohne** Temporary Authentication, Session-Dauer der Application
  auf z. B. 24 h oder länger. Dann im Panel als Member mit Rolle anlegen. Der Chat kann das nur
  anleiten, nicht selbst ändern.
- Testaccount: herausfinden, wo er herkommt (`admin_users`, `ACCESS_ALLOWED_EMAIL`, Access-Policy)
  und an allen drei Stellen entfernen.

**Entscheidung nötig:** Welche Adresse ist der Testaccount; wie lange soll ein Zugang für Arne
gelten (feste Ablaufzeit im Panel vs. unbefristet bis Entzug).

### 2.3 Einheitliche Controls und ein Filter-Ort pro Seite

**Beschwerde:** „Einheitliche Designs für Suchleisten, Buttons, Regler, Knöpfe, für alles." „3000
verschiedene Filter überall verteilt." „Alles Offset irgendwo hin verschoben."

**Befund (Inventar, `src/pages/*` und `src/components/Navbar.tsx`):**

- **Drei Such-Implementierungen:** rohes `<input type="search">` in `form.workspace-search` in der
  Navbar (`Navbar.tsx:530-570`, Scope-Umschaltung pro Seite `:183-186`, sessionStorage via
  `src/hooks/useWorkspaceSearch.ts`), gilt für Customers, Licenses, Workers, Live; `ds/SearchInput`
  nur auf Errors (`ErrorsPage.tsx:550-557`) und Feedback (`FeedbackPage.tsx:237-242`), jeweils im
  Panel-Head statt im Page-Header; `ds/Input` für Formulare.
- **Dropdowns:** `ds/Select` ist eine Fassade über `GlassDropdown` (`ds/Select.tsx:49-73`), die
  Aufrufstellen sind willkürlich gemischt (Heatmap nutzt beide im selben Header,
  `HeatmapPage.tsx:534-549`). `align` inkonsistent: `Select` hart `left`, Heatmap-Country bekommt
  Default `right`.
- **Segmented vs. Tabs:** `SegmentedControl` als radiogroup auf Heatmap/Live/Feedback/Traffic/
  Licenses, als `as="tablist"` nur auf Errors (`ErrorsPage.tsx:460-466`); `ds/Tabs` für dieselbe
  Aufgabe auf Licenses/Settings/Team.
- **Filter-Platzierung** verteilt sich auf: PageHeader rechts (Heatmap, Errors, Feedback,
  Versions), Panel-Head rechts (Customers `CustomersPage.tsx:514-543`, Errors-Suche, Feedback-Suche,
  Licenses-Generator), eigene `.filters`-Zeile (nur Heatmap-Regionen `HeatmapPage.tsx:570-577`),
  eigene `.monitor-filter-row` (nur Live `LivePage.tsx:296-330`).
- „Clear filters" gibt es auf Live immer, auf Licenses/Errors nur im Empty-State, auf Customers und
  Heatmap gar nicht.
- Overview/Traffic/Versions/Announcements haben `filterBar`-Slots, die `null` sind (`App.tsx:233-235`).
- „Legacy (pre-1.4)" ist fünfmal unabhängig implementiert, einmal als „Legacy" ohne Zusatz
  (`InstallsPanel.tsx:9-10`), einmal als nackter Token `legacy` (Heatmap `formatVersionTag`).

**Richtung:**

- Eine **`PageToolbar`** (oder Erweiterung von `PageHeader`) als **einziger** Filter-Ort pro Seite:
  links Scope/Segmented, rechts Suche + Dropdowns + „Zurücksetzen". Alle Seiten darauf umziehen,
  die Panel-Head-Filter und die Sonderzeilen abschaffen.
- Suche: eine Komponente (`ds/SearchInput`) überall; die Navbar-Globalsuche entweder zur echten
  Globalsuche (über alle Entitäten) machen oder abschaffen und die Suche in die Toolbar der
  jeweiligen Seite legen. Empfehlung: in die Toolbar, weil die Scope-Umschaltung in der Navbar
  heute niemand versteht.
- Nur noch `ds/Select`; `GlassDropdown` wird internes Detail. Einheitliches `align`.
- `SegmentedControl` = Filter/Ansicht, `Tabs` = Seitenbereiche, nie gemischt.
- Ein `versionLabel()` in `src/utils/`.
- Farbdisziplin: Akzent nur für primäre Aktion und aktiven Zustand; Status-Farben nur für
  Status; keine Farbverläufe auf Flächen.

**Entscheidung nötig:** Globalsuche behalten oder in die Seiten legen.

### 2.4 KPI-Kacheln kompakt

**Beschwerde:** „Ich hab gesagt, die sollen flacher sein und nicht so fett. Du hast die schon ein
bisschen flacher gemacht, aber die sind nach wie vor extrem groß."

**Befund:** `KpiStatCard` (`src/components/KpiStatCard.tsx:71`, Markup `:99-160`). `.stat-card` ist
an **sechs** Stellen deklariert; was tatsächlich malt:

- `min-height: 108px; padding: 20px 22px` aus `src/theme/workspace.css:400-403`. Das ist die
  gewinnende Höhe für **jede** Kachel. `.stat-card-compact { min-height: 56px }`
  (`components.css:94`) hat gleiche Spezifität, liegt aber früher in der Cascade und **greift nie**.
  Deshalb war die frühere Verkleinerung wirkungslos.
- Padding, das schließlich schießt: `html[data-theme] .stat-grid .stat-card { padding: 9px 16px }`
  (`consistency.css:511-513`); Icon-Kacheln `padding-inline: 20px`, Icon-first (`consistency.css:671-688`).
- Schriftgrößen: Label 13px, Wert `--fs-stat` ≈ 29px, Sub 12px; ≤768px Wert 20px, ≤480px 17px
  (`workspace.css:448-459`). Bekannte Macke: die Compact-Variante springt am 768er-Rung hoch
  (dokumentiert in `tokens/typography.css`).
- Compact benutzen nur Live und Session history; Customers/Overview/Errors/Heatmap/Traffic/Versions
  nutzen die volle Variante (`CustomersPage.tsx:469-501`, `OverviewPage.tsx:268-317`).
- Tote Regel: `.stat-card .sparkline { display: none }` (`workspace.css:1401-1403`), Element heißt
  `.tile-spark`.

**Richtung:** Eine Kachel-Spezifikation an **einer** Stelle (`components.css`), alle fünf anderen
Deklarationen löschen. Zielbild: Höhe ≈ 64px, Label 12px, Wert 20px (`--fs-figure`), Sub 11–12px,
Icon 28px, eine Zeile Label + Wert nebeneinander oder Wert über Label, kein Sparkline-Well auf
Desktop-Standard. Die volle Variante wird zur Ausnahme (nur Overview, wenn überhaupt). Vorher mit
dem Nutzer ein Mock (Screenshot von der Fixture-Preview) abstimmen, weil „gut aussehen" die
Bedingung ist.

### 2.5 Navigation: zurückkommen, Breadcrumb klickbar, Mobile

**Beschwerde:** „Wenn ich irgendwo reingehe, komme ich nicht so richtig zurück. Auf dem PC geht's
noch, auf dem Handy nicht nutzbar: kein Pfeil zurück, der X-Button ist in der Navbar und nicht
oben rechts." „Oben steht Monitoring und dann Pfeil Overview: macht die Clickbox, dass man
zurückgehen kann."

**Befund:**

- Breadcrumb: gerendert in `src/components/Navbar.tsx:519-528` in `header.workspace-bar`.
  Gruppe als `<span>`, Chevron, Seite als `<strong>`, **kein** Link/Button. CSS
  `.workspace-breadcrumb` `workspace.css:297-310`; Gruppe ausgeblendet ≤1150px
  (`:1131-1133`), **ganzer Breadcrumb `display:none` ≤600px** (`:1289-1291`). Gruppen in
  `src/pageMeta.ts:22-43` (`group` dient als Breadcrumb-Präfix, `:16`).
- Mobile-Navigation: Off-Canvas-Drawer ≤900px (`workspace.css:1183-1211`), Hamburger
  `IconButton.mobile-menu` (`Navbar.tsx:509-518`, Icon wechselt Menu ↔ X). Keine Bottom-Bar.
- Zurück-Affordanzen (alle App-Buttons, keine History): Customer 360 „Back to workspace"
  (`Customer360Overlay.tsx:979-981`, in der Sticky-Bar), „Back to customer" auf Licenses
  (`src/components/CustomerReturnLink.tsx`, `LicensesPage.tsx:1029`). **Keine** in Dialogen oder
  aufgeklappten Zeilen.
- History: Customer 360 öffnet per `history.pushState` (`src/components/CustomerWorkspaceRouter.tsx:45-53`),
  Browser-Zurück schließt es (popstate `:54`). **Dialoge pushen nichts** (`ds/Modal.tsx` hat keinen
  History-Code), Browser-Zurück schließt keinen Dialog.
- Dialog-Schließen-X: immer zweites Flex-Kind in `.dialog-head` (`Modal.tsx:277-286`), Dialog
  bleibt auch mobil eine zentrierte Karte `width: min(560px,100%)` (`components.css:419-440`).
  Der „X in der Navbar"-Eindruck kommt vermutlich vom Customer-Workspace: das ist ein
  `position: fixed`-Overlay unter der Workspace-Bar (`workspace.css:1014-1021`, Top-Inset 68/58/54px
  hart kodiert) mit dem Schließen-Button links in der Sticky-Bar, oder vom Hamburger, der bei
  offenem Drawer zum X wird. **Auf 390px reproduzieren**, bevor man baut.

**Richtung:**

- Breadcrumb-Segmente als Buttons: Gruppe → erste Seite der Gruppe (oder Gruppenmenü), Seite →
  Seite. Mobil nicht ausblenden, sondern ab ≤600px auf „‹ Elternebene" reduzieren.
- Ein **konsistentes Zurück-Modell**: alles, was den Bildschirm ersetzt (Customer 360, Dialoge,
  Fullscreen-Map), pusht einen History-Eintrag und schließt auf popstate; mobil oben links ein
  Zurück-Pfeil in der Workspace-Bar, wenn ein solcher Eintrag offen ist; Dialog-X oben rechts im
  Dialog, mobil als Vollbild-Sheet mit Kopfzeile (Titel links, X rechts).
- Aufgeklappte Tabellenzeilen mobil als eigene Detailansicht mit Zurück.

### 2.6 Customer Directory und Customer 360

**Beschwerde:** „Alles so verschoben, es könnte so viel Platz gespart werden." „Wenn ich Manage
License anklicke, ist der Hintergrund von diesem Overlay komplett durchsichtig."

**Befund:**

- Customer 360 (`src/components/Customer360Overlay.tsx`, `Customer360View :677`) wird nur
  `embedded` gemountet (`CustomerWorkspaceRouter.tsx:67-74`); der `Modal size="viewport"`-Pfad und
  `.dialog-viewport` (`components.css:581-590`) sind toter Code.
- Layout: Identity-Bar → Tabs (Icons per CSS ausgeblendet, `workspace.css:1069-1071`) → Content
  → `<details>`-JSON-Dump. Grids in `components.css:599-786`; Metrics fix 4 Spalten (`:702`).
- Platzfresser: `.customer360-card { padding: 22px }` (`workspace.css:1081-1083`), Workspace
  `padding: 28px var(--page-pad)` (`workspace.css:1014-1021`), Content ohne eigenes horizontales
  Padding (`consistency.css:899-905`), `.customer360-anchor` immer gerendert, nie sichtbar
  (`workspace.css:1078-1080`), `.customer360-json max-height: calc(100dvh - 310px)`.
- **„Manage licenses" öffnet keinen Dialog.** Der Button (`Customer360Overlay.tsx:996-998`)
  navigiert zur Licenses-Seite (`openCustomerAction :964-970` → `customerActionUrl`,
  `src/utils/customerNavigation.ts:39-48`, `history.pushState :69-73`) und schließt den Workspace.
  Der einzige Dialog aus Customer 360 ist „Manage app access" (`CustomerAccessDialog`,
  `:1017-1031`), ein Standard-`Modal` mit opakem `--workspace-dialog` = `--surface-float`
  (`colors.css:33/89`). Scrim ist 38 % Schwarz ohne Blur (`consistency.css:715-718`; Blur global
  per `backdrop-filter: none !important` verboten, `app-glue.css:606-611`).
- Das „Durchsichtige" ist also **nicht** erklärt und muss mit der Nutzer-Appearance (network-
  Hintergrund, Dim 35) reproduziert werden. Kandidaten: der Übergang Workspace → Licenses
  (Workspace schließt, `main.inert` bleibt kurz), `PanelBackground` im Workspace
  (`consistency.css:585-587`), oder ein Appearance-Override von `--workspace-dialog`.
- Directory (`src/pages/CustomersPage.tsx`): vier `GlassDropdown`-Filter im Panel-Head
  (`:514-543`), Restriction-Spalte nur im Scope `restricted` (`:301-325`, `:755-783`),
  `minWidth={960}`, Container-Query-Tiers in `app-glue.css`.

**Richtung:** Customer 360 auf ein dichtes Zwei-Spalten-Layout (Identität + Kennzahlen links
kompakt, Tabs-Inhalt rechts), Card-Padding 14–16px, JSON-Dump raus oder hinter einen Button,
Tabs mit Icons oder ohne, aber nicht „gerendert und versteckt". Den Nutzer nach einem Screenshot
der „durchsichtigen" Stelle fragen, wenn die Reproduktion nichts zeigt.

**Entscheidung nötig:** Screenshot der durchsichtigen Ansicht vom Nutzer.

### 2.7 Übersicht aller aktiven Bans

**Beschwerde:** „Ich will trotzdem eine Ansicht haben, wo ich alle aktiven Bans sehen kann. Wenn
ich den mal wieder aufheben will, hab ich keine Ahnung, wer das ist."

**Befund:** Die App-Access-Seite (`src/pages/AccessPage.tsx`, 559 Zeilen) wurde in `8b8d64a`
entfernt, weil sie ohne Nav-Eintrag unerreichbar war; wiederherstellbar mit
`git show 8b8d64a^:src/pages/AccessPage.tsx`. Sie hatte eine Tabelle **„Active suspensions &
bans"** (Customer + Paid-Badge, Typ Permanent/Until, Reason, By, Aktion **Lift** mit
Bestätigung, Zähler, Leerzustand). Heute gibt es nur die Restriction-Spalte im Directory-Scope
`restricted`; Aufheben nur über den Kundendialog (Select zurück auf „Allowed",
`CustomerAccessDialog.tsx:99-102`). Daten: `GET /api/admin/access` liefert alle Suspensions
(`functions/api/admin/access/index.ts:13-31`), Lift = `POST /api/admin/access/lift` (soft,
Historie bleibt), Modell `functions/_lib/access.ts:17-33`, Typ `SuspensionRecord` in
`src/types/telemetry.ts`. Test `tests/access-page-retired.test.ts` sichert die Abschaffung und
muss mit angepasst werden.

**Richtung:** Eigene Ansicht **„Restrictions"** (unter Administration oder als Tab in Customers):
aktive Bans/Suspensions zuerst, dann Historie (lifted), mit Lift-Aktion, Grund, Aussteller,
Ablauf, Link in Customer 360. Zusätzlich Suspend/Lift in `panel_audit` schreiben.

**Entscheidung nötig:** eigene Seite vs. Tab in Customers.

### 2.8 Heatmap: Filter bündeln, kaputtes In-Map-Menü

**Beschwerde:** „Die Filter sind alle irgendwo verschoben, pack die in eine Ecke in ein schönes
Menü. Die Dropdown-Ansicht in der Kachel von der Karte selbst geht nicht weg, funktioniert nicht."

**Befund (`src/pages/HeatmapPage.tsx`, `src/components/charts/WorldHeatmap.tsx`):**

- Controls: Live/All-time `ds/Select` und Country `GlassDropdown` im PageHeader (`:534-549`),
  Regionen-Chips in eigener `.filters`-Zeile darunter (`:570-577`), sechs KPI-Kacheln, dann Karte
  neben „Regional load". Kein Zeitraum außer Live/All-time, kein Plattform-/Versionsfilter.
- **Das In-Map-Menü** (`.world-heatmap-hovbar`, `WorldHeatmap.tsx:1372-1449`, acht `btn-icon`:
  Zoom ±, Live-Märkte, Auswahl, Kartenstil, Globus, Fullscreen, Info) öffnet und schließt **rein
  per CSS** `:hover`/`:focus-within` (`src/index.css:1258-1292`). Kein State, kein Outside-Click,
  kein Escape. Ein Klick fokussiert den Button → Menü bleibt offen, MapLibre-Canvas ist nicht
  fokussierbar → nichts blurt es. Auf Touch nur per Tap-Fokus erreichbar und **ohne Schließweg**.
  Genau das ist die Beschwerde.
- Info-Panel `showPanel` (`:886`, `:1313-1358`): nur über den Info-Button und sein eigenes X
  schließbar, kein Escape/Outside-Click.
- Kartenstil ist ein **Cycle** (`cycleMapStyle :1261-1295`), kein Picker.
- `GlassDropdown` (`src/components/GlassDropdown.tsx`): `popover="manual"` + `position: fixed`
  (`:171`, `:192-198`); latenter Bug: `showPopover()` wird bei `align`-Änderung erneut aufgerufen
  und wirft, wenn schon offen (`:60`).

**Richtung:** Ein Filter-Ort (Toolbar aus 2.3) mit Zeitraum, Region, Land, ggf. Version. In der
Karte nur Zoom ±, Fullscreen und **ein** echtes Menü (React-State, Outside-Click, Escape, Touch)
mit Stil-Auswahl als Liste, Globus-Toggle, Info. KPI-Kacheln kompakt (2.4), „Regional load" unter
die Karte oder als Tab.

### 2.9 Errors: was ist überhaupt ein Fehler

**Beschwerde:** „Das sind keine wirklichen Fehler, das sind nur die Leute, die meine App force-
closed haben, wo der letzte Push nicht durchging. Das brauche ich nicht als Fehler."

**Befund (`src/pages/ErrorsPage.tsx`, `functions/_lib/errors.ts`, `shared/telemetry-contract.ts`):**

- Ein „Error" ist **eine `telemetry_events`-Zeile mit `service = 'app_error'`**, sonst nichts
  (`errors.ts:5`, Scan `:158-176`, Limit 4000). Felder pro Event `:292-306`: `message`,
  `metrics.exception_type`, **`metrics.error_kind`**, `metrics.error_code`, `session_id`,
  `app_version`, Extras.
- Einzige Klassifikation: `error_kind` mit bekannten Werten `background` und `unhandled`
  (`ErrorsPage.tsx:57-60`), `null` → „unclassified". Nur `background` wird serverseitig
  ausgeklammert (`errors.ts:250`, `storage.ts:426-427`, `stats.ts:144-145`).
- **Es gibt kein Feld für Force-Close / Crash / fehlgeschlagenen Push.** Grep über `functions`,
  `shared`, `src`, `backend-worker`, `deploy/nas/rr-api/src` nach `exit_reason`, `force_close`,
  `unsent`, `last_push` usw.: null Treffer. Force-Close erzeugt **keine** `app_error`-Zeile; er
  wird nur als Session-Ablauf inferiert (`expireStaleSessionsD1`, `storage.ts:854-897`, Timeout
  2 min) und einzig in der Activity-Timeline als `approximateEnd` markiert
  (`functions/_lib/activity.ts:284-292`).
- Was der Nutzer auf der Errors-Seite sieht, sendet also **der Desktop-Client selbst** als
  `app_error`. Welche Werte in Produktion vorkommen (`error_kind`, `exception_type`, `message`), ist
  aus dem Repo nicht ersichtlich; der Client-Code liegt in einem anderen Repo.
- Ingest: `POST /api/ingest` und `/v1/telemetry/event` (`functions/api/ingest.ts:20-113`,
  `backend-worker/index.js:177`), Payload-Schema `shared/telemetry-contract.ts:11-18`; Legacy-
  Events mit „error" im Namen werden zu `status: "down"` (`:423-425`).

**Richtung:** Erst Daten ansehen: auf dem NAS
`SELECT json_extract(metrics,'$.error_kind'), json_extract(metrics,'$.exception_type'), message, COUNT(*) FROM telemetry_events WHERE service='app_error' GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 40`
(SQLite in `/volume1/docker/razorreaper/data/db`). Dann entscheiden: Was ist „echter Fehler"
(z. B. `error_kind='unhandled'` mit Exception-Typ), was ist Rauschen. Rauschen entweder am
Client nicht mehr senden, oder serverseitig als eigene Kategorie „Abnormal exits" ausweisen, die
weder in KPIs noch in „Needs attention" zählt. Seite umbenennen, wenn sie am Ende etwas anderes
zeigt.

**Entscheidung nötig:** Definition „Fehler"; Zugriff auf die Produktionsdaten oder ein Export;
Repo des Desktop-Clients.

### 2.10 Overview: verschobene Zeile „Legacy (pre-1.4)"

**Beschwerde:** „Bei Workspace Overview auf Active Users, dann Version Legacy pre 1.4, diese eine
Zeile ist so blöd nach rechts verschoben."

**Befund:** Kachel „Active customers" (`OverviewPage.tsx:269-280`), Drilldown
`activeUsersDrilldown :156-171` → `BreakdownList` (`ds/Modal.tsx:375-395`). Ursache:
`.kpi-breakdown-label { min-width: 92px; white-space: nowrap }` (`components.css:550`), kein
festes `width`/`flex-basis`; ein Label, das breiter als 92px ist, schiebt Track und Wert dieser
Zeile nach rechts. Nebenbefund: Anteil = `users / lifetimeUsers`, Zeilen aber aus
`versionsCurrent` (Zähler und Nenner passen nicht, `:160-165`), und die Kachel zeigt Allzeit-
Werte in einer „today"-Seite (`App.tsx:219`, `stats.ts:124-136`).

**Richtung:** Zeile als Grid `minmax(120px, max-content) 1fr auto` oder Label mit fester Breite +
Ellipsis; Nenner korrigieren.

### 2.11 Backend-Status → echtes Analyse-Panel (inkl. Discord-Bot und NAS-Container)

**Beschwerde:** „Nicht nur API, Database, Telemetry, sondern ein richtiges Analysis Panel. Dazu
der Discord-Bot und die Docker-Container auf dem NAS."

**Befund:**

- Seite `src/pages/SystemStatusPage.tsx` pollt `GET /api/admin/health` alle 15 s (`:16-60`), drei
  Karten aus `src/utils/systemStatus.ts:10-75` (API reachable, DB connected, Telemetry receiving).
  Handler `functions/api/admin/health.ts` → `loadHealthD1` (`functions/_lib/storage.ts:505-533`):
  `SELECT 1`, `COUNT(*)`/`MAX(ts)` aus `telemetry_events`, Rest sind Literale. Die Seite sagt
  selbst, dass Container, Bot und Backups nicht berichten (`SystemStatusPage.tsx:119-125`).
- NAS-Dienste (`deploy/nas/compose.yml`): `cloudflared`, `caddy` (media/dl), `bot` (aus dem
  separaten Repo `razorreaper-bot`, Port 8080, hat `/health` laut Healthcheck `:40`), `rr-api`
  (Node 22, SQLite, `/health` = `{ok:true}` einzeilig, `deploy/nas/rr-api/src/app.ts:103`),
  `admin` (Caddy), `backup` (alpine + cron, kein Healthcheck). Tunnel-Hostnames in
  `deploy/nas/cloudflared/config.yml`.
- **Kein Docker-/Container-Endpunkt existiert.** Container-Liveness gibt es nur als Compose-
  Healthchecks, sichtbar in `docker compose ps` und sonst nirgends. Nichts liest den Bot-`/health`.
- Panel → rr-api: same-origin über Caddy (`/api/*` → `rr-api:8787`), Legacy-Shells per Proxy
  (`shared/origin-proxy.ts`).

**Richtung (drei Stufen, jede einzeln liefer- und deploybar):**

1. **rr-api-Health erweitern**: Uptime, Build-SHA, DB-Datei-Größe/WAL, freier Platz, Event-Rate
   (letzte 5/60 min), Ingest pro Service, letzte Fehler, Backup-Alter (mtime der letzten
   `.backup`-Datei im Backup-Volume, das rr-api dafür read-only gemountet bekommt).
2. **Bot**: rr-api ruft `http://bot:8080/health` im Compose-Netz ab und reicht das Ergebnis durch
   (Latenz, letzter Reconcile, Guild-Verbindung, was der Bot liefert).
3. **Container**: rr-api bekommt den Docker-Socket **read-only** (oder besser einen
   `docker-socket-proxy`-Sidecar mit nur `containers`/`ps`), listet Container mit Status, Uptime,
   Restarts, Healthcheck-Ergebnis, CPU/RAM. UI: „Infrastructure"-Bereich mit Service-Karten
   (kompakt, 2.4), Zeitverlauf der Event-Rate als Chart, Incident-Liste.
   Sicherheits-Tradeoff des Sockets vorher benennen.

**Entscheidung nötig:** Docker-Socket in rr-api (read-only) vs. Sidecar-Proxy; welche Kennzahlen
der Nutzer wirklich sehen will (Vorschlag zeigen, dann bauen).

---

## 3. Vorgeschlagene Reihenfolge

1. 2.1 Deploy-Pfad (sonst sieht der Nutzer nichts).
2. 2.2 Panel Access (Testaccount raus, Arne rein).
3. 2.3 + 2.4 als eine Runde: Toolbar-Pattern, Controls vereinheitlichen, Kacheln kompakt.
   Vorher ein Mock auf der Fixture-Preview abstimmen.
4. 2.5 Navigation/Mobile, 2.10 Drilldown-Zeile (klein), 2.6 Customer 360 Layout.
5. 2.7 Restrictions-Ansicht.
6. 2.8 Heatmap.
7. 2.9 Errors (braucht Daten und Entscheidung).
8. 2.11 Analyse-Panel in drei Stufen.

Jede Runde: typecheck, Tests, Build, Screenshots vorher/nachher bei 1440 **und** 390px mit der
Nutzer-Appearance, Push auf `main`, NAS-Rebuild ansprechen.

---

## 4. Fragen für den Start des neuen Chats

1. Panel auf dem NAS lassen (jetzt mit Git-Standard) oder zurück auf Cloudflare Pages, damit Push =
   Deploy ist? (Abschnitt 2.1)
2. Welche Adresse ist der Testaccount, und steht sie in `ACCESS_ALLOWED_EMAIL` (`rr-api.env` auf
   dem NAS) oder in der Access-Policy?
3. Arne: Wie sieht die Policy der Access-Application aus (Allow mit E-Mail? Temporary auth an?),
   und wie lange soll sein Zugang gelten?
4. Screenshot der „durchsichtigen" Ansicht nach „Manage licenses" (mit Appearance-Einstellungen).
5. Errors: Zugriff auf die SQLite-DB oder ein Export der `app_error`-Verteilung; Repo des
   Desktop-Clients; was soll als Fehler zählen?
6. Restrictions: eigene Seite oder Tab in Customers?
7. Globalsuche in der Navbar behalten oder pro Seite?
8. Docker-Socket read-only in rr-api oder Sidecar?

---

## 5. Startprompt für den neuen Chat (Vorschlag)

> Lies `docs/handoff-2026-09-12-panel-rework.md` im RR-Admin-Panel-Repo und die Memories
> `rr-admin-panel-deploy-path`, `rr-admin-panel-user-expectations`, `dispatch-work-to-opus`.
> Stell mir die acht Fragen aus Abschnitt 4 gebündelt, dann fang mit 2.2 an. Hands-on-Arbeit auf
> Opus-Subagenten, pro Runde Screenshots vorher/nachher bei 1440 und 390px, und nach jedem Push
> `npm run deploy:nas`, sonst sehe ich nichts.

---

## 6. Stand nach der Rework-Session (13.09.2026)

Entscheidungen aus Abschnitt 4: Panel bleibt auf dem NAS (Git-Checkout + `npm run deploy:nas`),
Restrictions als Tab in Customers, Navbar-Suche entfernt (Suche pro Seite in der Toolbar),
Container-Daten über einen read-only Socket-Proxy-Sidecar, „Fehler" = nur unhandled.

| Paket | Stand | Commit(s) |
|---|---|---|
| 2.1 Deploy-Pfad | erledigt; `-Service a,b` wird gesplittet, SSH-Fehler bricht ab, BUILD_SHA wird mitgegeben (über `environment`, weil `rr-api.env` ein leeres `BUILD_SHA=` hat) | `76ccaa6`, `124d951`, `a1cb583` |
| 2.2 Panel Access | erledigt; „Remove access"/„Restore", Sessions pro Gerät, Testaccount live entfernt (Backup `rr-pre-testaccount-removal-20260912.sqlite`) | `ae2fd8f` |
| 2.3 + 2.4 Toolbar/Kacheln | erledigt; `ds/PageToolbar`, eine KPI-Kachel-Spezifikation (64px, Wert vor Label, 2 pro Zeile ≤600px) | bis `f667dc2` |
| 2.5 + 2.10 Navigation | erledigt; Breadcrumb klickbar, `useHistoryLayer` (Zurück schließt Dialoge), Zurück-Pfeil am Handy, Dialoge als deckende Sheets ≤600px, Drilldown-Zeilen bündig | `632aa71`, `d61dca6`, `cd88071` |
| 2.6 Customer 360 | erledigt; zwei Spalten, „Raw data"-Dialog, deckende Leiste (Ursache des „durchsichtig") | `d61dca6` |
| 2.7 Restrictions | erledigt; Tab „Directory \| Restrictions" mit Lift, Audit-Einträge, `access_suspensions.lifted_by` | `3906ef1` |
| 2.8 Heatmap | erledigt; In-Map-Menü als React-State, schwarzer Streifen am Handy (ResizeObserver), GlassDropdown-Fix | `18ffd5d` |
| 2.9 Errors | erledigt; „Fehler“ = nur unhandled, Segment „Errors | Background faults“ (RR-E1003 gruppiert nach Exception mit Installs/Sessions/Versionen, nicht vom 4000-Zeilen-Scan begrenzt), `app_sessions.error_count` und `last_status` ignorieren Hintergrundfehler, Overview-Feed filtert sie in SQL, Recompute-Skript `deploy/nas/rr-api/scripts/recompute-session-error-counts.mjs` für Altdaten | `b2e9036`, `e95e8d2`, `fd97d8d`, `c5d9043` |
| 2.11 Analyse-Panel | erledigt; Seite „System health": rr-api/DB/Disk/Backup-Alter, Bot-Health, Container über `docker-proxy` (nur list/inspect/stats, POST=0, internes Netz), Ereignisrate, Incidents | `29af880`, `124d951`, `968bd84` |

Live auf dem NAS: `main` bis `a1cb583` (admin, rr-api, docker-proxy); Hashes und Zeitpunkte stehen im
Deploy-Log der Memory `rr-admin-panel-deploy-path`.

Hinweis Deploy: `tools/deploy-nas.ps1` prüft den HEAD des Checkouts, aus dem es läuft. Arbeitet ein Agent
im Haupt-Checkout auf einem Feature-Branch, bricht das Skript mit „HEAD … is not origin/main“ ab und
deployt nichts (Exit 0). Dann aus einem Worktree auf `origin/main` starten.

Werkzeuge: Fixture-Preview `.local/panel-consistency-4fd4a24/preview.config.ts` (Port 4179),
Headless-Harness `.local/visual-harness/`, echtes Handy (S26 Ultra per Wireless-adb,
`phone.mjs smoke|scenarios|heatmap`). Dialog-/Animationsänderungen brauchen einen Lauf auf dem
echten Gerät, Headless-Chrome hat den Sheet-Bug nicht gezeigt.

### Offen

1. **Arne (15-Minuten-Sessions):** Cloudflare Zero Trust → Access-Application: Allow-Policy mit
   seiner E-Mail, keine „Temporary authentication", längere Session-Dauer. Nur im Dashboard möglich.
2. **Desktop-Client RR-E1003:** unbeobachtete Task-Exceptions (NullReference 74 %, Socket 25 %),
   ~267 Events pro Session in einer Schleife, v. a. 1.4.8.11 / 1.4.9 / 1.5.2. Fix gehört ins
   Client-Repo; optional Ingest-Dämpfung (erste N gleiche Hintergrundfehler pro Session, dann Zähler).
3. **Healthchecks ohne Tunnel-Neustart nicht machbar:** cloudflared `--metrics` + `/ready`
   (zählt dann auch Origin-Fehler), `backup.sh` schreibt `.last-success` + Healthcheck,
   Caddy-Liveness. Jede davon startet den jeweiligen Container neu → bewusst planen.
4. **Bot:** Guild-/Reconcile-Status braucht eine Änderung im `razorreaper-bot`-Repo.
5. **Customers am Handy:** Tippen auf Kartenkopf/Avatar soll Customer 360 öffnen (heute nur
   36px-Icon im Kartenfuß).
6. **Aufräumen:** ungenutzte Detailfelder von `/api/admin/health`, sobald die Navbar sie nicht
   mehr braucht.
