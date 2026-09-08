# Design-Audit: RazorReaper Admin Panel

Stand: 7. September 2026 · Commit 6127e49 · Basis: Quellcode + 203 Screenshots (Fixture-Daten, Dark/Light, Desktop/Tablet/Mobile)

**Gesamturteil:** Solides Produkt mit guten Primitives, dessen letzte CSS-Patch-Layer die eigene Farbsemantik und Button-Hierarchie neutralisiert hat; die hohen Befunde sind mit wenigen gezielten Löschungen behebbar, die Layer-Konsolidierung ist die eigentliche Investition.

Befunde: 72 bestätigt (0 kritisch, 14 hoch, 37 mittel, 21 niedrig), 0 in der Verifikation verworfen.

## Zusammenfassung

Das RazorReaper Admin Panel ist funktional weit gereift: Hash-Routing mit Persistenz, rollenbewusste Navigation, eine Modal-Primitive mit korrektem Focus-Management, ein eigenes Dropdown ohne native Selects, saubere Pagination und ein vorbildlicher Lizenz-Workflow. Die Schwäche liegt nicht im Produktverständnis, sondern in der Art, wie das Styling entstanden ist: Sieben gestapelte CSS-Layer (index.css, DS-Tokens, app-glue, workspace, operations, consistency) definieren dieselben Selektoren und Tokens bis zu neunmal, mit 52 !important-Deklarationen und 326 hartcodierten Farbliteralen. Die zuletzt geladene Layer consistency.css gewinnt und hat dabei mehrere Design-Entscheidungen unbeabsichtigt umgekehrt. Von 72 Befunden sind 14 hoch, 37 mittel, 21 niedrig; kein Befund ist kritisch, aber die hohen Befunde sind auf jeder Seite sichtbar.

Der größte Hebel ist ein einzelner Block in consistency.css: Er mappt alle semantischen Statusfarben (Erfolg, Warnung, Fehler, Info) und jeden Status-Dot auf den User-Accent und reduziert jeden Button auf dieselbe Accent-Outline. Dadurch sehen Danger und Primary identisch aus, ein Fehler-Badge trägt dieselbe Farbe wie ein Link, und 'Online' ist auf einer Seite grün, auf der nächsten violett (F001, F003, F004). Das Löschen dieses Blocks kostet weniger als eine Stunde und behebt drei hohe Befunde gleichzeitig. Der zweite Hebel sind die Record-Tabellen: transluzenter Sticky-Header, dessen Blur global verboten ist (F006/F044), und Zeilenaktionen in einer abgeschnittenen letzten Spalte ohne Scroll-Hinweis (F007/F013/F023) — bei 1440px, dem Standard-Desktop dieses Teams. Der dritte Hebel ist die Shell: Bei 1440×900 fallen 'Backend status' und 'Settings' unter den Fold der Sidebar (F008), ein mobiler Close-Button steht auf dem Desktop (F024/F029), und der frei wählbare Accent-Hue erzeugt bei Cyan/Grün/Gelb unlesbaren Button-Text (F002). Erst danach lohnt die strukturelle Konsolidierung der Layer (F005, F017, F018), die die Wiederholung solcher Regressionen verhindert.

Ausdrücklich gut und zu behalten: die Text-Kontrastleiter (jede Stufe über AA, Fließtext AAA in beiden Themes), das vollwertige Light-Theme mit eigenen semantischen Farbwerten, das hue-komponierte Accent-System, die Modal- und GlassDropdown-Primitives mit vollständigem Keyboard- und Focus-Handling, die Button-Primitive mit Permission-Gating, TablePagination, die bewusste Zahlen- und Dauerformatierung, der Stale-Data-Guard auf Errors, der ehrliche Status-Ton auf Backend status und das Issue/Activate/Bind-Modal auf Licenses als Referenzformular. Die Motion-Regeln aus dem früheren Audit (reduced-motion, Tab-Visibility) sind ohne Regression umgesetzt.

## Scorecard

| Dimension | Score | Urteil |
| --- | --- | --- |
| Visuelles System | ●●○○○ 2/5 | Kontrast und Schriftrollen sind stark, aber der Accent-Remap aller Statusfarben, die hue-abhängige Unlesbarkeit von On-Accent-Text und die sechsfach definierten Tokens untergraben das System. |
| Komponenten & CSS-Architektur | ●●○○○ 2/5 | Gute Primitives (Modal, Dropdown, Button, Pagination) werden von sieben Layern, 52 !important, 76 rohen Buttons und 184 Inline-Styles überlagert; Button-Varianten und Badge-Töne kollabieren. |
| Accessibility & Responsive | ●●●○○ 3/5 | Focus-Ringe, Dialog-Semantik und Navigation sind korrekt; Sticky-Header-Transluzenz, abgeschnittene Aktionsspalten, unterdrückte Input-Focus-Ringe und Touch-Größen bleiben offen. |
| Navigation, Content & Shell | ●●●○○ 3/5 | Routing und Rollenlogik sind vorbildlich; Sidebar-Überlauf bei 1440×900, die verkappte globale Suche, Marketing-Ton, Namensdrift und ein Settings-Mock-Dashboard stören die Konsole. |
| Daten, Charts & States | ●●●○○ 3/5 | Formatierung, Pagination und Stale-Guard sind sauber; Overview-Chart ohne Legende mit Wheel-Hijack, vier Loading-Muster, fehlende Sort-/Align-Verträge und Errors-Zustandsmix sind klare Lücken. |
| Formulare, Dialoge & Flows | ●●●○○ 3/5 | Das Lizenz-Issue-Modal ist ein Referenzformular, aber es ist versteckt; Generator ohne Form, fünf Dialog-Footer, Backdrop-Filter-Override im Feedback-Reply und fehlende Dirty-Guards ziehen den Schnitt. |

## Was gut ist und bleiben soll

- **Textkontrast in beiden Themes über AA, Fließtext AAA** — consistency.css:480-498: Dark --text-3 #adadad 9.1:1 und --text-4 #a0a0a0 7.8:1 auf #050505; Light --text-3 #595959 6.4:1, --text-4 #666 5.3:1. In desktop-dark-plain--workers--1.png und desktop-light-plain--workers--1.png gibt es kein Grau-auf-Grau-Meta.
- **Light-Theme ist ein vollständiges Theme, Accent ist durchgängig hue-komponiert** — workspace.css:37-69 färbt Flächen, Hairlines, Chart-Achsen und die semantischen Töne (#168143/#996000/#cb3535/#176cba) eigens für Light; tokens/accent.css:9-21 leitet jede Accent-Stufe aus --ah/--as/--al ab. Hue 310 (desktop-dark-network--customers--1.png) vs. 262 (desktop-dark-plain--overview--1.png) zeigen keine verwaisten Violett-Reste.
- **Modal- und GlassDropdown-Primitives mit korrektem Keyboard- und Focus-Handling** — Modal.tsx:70-121: role=dialog, aria-modal, Focus-Trap nur auf dem obersten Overlay, Escape-Guard bei offenem Dropdown, Focus-Restore, Scroll-Lock, Portal. GlassDropdown.tsx:227-358: Popover-API mit Flip-Up, Roving Focus, Type-to-Filter; grep '<select' in src/pages = 0. 16 Dialog-Aufrufe, keine Parallel-Implementierung.
- **Button-Primitive mit Permission-Gating, gemeinsames Seiten- und Tabellen-Chrome** — Button.tsx:44-52 blendet Aktionen per usePanelPermission aus und normiert Icon-Größen; 67 <Button> + 17 <IconButton>. TableFrame.tsx:126 und RecordCell werden auf 9 Seiten genutzt, EmptyState 17-mal; team/licenses/announcements-Screenshots teilen Breadcrumb, Titel, Panel-Radius und Pagination-Footer.
- **Navigation: Hash-Routen mit Persistenz, Rollenfilter, semantisches Markup, sicherer Sign-out** — App.tsx:82-100 liest Hash, dann rr:last-page, hört auf hashchange; Navbar.tsx filtert Items per canVisit, speichert Gruppen-Expansion pro Account, setzt aria-current/aria-expanded, und der geschlossene Mobile-Drawer ist mit visibility:hidden aus der Tab-Reihenfolge. scenario--d-nav-logout-confirm.png: 'Stay signed in' vs. 'Sign out'.
- **Datenhygiene: Pagination-Primitive, Formatierung, Stale-Guard, Drilldown-Guard** — TablePagination.tsx:26-65 mit aria-label, Range-Summary und Bound-Disabling; format.ts:21-25 exakte Zähler unter einer Million, '53m 20s'; ErrorsPage.tsx:281-283 verwirft Payloads fremder Ranges; KpiStatCard.tsx:62-69 macht Kacheln nur klickbar, wenn der Drilldown Inhalt hat.
- **Lizenz-Issue-Modal und Access-/Feedback-Dialoge als Referenzformulare** — LicensesPage.tsx:1394-1506: explizite required/recommended/optional-Hinweise, Idempotenz-Notiz, role=alert-Fehler, Erfolgszustand mit Key im <code> und 'Activate for install' als nächstem Schritt, retry:false auf POSTs. CustomerAccessDialog.tsx:186-193 wechselt Variante nach Modus; FeedbackReplies.tsx:64-68 nutzt request_id pro Entwurf.
- **Motion honoriert reduced-motion und Tab-Sichtbarkeit; Statustext ist ehrlich** — PanelBackground.tsx:7-11 und :91-122 pausieren die Animation bei prefers-reduced-motion und verstecktem Tab. SystemStatusPage.tsx:66-67 'Checked automatically every 15 seconds' und der NAS-Hinweis sind der Ton, den der Rest der Konsole übernehmen sollte.

## Top-Prioritäten

1. **Semantik-Remap und Button-Kollaps in consistency.css entfernen** (Aufwand S) — Ein Block (consistency.css:2-24 und :766-779) macht Erfolg/Warnung/Fehler/Info, jeden Status-Dot und jede Button-Variante zum selben Accent-Ton. Danger und Primary sind nicht unterscheidbar, Badge- und StatusBadge-APIs lügen, 'Online' wechselt zwischen Grün und Violett. Sichtbar auf allen neun datenführenden Seiten. Zeilen 2-24 (Token-Remap, .status-dot) und 766-779 (Button-Outline) löschen; --success/--warning/--danger/--info aus tokens/colors.css und dem Light-Block von workspace.css:55-62 wirken lassen; Live-Dot auf --success umstellen; .btn-primary gefüllt (operations.css:263), .btn-danger auf --danger; anschließend pro View höchstens ein Primary (Team, Announcements) prüfen und handgebaute Dot-Zellen durch StatusBadge ersetzen. _(F001, F003, F004)_
2. **Record-Tabellen: opaker Sticky-Header und erreichbare Aktionsspalte** (Aufwand M) — Der gepinnte thead hat 48% Alpha und einen global verbotenen Blur, sodass gescrollte Zeilen durchscheinen; Zeilenaktionen sitzen in einer Spalte, die bei 1440px halb und bei 1100px/390px ganz außerhalb liegt, ohne Scroll-Hinweis. Betrifft Customers, Workers, Live, Licenses, Errors, Team, Access. In consistency.css thead-th auf var(--surface-2) opak setzen und die tote backdrop-filter-Regel (:800) entfernen. In TableFrame/DataTable eine sticky-right Aktionsspalte (th/td:last-child, background --surface-1) als Opt-in ergänzen, Primärzelle dasselbe Ziel öffnen lassen, JS-Höhenmessung durch CSS calc ersetzen, pauschales min-width 760px durch Spaltenbreiten ablösen; unter 900px gestapelte Kartenliste. _(F006, F044, F007, F013, F023)_
3. **Shell aufräumen: Sidebar-Überlauf, Desktop-Close-Button, Settings entschlacken** (Aufwand S) — Bei 1440×900 sind 'Backend status' und 'Settings' unsichtbar und der Breadcrumb zeigt einen Eintrag, den die Nav nicht hat; das mobile X steht auf dem Desktop an der Stelle eines Collapse-Toggles; Settings zeigt ein Fake-Dashboard und eine hartcodierte 'API: Connected'-Kopie der Backend-status-Seite. .sb-item-Rhythmus verdichten oder 'Settings' in den Account-Footer verschieben, Bottom-Fade und scrollIntoView für das aktive Item; .sb-close ab 901px explizit ausblenden oder nur bei mobile rendern (besser: echten Collapse-Toggle an html.sb-collapsed binden); Preview-Aside und System-Tab aus SettingsPage entfernen. _(F008, F024, F029, F032, F033)_
4. **On-Accent- und Accent-Text-Kontrast hue-abhängig machen** (Aufwand M) — Die Presets Cyan, Grün und Gelb sowie jeder Slider-Wert zwischen ca. 45° und 200° erzeugen weißen Text auf hellem Accent (Dark) und zu hellen Link-Text (Light), deutlich unter WCAG. Ein Setting, das die App unlesbar machen kann, ist ein Produktrisiko für ein Team, das den Accent tatsächlich ändert (Fixture: Hue 310). In useAccent nach Kontrastmessung --on-accent und --accent-text schreiben (dunkler On-Accent für Hues 40-200), --al pro Hue-Band clampen, Light --accent-text auf ca. 32% Lightness, Dark-Accent-Text mit 80% Untergrenze; bis dahin Preset-Liste auf bestehende Hues beschränken. _(F002)_
5. **Overview-/Traffic-Charts lesbar und bedienbar machen** (Aufwand M) — Drei Serien ohne Legende, Session-Bars als Punkte, Wheel-Zoom, der das Seitenscrollen kapert, kein Touch-/Tastatur-Zoom, Zeitfenster-Select im Plot statt im Panel-Header, abgeschnittenes Tick-Label auf Traffic — der Einstiegs-Chart der Konsole ist der schwächste. ChartLegend-Komponente im Panel-Header (auch für Traffic Actual/Forecast); minPointSize und eckige Kanten für die Bar-Serie; Wheel-Zoom nur mit Ctrl/Cmd oder nach Fokus, dazu Brush oder +/−-Buttons und Drag-to-Select; cursor zoom-in; Reset-Button immer rendern; Select und Reset in den right-Slot; CHART_MARGIN zentral mit top 16. _(F010, F011, F036, F037)_
6. **Licenses: einen Issue-Pfad, ein Formular, kopierbare Keys** (Aufwand M) — Der auditierte, idempotente Issue-Flow ist hinter einem fehlgeschlagenen Lookup versteckt, während der prominente Generator mit alert()-Fehlern und ohne Form-Semantik läuft; erzeugte Keys sind nirgends kopierbar. Fünf verschiedene Dialog-Footer und uneinheitliche Required-Markierungen verstärken das. Primäre 'Issue license'-Aktion im PageHeader, Generator-Optionen als Advanced-Sektion ins Issue-Modal; Generator in <form onSubmit> mit role=alert-Fehlern; Keys im Erfolgshinweis in Mono mit Copy/Copy-all; ModalActions-Komponente in Modal.tsx und Field/FormError-Primitives in ds/ für alle Dialoge. _(F014, F046, F045, F047, F048)_
7. **Globale Suche ehrlich machen oder zurückstufen** (Aufwand M) — Die Top-Bar-Suche wirkt global, filtert aber je nach Seite eine andere Liste, zeigt auf Overview keine Treffer und persistiert veraltete Filter in sessionStorage; der Placeholder ändert sich zwischen den Scopes nicht. Entweder ein SearchResults-Popover über Customers, Licenses und Sessions aus bereits geladenen Listen (Enter öffnet Top-Treffer), oder die Suche aus .workspace-bar auf das SearchInput der jeweiligen Seite verschieben. Mindestens: scope-abhängiger Placeholder aus der bestehenden searchLabel-Map und Inline-Hinweis 'Press Enter to search customers'. _(F009)_
8. **CSS-Layer und Tokens auf eine Quelle konsolidieren** (Aufwand L) — Sieben Layer, --bg in sechs Dateien, --text-3 siebenmal, 52 !important, 326 Farbliterale, 50 verschiedene Schriftgrößen inklusive 8px: Jede der Prioritäten 1-7 kann in dieser Struktur von der nächsten Patch-Datei erneut überschrieben werden. Die Konsolidierung ist die einzige Maßnahme, die Regressionen strukturell verhindert. consistency/operations als Truth einfrieren, gewinnende Werte nach tokens/*.css und css/controls|components.css übertragen, doppelte Rule-Heads in index.css löschen, --glass-*-Bridge auflösen, px-Größen per Codemod auf --fs-*, Paddings/Radien auf spacing.css, Farbliterale auf var(--token), !important auf eine kommentierte Ausnahmeliste reduzieren; Ziel: tokens.css, base.css, components.css plus echte Per-Page-CSS. _(F005, F017, F018, F019, F016, F053, F058)_

## Quick Wins

- **backdrop-filter-Override im Feedback-Reply-Modal löschen** — Zwei !important-Regeln in src/components/feedbackReplies.css entfernen, Dialog von .kpi-modal (opakes --surface-float) erben lassen; nur die textarea-Focus-Regel behalten. _(F012)_
- **Mobilen Close-Button auf Desktop ausblenden** — In Navbar.tsx `{mobile && <button className="sb-close" …/>}` oder `@media (min-width: 901px) { html[data-theme] .sb-close { display: none } }` in consistency.css. _(F024)_
- **Errors-Seite: einen Zustand rendern** — loading | error | empty | data ableiten; Skeleton auf `loading && !error` gaten, KPIs bei Fehler 'Unavailable' statt 'None'/'—', Subtitel 'Loading errors...' ausblenden. _(F035)_
- **Errors-Zeilen per Tastatur expandierbar machen** — Row-onClick durch das WorkersPage-Pattern ersetzen: <button className="person-cell" aria-expanded aria-label> in der ersten Zelle plus IconButton-Chevron in der letzten. _(F025)_
- **Login-Felder mit name/id/autoComplete versehen** — `autoComplete="email"`, `autoComplete={isBootstrap ? "new-password" : "current-password"}`, Bestätigungsfeld `new-password`; Fehlermeldung per aria-describedby verknüpfen. _(F026)_
- **Focus-Ring auf Suchfeld und Dropdown-Filter wiederherstellen** — Eine Regel `.workspace-search:focus-within, .gdrop-search:focus-within { outline: 2px solid var(--accent); outline-offset: 2px }` in consistency.css, nackte `outline: none`-Zeilen löschen. _(F027)_
- **PAGE_META als einzige Quelle für Nav-Label, Breadcrumb und H1** — Record<PageKey,{group,label}> aus Navbar exportieren, PageHeader-title darauf defaulten; Panel auf Customers in 'Directory' umbenennen. _(F030)_
- **Traffic-Chart-Margin auf top 16 setzen** — margin.top in TrafficPage auf 16 (wie Overview) und CHART_MARGIN in components/charts zentralisieren, damit das oberste Tick-Label nicht abgeschnitten wird. _(F037)_
- **Numerische Spalten rechtsbündig mit tabular-nums** — `align`/`numeric` in DataTableColumn, `td.numeric { font-variant-numeric: tabular-nums }`; auf Sessions, Time in app, Total time, Errors, Session time anwenden. _(F039)_
- **Dirty Form-Dialoge nicht per Scrim/Escape verwerfen** — `dismissOnScrim`-Prop (Default true) an Modal, für Issue-, Access- und Reply-Dialog false; X-Button bleibt expliziter Close. _(F050)_

## Alle Befunde

### Farbsemantik, Accent und Button-Hierarchie

Die letzte CSS-Layer hebt die Trennung zwischen interaktivem Accent und semantischen Statusfarben auf und flacht Button-Varianten ab; parallel ist das Accent-System bei bestimmten Hues kontrastunsicher. Diese Befunde teilen eine Ursache und sind gemeinsam zu beheben.

#### F001 · Alle semantischen Statusfarben werden auf den Accent umgemappt

**Schwere:** Hoch · **Aufwand:** S · **Seiten:** overview, live, workers, customers, errors, licenses, access, feedback, system

consistency.css (letzte, gewinnende Layer) überschreibt jeden semantischen Token mit dem User-Accent. Fehler, Warnungen, Sperrungen und Erfolgszustände rendern dadurch im selben Violett/Pink wie Links, aktive Navigation und Buttons. Nur eine hart codierte Ausnahme (das Live-Session-Grün) bleibt bestehen, wodurch 'Online' auf einer Seite grün und auf einer anderen accent-violett erscheint.

*Auswirkung:* In einer Monitoring-Konsole scannt Ops-Personal nach Rot/Amber, um Probleme zu finden. Mit Danger, Warning, Success und Info im Accent sind eine 'Errors 12'-Kachel, ein gesperrter Kunde und ein gesundes 'Online'-Badge auf einen Blick nicht unterscheidbar; ein roter Accent-Preset lässt zudem jedes neutrale Control wie einen Fehler aussehen und der farbfehlsichtigkeitssichere Fallback unterschiedlicher Farbtöne entfällt.

Belege:
- `src/theme/consistency.css:2-19 — 'html[data-theme] { --ui-green: var(--accent-text); --ui-amber: var(--accent-text); --ui-rose: var(--accent-text); --success: var(--accent); --warning: var(--accent); --danger: var(--accent); --info: var(--accent); --success-text: var(--accent-text); --danger-text: var(--accent-text); --danger-sub: var(--accent-subtle); ... }'`
- `src/theme/consistency.css:21-23 — 'html[data-theme] .status-dot { background: var(--accent); box-shadow: none; }'`
- `src/theme/consistency.css:25-32 — '.live-session-status { --live-online-color: #20b657 }' / light '#157938' — the only status color that escaped the remap`
- `src/theme/tokens/colors.css:44-56 — the token file explicitly says '/* Status / semantic — fixed, NOT themeable */' and defines --success/--warning/--danger/--info; that contract is voided downstream`
- `desktop-dark-network--customers--1.png — 'Needs attention 12' tile with a warning-triangle icon is rendered in the same pink as 'Premium' and 'Online now'; the 'Clear' support flags are accent pink`
- `desktop-dark-plain--workers--1.png — '3 errors recorded' under 'just now' is accent violet, the same color as the active nav item; the 'Online' dot in the Status column is accent violet, not green`
- `desktop-light-plain--settings--1.png — the Settings preview card still shows green 'Resolved' / amber 'New session' colored dots, i.e. the product's own preview promises semantic color the real pages no longer have`

**Empfehlung:** Den semantischen Remap-Block in src/theme/consistency.css:2-19 und die Regel `.status-dot { background: var(--accent) }` in :21 löschen. --success/--warning/--danger/--info als feste Werte aus src/theme/tokens/colors.css (dark) und src/theme/workspace.css:55-62 (light, bereits AA-getunt: #168143 / #996000 / #cb3535 / #176cba) beibehalten. Den Live-Session-Dot über --success statt über das private --live-online-color führen. Falls 'weniger Regenbogen' gewünscht ist, die Sättigung der semantischen Farbtöne reduzieren statt sie durch den Accent zu ersetzen; den Accent ausschließlich für interaktive Elemente reservieren (Links, aktive Nav, Primary-Buttons, Focus).

#### F002 · Frei wählbarer Accent-Hue macht On-Accent-Text und --accent-text unlesbar

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** settings, overview, licenses, access, team, announcements, feedback

Primary-Buttons nutzen `color: var(--on-accent)` = #fff auf `hsl(--ah 83% 58%)` (dark) / 47% (light); das Light-Theme setzt --accent-text auf `hsl(--ah 66% 38%)`. Diese Formeln bestehen beim Standard-Violett (Hue 262), scheitern aber deutlich an WCAG bei den in den Settings angebotenen Presets Cyan, Grün und Gelb sowie bei jedem Slider-Wert zwischen ca. 45° und 200°.

*Auswirkung:* Jedes Teammitglied, das ein kühles oder warmes Preset wählt, erhält Primary-Buttons ('Export', 'Issue license', 'Suspend') mit nahezu unsichtbarem Label sowie accent-farbige Micro-Labels, Links und Hinweise wie '3 errors recorded' ohne ausreichenden Kontrast. Das ist eine beworbene Produkteinstellung, kein Randfall, und betrifft jede Seite.

Belege:
- `src/theme/workspace.css:34 — '--on-accent: #fff;' and :515-519 — '.btn-primary { background: var(--accent); color: var(--on-accent); }'`
- `src/theme/workspace.css:52-53 — light theme '--al: 47%; --accent-text: hsl(var(--ah) 66% 38%);' ; :70-72 dark '--al: 58%; --accent-text: hsl(var(--ah) 85% 77%);'`
- `src/theme/tokens/accent.css:9-11 — '--ah: 262 /* user configurable 0–360 */'`
- `Computed: white on hsl(180 83% 58%) (dark, cyan preset) = 1.45:1; white on hsl(60 83% 47%) (light, yellow preset) = 1.5:1; light --accent-text hsl(60 66% 38%) on white = 2.8:1 — all fail AA (4.5:1). Default violet: light accent-text hsl(262 66% 38%) on accent-subtle over white = 8.1:1 (pass); dark hsl(262 85% 77%) on #09090b = ~7:1 (pass).`
- `desktop-light-plain--settings--1.png — preset row includes cyan (~190°), two greens (~150–165°), orange (~30°) and yellow (~45°) plus a free 'Custom hue' slider`

**Empfehlung:** Die abgeleiteten Shades hue-abhängig machen: (1) --on-accent pro Helligkeit berechnen, z. B. #fff beibehalten, aber --al pro Hue-Band clampen (Gelb/Cyan/Grün brauchen --al ≤ 40% im Light-Theme und einen dunklen On-Accent im Dark-Theme); am einfachsten `--on-accent: hsl(var(--ah) 60% 8%)` für Hues 40–200 über einen kleinen JS-Hook in useAccent setzen, der nach Kontrastmessung `--on-accent` und `--accent-text` schreibt (der Hook schreibt bereits --ah). (2) Light --accent-text-Lightness von 38% auf ca. 32% senken und Dark-Accent-Text mit 80% als Untergrenze festlegen. (3) Die Preset-Liste bis zur Umsetzung von (1) auf Hues beschränken, die mit den aktuellen Formeln bestehen.

#### F003 · Button-Varianten kollabieren: Primary und Danger sehen identisch aus

**Schwere:** Hoch · **Aufwand:** S · **Seiten:** team, licenses, announcements, access, settings, workers

Die letzte CSS-Layer reduziert jeden Button auf eine transparente Outline und gibt .btn-primary und .btn-danger anschließend exakt dieselbe Accent-Outline. Der DS-Vertrag aus Button.tsx (primary = die eine Hauptaktion, danger = destruktiv) hat damit keinen visuellen Ausdruck. Ein 'Remove member'-Danger-Button und ein 'Add member'-Primary-Button sehen gleich aus.

*Auswirkung:* Ops-Personal kann eine destruktive Bestätigung ('Remove member', 'Suspend') weder über Form noch Farbe von der Hauptaktion der Seite unterscheiden; auf dem Smartphone ist das ein reales Fehltipp-Risiko. Aus den vier Button-Varianten der Primitive werden effektiv zwei, weshalb Autoren weiter eigene Klassen (btn-secondary) erfinden statt der API zu vertrauen.

Belege:
- `src/components/ds/Button.tsx:4-5 — "Ghost is the workhorse; primary is reserved for the one true action (at most one per view); danger only for destructive/auth actions."`
- `src/theme/consistency.css:766-773 — 'html[data-theme] :is(.btn, .btn-icon, .gdrop-trigger, .filter-pill, .monitor-search) { background: transparent; color: var(--text-1); border-color: var(--line-hi); }' then 'html[data-theme] :is(.btn-primary, .btn-danger) { color: var(--accent-text); border: 1px solid var(--accent); }' — this overrides operations.css:263-267 '.btn-primary { background: var(--accent); color: white }' because of the higher specificity of 'html[data-theme] :is(...)'.`
- `src/theme/consistency.css:774-779 — hover for ALL buttons is the same accent outline ('border-color: var(--accent); color: var(--accent-text)'), so ghost:hover == primary:rest.`
- `src/pages/TeamPage.tsx:155-160 'className="btn btn-primary"' (Add member) vs src/pages/TeamPage.tsx:573-578 'className="btn btn-danger"' (confirm remove) — same rendered style.`
- `desktop-dark-plain--team--1.png — 'Add member' renders as a dark, accent-outlined button, not a filled primary; scenario--d-licenses-issue-modal.png — 'Generate Standard Keys' (LicensesPage.tsx:1334 variant="primary") renders identically to the accent-ghost style defined in operations.css:258-262.`
- `Definition chain for .btn-primary: index.css:717, css/controls.css (2 rules), app-glue.css:1434/1445/1459, workspace.css:515-523, operations.css:263, consistency.css:770 — six layers, the last one wins.`

**Empfehlung:** Den Button-Block in consistency.css:766-779 löschen (oder auf `.btn-ghost` beschränken) und operations.css zum alleinigen Owner der Button-Visuals machen: gefüllten Accent für `.btn-primary` (operations.css:263) beibehalten, `.btn-danger` einen festen Rotton geben (`--danger`, bevor es auf den Accent aliasiert wird), Ghost transparent lassen. Anschließend jeden Page-Header prüfen, sodass pro View höchstens ein Primary existiert (Team nutzt rohes btn-primary für Add member, Announcements einen Ghost-Button für New Announcement — AnnouncementsPage.tsx:251-257).

#### F004 · Statusfarben auf Accent aliasiert: Badge/StatusBadge-Tone-Semantik entfällt

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** licenses, workers, live, team, access, errors, customers

consistency.css schreibt --success/--warning/--danger/--info (inklusive der -text/-sub-Varianten) auf den Accent um und färbt jeden .status-dot mit dem Accent. Badge.tsx verspricht feste Statustöne, die dem User-Hue nie folgen; tatsächlich sind Success-, Warning- und Danger-Badges sowie Dots alle dasselbe Violett.

*Auswirkung:* In einer Operations-Konsole ist der Farbkanal das schnellste Scan-Signal: Eine Zeile mit 'Unreachable'- oder 'Suspended'-Badge ist visuell nicht lauter als 'Online'/'Active', jedes Badge muss gelesen werden. Zukünftige Error-/Warning-Flächen, die gegen die Badge-API gebaut werden, brechen ebenfalls stillschweigend.

Belege:
- `src/components/ds/Badge.tsx:4-5 — "Status tones (success/warning/danger/info) are fixed brand colors and never follow the user accent hue"`
- `src/theme/consistency.css:2-19 — 'html[data-theme] { --success: var(--accent); --warning: var(--accent); --danger: var(--accent); --info: var(--accent); --success-text: var(--accent-text); ... --danger-sub: var(--accent-subtle); }'`
- `src/theme/consistency.css:21-24 — 'html[data-theme] .status-dot { background: var(--accent); box-shadow: none; }' — StatusBadge.tsx:157-160 maps online/idle/unreachable to 'status-dot', 'status-dot warn', 'status-dot err', which now all render the same colour.`
- `desktop-dark-plain--licenses--1.png — 'Active' badges are purple; scenario--d-workers-dropdown-open.png — 'Online' dots and the 'Online' filter pill dot are purple, i.e. the same colour as the selected nav item and the accent buttons.`
- `Usage: '<Badge' 36 occurrences, '<StatusBadge' 1 occurrence, '<Tag' 4 (grep src/pages src/components) — pages roll their own dot+text presence cells instead of StatusBadge.`
- `src/pages/ErrorsPage.tsx:206-209 — 'color: event.kind === BACKGROUND_KIND ? "var(--warning)" : "var(--danger)"' — author expects two different colours; both resolve to accent.`

**Empfehlung:** Einmal entscheiden: entweder (a) feste Töne wiederherstellen, indem consistency.css:2-24 gelöscht und nur das `--accent`-getriebene `.badge-accent` behalten wird, oder (b) falls 'alles im Accent' das beabsichtigte Branding ist, die tone-Prop aus Badge/Tag und die Presence-Dot-Klassen aus StatusBadge entfernen, damit die API nicht mehr lügt. Option (a) wird empfohlen; die Status-Dot-Farben mindestens für Danger/Warning behalten. Danach handgebaute 'Dot + Online'-Zellen (Tabellen in Workers, Licenses, Team) durch `<StatusBadge presence=…>` ersetzen, sodass es eine einzige Presence-Komponente gibt.

#### F052 · --text-3 und --text-4 fast gleichfarbig: Text-Hierarchie schrumpft auf drei Stufen

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** overview, workers, customers, settings

Die wirksame Dark-Leiter ist #f5f5f5 / #d2d2d2 / #adadad / #a0a0a0, die Light-Leiter #141414 / #383838 / #595959 / #666. Stufe 3 und 4 unterscheiden sich um ca. 1.15:1, sodass 'meta'- und 'disabled/placeholder'-Text als derselbe Ton gelesen werden. Der Kontrast selbst ist in beiden Themes gesund.

*Auswirkung:* Gering: sekundäre und tertiäre Information (z. B. 'Last 24 hours' gegenüber einem deaktivierten Pagination-Button) teilen sich ein Grau, sodass Hierarchie allein über die Größe entstehen muss. Geschmacksnah, aber angesichts des großen Kontrast-Spielraums günstig zu beheben.

Belege:
- `src/theme/consistency.css:480-483 — '--text-1: #f5f5f5; --text-2: #d2d2d2; --text-3: #adadad; --text-4: #a0a0a0;' ; :495-498 — '--text-1: #141414; --text-2: #383838; --text-3: #595959; --text-4: #666;'`
- `Computed contrast on winning --bg: dark text-2 13.5:1, text-3 9.1:1, text-4 7.8:1 (on #050505); light text-2 10.7:1, text-3 6.4:1, text-4 5.3:1 (on #f5f5f5) — all pass AA; text-3 vs text-4 ratio only ~1.2:1 in both themes`
- `desktop-dark-plain--overview--1.png — 'Scroll inside chart to zoom in', tile sublabels and the chart axis labels are visually one gray; the subtitle under 'Workspace overview' is not distinguishable from the tile subs`

**Empfehlung:** Die Leiter spreizen: Dark --text-3 #a3a3a3 → beibehalten, --text-4 #7a7a7a (weiterhin 5.0:1 auf #050505); Light --text-3 #5c5c5c, --text-4 #7a7a7a (4.4:1, akzeptabel nur für Placeholder/Disabled). In der einzelnen Token-Datei setzen, gemäß dem Token-Konsolidierungs-Befund.

#### F056 · Bei animiertem Hintergrund laufen Netzwerklinien durch Tabellenzeilen (32%-Surface)

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** customers, workers, live, licenses

Sobald ein nicht-einfarbiger Hintergrund aktiv ist, werden Panels, Kacheln und der Tabellenkörper mit `--workspace-surface: rgb(0 0 0 / 32%)` gezeichnet. Text bleibt dank der starken Text-Leiter lesbar, aber die Constellation-Kanten kreuzen sichtbar Zeilen und Zellen und erzeugen visuelles Rauschen genau auf den Flächen, die zum Lesen dienen.

*Auswirkung:* Lesbar, aber unruhiger als nötig auf den Seiten, auf denen Ops-Mitarbeiter die meiste Zeit verbringen (Tabellen). Geringe Schwere; das Light-Theme-Gegenstück (60% Weiß) wirkt bereits ruhiger.

Belege:
- `src/theme/consistency.css:586-587 — 'html[data-theme="dark"] { --workspace-surface: rgb(0 0 0 / 32%); … }' ; :598-604 — 'html[data-background]:not([data-background="plain"]) :is(.panel, .monitor-surface, .customer360-card) { background: var(--workspace-surface); }' and same for '.stat-card, .monitor-metric'`
- `src/theme/consistency.css:608-613 — headers/pagination get a stronger '--workspace-chrome: rgb(0 0 0 / 48%)' but the table body does not`
- `desktop-dark-network--customers--1.png — network lines pass behind the rows 'Kai Bennett 2' → 'Robin Walsh 3' and through the 'Needs attention' tile; the 'Customer Directory' panel body is visibly more transparent than its header`

**Empfehlung:** Dark `--workspace-surface` für `.panel`/`.record-table` auf ca. rgb(0 0 0 / 55%) anheben (32% für die kleinen KPI-Kacheln beibehalten, falls der 'See-through'-Look gewünscht ist) in src/theme/consistency.css:586, oder die Transluzenz auf das Panel-Chrome beschränken und Tabellenkörper opak halten.

### CSS-Architektur und Token-Quelle

Sieben Layer definieren dieselben Selektoren und Tokens mehrfach; die dokumentierten Token-Dateien beschreiben ein System, das nie rendert. Das ist die strukturelle Ursache der meisten visuellen Inkonsistenzen.

#### F005 · Sieben gestapelte CSS-Layer definieren dieselben Selektoren mehrfach

**Schwere:** Hoch · **Aufwand:** L · **Seiten:** overview, live, workers, customers, traffic, versions, heatmap, errors, licenses, access, feedback, announcements, system, settings, team

main.tsx lädt index.css (Legacy), das DS (styles.css → tokens + base/shell/controls/components), danach drei Patch-Layer (app-glue, workspace, operations) und eine vierte 'consistency'-Layer. Kernselektoren sind in bis zu sechs davon mit widersprüchlicher Geometrie deklariert, sodass der effektive Stil eines Buttons, einer Tabelle oder einer KPI-Kachel nur durch Lesen von fünf Dateien ermittelbar ist.

*Auswirkung:* Kein direkt sichtbarer Bug, aber die Ursache hinter den Befunden 1, 2 und 4: Jeder visuelle Fix wird als weiterer Override geschrieben, und Änderungen in der DS-Layer sind nicht vorhersagbar. Zudem wächst das CSS auf ca. 10,8k Zeilen für eine Konsole mit 15 Seiten, was jede künftige Designänderung verlangsamt.

Belege:
- `src/main.tsx:269-274 — 'import "./index.css"; import "./theme/styles.css"; import "./theme/app-glue.css"; import "./theme/workspace.css"; import "./theme/operations.css"; import "./theme/consistency.css";'`
- `Rule-head counts per layer (grep '^\.selector'): '.btn' index 14 / controls 15 / app-glue 12 / workspace 11 / operations 13; '.kpi*' index 21 / components 20 / app-glue 6 / workspace 2 / operations 10; '.data-table' index 12 / components 10 / app-glue 7 / operations 11; '.panel' index 16 / components 16 / app-glue 6 / workspace 8 / operations 7 / consistency 10; '.gdrop-trigger' 2/2/3/2/3; '.glass-input' 3/3/1.`
- `Conflicting button geometry across layers: index.css:697-699 'padding: 7px 14px; border-radius: 9px; font-size: 0.8125rem'; css/controls.css:12-14 'border-radius: var(--r-ctl); font-size: var(--fs-body)'; app-glue.css:1185 'border-radius: 12px'; workspace.css:509-514 'font-size: 12px; min-height: 35px; border-radius: 8px'; operations.css:207-218 'min-height: 34px; height: 34px; padding: 0 12px; font-size: 12px; border-radius: 7px'.`
- `src/theme/app-glue.css:1-8 header — "This file owns the final word" — but three more layers were added after it (workspace, operations, consistency), each with its own one-line 'foundation'/'anatomy'/'preserve' mission statement (workspace.css:1, operations.css:1, consistency.css:1).`
- `Dead rules left behind: workspace.css:569-571 '.modal, .modal-card, .modal-dialog' and operations.css:137-139 '.modal-box, .modal-dialog' — grep of src/**/*.tsx finds 0 usages of modal-box/modal-dialog/modal-card; the app's Modal uses '.kpi-modal' (Modal.tsx:145-191).`

**Empfehlung:** Konsolidierungsplan (in dieser Reihenfolge): 1) consistency.css + operations.css als 'Truth' einfrieren und deren effektive Werte in css/controls.css, css/components.css und tokens/colors.css übertragen. 2) Doppelte Rule-Heads aus index.css löschen, sobald die DS-Regel denselben Wert trägt (beginnend mit .btn*, .badge*, .data-table*, .kpi-*, .panel, .gdrop-*). 3) Die Token-Bridge aus app-glue (app-glue.css:14-25) auflösen, indem `--glass-*`-Verwendungen zu `--surface-*` umbenannt werden. 4) Auf drei Dateien reduzieren: tokens.css, base.css, components.css (+ Per-Page-CSS nur wo tatsächlich seitenspezifisch). Fortschritt über die Rule-Head-Zählungen verfolgen (Ziel: jeder Selektor einmal deklariert).

