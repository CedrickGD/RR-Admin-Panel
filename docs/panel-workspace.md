# Panel workspace

## Navigation and appearance

Customers owns the directory, full Customer 360 workspace, licenses/orders and app suspensions. Monitoring owns live sessions, history and analytics. Support owns feedback and errors. Communication owns announcements. Administration owns panel members and personal settings.

The sidebar has two widths, and the narrow one is a real mode, not a leftover. Between 901px and 1200px the 244px sidebar leaves too little room for the wide record tables, so the 64px icon rail (`html.sb-collapsed`) is the default in that band; the toggle in the sidebar header writes `rr:sidebar-rail` to local storage and that stated preference then holds at every width. `--sb-w` and every offset that reads it — the top bar, the main column, Customer 360 — follow the class, so nothing positions against a hardcoded sidebar width. A new nav item must carry a `title` while the rail is collapsed: the label is hidden there and the tooltip is all that is left of it.

The top-bar search belongs to the page under it. Its scope follows the route (Customers, Licenses, Session history, Live), each scope keeps its own query in session storage with its own placeholder, and leaving a scope drops that scope's query rather than carrying a stale filter onto the next page. The popover only matches records the page has already loaded — a page publishes them with `useSearchRecordSource(scope, records)` from `src/hooks/useWorkspaceSearch.ts`, mapped through the per-scope mappers there — so it never issues a query of its own. Picking a result opens the Customer 360 workspace through `openCustomerWorkspace()` (`src/utils/customerNavigation.ts`), the single entry point for every row that opens a customer; it does not navigate to another page.

The dark and light themes use neutral surfaces with colored accents. Settings offers a plain background, animated RGB fade, a custom JPG/PNG/WebP image, or an animated network inspired by RazorReaper. Network speed, density, connection distance, intensity and offsets are adjustable. Background motion respects the operating system's reduced-motion preference and pauses in hidden tabs. Images are resized/compressed before browser storage; neither images nor appearance preferences are uploaded to the backend or shared with other members/devices.

The accent hue is free (0–360°) and the derived shades follow it. `src/utils/accentContrast.ts` picks, per hue and theme, the accent lightness (`--al`), the ink on top of it (`--on-accent`: white or a hue-tinted dark) and the accent-coloured text (`--accent-text`), so every hue clears WCAG AA (4.5:1); the values are written inline on `<html>` whenever the hue or theme changes. The formulas in `src/theme/tokens/accent.css` and `src/theme/workspace.css` are the pre-hydration fallback — keep them in step, never hardcode `#fff` on an accent background. Presets cover green through pink; red and orange stay out because they collide with the danger and warning colours, not because of contrast.

## Panel access

The owner manages access from Administration → Panel access. Administrators have all business permissions, Support has customer/support reads and feedback editing, and Read only grants business reads. Only the owner can manage panel members. Individual Allow/Deny overrides can have an expiry; after expiry the underlying role applies again. Denying a section's read permission also denies its write permission. An account expiry or disabled access blocks login and existing sessions.

The server checks current permissions and revocation on every protected request. A same-origin event stream refreshes open panels within approximately two seconds while connected. Ending one session preserves others; ending all sessions invalidates even older tokens which have not yet appeared in the session list. A kick requires a fresh login, while disabling the member also prevents new logins. Changes are audited without passwords or authentication tokens. Owner access cannot be disabled or edited through this screen.

For in-app authentication, the first existing admin by database ID becomes owner. For Cloudflare Access, the first `ACCESS_ADMIN_EMAIL` becomes owner; a single `ACCESS_ALLOWED_EMAIL` works as the existing fallback. Configure an explicit admin email if several Access identities are allowed. The first owner visit to Panel access imports existing accounts, preserving passwords and existing viewer restrictions. It does not modify customer accounts, licenses or RazorReaper app access.

In-app members get a password set by the owner. Cloudflare Access members still need admission through the upstream Access application policy; adding them in the panel does not change that policy. After ending an Access session, use the sign-in link to obtain a fresh Access token.

## Deployment