#### F016 · Type-Scale-Tokens vorhanden, Patch-Layer nutzen fast nur rohe px-Werte

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** overview, workers, customers, licenses, live, errors, team, settings

typography.css definiert --fs-micro…--fs-page (mit dem Hinweis „never below 10px“), workspace.css definiert dieselben Tokens stillschweigend mit anderen Werten neu, und die späteren Layer ignorieren die Tokens: index.css 121 rohe font-sizes / 0 Token-Verwendungen, workspace.css 77/1, operations.css 38/0, consistency.css 31/0. Ergebnis sind 50 verschiedene Größen im Codebase, darunter 8px, 8.5px, 9px, 0.55rem und 0.6rem, und derselbe Datentyp wird auf verschiedenen Seiten in verschiedenen Größen gerendert.

*Auswirkung:* Das Ops-Team liest über lange Zeiträume dichte Tabellen; uneinheitliche Größen für denselben Datentyp (Versionen, Timestamps, Badges) verlangsamen das Scannen, und 8–9px-Strings sind auf dem Smartphone unlesbar. Wartungsseitig gibt es keine zentrale Stelle, um die Basisgröße der Konsole anzuheben, was ein kleines Team irgendwann brauchen wird.

Belege:
- `grep -c 'font-size: *[0-9]' — src/index.css 121 (token 0), src/theme/workspace.css 77 (token 1), src/theme/operations.css 38 (0), src/theme/consistency.css 31 (0) vs src/theme/css/components.css 9 raw / 53 token`
- `distinct raw sizes across src/index.css + src/theme: 12px ×58, 11px ×43, 0.75rem ×21, 10px ×17 … 9px ×5, 8px ×3, 8.5px ×2, 0.6rem ×5, 0.55rem ×1 (50 unique values)`
- `src/theme/tokens/typography.css:12 — '/* Size scale (dense console — small but never below 10px) */'; sub-10px rules at src/index.css:2004, 2082, 2133 ('font-size: 8.5px'), 2142, 2196, 2221 ('8px'), 2229, 2307, 2311, 2577-2756 ('0.6rem', '0.55rem'), src/theme/workspace.css:882 ('9px')`
- `src/theme/workspace.css:22-27 — '--fs-micro: 0.6875rem; --fs-tiny: 0.75rem; --fs-small: 0.8125rem; --fs-body: 0.875rem; --fs-page: 1.65rem;' overrides typography.css:13-19 (10/11/12/13/20px) — every token shifted one step without renaming`
- `src/theme/operations.css:178-181 — '.page-title { font-size: clamp(1.35rem, 1.6vw, 1.8rem); }' bypasses --fs-page entirely`
- `desktop-dark-network--customers--1.png vs desktop-dark-plain--workers--1.png — the same 'Version' value renders ~10px in the Customer directory and ~13px in Session history; desktop-dark-plain--licenses--1.png — license keys in bold JetBrains Mono at ~11px look heavier than the 13px body text next to them`

**Empfehlung:** src/theme/tokens/typography.css als einzige Skala behandeln: die Werte, die workspace.css tatsächlich will (11/12/13/14/17/20/22), dort einmal eintragen, den Redefinitionsblock in workspace.css:22-27 löschen und rohe font-sizes in workspace/operations/consistency durch das nächstliegende --fs-* ersetzen (Codemod: 10→--fs-micro, 11→--fs-tiny, 12→--fs-small, 13→--fs-body, 14→--fs-body, 15→--fs-strong). Jede Regel < 10px entfernen oder anheben (Block index.css:2004-2311 und Media-Block :2577-2756; workspace.css:882). Version-/Build-/Hash-Zellen eine gemeinsame Klasse geben (`.mono-value`, var(--font-mono) var(--fs-small) 500) und diese in DataTable auf Customers, Session history und Licenses verwenden.

#### F017 · Core-Tokens an sechs Stellen definiert; dokumentiertes „Frost“-Glass-System ist toter Code

**Schwere:** Mittel · **Aufwand:** L · **Seiten:** overview, live, workers, customers, traffic, versions, heatmap, errors, licenses, access, feedback, announcements, system, settings, team