Ship the frontend and matching Functions/NAS API together. `panel_members`, `panel_sessions` and `panel_audit` are additive tables created automatically on first use, with equivalent definitions in `schema.sql`. Back up the production database before the normal deployment process. No customer data migration is required. Mutable access management requires the configured D1/SQLite database; static Access deployments without a database retain legacy allowlist authentication.

Validation: `npm run check` in the repository, and `npm run build` in `deploy/nas/rr-api`. Permission integration tests use isolated in-memory SQLite and cover live changes, expiry, escalation prevention, session revocation and Access identities.

## Charts

Every plot with more than one series carries a `<ChartLegend>` (`src/components/charts/ChartLegend.tsx`) in the panel header, wrapped with the meta stats and the range controls in a `.chart-head-tools` cluster passed to the panel's `right` slot — controls never float over the plot area. Swatch colours are the values the series is drawn with (`--chart-users`, `--chart-sessions`, `--chart-errors`, or a `useChartColors` value); a forecast series gets `dashed`.

Zooming a chart never hijacks the page: `useChartZoom` consumes the wheel only while Ctrl/⌘ is held or the plot itself has focus, and the plot is a focusable `.chart-zoom` element that also answers `+`, `-` and `0`. Pointer-free users get the same range through the `−` / `+` icon buttons and a Reset button that is always rendered and disabled at full range.

## Record tables

Every list page renders through `TableFrame`/`DataTable` (`src/components/ds/`). A table whose last column holds the row action or the expand chevron passes `stickyActions`, which pins that column to the right edge and shows a shadow only while content is still hidden underneath — the action can no longer be scrolled off screen. The same tables pass `mobileLayout="stack"`, so below 900px each row becomes a card: first column the title, last column the footer, everything between a `label ……… value` line driven by the cell's `data-label`. Give every body cell a `data-label` matching its header, or the card row loses its name.

Sorting is one contract: a column is sortable when the page hands `SortHeader` (or a `DataTable` column with `sortable`) a `sort={{ key, direction }}` and an `onSortChange`. The header shows an ArrowUp/ArrowDown on the active column and a dimmed ChevronsUpDown on every other sortable one, so which columns can be sorted is visible without hovering; `aria-sort` is always set, "none" when inactive. The page owns the direction toggle. Sorting a list never lives in a separate Select.

Each table names itself with a visually hidden `<caption className="table-caption">` (or `DataTable`'s `caption` prop) and every `<th>` carries `scope="col"`. A disclosure control states what it will do: `Show session history for …` / `Hide session history for …`, on the row button and the chevron alike.

Loading is a skeleton, never a sentence: `SkeletonRows` inside the `<tbody>`, `Skeleton` for a single block or a single not-yet-known cell, `<KpiStatCard loading />` for a tile. The table head, the KPI row and the panel keep their shape while data lands, and a cell never states a value it has not loaded — an unknown access state is a skeleton, not "Allowed". A text loader is only for an inline sub-fetch inside an already-expanded row. An empty state that has a next step carries it in `EmptyState`'s `action` slot — "Clear filters" on a filtered list, "Add member" on Panel access — instead of a bare paragraph.

Every KPI row is `KpiStatCard` (`src/components/KpiStatCard.tsx`) in a `.stat-grid`; the denser monitoring rows on Live sessions and Session history pass `density="compact"`. There is no second tile component — `MonitoringSummary` and its `.monitor-metric` styles are gone.

## Customer workspace

One dialog owns app access: `CustomerAccessDialog` takes a `CustomerAccessTarget` (identity, hwid, install_id, label, and whether the customer has paid) and is opened from the customer directory row and from Customer 360's "Manage app access" — the same allowed / suspend-until / ban form in both places, with the paid warning built in. The directory's Status column states it before you open anything: a Badge reading "Banned" or "Suspended until \<day\>" beside the support state (an error count, Down, Degraded), and a dash when nothing is wrong; the full wording is the cell title and, on the stacked phone card, two labelled lines.

There is no separate App access page. The directory's "Suspended or banned" scope is the enforcement overview: it loads `/api/admin/access` (permission `access.read`, the same gate the old page had), folds in the restrictions whose identity has no telemetry rollup row, and carries the reason and who issued it as a Restriction column. `#/access` still resolves — to the directory — so old bookmarks and a stored `rr:last-page` of `"access"` keep working, but `"access"` is not a `PageKey`, has no `PAGE_META` label and has no sidebar item; see `src/utils/pageRouting.ts`.

Customer 360 embedded in the workspace scrolls inside itself, so its identity and action bar sit in one sticky `.customer-workspace-bar`, which goes opaque and compact once the record scrolls under it. Escape closes the workspace from anywhere on the page (a window listener that stands down while a dialog is open, exactly like `ds/Modal`), not only while focus happens to be inside it.

## Tabs and filters

Two primitives switch sub-views: `ds/Tabs` (underline) when the choice swaps the panel below it, `ds/SegmentedControl` (pills) when it narrows what the panel already shows. Both require an `aria-label`, both roam the tab index with the arrow keys. `SegmentedControl` defaults to radiogroup semantics for a filter and takes `as="tablist"` for the few pill rows that really do switch panels (Feedback's status row, Errors' grouping switch). Do not hand-roll another `.seg-control` or `.workspace-tabs` row.

## Forms and dialogs

Every field is a `ds/Field` wrapping a `ds/Input`, `Textarea` or `Select` (`src/components/ds/`). The label carries a visible `required` / `optional` marker — a field with a sensible default (a plan, a seat count) carries none — and the control keeps its native `required` attribute so Enter still blocks an incomplete submit. A form is a real `<form onSubmit>`: Enter submits, and nothing reports itself through `window.alert()`. A failed field takes `Field`'s `error`, a failed save takes `FormError`, and the dialog stays open with the reason next to the work.

Every dialog footer is `ModalActions` (`src/components/ds/Modal.tsx`): Cancel first as a ghost button, the committing primary or danger button last, sticky at the bottom of the scrolling body. Cancel never carries a `permission` — leaving a dialog is not a privilege — while the committing button keeps it. A dialog is sized for its form, not for the viewport: the member editor is the default width with one column of fields, its checkbox in a `toggle-row` beside its label, and the permission matrix folded into a `<details>` below.

Controls come from the design system, never from a bare `<button>`: `ds/Button` (which carries the permission gate and the variant contract), `ds/IconButton` for a square icon action, `ds/RecordLink` for the link-styled name inside a record cell. `tests/no-raw-buttons.test.ts` enforces it and lists the remaining exceptions with a reason and a count that may only shrink.

A page has one primary action and it lives in the `PageHeader` right slot on every tab — "Issue license" on Licenses opens the audited issue dialog, pre-filled from the current lookup; the "Bulk generate" tab stays the batch/master path and says so. Anything an operator has to hand to a customer is copyable: a license key carries a Copy icon button wherever it is shown (creation notice, inventory row, lookup card, issue result), a batch adds "Copy all", and the control confirms with a checkmark.

## Copy rules

Sentence case everywhere: page titles, buttons, table headers, field labels, badges, empty-state titles and modal kickers. Only product and proper nouns keep a capital (RazorReaper, Discord, Cloudflare Access, HWID). Write "Create licenses", "Add member", "Sign out" — not "Create Licenses" or "DANGER ZONE".

Buttons name their action, verb first: "Add member", "Delete", "End session", "Save access". Avoid "OK", "Confirm" and "Submit". The busy state repeats the verb with a real ellipsis ("Deleting…", "Saving…"). Sign-in wording is "Sign in" / "Sign out", never "Login" or "Log out".

One name per page. `PAGE_META` in `src/pageMeta.ts` owns it for the sidebar item, the breadcrumb, the page H1 and the browser tab title; a top-level page passes `page="<key>"` to `PageHeader` instead of its own `title`. A panel inside a page never repeats the page name — Customers holds a "Directory" panel, not a "Customer Directory" one.

Subtitles only when they carry a fact the title does not: "Checked automatically every 15 seconds", "Every collected error, linked to the customer it came from." Mood lines belong on a landing page, not on a console.

Two words for people. A **customer** uses the RazorReaper app and is called that in KPIs, table columns, empty states and search placeholders. A **member** is a panel account and appears only on Panel access. A **session** stays the unit of activity in both worlds.

Relative timestamps always carry the absolute one: use `<RelativeTime iso={…} />` from `src/components/ds/RelativeTime.tsx` instead of a bare `timeAgo()`.