--bg wird in index.css (#05050c), tokens/colors.css (#05060c), app-glue.css (#0b0d17), workspace.css (#09090b), operations.css (#000) und consistency.css (#050505) gesetzt; --text-3 hat sieben Definitionen. Nur die letzte (consistency.css) rendert, aber die Token-Dateien am Anfang der Kaskade – mit den Kommentaren, die ein Entwickler zuerst liest – beschreiben transluzentes Aurora-Glass, das workspace.css abschaltet (`--glass-blur: 0px; --glow: 0`).

*Auswirkung:* Kein direkter Pixel-Defekt heute, aber jeder frühere Befund dieses Audits existiert, weil Fixes immer wieder in einem neuen Layer landen; der nächste Kontrast- oder Spacing-Fix wird voraussichtlich auf ein Token angewendet, das nicht rendert. Für ein Ein- bis Zwei-Personen-Team ist das die Quelle von Regressionen.

Belege:
- `grep of '^\s*--(text-[1-4]|bg):' — src/index.css:27,39-44; src/theme/tokens/colors.css:10,29-32; src/theme/app-glue.css:690-692; src/theme/workspace.css:3,11-14,38,46-49; src/theme/operations.css:94,104-107,115,125-128; src/theme/consistency.css:472,480-483,488,495-498`
- `src/theme/tokens/colors.css:1-7 — '/* COLOR TOKENS — "Frost" language. Deep blue-black ground with a slowly drifting violet/cyan aurora … surfaces are icy translucent glass */' vs src/theme/workspace.css:20-21 — '--glass-blur: 0px; --glow: 0;' and :74-79 'html::before, html::after, body::before, body::after { content: none !important; }'`
- `src/theme/consistency.css:471-486 — 'html[data-theme="dark"] { --bg: #050505; --surface-1: #09090b; … --text-3: #adadad; --text-4: #a0a0a0; }' — this is the block that actually paints the product`
- `!important counts: workspace.css 31, app-glue.css 10, operations.css 4, consistency.css 3 — override chains rather than a single owner`
- `src/main.tsx:4-9 — 'import "./index.css"; import "./theme/styles.css"; import "./theme/app-glue.css"; import "./theme/workspace.css"; import "./theme/operations.css"; import "./theme/consistency.css";'`

**Empfehlung:** src/theme/tokens/*.css zur einzigen Quelle machen: die gewinnenden Werte aus consistency.css:471-500 (und dem Light-Block) als `:root` (dark) + `html[data-theme="light"]` nach tokens/colors.css kopieren, die Token-Blöcke in index.css:8-66, app-glue.css:681-692, workspace.css:2-72, operations.css:92-133 und consistency.css:471-500 löschen und die Datei-Header-Kommentare so anpassen, dass sie das neutrale System beschreiben, das tatsächlich ausgeliefert wird. Dasselbe für --fs-* und --r/--page-pad. Anschließend einen Dead-Rule-Pass (z. B. PurgeCSS-Report) über die Legacy-Component-Styles in index.css laufen lassen.

#### F018 · Core-Farb-Tokens 8-9-fach in sechs Dateien definiert; tokens-Ordner nicht Source of Truth

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** settings, overview, live, workers, customers, licenses, team

--bg, --text-3, --surface-1, --line und --text-1 haben jeweils 8-9 konkurrierende Definitionen. Die tatsächlich wirksamen Werte stammen aus consistency.css (letzter Layer), sodass src/theme/tokens/colors.css und der Anfang von index.css Werte dokumentieren, die nie rendern.

*Auswirkung:* Theme-/Hue-Änderungen in Settings (ein Produkt-Feature) sind schwer konsistent zu halten, weil die halbe Palette am gewinnenden Layer nicht tokenisiert ist; insbesondere das Light Theme hängt davon ab, welcher `html[data-theme="light"]`-Block zuletzt lädt. Jede Anpassung des Kontrasts von Muted-Text muss sicherheitshalber an sechs Stellen erfolgen.

Belege:
- `grep '^\s*--bg:' → 9 hits in index.css:27 '#05050c', tokens/colors.css:10 '#05060c', app-glue.css:690 '#0b0d17', workspace.css:3 '#09090b' / :38 '#f5f5f7', operations.css:94 '#000' / :115 '#fff', consistency.css:472 '#050505' / :488 '#f5f5f5' (winner).`
- `grep '^\s*--text-3:' → 9 hits: index.css:41 'rgba(255,255,255,0.34)', tokens/colors.css:31 'rgba(235,240,254,0.34)', app-glue.css:692 'rgba(236,241,255,0.42)', workspace.css:13 '#898994', operations.css:106 '#9b9ba3', consistency.css:482 '#adadad' (winner, dark) — the muted text colour drifted from 34% alpha to a solid #adadad through five rewrites.`
- `--surface-1: 8 definitions, --line: 8, --text-1: 8 (tokens/colors.css, app-glue, workspace, operations, consistency).`
- `src/theme/app-glue.css:10-20 — token bridge ':root { --glass-1: var(--surface-1); --glass-2: var(--surface-2); --glass-border: var(--line); ... }' with comment "until pages migrate, then drop these" — still present; index.css still has its own '--glass-*' definitions (index.css:8-41).`
- `Type-scale tokens exist (workspace.css:21-26 '--fs-micro … --fs-page') but the patch layers hard-code px instead: font-size in px — workspace.css 73, operations.css 37, consistency.css 31 occurrences vs 'var(--fs-' used once across those three files.`

**Empfehlung:** Die gewinnenden Werte (Dark-/Light-Blöcke in consistency.css:471-500 + tokens/accent.css) als einzige Definitionen nach src/theme/tokens/colors.css verschieben; die `:root`/`html[data-theme]`-Token-Blöcke in index.css:8-41, app-glue.css:671-700, workspace.css:2-70, operations.css:92-130 und consistency.css:471-500 löschen. Im Zuge der Konsolidierung px-font-sizes in den Patch-Layern durch die bestehende `--fs-*`-Skala ersetzen.

#### F019 · 52 `!important`-Deklarationen, konzentriert in workspace.css, inklusive globalem box-shadow-Kill

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** overview, workers, licenses, customers, team, settings

Die Patch-Layer setzen auf !important, um frühere Layer zu überschreiben. Allein workspace.css enthält 31 davon, darunter `box-shadow: none !important` auf jedem Button, Dropdown-Trigger und Suchfeld sowie hartkodierte Hex-Farben, die per !important erzwungen werden.

*Auswirkung:* Jedes !important ist eine künftige Sackgasse: Der nächste Fix braucht einen Selektor mit höherer Spezifität oder ein weiteres !important (consistency.css tut das bereits mit `html[data-theme] :is(...)`). Konkret müssen Focus-Styles auf Buttons/Dropdowns per outline statt box-shadow umgesetzt werden – was beim Arbeiten in index.css oder controls.css nicht offensichtlich ist.

Belege:
- `grep -c '!important': index.css 2, css/components.css 2, app-glue.css 10, workspace.css 31, operations.css 4, consistency.css 3 (total 52).`
- `src/theme/workspace.css:503-508 — '.btn, .btn-icon, .gdrop-trigger, .search-input { box-shadow: none !important; }' — any focus-visible ring or pressed state implemented with box-shadow on these controls cannot win without another !important.`
- `src/theme/workspace.css:1362-1363 — 'background: #0d0e15 !important; background: var(--surface-1, #0d0e15) !important;' — hard-coded colour with !important inside a media query.`
- `src/theme/workspace.css:1565-1567 / 1574-1575 — 'font-size: 12px !important; text-transform: none !important; letter-spacing: 0 !important; … font-size: 1.75rem !important; white-space: normal !important;' — typography forced instead of fixed at source.`
- `src/theme/workspace.css:1747 — 'background: var(--workspace-surface) !important;'`

**Empfehlung:** Während der Konsolidierung jedes !important in workspace.css als Hinweis auf eine Regel in index.css behandeln, die schlicht gelöscht werden sollte. Das globale `box-shadow: none !important` (workspace.css:507) entfernen und den gewünschten flachen Look stattdessen in der einen Button-Regel ausdrücken. Ziel: 0 !important außerhalb einer kleinen, kommentierten Liste (der dokumentierte backdrop-filter-Performance-Ban in app-glue ist die akzeptierte Ausnahme).

#### F053 · Spacing- und Radius-Tokens definiert, Patch-Layer hart-codieren Paddings und Radien

**Schwere:** Niedrig · **Aufwand:** M · **Seiten:** overview, workers, customers, licenses

spacing.css definiert --gap-panel/--gap-tile/--pad-panel-x/--page-pad und eine Radius-Familie, workspace.css definiert --r/--r-sm/--r-ctl/--page-pad mit anderen Werten neu, und operations/consistency verwenden anschließend rohe px für jeden Panel-Head, jede Tabellenzelle und jede Kachel (operations.css 29 rohe Paddings, 0 Token-Nutzungen; consistency.css 19/0; workspace.css 69 rohe Paddings + 28 rohe Margins).

*Auswirkung:* Geringe Nutzerwirkung heute, weil die Werte zufällig übereinstimmen; das Risiko ist Drift, sobald ein Layer bearbeitet wird (z. B. die oben genannte 13px→9px-Kachel-Padding-Kette). Als Maintainability einzustufen.

Belege:
- `src/theme/tokens/spacing.css:6-9 — '--r: 12px; --r-sm: 8px; --r-ctl: 9px;' vs src/theme/workspace.css:17-19 — '--r: 14px; --r-sm: 10px; --r-ctl: 8px;' and :16 '--page-pad: 32px' vs spacing.css:17 '--page-pad: clamp(14px, 1.6vw, 26px)'`
- `grep counts (raw 'padding: Npx' / raw 'margin: Npx' / 'var(--gap|--pad|--page-pad)' uses): index.css 96/30/0, app-glue.css 42/11/4, workspace.css 69/28/4, operations.css 29/12/0, consistency.css 19/7/0 vs theme/css/base.css 1/1/9`
- `src/theme/operations.css:189-200 — '.panel-head { min-height: 58px; padding: 15px 18px; gap: 12px; }' / '.panel-body { padding: 18px; }'; :299-302 '.stat-grid .stat-card { padding: 13px 16px; gap: 14px }' then src/theme/consistency.css:557-560 'padding: 9px 16px'; workspace.css:513 '.btn { border-radius: 8px }'`
- `desktop-dark-plain--overview--1.png / desktop-dark-plain--workers--1.png — the rendered rhythm is actually fairly even (16px tile padding, 14px grid gap, 18px panel padding), so this is a code-hygiene finding, not a visible defect`

**Empfehlung:** Die workspace.css-Werte als kanonisches Set in spacing.css überführen (--r 14, --r-sm 10, --r-ctl 8, --page-pad 32px Desktop / 16px Mobile, --pad-panel 18px, --pad-tile 16px) und die rohen Paddings auf .panel-head/.panel-body/.stat-card/.record-table td in den Primitives (src/theme/css/components.css) durch diese Tokens ersetzen; die operations/consistency-Overrides löschen.

#### F058 · Hard-codierte Farben außerhalb der Token-Dateien: 326 CSS-Literale plus 52 in WorldHeatmap.tsx

**Schwere:** Niedrig · **Aufwand:** M · **Seiten:** heatmap, live, overview, settings

Farbliterale (hex/rgba) sind über alle CSS-Layer verteilt statt auf Tokens zu verweisen; dadurch existiert dasselbe gedämpfte Grau in sechs Abstufungen. Chart- und Map-Farben liegen zusätzlich direkt im TSX von WorldHeatmap.

*Auswirkung:* Geringer direkter Nutzer-Impact. Es ist jedoch die Ursache dafür, dass Light-Theme- und Hue-Änderungen durchschlagen: ein Grau, das auf #050505 funktioniert, ist auf #f5f5f5 unsichtbar. Als Wartbarkeitsproblem eingestuft.

Belege:
- `grep -c '#hex|rgba(' per file: index.css 153, workspace.css 74, operations.css 38, app-glue.css 32, consistency.css 29, css/controls.css 11 (tokens/colors.css 14 is the legitimate place).`
- `src/theme/consistency.css:29 — '--live-online-color: #20b657;' defined inside '.live-session-status', a component-local colour token that bypasses the (accent-aliased) '--success'.`
- `src/theme/workspace.css:1362 — 'background: #0d0e15 !important;'`
- `grep '#[0-9a-fA-F]{6}' src/**/*.tsx → 52, all in src/components/charts/WorldHeatmap.tsx (map layer paint — partly unavoidable for maplibre, but should read the same tokens as useChartColors).`

**Empfehlung:** Im Zuge der Konsolidierung per Einmal-Skript alle Literale, die innerhalb eines kleinen Deltas einem Token-Wert entsprechen, durch `var(--token)` ersetzen. Das Painting in WorldHeatmap über die Ausgaben von `useChartColors` (CSS-Variablen, beim Mount gelesen) leiten, damit die Map dem Theme folgt.

### Komponenten-Primitives und Bypasses

Das DS hat gute Kernprimitives, aber Seiten umgehen sie mit rohen Buttons, Inline-Styles, drei Tab-Implementierungen und zwei KPI-Kacheln; für Inputs, Skeletons und Empty-State-Aktionen fehlen Primitives ganz.

#### F015 · Zwei konkurrierende KPI-Tile-Implementierungen mit invertierter Label/Sub-Skala und umbrechenden Sublabels

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** overview, workers, live, customers, heatmap, traffic, versions

Overview, Customers und Heatmap verwenden KpiStatCard (.stat-card, linker Akzentbalken, Sub unter dem Wert), Session history und Live dagegen .monitor-metric (kein Akzentbalken, Sub-Text rechts). In .stat-card landet das Label bei 11px und das Sub bei 12px (Sub größer als Label); consistency.css erzwingt Umbrüche im Sub, wodurch der Drill-down-Chevron auf eine zweite Zeile rutscht. In .monitor-metric brechen bei 1440px das seitliche Sub und sogar der Wert um, unterhalb von 1300px wird das Sub komplett ausgeblendet – der verbreitete 1440-Desktop ist damit der schlechteste Fall.

*Auswirkung:* KPI-Tiles sind das erste Element auf jeder Monitoring-Seite; ungleiche Grundlinien, umgebrochene Werte und ein Sub, das größer als sein Label ist, erschweren das Scannen der Zahlen und lassen die Seiten wie aus verschiedenen Kits zusammengesetzt wirken. Der 1440×900-Desktop, den das Ops-Team überwiegend nutzt, ist genau die Breite, bei der es am schlechtesten aussieht.

Belege:
- `src/theme/operations.css:335-349 — '.stat-card .stat-label { font-size: 11px; }' / '.stat-card .stat-value { font-size: 1.38rem !important; }' / '.stat-card .stat-sub { font-size: 10.5px; }' then src/theme/consistency.css:577-582 — 'html[data-theme] .stat-card .stat-sub { font-size: 12px; white-space: normal; overflow-wrap: anywhere; }' → label 11px < sub 12px`
- `src/theme/workspace.css:1564-1577 — a third opinion: '.stat-card .stat-label { font-size: 12px !important }' and '.stat-card .stat-value { font-size: 1.75rem !important }' (loses to operations.css by cascade order despite !important)`
- `src/theme/tokens/typography.css:20 — '--fs-stat: 1.25rem; /* KPI tile value */' — the token is never the rendered value`
- `src/components/KpiStatCard.tsx:100-107 — '<p className="stat-sub" title={sub}>{sub}{expandable ? <span className="kpi-card-chevron">…' — a title attribute exists for truncation, but the CSS forbids truncation`
- `src/components/MonitoringSummary.tsx:9-12 — '<div className="monitor-metrics"> … <div className="monitor-metric">' — separate tile markup, not KpiStatCard; src/theme/operations.css:990-992 — '@media (max-width:1300px) { .monitor-metric > small { display: none } }'`
- `desktop-dark-plain--overview--1.png — 'Sessions' sub 'Last 24 hours · 4,100 all-time' wraps to 2 lines; 'Avg Session' sub wraps with the chevron alone on line 2; tile labels sit at different y positions (Sessions/Avg Session vs Active Users/Errors)`
- `desktop-dark-plain--workers--1.png — 'All recorded users', 'Lifetime totals' wrap; 'Time in app' value breaks into '3845h / 20m'; no left accent bar unlike Overview tiles`
- `scenario--n-workers.png (1100 wide) — same tiles render cleanly on one line because the sub is dropped`

**Empfehlung:** Auf ein Tile konsolidieren: MonitoringSummary (Workers/Live) auf KpiStatCard migrieren und die .monitor-metric-Styles löschen. In der Tile-Primitive eine einzige Skala über Tokens setzen (Label var(--fs-small) 12px / Wert var(--fs-stat) → Token auf 1.4rem anheben / Sub var(--fs-tiny) 11px), .stat-sub mit `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` versehen (das title-Attribut trägt bereits den vollständigen Text), den Chevron außerhalb des Ellipsis-Spans verankern und `min-height` ergänzen, damit ein- und zweizeilige Tiles ausgerichtet sind. Die drei konkurrierenden !important-font-size-Regeln (workspace.css:1564-1577, operations.css:335-349, consistency.css:577-582) entfernen, sodass die Primitive in src/theme/css/components.css:57-128 der einzige Owner ist.

#### F020 · Rohe <button> überwiegen die Button-Primitive; TeamPage und SettingsPage umgehen sie komplett

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** team, settings, licenses, access, workers, live, errors

76 rohe <button>-Elemente stehen 67 <Button> + 17 <IconButton> gegenüber. TeamPage (10 roh, 0 Button) und SettingsPage (9 roh, 0 Button) importieren die Primitive nie. Die rohe Nutzung führt `btn-secondary` ein, das Button.tsx nicht kennt und das nur durch die Patch-Layer gestylt wird; außerdem wird das in Button eingebaute Permission-Gating übersprungen.

*Auswirkung:* Zwei Authoring-Pfade für dasselbe Control bedeuten, dass jeder visuelle Fix doppelt verifiziert werden muss, und das rollenbasierte Ausblenden von Aktionen (ein Feature der Primitive) ist auf der Panel-access-Seite nicht garantiert – genau dort, wo ein Read-only-Member einen Button bemerken würde, den er nicht nutzen kann. Sichtbar heute: Header-CTAs unterscheiden sich von Seite zu Seite (Team „Add member“ outlined-accent, Announcements „New Announcement“ plain ghost, Workers „Export“ ghost).

Belege:
- `grep counts: '<Button' 67, '<IconButton' 17, raw '<button' 76 (TeamPage 10, SettingsPage 9, Navbar 7, LicensesPage 6, AccessPage 4, WorkersPage/LivePage/ErrorsPage 3 each).`
- `Per page: TeamPage.tsx Button-import=0 <Button=0 raw=10; SettingsPage.tsx Button-import=0 <Button=0 raw=9; HeatmapPage/OverviewPage/TrafficPage import=0.`
- `src/components/ds/Button.tsx:17-22 — variants are 'primary | ghost | accent | danger'; no 'secondary'. src/pages/TeamPage.tsx:262 'className="btn btn-secondary btn-sm"', :570 'className="btn btn-secondary"', SettingsPage.tsx:330 'className="btn btn-secondary"' (6 usages). '.btn-secondary' is defined only in workspace.css:524 and operations.css:251 — never in index.css or the DS controls.css.`
- `src/components/ds/Button.tsx:44-45 — 'const allowed = usePanelPermission(permission); if (!allowed) return null;' — TeamPage.tsx:155-160 renders 'Add member' as a raw '<button className="btn btn-primary">' without a permission prop, while AnnouncementsPage.tsx:254 correctly passes 'permission="announcements.write"' via <Button>.`

**Empfehlung:** TeamPage, SettingsPage, Navbar, LicensesPage und AccessPage auf <Button>/<IconButton> migrieren; `btn-secondary` auf `variant="ghost"` abbilden und die Klasse aus workspace.css/operations.css löschen. Eine ESLint-Regel `no-restricted-syntax` ergänzen, die `<button` außerhalb von src/components/ds und GlassDropdown markiert. Auf jeder mutierenden Aktion `permission` übergeben.

#### F021 · Drei parallele Tab-/Segmented-Control-Implementierungen, keine davon eine DS-Primitive

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** licenses, team, settings, access, errors, feedback, heatmap, traffic, workers

Seiten wechseln Sub-Views über (1) `.workspace-tabs`-Underline-Tabs aus nackten <button className="active"> (Licenses, Team, Settings), (2) `.seg-control/.seg-btn`-Pills (Access, Errors, Feedback, Heatmap, Licenses, Traffic) und (3) eine Filter-Pill-Reihe (Workers). Nur Licenses/Feedback setzen tablist-Rollen; das CSS jeder Variante liegt in einem anderen Layer.

*Auswirkung:* Keyboard-Nutzer erhalten auf manchen Tab-Leisten Arrow-Key-/Rollen-Semantik und auf anderen nicht; visuell sieht dieselbe Aufgabe „Sub-View wählen“ auf benachbarten Seiten wie drei verschiedene Controls aus, was jedes Mal einige Sekunden Orientierung kostet und eine Wartungsfalle ist (ein Fix an seg-btn erreicht workspace-tabs nicht).

Belege:
- `src/pages/LicensesPage.tsx:905 '<div className="workspace-tabs" role="tablist" …>' with :906-923 '<button className={workspaceTab === "inventory" ? "active" : ""}>'; src/pages/TeamPage.tsx:206 and src/pages/SettingsPage.tsx:93 — same 'className={tab === key ? "active" : ""}' pattern without role="tablist".`
- `'.workspace-tabs' styled only in workspace.css (3 rules, 0 in index.css/controls.css); '.seg-control/.seg-btn' styled in index.css (4), css/controls.css (4) and app-glue.css (4) — 12 rule heads for one control.`
- `'className="seg-control"' used in AccessPage (2), ErrorsPage, FeedbackPage (with role="tablist"), HeatmapPage, LicensesPage, TrafficPage; LicensesPage.tsx:766-772 'className={"seg-btn" + (!isMaster ? " active" : "")}'.`
- `desktop-dark-plain--licenses--1.png / desktop-dark-plain--team--1.png — underline tabs; scenario--d-licenses-issue-modal.png — 'Standard | Master Key' pill segmented control on the same page; scenario--d-workers-dropdown-open.png — 'Everyone / Online / Offline / With errors' filter pills as a third style.`
- `No Tabs or SegmentedControl in src/components/ds/ (list: Badge, Button, DataTable, EmptyState, Feed, KvList, Modal, PageHeader, RadialGauge, RankList, SearchInput, Select, TableFrame, TablePagination, Tag).`

**Empfehlung:** `ds/Tabs` (Underline, role=tablist, Roving Tabindex) und `ds/SegmentedControl` (Pill) mit je einem CSS-Block in css/controls.css ergänzen; die drei handgebauten Varianten ersetzen; `.seg-*` aus index.css/app-glue und `.workspace-tabs` aus workspace.css löschen.

#### F022 · 184 Inline-Style-Objekte in Pages reimplementieren Type-Scale und Layout-Primitives

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** errors, licenses, access, announcements, feedback

Pages setzen Font-Größen, Farben und Flex-Layouts inline, statt `--fs-*`, `.label-sm`, KvList oder eine gemeinsame Klasse zu nutzen (Errors 52, Licenses 45, Access 33); selbst das DetailGrid des DS ist mit Inline-Styles geschrieben und dupliziert KvList.

*Auswirkung:* Light Theme und künftige Typografie-Änderungen erreichen inline gesetzte `fontSize`/`color` nicht; Inline-Größen sind auch der Grund, warum dieselbe „Meta-Zeile“ zwischen Errors, Access und Licenses leicht abweicht. Für den Entwickler ist das die Hauptquelle für Copy-Paste-Drift in den drei größten Pages.

Belege:
- `grep -c 'style={{' src/pages/*.tsx → ErrorsPage 52, LicensesPage 45, AccessPage 33, AnnouncementsPage 22, FeedbackPage 16, VersionsPage 5, OverviewPage 4 (total 184); components 30 (InstallsPanel 13, FeedbackReplies 9).`
- `src/pages/ErrorsPage.tsx:213 'style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-1)" }}'; :221-226 'fontSize: "0.6875rem", color: "var(--text-3)"'; :233-238 'fontSize: "0.78125rem", lineHeight: 1.55' — three ad-hoc sizes where '--fs-tiny/--fs-micro/--fs-small' exist (workspace.css:21-26).`
- `src/components/ds/DataTable.tsx:96-116 — DetailGrid uses 'style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}' and 'style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-1)", wordBreak: "break-all" }}'; usages: KvList 1, DetailGrid 2, raw 'className="glass-inset"' 3 — two primitives and one raw pattern for the same 'label/value cells' need.`
- `'label-sm' class used 46 times in TSX as an inline-ish utility; 'kicker' 12 times.`

**Empfehlung:** Einige Kompositionsklassen in css/components.css einführen (`.meta-row`, `.detail-grid`, `.text-tiny/.text-small`), DetailGrid darauf umschreiben und mit KvList zusammenführen, anschließend ErrorsPage/LicensesPage/AccessPage bereinigen. Eine ESLint-Regel ergänzen, die `style={{` auf dynamische Werte beschränkt (Breiten, Transforms, aus Daten berechnete Farben).

#### F041 · Loading States nutzen vier verschiedene Muster

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** errors, versions, customers, workers, team, heatmap, access, announcements, feedback, licenses

Errors, Versions und Customers verwenden `.skeleton`-Blöcke; Session history zeigt einen zentrierten grauen Satz via `.monitor-loading`; Team schreibt 'Loading panel members…' in die Empty-State-Copy; Heatmap setzt 'Rollup loading…' in eine KPI-Subzeile; Errors-KPIs zeigen '—'. In `src/components/ds/` existiert kein Skeleton-/Loading-Primitive.

*Auswirkung:* Jede Seite wirkt beim Warten anders; Text-Loader verschieben das Layout beim Eintreffen der Daten, Skeletons mit hartcodierten Breiten weichen von den realen Spaltenbreiten ab. Für ein kleines Team überwiegend Politur, aber die wiederholten Inline-Styles sind zugleich der Grund, warum jede Seite leicht abweicht.

Belege:
- `src/pages/ErrorsPage.tsx:186-189 — '<tr key={\'skeleton-${row}\'}> ... <div className="skeleton" style={{ height: 12, width: col === 0 ? 120 : 48 }} />'`
- `src/pages/VersionsPage.tsx:349-351,365 — inline '<div className="skeleton" style={{ height: 12, width: "55%" }} />' … 'style={{ height: 300 }}'`
- `src/pages/WorkersPage.tsx:317,458 — '<div className="monitor-loading" role="status">' / '<div className="monitor-loading">Loading session timeline…</div>'; src/theme/operations.css:856-861 — '.monitor-loading { padding: 40px 20px; text-align: center; color: var(--text-3); font-size: 12px; }'`
- `src/pages/TeamPage.tsx:283 — '<p className="empty-copy">{data ? "No matching members." : "Loading panel members…"}</p>'`
- `src/pages/HeatmapPage.tsx:471 — 'sub: users ? "All-time rollup" : "Rollup loading…"'`
- `desktop-dark-plain--errors--1.png — six skeleton rows with per-column pills; contrast with Workers' text-only loader`

**Empfehlung:** `ds/Skeleton.tsx` hinzufügen (`<Skeleton width height />`, `<SkeletonRows columns rows />` für Tabellen, `<KpiStatCard loading />` für Kacheln) und alle sechs Seiten darüber leiten; Text-Loader nur für inline Sub-Fetches (Timelines in expandierten Zeilen) vorbehalten.

#### F043 · Zwei verschiedene KPI-Kachel-Designs auf den Monitoring-Seiten

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** live, workers, overview, traffic, customers

Overview, Traffic, Customers, Versions, Heatmap und Errors verwenden `KpiStatCard` (Akzent-Tick am linken Rand, Label über dem Wert, Sub-Zeile darunter, optional Sparkline/Icon rechts). Live sessions und Session history rendern ihre Kennzahlen über `MonitoringSummary`-Kacheln (Icon-Fläche links, kein Akzent-Tick, Sub-Text ganz rechts und rechtsbündig, niedrigere Kachel). Gleiche Aufgabe, zwei visuelle Grammatiken, zwei Klicks voneinander entfernt.

*Auswirkung:* Beim Wechsel Overview → Live sessions → Session history erscheinen dieselben Zahlen (Online now 18) in zwei unterschiedlichen Kartenformen, was wie zwei Produkte wirkt; die MonitoringSummary-Variante bietet zudem keine Drilldown-Affordance, während die Nachbarseiten sie haben.

Belege:
- `src/pages/LivePage.tsx:237 and src/pages/WorkersPage.tsx:235 — '<MonitoringSummary' (24-line component in src/components/MonitoringSummary.tsx); src/pages/HeatmapPage.tsx:576 and Overview/Traffic/Customers/Versions — '<KpiStatCard'`
- `src/components/KpiStatCard.tsx:83-121 — '<article className="stat-card ..."><div className="tile-main"><span className="stat-label">…<strong className="stat-value tile-value-pop">…<p className="stat-sub">'`
- `desktop-dark-plain--live--1.png / --workers--1.png — tiles 'Online now 18 | Active in the last 6 min', 'People 84 | All recorded users' with the sub text right-aligned in a second column and a round icon well; no left accent bar; tile height ≈ 68px vs ≈ 105px on Overview`
- `desktop-dark-plain--overview--1.png / --customers--2.png — accent tick, stacked label/value/sub, optional chevron for drilldown`

**Empfehlung:** `MonitoringSummary` entfernen und die Live-/Workers-Kennzahlen über `KpiStatCard` rendern (icon-Prop, Sub-Zeile). Falls auf diesen Seiten eine dichtere Reihe gewünscht ist, eine `density="compact"`-Variante zu KpiStatCard hinzufügen statt einer zweiten Komponente.

#### F054 · Page-Subtitle auf manchen Seiten sichtbar, auf anderen versteckt; PageHeader-Docs veraltet

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** overview, workers, customers, licenses, heatmap, settings

app-glue.css versteckt .page-subtitle ('subtitles were filler'), operations.css reaktiviert sie, und der Kommentar der PageHeader-Komponente dokumentiert sie weiterhin als versteckt. In der Praxis zeigen Overview, Session history und Settings eine Subtitle-Zeile, Customers, Licenses und World map nicht, sodass die Höhe des Titelblocks von Seite zu Seite variiert.

*Auswirkung:* Klein: inkonsistenter vertikaler Rhythmus zwischen Seiten und Marketing-artige Subtitles ('Make it yours') ohne operativen Informationswert. Überwiegend ein Konsistenz-/Geschmacksthema.

Belege:
- `src/components/ds/PageHeader.tsx:7-10 — '* Deviation from the DS contract: an optional 'sub' prop … renders as '.page-subtitle', which the v2 glue CSS hides (subtitles are considered filler in v2)'`
- `src/theme/app-glue.css:117-120 — '/* Page subtitles were filler — the title row stays lean. */ .page-subtitle { display: none; }' vs src/theme/operations.css:182-188 — '.page-subtitle { display: block; color: var(--text-3); font-size: 12px; margin-top: 4px; }'`
- `desktop-dark-plain--overview--1.png ('A clear view of activity, health and the work ahead.'), desktop-dark-plain--workers--1.png ('People, activity and every recorded session. One place to look.') vs desktop-dark-network--customers--1.png, desktop-dark-plain--licenses--1.png, scenario--w-overview.png ('Heatmap') — no subtitle, first content row starts ~24px higher`
- `PageHeader also supports a 'kicker' (src/components/ds/PageHeader.tsx:16,31) but no screenshot shows one; the breadcrumb in the top bar plays that role`

**Empfehlung:** Einmal entscheiden: entweder die `sub`-Prop und die Reaktivierung in operations.css entfernen (empfohlen für eine dichte Konsole) oder jeder Seite eine einzeilige, faktische Sub-Zeile geben (Record-Anzahl, Zeitfenster). Den veralteten Kommentar in PageHeader.tsx entfernen und die `kicker`-Prop, falls ungenutzt, ebenfalls.

#### F055 · Micro-Text mit 10px für Badges, Avatare und Account-Meta an der Lesbarkeitsgrenze

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** licenses, access, live, overview, team

Status-Badges, die Sidebar-Rolle 'Owner', Avatar-Initialen, Feldlabels der Live-Sessions und Preview-Metriken werden in den finalen Layern mit 10px (Uppercase, Weight 600) gerendert. Auf dem Desktop ist das dicht, aber lesbar; im Phone-Layout liegt es unter der Größe, die die meisten Guidelines als Minimum für funktionalen Text ansetzen.

*Auswirkung:* Ops-Mitarbeiter prüfen das Panel gelegentlich auf dem Phone; 10px-Uppercase-Badges ('Active', 'Suspended') sind genau die Strings, die sie dort lesen müssen. Desktop-Auswirkung ist gering.

Belege:
- `src/theme/operations.css:286 '.status-badge { font-size: 10px; … font-weight: 600 }'; :480 '.sb-brand-text small { font-size: 10px }'; :746 '.person-avatar { font-size: 10px }'; :904 '.live-field span', :917 '.live-state > small', :931 '.live-timeline-caption' — all 10px; src/theme/workspace.css:316 '.account-text small { font-size: 10px }', :368 '.workspace-search kbd', :854 '.preview-metrics small'`
- `desktop-dark-plain--licenses--1.png — 'Active' status badges and the 'Duration/Usage/Status' header row are visibly the smallest text on the page; desktop-dark-plain--overview--1.png — 'Owner' under the avatar and 'PEAK USERS/H · SESSIONS · ERRORS' meta labels at ~10px`

**Empfehlung:** --fs-micro in der einzelnen Token-Datei auf 11px anheben und für .status-badge / .account-text small / Meta-Labels verwenden; 10px nur für Avatar-Initialen (dekorativ) beibehalten. In src/theme/css/components.css einen `@media (max-width: 600px)`-Bump auf 12px für Badges ergänzen.

#### F057 · Kein Input/Field-Primitive: 39 rohe glass-input-Elemente, 28 davon in LicensesPage

**Schwere:** Niedrig · **Aufwand:** M · **Seiten:** licenses, announcements, access, team

Formulare bestehen aus rohen <input className="glass-input">-Elementen plus ad-hoc Label-Markup; das einzige Input-Primitive ist SearchInput (3 Verwendungen). Die Klasse `.glass-input` selbst ist in drei Layern definiert. Validierungszustände, Hint-Texte und Fehlermeldungen existieren derzeit in keiner gemeinsamen Komponente.

*Auswirkung:* Heute gering, da die Formulare optisch konsistent wirken. Sobald der Licenses-Generator und der Announcements-Editor Validierung, Hint-Texte und Error-Messaging benötigen, müsste dies pro Formular neu implementiert werden.

Belege:
- `grep: '<SearchInput' 3; raw 'className="glass-input"' 39 (LicensesPage 28, AnnouncementsPage 5, AccessPage 2, CustomerAccessDialog 2, InstallsPanel 1).`
- `'.glass-input' rule heads: index.css:841/855/860, css/controls.css (3), app-glue.css:1258 — three layers for one control.`
- `src/components/ds/Select.tsx:123-144 shows the intended pattern (primitive wrapping GlassDropdown with hidden input for forms) — there is no equivalent for text inputs.`
- `scenario--d-licenses-issue-modal.png — the generator form (Quantity, Duration Type, Order No., Customer Name, Email, Discord) is visually consistent today, so the cost is maintainability rather than a visible defect.`

**Empfehlung:** `ds/Input` (kapselt `.glass-input`, forwardet ref) und `ds/Field` (Label, Hint, Error, `aria-describedby`) anlegen. Zuerst LicensesPage migrieren, danach Announcements und Access. `.glass-input` auf eine einzige Regel in css/controls.css zusammenführen.

#### F059 · Generisches Modal heißt 'kpi-*', Regeln über fünf Dateien verteilt, tote '.modal-*'-Regeln

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** overview, licenses, team, access, announcements, customers

Jeder Dialog der App (16 Verwendungen: Confirm, Formulare, Drill-downs) rendert `.kpi-overlay/.kpi-modal`, benannt nach dem ersten Einsatz auf den Overview-KPI-Tiles. Das zugehörige CSS ist auf fünf Layer verteilt und liegt neben `.modal-box/.modal-dialog/.modal-card`-Regeln, die keine Komponente verwendet.

*Auswirkung:* Kein Nutzer-Impact. Für die Entwicklung sind KPI-spezifische Regeln (`.kpi-timespan-*`, `.kpi-breakdown-*`) und das generische Dialog-Chrome verschränkt, sodass eine Änderung am Confirm-Dialog auf Team leicht im falschen Block landet. Reine Wartbarkeit.

Belege:
- `src/components/ds/Modal.tsx:145 'className={\'kpi-overlay…\'}', :162 'className={\'kpi-modal…\'}', :170 'kpi-modal-head', :191 'kpi-modal-content'; '<Modal' usages: 16 (Licenses 4, Team 2, Access 2, Announcements 2, Navbar 1, …).`
- `Rule heads: '.kpi*' index.css 21 (2882-3074), css/components.css 20, app-glue.css 6 (152, 829, 1546-1571), workspace.css 2 (1614-1619), operations.css 10 (33-65); consistency.css:788 'html[data-theme] :is(.kpi-modal, .modal-dialog, .modal-box)'.`
- `Dead selectors: workspace.css:569-571 '.modal, .modal-card, .modal-dialog', operations.css:137-139 '.modal-box, .modal-dialog', workspace.css:1253 'html[data-theme="light"] .modal-box' — 0 TSX usages of modal-box/modal-dialog/modal-card.`

**Empfehlung:** In Modal.tsx zu `.dialog-overlay/.dialog/.dialog-head/.dialog-body` umbenennen und das CSS in einem Block in css/components.css bündeln. `.kpi-timespan-*`/`.kpi-breakdown-*` bei KpiStatCard belassen; die `.modal-*`-Regeln löschen.

#### F068 · EmptyState-Primitive ohne Action-Slot, Seiten weichen auf nackte Absätze aus

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** team, customers, workers, errors, access

`EmptyState` akzeptiert nur icon/title/children. Empty States, die einen nächsten Schritt benötigen (Filter zurücksetzen, Mitglied hinzufügen, Retry), können das Primitive nicht nutzen; mehrere Seiten rendern stattdessen einfache `.empty-copy`-Absätze.

*Auswirkung:* Auf leer gefilterte Verzeichnisse bieten keinen Weg zurück (Clear filters), und die Empty States der Team-Seite wirken wie übrig gebliebener Text. Geringe Schwere, da das Team klein ist und die App kennt; die Behebung ist günstig.

Belege:
- `src/components/ds/EmptyState.tsx:17-25 — 'export interface EmptyStateProps { allClear?: boolean; icon?: ReactNode; title?: string; children?: ReactNode; }'`
- `src/pages/TeamPage.tsx:283,325,362 — '<p className="empty-copy">{data ? "No matching members." : "Loading panel members…"}</p>', '<p className="empty-copy">No active sessions.</p>', '<p className="empty-copy">Access changes will appear here.</p>'`
- `desktop-dark-plain--overview--1.png — the allClear variant ('All clear — No failures in the selected range…') is the good pattern to extend`

**Empfehlung:** `action?: ReactNode` (als Button unter dem Text gerendert) zu EmptyState hinzufügen und für 'Clear filters' in den Suchergebnissen von Customers/Workers/Errors sowie 'Add member' auf Team verwenden; die `.empty-copy`-Absätze durch das Primitive ersetzen.

### Tabellen: Sticky-Header, Aktionsspalte, Sortierung, Zahlen

Die Record-Tabellen sind das Arbeitswerkzeug der Konsole. Transluzenter Header, abgeschnittene Aktionsspalten, fehlender Sort-/Align-/Scope-Vertrag in DataTable und eine nur per Maus bedienbare Zeile auf Errors sind hier gebündelt.

#### F006 · Sticky Table-Header ist transluzent: gescrollte Zeilen scheinen durch

**Schwere:** Hoch · **Aufwand:** S · **Seiten:** customers, workers, live, licenses, errors, team, access

Der gepinnte <thead> jeder Record-Tabelle erhält aus der letzten CSS-Layer einen Hintergrund mit 48% Alpha; der Blur, der die dahinterliegenden Zeilen maskieren sollte, wird durch das globale backdrop-filter-Verbot aufgehoben. Sobald der Scroll-Container der Tabelle gescrollt wird, überlagern sich Header-Text und erste Zeile.

*Auswirkung:* Customer Directory, Session History und Licenses sind die zentralen Tagesflächen. Nach dem Scrollen einer Liste werden die Spaltennamen unlesbar (WCAG 1.4.3 / 1.4.11 für den Header-Text nicht erfüllt) und die oberste Zeile ist unbenutzbar, bis sie freigescrollt ist; zudem wirkt es defekt, was das Vertrauen in die Daten untergräbt.

Belege:
- `src/theme/consistency.css:606 — '--workspace-chrome: rgb(0 0 0 / 48%);' and :612 — 'html[data-theme] .record-table > thead > tr > th { background: var(--workspace-chrome); }' (wins over src/theme/app-glue.css:1701-1706 '.data-table thead th { position: sticky; top: 0; z-index: 5; background: hsl(238 34% 11% / 0.97); }' by specificity and layer order)`
- `src/theme/consistency.css:800 — 'html[data-theme] .record-table > thead > tr > th { backdrop-filter: blur(8px); }' is neutralised by the documented 'backdrop-filter: none !important' ban (app-glue.css:625-646, deliberate non-finding), so nothing hides the rows underneath`
- `scenario--d-customers-row-c360.png — header row shows 'Customer' / 'Contact' / 'Device / OS' with 'Morgan Ellis 15', '@member_15', 'Windows 11' drawn straight through them`

**Empfehlung:** In consistency.css den Sticky-Header opak machen: `html[data-theme] .record-table > thead > tr > th { background: var(--surface-2); }` (oder `color-mix(in srgb, var(--surface-2) 97%, transparent)`) für beide Themes, und die tote backdrop-filter-Deklaration in :800 entfernen. Dasselbe auf `.panel-head`/`.table-pagination` anwenden, falls diese über gescrolltem Inhalt schweben sollen.

#### F007 · Zeilenaktionen in abgeschnittener letzter Spalte ohne Scroll-Affordance

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** customers, licenses, workers, live, errors, team, access

Record-Tabellen haben harte Mindestbreiten (760px, Licenses 1180px), und die Zeilenaktion (Open Customer 360, Expand, Detail) sitzt in der letzten Spalte. Bei 1440px mit der 244px-Sidebar ist die Aktionsspalte bereits zur Hälfte abgeschnitten; bei 1100px und auf einem 390px-Smartphone liegt sie außerhalb des Viewports und ist nur über eine horizontale Scrollbar am unteren Ende eines Scroll-Containers erreichbar, der 340px+ hoch sein kann.

*Auswirkung:* Der primäre Drill-down des Produkts ist im Narrow-Laptop-Fall hinter einem nicht entdeckbaren horizontalen Scroll verborgen und auf dem Smartphone praktisch unerreichbar. Support-Personal kann Customer 360 vom Telefon aus nicht öffnen, ohne zu wissen, dass die Tabelle seitwärts gezogen werden muss.

Belege:
- `src/theme/consistency.css:140 — '.record-table { min-width: 760px; }'; :417 — 'html[data-theme] .license-table { min-width: 1180px; }'; :131-134 — '.data-table-wrap { overflow: auto; }'`
- `src/theme/app-glue.css:1698 — '.data-table-wrap { max-height: max(340px, calc(100dvh - 310px)); overflow: auto; }' (horizontal scrollbar sits at the bottom of that box)`
- `src/pages/CustomersPage.tsx:450-455 — the only way into Customer 360 is the '<IconButton icon={<ScanSearch />} aria-label="Open Customer 360 for …">' in the last cell`
- `scenario--d-customers-row-c360.png — the action button column is cut at the right edge at 1440px; scenario--n-overview.png (1100px) — 'Sess…' column clipped, action column invisible; mobile-dark-plain--customers--1.png — only 'Customer' and 'Contact' columns fit; scenario--m-customers-row-c360.png — the scripted tap on the C360 button missed because it is off-canvas`

**Empfehlung:** In DataTable/TableFrame eine Opt-in-Sticky-Aktionsspalte ergänzen (`th:last-child, td:last-child { position: sticky; right: 0; background: var(--surface-1); }`) und für die Aktionszellen verwenden; zusätzlich die Primärzelle (`.person-cell` / record-link) dasselbe Ziel öffnen lassen, damit die Aktion ohne Scrollen erreichbar ist. Unter 900px Schlüsselspalten als gestapelte Kartenliste rendern (DataTable-Prop `mobileLayout`) statt eine 760px-Tabelle zu erzwingen. Erwägen, das bestehende `html.sb-collapsed`-64px-Rail (app-glue.css:1066-1100) zwischen 901px und ca. 1200px automatisch anzuwenden, damit 1100px-Laptops die Tabellenbreite zurückerhalten.

#### F013 · 'Activate'/'Bind'-Zeilenaktion der Licenses-Tabelle bei 1440px abgeschnitten

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** licenses

Die Zeilenaktion, die den Activate/Bind-Flow startet, ist auf einem Standard-Desktop-Viewport innerhalb des Table-Frames zur Hälfte abgeschnitten ('Activa…'). Der Button ist nur über horizontales Scrollen erreichbar, das nichts signalisiert.

*Auswirkung:* Ops-Personal sieht die primäre Per-License-Aktion (und vermutlich die folgenden Edit-/Delete-Icons) nicht, ohne den versteckten horizontalen Scroll zu entdecken; auf einem 1440px-Laptop ist das der Alltagsfall, kein Randfall.

Belege:
- `scenario--d-licenses-row-detail.png — every row ends with a clipped button reading 'Activa' at x≈1330–1407; the frame edge cuts the label and there is no visible scrollbar or fade`
- `desktop-dark-plain--licenses--2.png and desktop-dark-network--licenses--1.png — same clipping in both background modes`
- `src/pages/LicensesPage.tsx:361 — 'const openLicenseAction = (license: LicenseRecord, mode: LicenseActionMode)' is the only entry into the 'Activate on an install' / 'Bind a device' modal apart from the post-issue success screen`

**Empfehlung:** Die Aktionsspalte innerhalb von TableFrame sticky-right machen (position: sticky; right: 0 mit --surface-1-Hintergrund und linkem Schatten) und die Spalten Customer/Order mit minmax(0,1fr) versehen. Alternativ die Aktion unter ca. 1500px auf einen Icon-only-IconButton mit title reduzieren. Umsetzung in src/components/ds/TableFrame.tsx / src/theme/consistency.css, damit jede Record-Tabelle profitiert.

#### F023 · Table-Frame mit fixer 760px-min-width und JS-gemessener max-height; Licenses-Aktionsspalte bei 1440px abgeschnitten

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** licenses, workers, live, customers, team, access, versions, errors, announcements

TableFrame setzt seine Scroll-Höhe imperativ per ResizeObserver + requestAnimationFrame, und operations.css erzwingt für jede Record-Tabelle min-width 760px mit overflow auto. Auf Licenses wird die „Activate“-Aktionsspalte am Panel-Rand abgeschnitten, ohne sichtbare Scroll-Affordance.

*Auswirkung:* Auf dem Standard-1440px-Desktop ist die primäre Aktion pro Zeile auf der Licenses-Seite halb verdeckt; auf einem schmaleren Laptop oder Smartphone liegt die gesamte Aktionsspalte außerhalb des Viewports und ist nur per horizontalem Scroll erreichbar, der nicht signalisiert wird.

Belege:
- `desktop-dark-plain--licenses--1.png — the last column shows 'Activat' truncated at x≈1407 on all six rows; no scrollbar or fade indicates the hidden content.`
- `src/theme/operations.css:412-418 — '.data-table-wrap { width: 100%; max-width: 100%; overflow: auto; min-width: 0 } … min-width: 760px' on the table.`
- `src/components/ds/TableFrame.tsx:136-164 — 'useLayoutEffect' with 'new ResizeObserver(measure)' and 'element.style.maxHeight = \'${available}px\'' computed from 'window.innerHeight - top - footer.offsetHeight - 28' — layout math duplicated in JS instead of CSS.`
- `'.data-table-wrap' overflow declared in three layers: index.css:884 'overflow-x: auto', css/components.css:242 'overflow-x: auto; border-radius: var(--r); border: 1px solid var(--line)', app-glue.css:1688-1689 scrollbar tweaks, operations.css:412-415.`
- `Usage: '<TableFrame' 12 (9 pages hand-build <thead>/<tbody>), '<DataTable' 3 — the higher-level primitive with per-column 'width' (DataTable.tsx:13,46) is mostly bypassed.`

**Empfehlung:** In TableFrame die letzte Zelle sticky machen (`th:last-child, td:last-child { position: sticky; right: 0; background: var(--surface-1) }`) oder DataTable eine `stickyActions`-Prop geben; die JS-Höhenmessung durch `max-height: calc(100dvh - var(--table-top, 0px) - var(--table-footer, 0px))` ersetzen, einmalig über CSS-Variablen auf `.page-content` gesetzt; das pauschale `min-width: 760px` zugunsten von Spaltenbreiten aufgeben (DataTable unterstützt `width` bereits). Die 9 handgebauten TableFrame-Pages auf DataTable migrieren, wo die Spalten statisch sind.

#### F025 · Application-errors-Zeilen sind nur per Klick bedienbar (kein Keyboard-Zugriff)

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** errors

ErrorsPage expandiert die Fehlergruppe eines Users über ein onClick direkt auf dem <tr> mit Pointer-Cursor; es gibt weder Button, tabindex, Key-Handler noch aria-expanded, sodass das Expandieren per Keyboard oder Screenreader weder erreichbar noch angekündigt wird. Jede andere Liste in der App nutzt dafür einen echten Button.

*Auswirkung:* WCAG-2.1.1-/4.1.2-Verstoß auf der Diagnoseseite: Ein reiner Keyboard- oder Screenreader-Nutzer kann keine Fehlergruppe öffnen, um die Events zu sehen – der eigentliche Zweck der Seite.

Belege:
- `src/pages/ErrorsPage.tsx:640-643 — '<tr className={isExpanded ? "row-expanded" : ""} onClick={() => toggleUser(user.identity)} style={{ cursor: "pointer" }}>'`
- `grep: 0 'onKeyDown' in src/pages; 0 'role="button"' in src/pages`
- `Contrast with src/pages/WorkersPage.tsx:349-353 — '<button className="person-cell" onClick=… aria-expanded={isExpanded} aria-label={'Show session history for ${label}'}>'`

**Empfehlung:** Das Row-onClick durch das WorkersPage-Pattern ersetzen: ein `<button className="person-cell" aria-expanded aria-label>` in der ersten Zelle plus ein `IconButton`-Chevron in der letzten Zelle; den Inline-Style `cursor: pointer` entfernen. Langfristig DataTable eine `onRowToggle`-/`expandable`-Option geben, die diesen Button selbst rendert, damit Pages nicht regressieren können.

#### F028 · DataTable-Primitive ohne Header-Scope, Tabellenbenennung und Sort-Contract

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** customers, workers, errors, licenses, live, team, access

Die gemeinsame DataTable/TableFrame rendert <th> ohne `scope="col"`, ohne caption oder `aria-label` für die Tabelle und ohne Sorting-API; drei Pages bauen deshalb eigene sortierbare Header mit leicht unterschiedlicher aria-sort-Semantik.

*Auswirkung:* Screenreader-Nutzer erhalten eine schwächere Spalten-/Zeilen-Zuordnung und keinen Tabellennamen, wenn mehrere Tabellen auf einer Seite liegen (WCAG 1.3.1); der Sortierzustand wird seitenübergreifend uneinheitlich angekündigt. Für dieses Team selten relevant, aber einmalig in der Primitive günstig zu beheben.

Belege:
- `src/components/ds/DataTable.tsx:46-48 — '<th key={col.key} style={col.width ? { width: col.width } : undefined}>{col.header}</th>'`
- `grep: 0 'scope="col"' in src; 3 'aria-sort' hits, all page-local: CustomersPage.tsx:136, ErrorsPage.tsx:166, WorkersPage.tsx:197 ('aria-sort' is '"none"' when inactive in Customers but 'undefined' in Workers/Errors)`
- `src/pages/WorkersPage.tsx:198 — '<button className="table-sort" onClick={() => changeSort(key)}>' with no visible focus size rule beyond 'font-size: inherit' (operations.css:693-699)`

**Empfehlung:** In DataTable `scope="col"` auf Header setzen, `caption`/`aria-label` akzeptieren und `sort?: { key, direction, onChange }` ergänzen, das den `.table-sort`-Button mit `aria-sort` rendert (`none` bei inaktiv). Die drei Pages darauf migrieren.

#### F039 · Numerische Tabellenspalten linksbündig ohne Tabular Figures; DataTable ohne `align`-Option

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** workers, customers, live, errors, access, licenses

Zähler und Dauern (Sessions, Time in app, Errors, Total time) werden linksbündig in proportionalen Ziffern gerendert, sodass Ziffernspalten nicht fluchten; der DataTable-Spaltenvertrag bietet nur `mono`/`muted`/`width`, und keine Tabellen-CSS setzt `font-variant-numeric: tabular-nums` auf Zellen.

*Auswirkung:* Der Vergleich von Größenordnungen entlang einer Spalte (wer hat die meisten Sessions/die meiste Zeit) erfordert das Lesen jeder Zahl statt des Scannens der rechten Kante, was die Hauptaufgabe dieser Directory-Tabellen für Support ist.

Belege:
- `src/components/ds/DataTable.tsx:5-14 — 'export interface DataTableColumn<T> { key; header; render?; mono?; muted?; width? }' (no 'align'/'numeric')`
- `grep -rn 'tabular-nums' src/index.css src/theme → only on .chart-tip-val, stat values and meta items (components.css:792, workspace.css:753, operations.css:574/769, app-glue.css:278/1640, base.css:143); nothing targets '.record-table td' / '.data-table td'`
- `grep -rn 'className="num\|text-right\|align-right' src/pages src/theme → no results`
- `desktop-dark-plain--workers--1.png — 'Sessions' 10/11/12… and 'Time in app' 8h 53m / 9h 46m / 10h 40m are left-aligned; desktop-dark-plain--customers--2.png — 'Sessions' 17–22 and 'Total time' 15h 6m … 19h 33m left-aligned while the header 'Sessions' is also left`

**Empfehlung:** `align?: "left" | "right"` (oder `numeric?: boolean`) zu DataTableColumn hinzufügen, das `text-align:right` auf th und td setzt, und `html[data-theme] .record-table td.numeric { font-variant-numeric: tabular-nums; }` in consistency.css ergänzen. Auf die Spalten Sessions, Time in app, Total time, Errors, Session time, Version count anwenden.

#### F040 · Sortier-Affordanzen pro Seite neu implementiert und auf inaktiven Spalten unsichtbar

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** workers, customers, live, access, errors

Session history und Customers definieren jeweils einen eigenen `heading()`/sortable-th-Helper mit `.table-sort`-Buttons; Live sessions, Errors und Access haben keine Header-Sortierung (Access nutzt ein separates Select für den Sortiermodus). Da das Pfeil-Icon nur für die aktive Spalte gerendert wird, ist nicht erkennbar, welche weiteren Spalten sortierbar sind.

*Auswirkung:* Ops-Mitarbeiter lernen die Sortierung auf einer Seite und finden sie auf der nächsten nicht oder anders umgesetzt; auf den sortierbaren Seiten müssen Header spekulativ angeklickt werden, um interaktive Spalten zu entdecken.

Belege:
- `src/pages/WorkersPage.tsx:195-203 — 'function heading(label, key) { return (<th aria-sort={...}><button className="table-sort" onClick={() => changeSort(key)}>{label}{sort === key && (direction === "asc" ? <ArrowUp /> : <ArrowDown />)}</button></th>); }'`
- `src/pages/CustomersPage.tsx:136-144 — second copy: 'aria-sort={active ? ... : "none"} ... {active ? direction === "asc" ? <ArrowUp /> : <ArrowDown /> : null}'`
- `src/pages/AccessPage.tsx:267-272 — sort chosen via '<Select value={sortMode ...} renderOption={(o) => SORT_LABELS[o]}>' instead of the header`
- `src/components/ds/DataTable.tsx — no 'sortKey'/'onSort' props; sorting cannot be expressed through the primitive`
- `desktop-dark-plain--workers--1.png — only 'Last active ↓' shows an arrow; desktop-dark-plain--live--1.png — header row 'User / Version / Session time / Location / Status' has no sort control; scenario--d-workers-row-expand.png — after clicking Person the arrow moves to 'Person ↑' and 'Last active' loses any hint`

**Empfehlung:** `sortable?: boolean` pro Spalte sowie `sort={{key, direction}}` / `onSort` zu DataTable hinzufügen und einen `SortHeader` rendern, der für inaktive sortierbare Spalten bei Hover/Focus ein gedämpftes ChevronsUpDown und für die aktive Spalte ArrowUp/Down zeigt. Workers und Customers darauf migrieren und die Sortierung auf Live sessions (Session time, Location) und Access (Sortier-Select ersetzen) aktivieren.

#### F044 · Sticky-Tabellenheader ist transluzent: gescrollte Zeilen scheinen durch

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** customers, workers, live, access, errors, licenses

Im Customers-Verzeichnis ist der Text einer unter den Header gescrollten Zeile ('Premium', Teil eines Kundennamens) durch das Header-Band sichtbar. Ursache: thead ist transparent gesetzt, und der th-Hintergrund stützt sich auf einen Surface-Token plus einen backdrop-filter, der im Repo global deaktiviert ist.

*Auswirkung:* Beim Scannen eines langen Verzeichnisses wird der Header unruhig und die Spaltentitel sind genau dann schwer lesbar, wenn sie gebraucht werden (tief in der Liste gescrollt).

Belege:
- `desktop-dark-plain--customers--2.png — at y≈350–378 the words 'Premium' and a partially hidden name show through the header row, overlapping 'Customer'`
- `src/theme/consistency.css:851-853 — 'html[data-theme] :is(.data-table, .clean-table, .monitor-table) :is(thead, thead tr) { background: transparent; }'`
- `src/theme/consistency.css:145-148 — 'html[data-theme] .record-table > thead > tr > th { ... background: var(--surface-2); ...}' and :798-800 — 'html[data-theme] :is(.panel-head, .table-pagination), html[data-theme] .record-table > thead > tr > th { backdrop-filter: blur(8px); }' (backdrop-filter is banned globally per plans/README.md, app-glue.css:625-646)`

**Empfehlung:** Sticky `th` einen opaken Hintergrund geben (`background: var(--workspace-chrome)` oder einen dedizierten `--table-head-bg`-Token, der in beiden Themes auf eine opake Farbe auflöst) und die tote `backdrop-filter`-Regel entfernen; auch im Light-Theme prüfen.

### Shell, Navigation und Suche

Sidebar-Überlauf bei 1440×900, ein mobiler Close-Button auf dem Desktop, die verkappte globale Suche sowie Touch-, Viewport- und Account-Details der Shell.

#### F008 · Sidebar schneidet 'Backend status' und 'Settings' bei 1440×900 ab

**Schwere:** Hoch · **Aufwand:** S · **Seiten:** settings, system, team, overview

Mit allen fünf Gruppen expandiert (Default: Navbar.tsx `return GROUPS.map((g) => g.label)`) fallen die letzten beiden Einträge der Administration-Gruppe unter den Fold der fixen Sidebar. `.sb-nav` ist `overflow-y: auto` (app-glue.css:923-929, consistency.css:108-112) und scrollt technisch, aber nichts signalisiert das: keine sichtbare Scrollbar, kein Fade, der Footer sitzt bündig unter 'Panel access'. Auf der Settings-Seite lautet der Breadcrumb 'Administration > Settings', während die Sidebar keinen 'Settings'-Eintrag zeigt.

*Auswirkung:* Ops-Personal auf einem typischen 1440×900-Laptop findet Settings und Backend status nur, wenn es zufällig entdeckt, dass die Sidebar scrollt; neue Teammitglieder nehmen an, diese Seiten existieren nicht. Die Wayfinding bricht auf der häufigsten Desktop-Größe, nicht in einem Randfall.

Belege:
- `desktop-dark-plain--settings--1.png — sidebar ends at 'Panel access'; the active 'Settings' item is not visible anywhere in the sidebar`
- `desktop-dark-plain--system--1.png — same: 'Backend status' is the active page, sidebar shows Administration > Panel access only`
- `src/components/Navbar.tsx — 'return GROUPS.map((g) => g.label);' (all groups expanded by default) and 'items: [["team","Panel access"],["system","Backend status"],["settings","Settings"]]'`
- `src/theme/consistency.css:108 — '.sb-nav { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }'`

**Empfehlung:** Die Navigation passend machen: vertikalen Rhythmus von `.sb-item` verdichten (consistency.css `.sb-item { min-height: 34px }` plus app-glue `.sb-item { padding: 9px 12px }` und `.nav-section`-Abstände), sodass 15 Einträge + 5 Header in ca. 700px passen, oder 'Settings' in die Account-Footer-Zeile (`.sb-foot`) neben Sign out verschieben, wo persönliche Einstellungen hingehören. Als Sicherheitsnetz einen Bottom-Fade/`scrollbar-gutter: stable` auf `.sb-nav` ergänzen und das aktive `.sb-item` bei Seitenwechsel automatisch in den sichtbaren Bereich scrollen (`scrollIntoView({block:'nearest'})` in einem Navbar-Effect).

#### F009 · Globale Suche ist ein versteckter, seitenabhängiger Filter

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** overview, customers, workers, live, licenses, errors

Die Suche in der Top-Bar wirkt global, ist aber nur ein Proxy für den Filter einer Liste. Ihr Scope ist `licenses|workers|live` auf diesen Seiten und `customers` überall sonst (Navbar.tsx `const searchScope = page === "licenses" || page === "workers" || page === "live" ? page : "customers"`). Auf Overview liefert die Eingabe von 'Avery' keine Treffer, kein Dropdown und keinen Hinweis außer einem kleinen `↵`-Glyph; erst Enter navigiert zu Customers. Der Placeholder ändert sich zwischen den Scopes customers/workers/live nicht, und der Wert wird pro Scope in sessionStorage persistiert (useWorkspaceSearch.ts `keys`), sodass ein veralteter Filter beim nächsten Besuch wieder auftauchen kann.

*Auswirkung:* Ops-Personal, das von Overview oder Errors aus einen Kunden sucht, erhält kein Feedback; auf Session History filtert dieselbe Box stillschweigend Sessions statt Kunden. Das Muster hinterlässt zudem Per-Scope-Filter, die später wieder auftauchen ('warum ist meine Liste leer?').

Belege:
- `scenario--d-nav-search-results.png — 'Avery' typed in the top-bar search on Overview; page unchanged, no results, no suggestion, only the '↵' badge`
- `src/components/Navbar.tsx — 'placeholder={searchScope === "licenses" ? "Search licenses, customers, orders…" : "Search customer, PC, Discord or HWID…"}' and '{page !== searchScope && <kbd>↵</kbd>}'`
- `src/hooks/useWorkspaceSearch.ts — 'const keys = { customers: "rr:customer-search", licenses: "rr:license-search", workers: "rr:history-search", live: "rr:live-search" }' (four independent persisted values)`

**Empfehlung:** Entweder (a) eine ehrliche globale Suche bauen: ein Dropdown mit Treffern über Customers, Licenses und Sessions (kleiner `SearchResults`-Popover in ds/, gespeist aus den bereits geladenen `users`-/License-Listen), Enter öffnet den Top-Treffer; oder (b) die Suche auf die zugehörige Seite zurückstufen — aus `.workspace-bar` entfernen und auf das `SearchInput` jeder Seite setzen. Falls das aktuelle Verhalten bleibt, mindestens den Placeholder pro Scope ändern ('Search session history…', 'Search live sessions…' — die `searchLabel`-Map existiert bereits, wird aber nur für aria-label genutzt) und beim Tippen auf anderen Seiten einen Inline-Hinweis 'Press Enter to search customers' anzeigen.

#### F024 · Mobiler Sidebar-Close-Button (X) wird auf Desktop gerendert und ist fokussierbar

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** overview, live, workers, customers, traffic, versions, heatmap, errors, licenses, access, feedback, announcements, system, settings, team

Der `.sb-close`-Button existiert nur, um die Off-canvas-Navigation auf Smartphones zu schließen, ist aber auf jedem Desktop-Screenshot unter dem Logo sichtbar und steht an zweiter Stelle in der Tab-Reihenfolge; ein Klick bewirkt auf Desktop nichts.

*Auswirkung:* Jeder Keyboard-Nutzer zahlt auf jeder Seite einen zusätzlichen Tab-Stop, und Screenreader-Nutzer hören „Close navigation“ für ein Control ohne Wirkung auf Desktop (WCAG 2.4.3 Focus-Order-Rauschen, 4.1.2 irreführendes Control). Zudem wirkt es wie ein verirrtes UI-Element neben der Brand.

Belege:
- `src/components/Navbar.tsx:191-198 — '<button type="button" className="btn-icon sb-close" onClick={() => setMobile(false)} aria-label="Close navigation">'`
- `src/theme/app-glue.css:918 — '.sb-close { display: none; margin-left: auto; }' (specificity 0,1,0) is beaten by later 'html[data-theme] .btn-icon' rules in consistency.css (:509-515 sizes it to 36×36; :765 'html[data-theme] :is(.btn, .btn-icon, …)'); the only intended enable is inside '@media (max-width: 900px)' (workspace.css:1395, block 1297-1445)`
- `scenario--d-overview-tab-focus-3.png, scenario--d-versions-tab-focus-6.png, scenario--d-customers-row-c360.png, scenario--n-overview.png — X button visible at (32,110) at 1440px and 1100px; after 3 Tabs focus is on 'Customers', i.e. brand → X → group, so the dead button consumes a Tab stop`

**Empfehlung:** Eine explizite Regel mit hoher Spezifität in consistency.css ergänzen: `@media (min-width: 901px) { html[data-theme] .sb-close { display: none; } }`, oder den Button in Navbar.tsx nur rendern, wenn `mobile` true ist (`{mobile && <button …/>}`).

#### F029 · Mobile-Sidebar-Schließen-Button (X) erscheint auf Desktop als funktionsloses Control

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** overview, customers, workers, settings, system, errors

Der `.sb-close`-Button (Navbar.tsx, `aria-label="Close navigation"`) ist für den mobilen Drawer gedacht (workspace.css:1395 innerhalb `@media (max-width: 900px)`; app-glue.css:918 `.sb-close { display: none }`), ist aber bei 1440px in jedem Desktop-Screenshot sichtbar, und zwar an der Stelle, an der ein Collapse-/Pin-Toggle erwartet wird. Ein Klick ruft lediglich `setMobile(false)` auf, was auf Desktop keinen Effekt hat.

*Auswirkung:* Ein prominentes, fokussierbares Control in der Shell ohne Funktion untergräbt das Vertrauen in die übrige Chrome und belegt den natürlichen Platz für eine echte 'Sidebar einklappen'-Affordanz (die CSS enthält bereits `html.sb-collapsed`-Regeln in app-glue.css:1071, die von nichts getoggelt werden).

Belege:
- `desktop-dark-plain--overview--1.png, desktop-dark-plain--customers--1.png, desktop-dark-plain--system--1.png — a 36px bordered X button at (32,110) under the brand block on a 1440px viewport`
- `src/components/Navbar.tsx — '<button type="button" className="btn-icon sb-close" onClick={() => setMobile(false)} aria-label="Close navigation">'`
- `src/theme/app-glue.css:918 — '.sb-close { display: none; margin-left: auto; }'; src/theme/workspace.css:1395 — '.sidebar .sb-close { display: inline-flex; ... }' (inside the max-width:900px block starting at 1297)`

**Empfehlung:** Die tatsächlich greifende Regel ermitteln (grep zeigte keine spätere `.sb-close`-Regel; Computed Style in den Devtools prüfen, vermutlich eine `.btn-icon`-Display-Regel oder die Grenze des Media-Blocks) und in consistency.css explizit `@media (min-width: 901px) { .sb-close { display: none !important; } }` ergänzen. Besser: den Slot in einen echten Collapse-Toggle umbauen, der an die vorhandenen `html.sb-collapsed`-Styles angebunden ist.

#### F060 · Touch-Targets von Dropdown-Optionen und Nav-Items nur 32–34px auf dem Phone

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** workers, customers, live, licenses, heatmap

GlassDropdown-Optionen sind ca. 32px hoch, Sidebar-Items auf `min-height: 34px` gesetzt (Child-Items: 12px Text mit 8px Padding). Das WCAG-2.5.8-Minimum von 24px wird eingehalten, die 44px-Komfortgröße des übrigen Mobile-Chromes jedoch unterschritten.

*Auswirkung:* Gelegentliche Phone-Nutzer treffen in den Version-/Country-Filtern und in den verschachtelten Nav-Items benachbarte Optionen. Geringe Schwere für eine Desktop-first Ops-Konsole.

Belege:
- `src/index.css:2848-2854 — '.gdrop-item { … padding: 7px 10px; … }' (≈32px with 13px text)`
- `src/theme/consistency.css:120-122 — '.sb-item { min-height: 34px; height: auto; }' overriding src/theme/workspace.css:210-214 '.sb-item { min-height: 40px; font-size: 13px; }'`
- `src/theme/operations.css:499-502 — '.nav-children .sb-item { font-size: 12px; padding: 8px; }'`
- `Contrast: consistency.css:509-512 '.btn-icon { width: 36px; height: 36px }', workspace.css:1309-1313 '.mobile-menu { width: 38px; height: 38px }'; scenario--m-nav-open.png shows comfortable nav spacing only because of the vertical gap`

**Empfehlung:** In consistency.css `@media (pointer: coarse) { .gdrop-item, .sb-item { min-height: 44px; } }` ergänzen; die Desktop-Dichte unverändert lassen.

#### F061 · Suchfelder mit 14px Text auf dem Phone lösen iOS-Auto-Zoom aus

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** overview, customers, workers, licenses

Unter 900px/600px ist das Workspace-Suchfeld auf 14px gesetzt. Safari auf iOS zoomt die Seite, sobald ein Input unter 16px den Focus erhält; nach dem Schließen der Suche bleibt das Layout gezoomt.

*Auswirkung:* Störend, nicht blockierend: iPhone-Nutzer erleben beim Antippen der globalen Suche einen Zoom-Sprung. Nicht auf einem Gerät verifiziert (nur Headless-Chrome-Screenshots).

Belege:
- `src/theme/workspace.css:1329-1331 — '.workspace-search input { font-size: 14px; }' (inside @media (max-width: 900px))`
- `src/theme/workspace.css:1461-1465 — '.workspace-search input { font-size: 14px; height: 34px; padding-left: 30px; }' (inside @media (max-width: 600px))`

**Empfehlung:** `font-size: 16px` für Inputs unter `(max-width: 600px)` oder `(pointer: coarse)` setzen; die bestehende Höhe von 34px reicht dafür aus.

#### F062 · Sidebar bleibt bis 901px bei 244px Breite und quetscht Inhalte auf schmalen Laptops

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** customers, licenses, workers, live, overview

Zwischen 901px und ca. 1200px lässt die fixe Sidebar nur rund 850px für Inhalte. Der eingeklappte 64px-Rail-Modus (`html.sb-collapsed`) existiert, wird aber nur manuell umgeschaltet, sodass Tabellen und KPI-Reihen bei 1100px Spalten verlieren.

*Auswirkung:* Auf einem 13-Zoll-Laptop oder in einem halbierten Fenster scrollen die Haupttabellen horizontal. In Kombination mit der abgeschnittenen Action-Spalte (siehe High-Befund) ist dies das häufigste Desktop-Layout, in dem der C360-Button verborgen ist.

Belege:
- `src/theme/workspace.css:15 — '--sb-w: 244px;', :324 — 'margin-left: var(--sb-w);'; the only breakpoint that removes it is '@media (max-width: 900px)' (workspace.css:1297-1300 '.workspace-bar { margin-left: 0 }', app-glue.css:1023-1027 '.sidebar { transform: translateX(-102%) }')`
- `src/theme/app-glue.css:1066-1100 — 'html.sb-collapsed' 64px rail styles under '@media (min-width: 901px)'`
- `scenario--n-overview.png (1100×720) — KPI labels wrap to two lines ('All-time customers'), the directory table clips at 'Sess…' with the action column off-screen`

**Empfehlung:** Zwischen 901px und 1200px standardmäßig den eingeklappten Rail aktivieren (`sb-collapsed` auf `<html>` per matchMedia in Navbar.tsx setzen, sofern der Nutzer die Sidebar nicht gepinnt hat), oder `--sb-w` in einem `@media (max-width: 1200px)`-Block auf ca. 200px senken.

#### F064 · Markenname weicht zwischen Sidebar, Login und Browser-Tab ab

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** overview, login, settings

Der Sidebar-Brand-Block zeigt 'RazorReaper / Admin workspace', das Login-Lockup 'RazorReaper / Operations Console', der Dokumenttitel lautet 'Razor Reaper — Operations Console' (mit Leerzeichen im Produktnamen). Der Tab-Titel ändert sich nie pro Seite, sodass Bookmarks und Tab-Wechsel 'Live sessions' nicht von 'Settings' unterscheiden können, obwohl für jede Seite Hash-Routen existieren.

*Auswirkung:* Leichte Verwirrung für neue Mitglieder sowie schlechtere Such- und Bookmark-Hygiene. Der fehlende seitenbezogene Titel trifft Desktop-Nutzer, die mehrere Panel-Tabs offen halten (im Ops-Alltag üblich).

Belege:
- `src/components/Navbar.tsx:187-188 — '<strong>RazorReaper</strong><small>Admin workspace</small>'`
- `src/components/LoginForm.tsx:21 — '<span className="auth-brand-sub">Operations Console</span>'`
- `public/index.html:14 — '<title>Razor Reaper — Operations Console</title>'; grep for 'document.title' in src returned nothing`

**Empfehlung:** Einen Produktnamen ('RazorReaper') und einen Konsolennamen ('Operations Console' oder 'Admin panel') festlegen und in Navbar, LoginForm und index.html verwenden. Im Page-Effect von App.tsx `document.title = \`${PAGE_META[page].label} · RazorReaper\`` setzen.

#### F065 · Zwei Sign-out-Pfade mit unterschiedlichem Verhalten; Account-Controls verstreut

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** settings, overview

Der Sign-out im Sidebar-Footer öffnet ein Confirm-Modal ('Sign out? … Stay signed in / Sign out'), während Settings > My account einen 'Sign out'-Button hat, der `onLogout` sofort ohne Bestätigung aufruft. Account-Informationen (E-Mail, Rolle, Sign-in-Methode) liegen unter Settings; der Footer zeigt nur den lokalen Teil der E-Mail ('preview') und die Rolle, ohne Weg zur vollständigen Adresse oder zum Account.

*Auswirkung:* Gering: Ein versehentlicher Klick in Settings loggt den Nutzer aus, im Cloudflare-Access-Modus mit vollständiger Re-Authentifizierung. Wiederherstellung in zwei Klicks möglich.

Belege:
- `src/components/Navbar.tsx — '<Modal open={confirmLogout} ... title="Sign out?" sub="You will need to sign in again to access the panel.">'`
- `src/pages/SettingsPage.tsx:330-332 — '<button className="btn btn-secondary" onClick={onLogout}>Sign out</button>' (no confirm)`
- `scenario--d-nav-logout-confirm.png — confirm dialog from the footer button; desktop-dark-plain--overview--1.png — footer 'P preview / Owner' with icon-only sign-out`

**Empfehlung:** Beide Pfade über dasselbe Confirm leiten (`confirmLogout` nach App heben oder einen `useSignOut()`-Hook exportieren) oder den Settings-Button entfernen und den Sign-out allein dem Footer überlassen. Die vollständige E-Mail per hover/title auf `.account-row` anzeigen.

#### F067 · Versteckte 'kicker'-Taxonomie und toter 'access'-Page-Key in der IA

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** licenses, customers, errors, access

Jede Seite übergibt einen `kicker` ('Customer support', 'Access' für Licenses, 'Broadcast', 'Failures', 'Inbox', 'Geography', 'Telemetry', 'Distribution'), den workspace.css ausblendet. Das bildet eine zweite, nie gerenderte Gruppierung, die den Nav-Gruppen widerspricht (Licenses liegt in der Nav unter 'Customers', im Kicker unter 'Access'). Der Page-Key 'access' steht weiterhin in PAGE_KEYS und USER_PAGES und leitet sofort auf customers um; AccessPage rendert dennoch einen eigenen `PageHeader kicker="Access" title="App suspensions"`.

*Auswirkung:* Kein direkter Nutzer-Impact (ausgeblendet), aber Ursache der oben beschriebenen Namensdrift; das Problem taucht wieder auf, sobald Kicker reaktiviert werden.

Belege:
- `src/theme/workspace.css:400-404 — '.page-header .kicker, .panel .kicker, .stat-card .kicker, .modal-head .kicker { display: none; }'`
- `src/pages/LicensesPage.tsx:866 — 'kicker="Access"'; src/pages/CustomersPage.tsx:241 — 'kicker="Customer support"'; src/pages/ErrorsPage.tsx:458 — 'kicker="Failures"'`
- `src/App.tsx:133-141 — 'if (page !== "access") return; ... setPage("customers");' and src/pages/AccessPage.tsx:228 — '<PageHeader kicker="Access" title="App suspensions" right={filterBar} />'`

**Empfehlung:** Entweder die `kicker`-Prop-Verwendungen und die PageHeader-Prop entfernen, oder die Prop so umwidmen, dass sie den Nav-Gruppennamen aus der einzigen Quelle PAGE_META rendert (und den Breadcrumb entfernen). 'access' aus PAGE_KEYS/USER_PAGES entfernen, falls der Redirect dauerhaft ist.

### Content, Benennung und Ton

Nav-Label, Breadcrumb und H1 widersprechen sich, Titel klingen nach Landingpage, Begriffe für dieselbe Entität wechseln, und Settings zeigt Mock-Daten neben echten Controls.

#### F030 · Nav-Label, Breadcrumb und Seitentitel widersprechen sich auf den meisten Seiten

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** overview, customers, errors, heatmap, feedback, workers

Sidebar und Breadcrumb verwenden einen Namen, die H1 einen anderen: Overview → 'Workspace overview'; Customer directory → 'Customers' (mit einem inneren Panel 'Customer Directory'); Application errors → 'Errors'; World map → 'Heatmap'; Feedback inbox → 'Feedback'. Der Breadcrumb-Strong-Text wird aus dem Nav-Label abgeleitet (Navbar.tsx `title = activeGroup?.items.find(...)[1]`) und weicht daher überall dort von der H1 ab, wo die Seite einen eigenen Titel setzt.

*Auswirkung:* Drei unterschiedliche Namen für denselben Screen innerhalb von 80px erschweren die Kommunikation über die Konsole ('open the heatmap' vs. 'World map') und lassen den Breadcrumb eher falsch als hilfreich wirken. Einzeln gering, aber auf jeder Seite präsent.

Belege:
- `desktop-dark-plain--customers--1.png — breadcrumb 'Customers > Customer directory', H1 'Customers', panel title 'Customer Directory'`
- `desktop-dark-plain--errors--1.png — breadcrumb 'Diagnostics > Application errors', H1 'Errors'`
- `desktop-dark-plain--overview--1.png — breadcrumb 'Monitoring > Overview', H1 'Workspace overview'`
- `src/pages/HeatmapPage.tsx:512 — 'title="Heatmap"' vs src/components/Navbar.tsx '["heatmap", "World map", <Globe2 />]'`
- `src/pages/ErrorsPage.tsx:459 — 'title="Errors"'; src/pages/OverviewPage.tsx:251 — 'title="Workspace overview"'`

**Empfehlung:** Single Source of Truth: ein `PAGE_META: Record<PageKey, {group, label}>` aus Navbar (oder shared/panel-policy) exportieren und `PageHeader` den `title` standardmäßig auf `PAGE_META[page].label` setzen lassen. Dann pro Seite einen Namen festlegen (Vorschlag: Overview, Customers, Licenses & orders, Live sessions, Session history, Traffic, Versions, World map, Errors, Announcements, Feedback, Panel access, Backend status, Settings) und diesen in Nav, Breadcrumb und H1 verwenden. Das innere Panel auf Customers in 'Directory' umbenennen, um 'Customer Directory' unter 'Customers' zu vermeiden.

#### F031 · Marketing-Ton in Titeln und Subtiteln einer Operations-Konsole

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** settings, team, workers, overview, login

Mehrere H1/Subtitel lesen sich wie Landingpage-Copy statt wie Labels: Settings trägt den Titel 'Make it yours — A clear workspace, with your own character.'; Panel access: 'The right people. The right permissions. For the right amount of time.'; Session history: 'People, activity and every recorded session. One place to look.'; Overview: 'A clear view of activity, health and the work ahead.'; Login: 'Welcome back' mit einem dekorativen Meta-Block 'Scope: Sessions · Incidents · Rollout Health / Mode: Protected Access', der nichts Reales beschreibt (es gibt keine Incidents- oder Rollout-Health-Seite). Der Doc-Kommentar von PageHeader bezeichnet Subtitel sogar als 'considered filler in v2' und blendet sie aus, workspace.css:1639 reaktiviert sie jedoch (`display: block`).

*Auswirkung:* Ops-Mitarbeiter orientieren sich an H1s; ein Slogan anstelle eines Labels kostet jedes Mal einen Moment und erfindet auf dem Login-Screen einen Scope ('Incidents', 'Rollout Health'), den das Tool nicht hat. Subtitel, die nur den Titel wiederholen, belegen auf jeder Seite eine 20px-Zeile ohne Information.

Belege:
- `src/pages/SettingsPage.tsx:86 — '<PageHeader title="Make it yours" sub="A clear workspace, with your own character." />'`
- `src/pages/TeamPage.tsx:152-153 — 'title="Panel access" sub="The right people. The right permissions. For the right amount of time."'`
- `src/components/LoginForm.tsx — '<span className="label-sm">Scope</span><strong>Sessions · Incidents · Rollout Health</strong>' and '<strong>{isBootstrap ? "Bootstrap" : "Protected Access"}</strong>'`
- `src/components/ds/PageHeader.tsx:8-10 — comment: subtitles 'hidden (subtitles are considered filler in v2)' vs src/theme/workspace.css:1639 '.page-header .page-subtitle { display: block; ... }'`
- `desktop-dark-plain--settings--1.png — 'Make it yours' as the page H1 under breadcrumb 'Administration > Settings'`

**Empfehlung:** Regel: Titel = Nav-Label; Subtitel nur, wenn er einen Fakt transportiert ('Checked automatically every 15 seconds' auf Backend status und 'Every collected error, linked to the user it came from.' auf Errors beibehalten). Ersetzen: Settings → 'Settings' (ohne Subtitel); Panel access Subtitel → 'Who can sign in to this panel and what they may do'; Session history Subtitel → entfernen; Overview Subtitel → entfernen oder 'Today, UTC'. In LoginForm den `.auth-meta`-Block Scope/Mode entfernen und 'Welcome back' durch 'Sign in' ersetzen; die nützliche Zeile 'If your access has ended, contact the panel owner.' beibehalten. Zudem den veralteten PageHeader-Kommentar korrigieren oder löschen.

#### F032 · Settings zeigt dekoratives Mock-Dashboard mit Fake-Metriken neben echten Controls

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** settings

Der Appearance-Tab enthält rechts eine Preview-Karte 'Your workspace' mit 'Everything in its place.', erfundenen KPIs ('Active 128 — Connected', 'Resolved 98.4% — Looking good'), einem fiktiven Activity-Feed ('License activated · Just now') und einem Button 'Your workspace, your way', der keine Aktion auslöst. Nur eine kleine Caption darunter weist auf 'The preview contains example data.' hin. Theme und Accent wirken bereits live auf die gesamte App, die Preview zeigt also nichts, was nicht ohnehin auf der realen Seite dahinter sichtbar ist.

*Auswirkung:* In einem Monitoring-Tool wirken Zahlen mit den Labels 'Active' und 'Resolved' und einem grünen 'Looking good' auf den ersten Blick wie Systemgesundheit; ein Support-Mitarbeiter, der auf Settings landet, kann sie als echt lesen. Zusätzlich verdoppelt die Karte die Breite der Settings-Seite ohne Informationsgewinn.

Belege:
- `desktop-dark-plain--settings--1.png — card at right: 'Active 128 Connected', 'Resolved 98.4% Looking good', 'License activated Just now', button 'Your workspace, your way'`
- `desktop-dark-plain--settings--2.png — same card persists while scrolling; caption 'The preview contains example data.'`
- `src/pages/SettingsPage.tsx:315 — '<p className="settings-caption">The preview contains example data.</p>'`

**Empfehlung:** Die Preview-Aside entfernen (SettingsPage `.settings-layout`, rechte Spalte) und die Appearance-Controls auf eine einzelne, gut lesbare Spalte ausdehnen; falls eine Swatch-Preview gewünscht ist, ein kleines neutrales Mock (drei graue Blöcke) ohne Zahlen oder Verben rendern. Den Nicht-Button 'Your workspace, your way' entfernen.

#### F033 · Settings > System dupliziert Backend status mit hartcodierten, widersprüchlichen Werten

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** settings, system

Der 'System'-Tab in Settings rendert 'System status' mit hartcodiertem `API: Connected`, `Environment` mit Default 'Production' sowie Build/Storage aus einem Summary-Payload, während die eigentliche Seite 'Backend status' (ebenfalls unter Administration) alle 15 s /api/admin/health pollt und korrekt berichtet. Zwei Orte, zwei Namen ('System status' vs. 'Backend status'), und die Settings-Variante kann 'Connected' anzeigen, während die API nicht erreichbar ist.

*Auswirkung:* Ein Admin, der die Gesundheit über Settings prüft, erhält unabhängig vom tatsächlichen Zustand ein statisches 'Connected'; die zwei unterschiedlichen Labels suggerieren zwei verschiedene Systeme. Außerdem werden persönliche Darstellung, Account und Infrastruktur-Health unter einer Überschrift 'Settings' vermischt.

Belege:
- `src/pages/SettingsPage.tsx:337-347 — '<h2>System status</h2> ... <dt>API</dt><dd>Connected</dd> ... <dd>{health.build?.environment ?? "Production"}</dd>'`
- `src/pages/SystemStatusPage.tsx:65-67 — '<PageHeader title="Backend status" sub="API, database and incoming data. Checked automatically every 15 seconds." />'`
- `desktop-dark-plain--settings--1.png — tabs 'Appearance | My account | System' under Settings; desktop-dark-plain--system--1.png — separate 'Backend status' page`

**Empfehlung:** Den System-Tab aus SettingsPage entfernen (oder auf einen einzelnen Link 'See Backend status' reduzieren) und Health ausschließlich auf SystemStatusPage belassen. Die Settings-Tabs auf 'Appearance' und 'Account' beschränken; erwägen, die 'Account'-Fakten (E-Mail, Rolle, Sign-in-Methode) in das Popover der Sidebar-Account-Zeile zu verschieben, sodass Settings rein Appearance ist.

#### F034 · Terminologie-Drift: users / people / persons / customers / members für dieselbe Entität

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** workers, errors, overview, customers

Derselbe App-Nutzer heißt 'Active Users' (Overview-KPI), 'People' / 'Person' / 'Everyone' / '84 people' (Session history), 'Users with Errors' / 'Affected Users' / 'User' (Errors), 'Customer' / 'All customers' (Customers) und trägt ein Handle '@member_N' (Contact-Spalte). Die Empty States folgen dem Muster: 'No users match' (Errors) vs. 'No customers match' (Customers) vs. 'No matching activity' (Session history).

*Auswirkung:* Ops-Mitarbeiter müssen zwischen den Seiten übersetzen ('ist eine Person ein Customer? ist ein User ein Member?'). Zudem schwächt es seitenübergreifende Links (Session history → Customer 360), weil das Objekt beim Folgen scheinbar seine Identität wechselt.

Belege:
- `desktop-dark-plain--workers--1.png — KPI 'People 84 · All recorded users', filter tab 'Everyone', column 'Person', pagination '1–50 of 84 people'`
- `desktop-dark-plain--errors--1.png — 'Affected Users', 'Users with Errors', column 'User'`
- `desktop-dark-plain--overview--1.png — 'Active Users'; desktop-dark-plain--customers--1.png — 'All-time customers', column 'Customer'`
- `src/pages/ErrorsPage.tsx:911 — '<EmptyState icon={<Search />} title="No users match">'; src/pages/CustomersPage.tsx:475 — 'title="No customers match"'; src/pages/WorkersPage.tsx:321 — 'title="No matching activity"'`

**Empfehlung:** Nur zwei Begriffe verwenden: 'customer' für den App-Nutzer überall (KPIs, Spalten, Empty States, Such-Placeholder), 'member' ausschließlich für Panel-Accounts auf Panel access. 'People/Person/Everyone/Users' in den Headern, KPIs und EmptyState-Titeln von WorkersPage und ErrorsPage ersetzen ('No customers match'). 'session' als Einheit für Aktivität beibehalten.

#### F063 · Uneinheitliche Groß-/Kleinschreibung und Button-Verben in Shell und Seiten

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** announcements, licenses, feedback, errors, login, overview

Title Case und Sentence Case sind innerhalb derselben Komponentenfamilie gemischt: EmptyState-Titel 'No Announcements Yet', 'No Licenses Found', 'No Feedback' vs. 'No customers match', 'No one is suspended'; Buttons 'Sign In' / 'Create Account' / 'Save Changes' vs. 'Sign out' / 'Add member' / 'Stay signed in'; KPI-Labels 'Active Users', 'Avg Session', 'Errors in Range' vs. 'Online now', 'Needs attention', 'Time in app'; Panel-Titel 'Customer Directory', 'Users with Errors' vs. 'Latest successful check'.

*Auswirkung:* Überwiegend Polish, aber die Konsole wirkt wie aus verschiedenen Quellen zusammengesetzt, und wiederkehrende Controls sind schwerer auf einen Blick zu erkennen. Kein Task-Versagen.

Belege:
- `src/pages/AnnouncementsPage.tsx:290 — 'title="No Announcements Yet"'; src/pages/LicensesPage.tsx:639 — 'title="No Licenses Found"'; src/pages/CustomersPage.tsx:475 — 'title="No customers match"'`
- `src/components/LoginForm.tsx — '{isBootstrap ? "Create Account" : "Sign In"}' vs src/components/Navbar.tsx '<Button variant="primary">Sign out</Button>'`
- `src/pages/AnnouncementsPage.tsx:490 — 'editingId === null ? "Publish" : "Save Changes"'`
- `desktop-dark-plain--errors--1.png — 'Errors in Range', 'Affected Users', 'Last Failure', 'Users with Errors', 'By User' / 'By Failure'`

**Empfehlung:** Durchgängig Sentence Case verwenden (bereits die Mehrheit) und in den Primitives erzwingen: EmptyState, Button, KpiStatCard-Labels, PageHeader-Titel. Die aufgeführten Strings korrigieren; einen kurzen Abschnitt 'Copy rules' in docs/panel-workspace.md ergänzen (Sentence Case, verb-first Buttons, 'Sign in/out').

#### F066 · Login-Formular wendet Bootstrap-Passwortregel auf normalen Sign-in an, Cloudflare-Modus ohne Orientierung

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** login

Das Passwortfeld trägt `placeholder="Minimum 10 characters"` und `minLength={10}` sowohl im Bootstrap- als auch im Normalmodus. Ein bestehender Account mit kürzerem Legacy-Passwort wird clientseitig mit einer Browser-Validierungsblase blockiert, und der Placeholder gibt die Policy bei jedem Sign-in preis. Im 'access'-Modus ist die einzige Aktion 'Sign in again' mit Ziel `/cdn-cgi/access/logout`, ohne Hinweis auf die Umleitung über Cloudflare.

*Auswirkung:* Gering; nur wenige Panel-Accounts betroffen. Ein ausgesperrter Admin auf dem Phone erhält jedoch einen kryptischen nativen Tooltip statt einer Server-Meldung. (Login nicht per Screenshot geprüft; Bewertung anhand des Codes.)

Belege:
- `src/components/LoginForm.tsx — '<input type="password" placeholder="Minimum 10 characters" ... required minLength={10} />' rendered for both 'isBootstrap' values`
- `src/components/LoginForm.tsx — '<a href="/cdn-cgi/access/logout" className="btn btn-primary auth-submit">Sign in again</a>'`

**Empfehlung:** `minLength` und den Hinweis 'Minimum 10 characters' nur bei `isBootstrap` anwenden; andernfalls Placeholder 'Password'. Im Access-Modus den Button in 'Continue with Cloudflare Access' umbenennen und die Contact-owner-Zeile beibehalten.

### Charts, Zeitangaben und Ladezustände

Der Overview-Chart ist ohne Legende und mit Wheel-Hijack der schwächste Einstieg der Konsole; dazu widersprüchliche Zustände auf Errors, relative Zeiten ohne Absolutwert und Grid-Waisen.

#### F010 · Overview-Chart: drei Serien ohne Legende, Session-Bars werden zu Punkten

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** overview, traffic

Der Overview-ComposedChart plottet 'Active users' (Area), 'New sessions' (Bars) und 'Errors' (Area), rendert aber nirgends in der App eine Legende. In der Standard-24h-Skala degradieren die Session-Bars zu einer Reihe winziger violetter Stummel entlang der Baseline, die weder von einer Nullserie noch von Dekoration unterscheidbar sind.

*Auswirkung:* Ops-Personal wirft einen Blick auf dieses Chart, um 'ist gerade etwas kaputt?' zu beantworten. Ohne Legende muss die Farbbedeutung geraten werden (der Hover-Tooltip ist der einzige Decoder), und die Sessions-Serie geht visuell verloren — das Chart kommuniziert effektiv eine Serie, während der Tooltip drei behauptet.

Belege:
- `src/pages/OverviewPage.tsx:377-476 — <ComposedChart> with <Area dataKey="users" name="Active users">, <Bar dataKey="started" name="New sessions" radius={[6, 6, 0, 0]} barSize={zoom.isZoomed ? 18 : 10}>, <Area dataKey="errors" name="Errors">; no <Legend> child`
- `grep -rn '<Legend' src → no results (no recharts Legend used in any chart)`
- `desktop-dark-plain--overview--1.png — a single purple curve plus ~14 small dots sitting on the 0 line between 17:00 and 15:00; nothing tells the reader what the dots or the curve are; the MetaRow above ('Peak users/h 18 · Sessions 15 · Errors 0') is the only hint`
- `desktop-light-plain--overview--1.png — same row of lavender dots on the baseline`

**Empfehlung:** Eine kompakte Legendenzeile ergänzen (Serien-Swatch + Name, mit --chart-users / --chart-sessions / --chart-errors), entweder als recharts <Legend verticalAlign="top"> oder als kleine DS-Komponente `ChartLegend` im Panel-Header neben MetaRow; auf Traffic wiederverwenden (Actual vs. gestrichelte Forecast). Bei den Session-Bars den 6px-Radius bei geringen Höhen entfernen (der Radius lässt 1-Unit-Bars wie Punkte aussehen) und der Bar-Serie entweder eine eigene rechte YAxis oder eine sichtbare Mindesthöhe geben (z. B. `minPointSize={2}` mit eckigen Kanten).

#### F011 · Wheel-only-Zoom kapert das Seitenscrollen ohne Touch-/Tastatur-Alternative

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** overview

Der Overview-Chart lässt sich ausschließlich per Mausrad zoomen; der Handler ruft preventDefault auf einem non-passive wheel-Listener auf, sodass jeder Versuch, die Seite zu scrollen, während der Pointer über dem 300px-Chart liegt, stattdessen zoomt. Auf dem Smartphone gibt es keinen Zoom, und die einzige Affordance ist die Textzeile 'Scroll inside chart to zoom in' plus ein `cursor: ns-resize`, der Resizing signalisiert, nicht Zoom.

*Auswirkung:* Desktop-Nutzer, die Overview per Trackpad scrollen, erhalten einen unerwarteten Zoom (und verlieren die 24h-Gesamtansicht), sobald der Pointer das Chart kreuzt; Smartphone-Nutzer können gar nicht zoomen. Der Zoom ist zudem eine Discoverability-Sackgasse: außer einem Satz lädt nichts Sichtbares dazu ein.

Belege:
- `src/hooks/useChartZoom.ts:29-33 — 'const handler = (e: WheelEvent) => { e.preventDefault(); e.stopPropagation(); ...' and :55 'container.addEventListener("wheel", handler, { passive: false });'`
- `src/pages/OverviewPage.tsx:318-321 — 'sub={ zoom.isZoomed ? \'Viewing ${windowHours}h window — scroll to adjust\' : "Scroll inside chart to zoom in" }'`
- `src/pages/OverviewPage.tsx:374-375 — '<div className="chart-wrap chart-wrap-tall" ref={zoom.containerRef} style={{ cursor: "ns-resize" }}>'`
- `src/pages/OverviewPage.tsx:357-368 — Reset button rendered only '{zoom.isZoomed && (...)}'`
- `desktop-dark-plain--overview--1.png — the chart occupies most of the viewport height below the KPI row; a trackpad scroll landing on it will zoom instead of scrolling`

**Empfehlung:** Wheel-Zoom beibehalten, aber nur bei gehaltenem Modifier (Ctrl/⌘+Wheel, die Konvention in Maps/Charts) oder nachdem das Chart geklickt/fokussiert wurde; ansonsten das Wheel die Seite scrollen lassen. Überall funktionierende Affordances ergänzen: ein recharts <Brush> unter dem Plot oder +/−-IconButtons neben dem Zeitfenster-Select sowie Drag-to-Select für Bereiche. `cursor: ns-resize` durch `zoom-in`/`grab` ersetzen. Den Reset-Button immer rendern (disabled, wenn nicht gezoomt), damit seine Position stabil bleibt.

#### F035 · Errors-Seite zeigt 'Failed to load', Loading-Skeleton und 'Last Failure: None' gleichzeitig

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** errors

Im erfassten Zustand rendert die Seite drei widersprüchliche Meldungen: ein rotes Banner 'Failed to load errors.' mit Retry, den Panel-Subtitel 'Loading errors...' über Skeleton-Zeilen und KPI-Karten mit '—' sowie 'None / No failures in range'. 'None' liest sich als 'null Fehler', obwohl die Daten tatsächlich nicht verfügbar sind.

*Auswirkung:* Für eine Diagnoseseite ist der Unterschied zwischen 'keine Fehler' und 'Fehler konnten nicht geladen werden' genau die Information, die Ops benötigt; die 'None'-KPI zusammen mit Entwarnungs-Formulierungen kann einen Ausfall der Fehler-Pipeline verdecken.

Belege:
- `desktop-dark-plain--errors--1.png — banner 'Failed to load errors. [Retry]', panel 'Users with Errors — Loading errors...' with skeleton rows, KPI 'Last Failure: None — No failures in range' and 'Errors in Range: —'`
- `src/pages/ErrorsPage.tsx:457-460 — '<PageHeader kicker="Failures" title="Errors" sub="Every collected error, linked to the user it came from."'`

**Empfehlung:** In ErrorsPage einen einzigen Seitenzustand (loading | error | empty | data) ableiten und exklusiv rendern: im Fehlerfall das Banner zeigen, KPIs ausgegraut mit 'Unavailable' (nicht 'None' / '—'), Skeleton und Subtitel 'Loading errors...' ausblenden. Einen gemeinsamen `PageState`-Helper in ds/ erwägen, da Licenses/Feedback dieselbe Dreifach-Logik haben.

#### F036 · Zeitfenster-Control ('24h') liegt im Plot-Bereich statt im Panel-Header

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** overview

Das Select für das Zeitfenster wird innerhalb des Chart-Bodys oberhalb der y-Achse gerendert, wo es mit dem Plot konkurriert; der Panel-Header besitzt bereits einen `right`-Slot, der die MetaRow aufnimmt.

*Auswirkung:* Controls, die den Inhalt eines Panels ändern, gehören zum Panel-Titel; hier muss der Leser den Plot-Bereich absuchen, um die Range zu wechseln, und bei schmalen Breiten drückt die Pill das Chart nach unten.

Belege:
- `src/pages/OverviewPage.tsx:340-355 — '<Select aria-label="Time window" value={activeWindow} ...>' rendered in a flex row with 'paddingBottom: 6' directly above '<div className="chart-wrap chart-wrap-tall">'`
- `src/pages/OverviewPage.tsx:322-329 — 'right={<MetaRow items={[...]} />}' on the CollapsiblePanel header`
- `desktop-dark-plain--overview--1.png — a '24h ▾' pill floats at x≈295–365, y≈400–433 in the chart body, left-aligned over the y-axis labels, disconnected from the header controls`

**Empfehlung:** Das Select (und den Reset-zoom-Button) in den `right`-Slot des CollapsiblePanel neben die MetaRow verschieben, analog zu Errors ('Last 24 hours ▾') und Versions ('Current ▾'), die ihre Range-Controls im Header platzieren (siehe desktop-dark-plain--errors--1.png und --versions--1.png).

#### F037 · Traffic-Chart schneidet oberstes y-Achsen-Tick-Label ('20') auf Desktop und Mobile ab

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** traffic

Der Daily-Users-AreaChart verwendet `margin top: 8`, wodurch das oberste Tick-Label zur Hälfte außerhalb des SVG gerendert wird; der Overview-Chart nutzt `top: 16` und ist korrekt.

*Auswirkung:* Das abgeschnittene Label wirkt wie ein Rendering-Bug und erschwert das Ablesen der Skala; Ops-Mitarbeiter nutzen den obersten Tick, um den Tagespeak einzuschätzen.

Belege:
- `src/pages/TrafficPage.tsx:226 — '<AreaChart data={chartData} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>'`
- `src/pages/OverviewPage.tsx:379 — 'margin={{ top: 16, right: 8, left: 0, bottom: 0 }}' (not clipped)`
- `desktop-dark-plain--traffic--1.png — at y≈457 the label reads as the bottom half of '20'`
- `mobile-dark-plain--traffic--1.png — same clipped '20' at y≈686`

**Empfehlung:** `margin.top` in TrafficPage auf 16 setzen (oder `tick={{ dy: ... }}` / YAxis `padding={{ top: 8 }}`) und Chart-Margins in einer gemeinsamen Konstante zentralisieren (z. B. `CHART_MARGIN` in components/charts), damit Overview, Traffic und die KPI-Drilldown-Serien konsistent bleiben.

#### F038 · Relative Zeitangaben ('6m ago', 'just now', '5d ago') ohne absolute Zeit

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** customers, workers, access, errors, live, team, licenses

`timeAgo()` wird an 25 Stellen über die Seiten hinweg verwendet, und keine davon kapselt den Wert in ein `<time>`-Element oder ergänzt ein `title` mit dem absoluten Zeitstempel; nur die Detailzeile auf Errors gibt beides aus.

*Auswirkung:* Support benötigt den exakten Zeitpunkt für Tickets ('wann hat dieser Customer die App zuletzt gestartet?'). Tages-Granularität ('5d ago') verbirgt das Datum vollständig, und der Wert veraltet in einem lange geöffneten Tab unbemerkt.

Belege:
- `src/utils/format.ts:26-36 — 'export function timeAgo(value: string | null): string { ... return \'${Math.floor(diff / 86_400_000)}d ago\'; }' (no absolute form returned)`
- `grep -rn 'timeAgo(' src/pages src/components → 25 call sites; grep for those with 'title=' → 0`
- `src/pages/CustomersPage.tsx:447 — '{timeAgo(user.lastSeen)}'; src/pages/AccessPage.tsx:330 — '{timeAgo(sortMode === "first_seen" ? u.firstSeen : u.lastSeen)}'; src/pages/ErrorsPage.tsx:513 — KPI 'value={kpis?.lastErrorAt ? timeAgo(kpis.lastErrorAt) : "None"}'`
- `desktop-dark-plain--customers--2.png — 'Last seen' column is a wall of '6m ago'; desktop-dark-plain--workers--1.png — 'Last active' column shows only 'just now'`

**Empfehlung:** Eine kleine DS-Komponente `RelativeTime` einführen (`<time dateTime={iso} title={formatDate(iso)}>{timeAgo(iso)}</time>`) und die rohen `timeAgo()`-Aufrufe damit ersetzen; optional in einem Intervall neu rendern, damit 'just now' nicht einfriert.

#### F042 · Errors-Seite zeigt Fehler-Banner und Loading-Skeleton gleichzeitig

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** errors

Schlägt der Errors-Request fehl, rendert die Seite das Banner 'Failed to load errors. Retry', während die Tabelle darunter weiterhin Skeleton-Zeilen zeigt, der Panel-Subtitel 'Loading errors…' lautet und die KPIs '—' anzeigen, weil der Loading-/Skeleton-Branch nur auf `rows === null` und nicht auf den Fehler prüft.

*Auswirkung:* Die beiden Zustände widersprechen sich: Der Leser weiß nicht, ob er warten oder Retry auslösen soll, und das pulsierende Skeleton suggeriert Fortschritt, der nicht stattfindet.

Belege:
- `src/pages/ErrorsPage.tsx:520-531 — '{error ? ( ... Retry ... ) : null}' banner`
- `src/pages/ErrorsPage.tsx:552-557 — 'sub={ rows ? ... : "Loading errors…" }'`
- `src/pages/ErrorsPage.tsx:281-283 — 'const current = data && data.range === range ? data : null;' — null on error, which feeds the skeleton branch at :926-931`
- `desktop-dark-plain--errors--1.png — red-bordered 'Failed to load errors.' banner with Retry at y≈290–340, directly above 'Users with Errors / Loading errors…' and six skeleton rows; KPI tiles read '—' with sub 'Last 24 hours · background hidden'`

**Empfehlung:** Das Skeleton auf `loading && !error` gaten; bei `error && !current` einen `EmptyState` im Tabellenrahmen rendern ('Couldn't load errors' + Retry-Button) und die KPI-Subs auf 'Unavailable' statt auf den Loading-Strich setzen. Ein `error`-Prop für das künftige Skeleton-/Loading-Primitive erwägen, damit diese Kopplung einmalig behandelt wird.

#### F069 · Mobile KPI-Grid mit verwaistem Tile, 6er-Heatmap-Tiles auf Desktop beengt

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** traffic, heatmap, versions

Seiten mit 5 KPI-Tiles (Traffic) brechen auf dem Phone in ein 2-spaltiges Grid mit einem einzelnen fünften Tile um. Heatmap rendert bei 1440px 6 Tiles in einer Reihe mit umbrechenden Sub-Zeilen ('Macro regions active', 'Across live sessions').

*Auswirkung:* Für diese Zielgruppe überwiegend kosmetisch; die umbrechenden Subs erzeugen ungleiche Tile-Höhen, und das Auge muss den Wert suchen.

Belege:
- `mobile-dark-plain--traffic--1.png — tiles 2×2 plus 'Last Ingest' alone at y≈385–470 on the left`
- `desktop-dark-plain--heatmap--1.png — six tiles of ≈176px each; sub lines wrap to two lines in four of six tiles`
- `desktop-dark-plain--traffic--1.png — five tiles; 'Busiest hour · last 24 h' and 'In range · legacy excluded' wrap to two lines`

**Empfehlung:** KPI-Reihen auf 4 Tiles begrenzen (5./6. Tile in die Panel-MetaRow oder eine zweite Reihe verschieben) oder das Grid auf `repeat(auto-fit, minmax(200px, 1fr))` umstellen, damit Phones 1–2 Spalten ohne Waisen erhalten. Sub-Texte auf eine Zeile kürzen oder mit dem vorhandenen `title={sub}`-Tooltip truncaten (KpiStatCard.tsx:110).

### Formulare, Dialoge und Flows

Das Lizenz-Issue-Modal ist das Referenzformular, aber versteckt; Generator, Dialog-Footer, Required-Markierung, Dirty-Guards, Initialfokus und Login-Attribute weichen davon ab.

#### F012 · Feedback-Reply-Modal reaktiviert backdrop-filter per !important

**Schwere:** Hoch · **Aufwand:** S · **Seiten:** feedback

src/components/feedbackReplies.css überschreibt die globale Regel 'NO backdrop-filter, anywhere, ever' mit höherer Spezifität und !important und macht den Reply-Dialog zu 10% transluzent. Das Reply-Modal blurrt dadurch den animierten Netzwerk-Hintergrund in jedem Frame neu und ist der einzige Dialog, der keine opake --surface-float-Fläche ist.

*Auswirkung:* Mit aktiviertem 'Reaper network'-Hintergrund (Fixture-Look, scenario--d-settings-network-bg.png) findet das Tippen einer Kundenantwort in genau der Fläche statt, die pro Animationsframe einen Fullscreen-Blur erzwingt — exakt der Freeze, den das frühere Motion-Audit beseitigt hat. Die Lesbarkeit des Kunden-Reports leidet auf unruhigen Hintergründen zusätzlich unter der transluzenten Füllung.

Belege:
- `src/components/feedbackReplies.css:1-4 — '.kpi-modal.feedback-reply-modal { backdrop-filter: blur(18px) !important; background: color-mix(in srgb, var(--bg) 90%, transparent) !important; }'`
- `src/theme/app-glue.css:795-806 — '/* Perf: NO backdrop-filter, anywhere, ever … the renderer froze outright */ *, *::before, *::after { backdrop-filter: none !important; }' (specificity 0,0,0 loses to the 0,2,0 selector above, and the component CSS is imported by the component so it also loads last)`
- `src/theme/operations.css:37-47 — every other modal: '.kpi-modal { … background: var(--surface-float); border: 1px solid var(--line-hi); }'`
- `plans/README.md:37 — the backdrop-filter ban is listed as a documented perf contract`

**Empfehlung:** Die beiden Overrides in src/components/feedbackReplies.css löschen und den Reply-Dialog von .kpi-modal erben lassen (opakes --surface-float). Nur die textarea-:focus-visible-Regel behalten oder nach src/theme/css/controls.css neben .glass-input:focus verschieben.

#### F014 · Auditierter 'Issue purchased license'-Flow versteckt hinter fehlgeschlagenem Lookup

**Schwere:** Hoch · **Aufwand:** M · **Seiten:** licenses

Das idempotente, order-getrackte Issue-Modal erscheint nur als kleiner Ghost-Button, nachdem eine 'Find a purchase'-Suche null Treffer liefert, während der prominente Tab 'Create licenses' einen separaten Generator mit anderen Regeln ausführt (Order optional, alert()-Fehler). Zwei Wege für dieselbe Aufgabe mit unterschiedlichen Garantien, und der bessere ist der schwerer auffindbare.

*Auswirkung:* Ein Support-Mitglied, das eine Store-Bestellung erfüllt, nutzt den offensichtlichen Tab, erzeugt Keys ohne Order-ID, und das Versprechen der nachvollziehbaren Lizenz geht verloren; der replay-sichere Flow mit dem eingebauten Folgeschritt 'Activate for install' ist praktisch nicht auffindbar.

Belege:
- `src/pages/LicensesPage.tsx:1021-1029 — '{lookupResults.length === 0 ? (<Button size="sm" icon={<Plus />} permission="licenses.write" onClick={openIssueForLookup}>Issue purchased license</Button>) : null}' (only render of the trigger; no other call to setIssueOpen(true) except line 302 inside openIssueForLookup)`
- `src/pages/LicensesPage.tsx:1394-1400 — issue modal: 'Order ID <em>required</em>' + 'required'; :309 — 'setIssueError("Order ID is required so this issue can be found and audited later.")'`
- `scenario--d-licenses-issue-modal.png — the 'Create licenses' tab instead shows 'Customer / Order (optional — for manual sales)' with a bare 'Generate Standard Keys' button and no required field`
- `src/pages/LicensesPage.tsx:1347-1356 — modal kicker 'Customer fulfilment', sub 'Creates one traceable license tied to the customer order.'`

**Empfehlung:** Eine primäre 'Issue license'-Aktion im PageHeader der Licenses-Seite (alle Tabs) platzieren, die das bestehende Issue-Modal öffnet, vorbefüllt aus dem aktuellen Lookup, falls vorhanden. Die Batch-/Master-Optionen des Generators als 'Advanced'-Sektion in dieses Modal integrieren (Quantity, Master-Flag, Custom Key), sodass es ein einziges Formular mit einem einzigen Validierungspfad gibt; mindestens den Tab in 'Bulk generator' umbenennen und als nicht-auditierten Pfad kennzeichnen.

#### F026 · Login-Formular ohne autocomplete-, name- und id-Attribute auf den Feldern

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** login

E-Mail- und Passwort-Inputs sind über umschließende <label> beschriftet (gut), tragen aber kein `autoComplete`/`name`/`id`, sodass Passwort-Manager und Browser-Autofill die Felder nicht zuverlässig identifizieren können und WCAG 1.3.5 (Identify Input Purpose) nicht erfüllt ist.

*Auswirkung:* Das Ops-Team loggt sich häufig und (laut Briefing) teils vom Smartphone ein; ohne autocomplete-Hinweise bieten iOS-/Android-Keychains und Desktop-Passwort-Manager oft keine Credentials an, und das „confirm password“-Feld des Bootstrap-Flows ist für assistive Technik nicht vom Login-Feld unterscheidbar.

Belege:
- `src/components/LoginForm.tsx:96-103 — '<input type="email" placeholder="admin@example.com" value={email} … required autoFocus />' (no autoComplete/name/id)`
- `src/components/LoginForm.tsx:111-118 — '<input type="password" placeholder="Minimum 10 characters" … required minLength={10} />'`
- `grep: 0 occurrences of 'autoComplete' in src/components/LoginForm.tsx`

**Empfehlung:** `name="email" id="login-email" autoComplete="email"`, `name="password" autoComplete={isBootstrap ? "new-password" : "current-password"}` sowie `autoComplete="new-password"` auf dem Bestätigungsfeld ergänzen. Zusätzlich die `role="alert"`-Fehlermeldung per `aria-describedby` von den Feldern aus verknüpfen.

#### F027 · Focus-Rings auf Text-Inputs durch `outline: none` in Element-Regeln unterdrückt

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** overview, workers, customers, live, licenses, feedback

Das globale `:focus-visible { outline: 2px solid var(--accent) }` ist eine nackte Pseudoklasse (Spezifität 0,1,0) und wird von 12 elementbezogenen `outline: none/0`-Deklarationen auf Inputs überschrieben, z. B. dem Dropdown-Filter-Input und dem Workspace-Suchfeld; Keyboard-Focus ist in diesen Feldern nur sichtbar, wenn ein Wrapper zufällig :focus-within stylt.

*Auswirkung:* Keyboard-Nutzer, die in die globale Suche oder das „Filter…“-Feld eines Dropdowns tabben, erhalten unter Umständen keinerlei sichtbare Positionsanzeige (WCAG 2.4.7 / 2.4.11). Buttons und Links sind in Ordnung – die Screenshots zeigen klare Akzent-Ringe auf Nav-Items.

Belege:
- `src/theme/workspace.css:107-110 — ':focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }'`
- `src/theme/css/controls.css:152 — '.gdrop-search input { … outline: none; … }'`
- `src/theme/app-glue.css:625-632 — search input rule with 'outline: none; background: none;'`
- `grep 'outline: none|outline: 0' across src/index.css src/theme/**: 12 hits (index.css:848,1551,2398,2836; app-glue.css:628; operations.css:617; workspace.css:361,981,1735; controls.css:152,187,224)`

**Empfehlung:** Jedes `outline: none` auf Inputs durch eine `:focus-within`-Behandlung des Wrappers ersetzen (`.workspace-search:focus-within, .gdrop-search:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }`) – eine einzelne Regel in consistency.css kann alle abdecken – und die nackten `outline: none`-Zeilen löschen. In den Devtools prüfen, welche Wrapper das bereits tun.

#### F045 · Neu generierte License Keys ohne Copy-Affordance im Erfolgshinweis

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** licenses

Nach dem Ausstellen von Lizenzen zeigt die Seite einen 'License created'-Hinweis mit einem 'Show created licenses'-Filter-Toggle, die Key-Werte selbst werden aber weder im Hinweis angezeigt noch sind sie kopierbar. Die einzige Clipboard-Aktion in der App ist 'Copy JSON' im Customer-360-Overlay.

*Auswirkung:* Ein Key wird ausgestellt, um ihn an einen Kunden weiterzugeben; der Operator muss die hervorgehobene Zeile suchen, den Mono-Text von Hand markieren und kopieren. Bei 20-Zeichen-Keys fehleranfällig und bei mehreren gleichzeitig erzeugten Keys langsam.

Belege:
- `src/pages/LicensesPage.tsx:871-900 — '<div className="creation-notice" role="status"> ... <strong>{createdKeys.length === 1 ? "License created" : ...}</strong><span>The new licenses are marked in your inventory.</span> <Button ...>{createdOnly ? "Show all licenses" : "Show created licenses"}</Button>'`
- `grep -rn 'clipboard' src/pages src/components → only src/components/Customer360Overlay.tsx:768 ('navigator.clipboard.writeText(JSON.stringify(customer, null, 2))')`

**Empfehlung:** Die erzeugten Key(s) im Erstellungshinweis in Mono auflisten, mit einem `Copy`-IconButton pro Key und einem 'Copy all' für Batches (Copied/Copy-JSON-Pattern aus Customer360Overlay wiederverwenden); zusätzlich einen Copy-Button in der Key-Zelle der Inventory-Tabelle und im Row-Detail-Drawer ergänzen.

#### F046 · License-Generator ist kein Form: kein Enter-Submit, window.alert()-Fehler

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** licenses

Der 'Create licenses'-Tab besteht aus ca. 8 inline-gestylten Flex-Spalten und einem einfachen onClick-Button. Validierungs- und API-Fehler werden über native alert()-Dialoge ausgegeben, anders als bei jedem anderen Form auf der Seite, das eine inline role=alert-Meldung verwendet.

*Auswirkung:* Enter in 'Quantity' bewirkt nichts; eine fehlgeschlagene Generierung öffnet einen Browser-Alert, der den Tab blockiert, nicht gestylt werden kann und von Screenreadern nicht im Kontext gelesen wird. Beschriftungen wie 'Quantity to Gen' und 'Max Uses (Usability)' wirken wie Entwickler-Kürzel.

Belege:
- `src/pages/LicensesPage.tsx:1327-1335 — '<Button size="md" icon={<Plus size={16} />} … onClick={handleGenerate}' with no enclosing <form> (grep '<form' finds only lines 954, 1392, 1569)`
- `src/pages/LicensesPage.tsx:492,496,530 — 'alert("Error generating license: " + …)', 'alert("Exception: " + e.message)', 'alert("Error: " + …)'`
- `src/pages/LicensesPage.tsx:1173-1240 — repeated '<div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>' wrappers, 'style={{ fontFamily: "monospace" }}' instead of the 'customer360-mono' class used at :1479`
- `src/theme/css/components.css:631-637 — the existing '.license-workflow-grid' / '.label-sm em' / '.license-workflow-error' pattern the issue modal uses`

**Empfehlung:** Den Generator in `<form onSubmit>` mit `.license-workflow-form/.license-workflow-grid` kapseln, alert() durch denselben `license-workflow-error`-Absatz mit role=alert ersetzen und die Labels in 'Quantity' und 'Seats (max uses)' umbenennen. Inline-Styles nach components.css verschieben.

#### F047 · Fünf verschiedene Dialog-Action-Rows; Sticky-Footer funktioniert nur bei einer

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** licenses, feedback, team, customers

Jeder Dialog baut seine Cancel/Primary-Reihe anders (Klasse, Reihenfolge, Primitive, Variante), und nur Teams `.form-footer` erhält die Sticky-Bottom-Behandlung, sodass lange Forms ihre Aktionen aus dem Sichtbereich scrollen. Der 'Send reply'-Button im Feedback ist nicht einmal als Primary-Aktion gestylt.

*Auswirkung:* Muscle Memory überträgt sich nicht zwischen Dialogen (Primary mal akzentgefüllt, mal ghost; mal 'Confirm', mal ein Verb). Auf dem Phone scrollt das 9-Felder-Issue-Modal und die Cancel/Issue-Buttons verschwinden unterhalb des Folds; ein Read-only-Member, der den Delete-Dialog öffnet, erhält einen per Permission deaktivierten Cancel-Button.

Belege:
- `src/theme/css/components.css:637 — '.license-workflow-actions { display: flex; … justify-content: flex-end; gap: 9px; }' (issue/activate modals)`
- `src/pages/LicensesPage.tsx:1665 and :1835 — '<div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 12 }}>' (delete/edit modals)`
- `src/components/CustomerAccessDialog.tsx:182 — '<div className="row-actions">' reuses the table row-action class; src/theme/consistency.css:807 patches it: '.customer-access-form .row-actions { margin-top: 10px; }'`
- `src/pages/TeamPage.tsx:538-549 — '<div className="form-footer"><button type="button" className="btn btn-secondary">Cancel</button><button className="btn btn-primary">' (raw buttons, bypasses ds/Button)`
- `src/components/FeedbackReplies.tsx:158-163 — '<Button type="submit" disabled={sending || !draft.trim()} icon={<Send size={16} />}>' with no variant; src/components/ds/Button.tsx:36 — 'variant = "ghost"' default`
- `src/theme/operations.css:64-70 — sticky footer applies only to '.kpi-modal-content .form-actions, .kpi-modal-content .form-footer'`
- `src/pages/LicensesPage.tsx:1675-1683 — delete confirm reads 'Confirm' and its Cancel carries 'permission="licenses.write"'`

**Empfehlung:** Eine `ModalActions`- (oder `DialogFooter`-)Komponente in src/components/ds/Modal.tsx ergänzen, die `Cancel` (ghost) + den Primary/Danger-Button rendert, die Sticky-Regel aus operations.css:64 anwendet und in allen sechs Dialogen verwendet wird. 'Confirm' in 'Delete license' umbenennen, 'Send reply' variant="primary" geben, die permission-Prop von Cancel-Buttons entfernen.

#### F048 · Required/Optional-Markierung und Fehlerdarstellung unterscheiden sich pro Form

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** team, customers, feedback, licenses

Das Issue-Modal versieht jedes Feld mit einem expliziten required/recommended/optional-Hinweis und zeigt einen gestylten Inline-Fehler; die Team- und Access-Forms verlassen sich auf das nackte HTML-Attribut `required` (native Browser-Bubble, kein sichtbarer Marker), und ihre Fehlerabsätze sind ungestylt oder inline-gestylt.

*Auswirkung:* Mitarbeiter erfahren erst nach dem Klick, welche Felder die Übermittlung blockieren; die native Validierungs-Bubble ist einzeilig, browser-gestylt und verschwindet beim Scrollen, während Server-Fehler in jedem Dialog anders aussehen.

Belege:
- `src/pages/LicensesPage.tsx:1395-1397 — '<span className="label-sm">Order ID <em>required</em></span>'; src/theme/css/components.css:632 styles it`
- `src/pages/TeamPage.tsx:400-405 — 'Email <input type="email" required …>' with no marker; scenario--d-team-add-member.png shows 'Display name' and 'Email' labels with no requirement hint`
- `src/components/CustomerAccessDialog.tsx:152-160 — 'Suspended until <input className="glass-input" type="datetime-local" … required' with no marker`
- `src/components/CustomerAccessDialog.tsx:181 — '{error && <p role="alert">{error}</p>}' (no class, plain text)`
- `src/components/FeedbackReplies.tsx:166-168 — '<p role="alert" style={{ color: "var(--danger)" … }}>'; src/theme/css/components.css:636 — the styled '.license-workflow-error' box used only by Licenses`

**Empfehlung:** Eine `Field`-Primitive in src/components/ds/ anlegen (Label, `hint="required"|"optional"|string`, Hilfetext, Error-Slot) sowie ein `FormError`, das die `.license-workflow-error`-Box rendert; TeamPage, CustomerAccessDialog und FeedbackReplies darauf migrieren und das `required`-Attribut für die Keyboard-Submit-Blockierung beibehalten.

#### F049 · 'Add panel member' nutzt das Full-Viewport-Modal für ein Fünf-Felder-Form

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** team

Der Member-Editor wird mit size="viewport" gerendert. Auf einem 1440px-Screen dehnt das zweispaltige Feldraster die Inputs auf ca. 640px und platziert die 'Panel access enabled'-Checkbox rund 630px von ihrem Label entfernt.

*Auswirkung:* Der Blickweg zwischen Label und Control ist lang, das Form wirkt wie eine Settings-Seite statt wie ein Dialog, und die Permission-Tabelle darunter schiebt den Save-Button ganz ans untere Ende des Screens.

Belege:
- `src/pages/TeamPage.tsx:366-371 — '<Modal open={!!editor} … size="viewport" className="team-editor" title={editor?.existing ? "Manage access" : "Add panel member"}'`
- `src/theme/workspace.css:1051-1056 — '.member-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }'`
- `scenario--d-team-add-member.png — Display name input spans x=67–705, the 'Panel access enabled' checkbox sits at x≈696 on the label row at x=67; the Cloudflare notice spans the full 1296px width`

**Empfehlung:** Die Standard-Modal-Größe mit einer max-width um 760px verwenden, `.member-fields` einspaltig machen (oder zwei schmale Spalten mit je ca. 320px begrenzen) und die Checkbox als `toggle-row` mit dem Control direkt rechts vom Text rendern. Die Permissions-Matrix als einklappbaren Abschnitt darunter belassen.

#### F050 · Dirty Form-Dialoge werden bei Scrim-Klick oder Escape ohne Rückfrage verworfen

**Schwere:** Mittel · **Aufwand:** S · **Seiten:** licenses, feedback, customers

Die Modal-Primitive schließt bei jedem Overlay-Klick und bei Escape; die Issue-, Access- und Feedback-Reply-Dialoge übergeben einen einfachen Close-Handler, sodass eingegebener Inhalt stillschweigend verloren geht.

*Auswirkung:* Ein Support-Agent, der eine lange private Antwort schreibt, oder ein Admin mitten im Neun-Felder-Issue-Form verliert alles durch einen versehentlichen Klick neben den Dialog. Auf Trackpads und auf Phones, wo der Scrim den Großteil des Screens ausmacht, ein häufiger Unfall.

Belege:
- `src/components/ds/Modal.tsx:143-149 — 'onClick={ open && onClose ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined }'`
- `src/pages/LicensesPage.tsx:1349 — 'onClose={() => (issueBusy ? undefined : setIssueOpen(false))}'`
- `src/components/FeedbackReplies.tsx:88-89 — 'onClose={sending ? undefined : onClose}' with a 'maxLength={4000}' textarea at :133`
- `src/components/CustomerAccessDialog.tsx:114-117 — 'onClose={() => { if (!busy) onClose(); }}'`

**Empfehlung:** Eine `dismissOnScrim`-Prop (Default true) an Modal ergänzen und für Form-Dialoge auf false setzen, oder Modal einen `isDirty`-Callback geben, der bei Scrim/Escape ein leichtgewichtiges 'Discard changes?'-Confirm auslöst. Den X-Button als expliziten Close beibehalten.

#### F051 · Suspend/Ban-Flow ist nur innerhalb von Customer 360 erreichbar

**Schwere:** Mittel · **Aufwand:** M · **Seiten:** access, customers

CustomerAccessDialog wird ausschließlich vom Customer-360-Workspace gemountet. Die 'App access'-Seite und das Kundenverzeichnis bieten daher keinen direkten Weg, eine Sperre zu starten; das Szenario-Skript konnte auf der Access-Seite kein Suspend/New/Add-Control finden.

*Auswirkung:* Um einen missbräuchlichen Nutzer zu blockieren, muss ein Admin den Kunden öffnen, das Laden von 360 abwarten und dann die Action-Bar finden. Drei Schritte für die eine dringende Aktion auf der Access-Seite.

Belege:
- `grep -rln CustomerAccessDialog src — only src/components/Customer360Overlay.tsx and the dialog itself`
- `src/components/Customer360Overlay.tsx:961-968 — '<Button permission="access.read" icon={<ShieldCheck />} onClick={() => setAccessOpen(true)}>Manage app access</Button>' (inside '{customer && (<div className="customer-action-bar">')`
- `scratchpad/scenarios.log — 'd-access-suspend ["NOT FOUND button suspend|new|add"]'; desktop-dark-plain--access--1.png shows a directory table with no access action`

**Empfehlung:** Denselben CustomerAccessDialog als Row-Action ('Manage access') auf der Access-Seite und im Kundenverzeichnis anbieten und den Anchor der Zeile übergeben; den C360-Button beibehalten. Den aktuellen Modus (Allowed / Suspended until / Banned) als Badge in der Zeile anzeigen, damit der Zustand vor dem Öffnen sichtbar ist.

#### F070 · Dialoge fokussieren beim Öffnen den Close-Button statt des ersten Feldes

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** licenses, team, feedback, customers, overview

Jeder Dialog setzt den Focus auf den X-Button. Tastaturnutzer müssen einmal Tab drücken, bevor sie tippen können, und ein reflexhaftes Enter direkt nach dem Öffnen eines Formular-Dialogs schließt diesen.

*Auswirkung:* Kleine, aber konstante Reibung für Desk-Mitarbeiter, die diese Dialoge viele Male täglich nutzen; Enter-on-open, das ein Formular schließt, ist unerwartet.

Belege:
- `src/components/ds/Modal.tsx:112-114 — 'const frame = window.requestAnimationFrame(() => { (closeRef.current ?? dialogRef.current)?.focus(); });'`
- `src/components/ds/Modal.tsx:183-191 — the close button is the first focusable element in the dialog`

**Empfehlung:** Eine `initialFocus`-Prop (Selector oder ref) zu Modal hinzufügen; standardmäßig das erste `input, select, textarea` innerhalb von `.kpi-modal-content` fokussieren, sofern vorhanden, sonst den Close-Button.

#### F071 · Customer-360-Header nicht sticky; Escape nur bei Fokus im Bereich

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** customers

Die eingebettete Customer-360-Seite hat eine nicht-sticky Kopfzeile/Action-Bar. Nach dem Scrollen durch die Tabs sind die Aktionen 'Back to workspace', 'Manage licenses' und 'Manage app access' nicht mehr erreichbar. Zusätzlich hängt der Escape-Shortcut davon ab, wo der Fokus gerade liegt, da der Handler nur innerhalb des Bereichs registriert ist.

*Auswirkung:* Support-Mitarbeiter, die 'Support & history' durchsehen, müssen zum Handeln zurück nach oben scrollen; ein Klick auf den Seitenkörper verschiebt den Fokus aus dem Bereich, wodurch Escape ohne Rückmeldung nicht mehr funktioniert.

Belege:
- `src/theme/consistency.css:887-892 — '.customer-workspace-head { display: grid; justify-items: start; gap: 18px; margin-bottom: 18px; }' (no position: sticky; the only sticky rules in workspace.css:322/792 belong to other elements)`
- `src/components/Customer360Overlay.tsx:926-936 — '<section className="customer-workspace" … onKeyDown={(event) => { if (event.key === "Escape" && … ) onClose(); }}' (section-scoped key handler)`
- `src/components/Customer360Overlay.tsx:918-923 — 'openCustomerAction()' calls 'onClose()' then 'navigateCustomerUrl(destination)', leaving the workspace to issue a license`

**Empfehlung:** `.customer-workspace-head` + `.customer-action-bar` als sticky Top-Bar umsetzen (position: sticky; top: 0; background: var(--surface-1)) mit kompakter Höhe im gescrollten Zustand. Den Escape-Handler auf window registrieren (abgesichert durch die bestehende Open-Modal-Prüfung), analog zur bereits vorhandenen Umsetzung in Modal.tsx.

#### F072 · Initialpasswort-Feld ohne Reveal-Toggle und ohne Generate-Helfer

**Schwere:** Niedrig · **Aufwand:** S · **Seiten:** team

Im App-Auth-Modus muss der Owner das Initialpasswort eines neuen Members blind eingeben. Es gibt weder eine Möglichkeit, die Eingabe anzuzeigen, noch ein starkes Passwort zu generieren, obwohl die Codebase bereits ein Eye/EyeOff-Pattern enthält.

*Auswirkung:* Tippfehler im unsichtbaren Feld führen dazu, dass sich der neue Member nicht anmelden kann und der Owner den Ablauf wiederholen muss; geringe Häufigkeit (wenige Members), daher niedrige Severity.

Belege:
- `src/pages/TeamPage.tsx:433-440 — '{editor.existing ? "Reset password (optional)" : "Initial password"} <input type="password" autoComplete="new-password" required={!editor.existing} …>'`
- `src/pages/LicensesPage.tsx:5-6 — 'Eye, EyeOff' imported from lucide-react for the key-reveal pattern`

**Empfehlung:** Einen Show/Hide-IconButton sowie einen 'Generate'-Button ergänzen, der ein zufälliges 16-Zeichen-Passwort einträgt und sichtbar macht, damit der Owner es an den Member weitergeben kann.

## Roadmap

### Phase 1 — Sichtbare Defekte (1–2 Wochen): Alle hohen Befunde beheben, die durch gezieltes Löschen oder kleine Regeln in consistency.css/Navbar lösbar sind, ohne die Architektur anzufassen.

- Semantik-Remap, .status-dot-Accent und Button-Outline-Block in consistency.css löschen; Live-Dot auf --success (F001, F003, F004)
- Sticky thead opak (--surface-2), tote backdrop-filter-Regel entfernen (F006, F044)
- feedbackReplies.css-Overrides löschen (F012)
- Sidebar-Rhythmus verdichten oder Settings in den Footer, Bottom-Fade + scrollIntoView; .sb-close nur mobil rendern (F008, F024, F029)
- Preview-Aside und System-Tab aus SettingsPage entfernen (F032, F033)
- Errors-Seite auf einen Zustand reduzieren, Zeilen als Button (F035, F042, F025)
- Login autoComplete/name/id, minLength nur im Bootstrap-Modus (F026, F066)
- Focus-within-Regel für Suchfeld/Dropdown-Filter (F027)
- PAGE_META für Nav/Breadcrumb/H1, Marketing-Subtitel entfernen, Sentence Case, Brand-/Tab-Titel, Terminologie 'customer'/'member' (F030, F031, F063, F064, F034)
- Traffic-Margin, numerische Spalten, RelativeTime, Dirty-Guard, Initialfokus (F037, F039, F038, F050, F070)
- Accent-Presets auf bestehende Hues beschränken als Übergang (F002, Teil 3)

### Phase 2 — Primitives ausbauen (3–5 Wochen): Die fehlenden oder unvollständigen DS-Primitives so ausbauen, dass Seiten keinen Grund mehr haben, sie zu umgehen, und die mittleren Befunde mit einer Änderung pro Primitive verschwinden.

- DataTable/TableFrame: sticky Aktionsspalte, sort/onSort mit SortHeader, align, scope=col, caption/aria-label, CSS-Höhe statt ResizeObserver, mobileLayout (F007, F013, F023, F028, F040)
- useAccent schreibt --on-accent/--accent-text nach Kontrastmessung, --al-Clamp pro Hue-Band (F002)
- Overview-/Traffic-Chart: ChartLegend, Modifier-Wheel + Brush/+/−, Select im Header, minPointSize (F010, F011, F036)
- Globale Suche als Popover oder Rückstufung auf Seiten-SearchInput (F009)
- KpiStatCard als einzige Kachel (MonitoringSummary entfernen, density=compact, Ellipsis-Sub, min-height) (F015, F043, F069)
- ds/Tabs und ds/SegmentedControl, ds/Input + ds/Field + FormError, ds/Skeleton, EmptyState action-Slot (F021, F057, F048, F041, F068)
- ModalActions in Modal.tsx, alle sechs Dialoge migrieren; Member-Editor auf Standardgröße (F047, F049)
- Licenses: 'Issue license' im PageHeader, Generator als Form im Issue-Modal, Keys kopierbar (F014, F046, F045)
- CustomerAccessDialog als Row-Action auf Access/Customers, C360-Header sticky, Escape auf window (F051, F071)
- TeamPage/SettingsPage/Navbar/Licenses/Access auf <Button>/<IconButton>, btn-secondary → ghost, ESLint-Regel gegen rohe <button> (F020)
- Sign-out über einen Pfad, Passwort-Reveal/Generate im Member-Editor (F065, F072)
- Touch-Targets 44px bei pointer:coarse, Inputs 16px unter 600px, Rail-Modus 901–1200px (F060, F061, F062)

### Phase 3 — Architektur konsolidieren (laufend, 4–8 Wochen): Von sieben CSS-Layern auf tokens/base/components reduzieren, sodass jeder Selektor und jedes Token genau einmal deklariert ist und Phase 1/2 nicht mehr regressieren können.

- consistency.css/operations.css als Truth einfrieren, gewinnende Token-Werte nach tokens/colors|typography|spacing.css übertragen, Token-Blöcke in index/app-glue/workspace/operations/consistency löschen, Datei-Header korrigieren (F017, F018, F016, F053)
- Doppelte Rule-Heads aus index.css entfernen (.btn*, .badge*, .data-table*, .kpi-*, .panel, .gdrop-*), --glass-*-Bridge auflösen, Ziel drei Dateien (F005)
- !important auf eine kommentierte Ausnahmeliste reduzieren, globales box-shadow:none entfernen (F019)
- Codemod: px-Schriftgrößen → --fs-*, Regeln < 10px entfernen, --fs-micro auf 11px, .mono-value-Klasse (F016, F055)
- Farbliterale → var(--token), WorldHeatmap über useChartColors (F058)
- Inline-Styles in Errors/Licenses/Access durch Kompositionsklassen ersetzen, DetailGrid mit KvList zusammenführen, ESLint-Regel für style={{ (F022)
- Modal-Klassen zu .dialog-* umbenennen, tote .modal-*-Regeln löschen; PageHeader sub/kicker entscheiden, 'access'-Key entfernen (F059, F054, F067)
- Text-Leiter spreizen (--text-4), Workspace-Surface bei animiertem Hintergrund auf ca. 55% (F052, F056)
- Dead-Rule-Pass (PurgeCSS-Report) über index.css und Rule-Head-Zählung als Fortschrittsmetrik

## Methode

Sechs Auditoren haben je eine Dimension untersucht: Visual System, Komponenten & CSS-Architektur, Accessibility & Responsive, Navigation/Content/Shell, Daten/Charts/States sowie Formulare/Dialoge/Flows. Grundlage waren der Quellcode (React 19, sieben CSS-Layer, DS-Primitives in src/components/ds) und eine Screenshot-Matrix aus 203 Aufnahmen: vier Basis-Sets (Dark/Network Hue 310, Dark/Plain Hue 262, Light/Plain, Mobile 390×844) über 15 Seiten mit Scroll-Positionen plus 41 Interaktions- und Viewport-Szenarien (Tablet, 1100px-Laptop, 1920px, Tab-Fokus, offene Modals und Dropdowns), aufgenommen in Headless Chrome mit Fixture-Daten; der Login-Screen wurde nur im Quellcode geprüft. Jeder Befund trägt Datei-/Zeilen-Belege und, wo visuell, Screenshot-Namen; bewusste Nicht-Befunde aus dem früheren Motion-Audit wurden nicht erneut berichtet. Aus Kostengründen gab es keine separate adversariale Verifikation pro Befund; die Belege sind im Report direkt nachprüfbar, weshalb alle 72 Befunde als 'unverified' geführt werden. Von 72 Rohbefunden blieben nach Deduplikation 72 erhalten, keiner wurde verworfen oder bestritten; die Scorecard leitet sich aus Anzahl und Schwere der Befunde je Dimension ab.

Zahlen: 6 Auditoren → 72 Befunde (nicht einzeln gegengeprüft, Belege im Report nachprüfbar). Screenshots: 203.