/**
 * DS PageToolbar — the ONE filter place on a page.
 *
 * Handoff 2026-09-12 §2.3: filters were scattered over four different homes
 * (PageHeader right, panel head right, a bespoke `.filters` row on Heatmap, a
 * bespoke `.monitor-filter-row` on Live), search existed in three separate
 * implementations, and "clear filters" was on some pages only, sometimes only
 * inside an empty state. This row replaces all of that: one strip directly
 * above the table or list it filters — below the KPI tiles, so the tiles stay
 * the page summary and the controls sit next to what they change.
 *
 * Slots
 *  - `left`   — scope or view: a ds/SegmentedControl (filters) or ds/Tabs.
 *  - `search` — a ds/SearchInput. Never a raw <input type="search">.
 *  - `filters`— ds/Select only. Pass GlassDropdown nowhere; it is an internal
 *               detail of ds/Select, and mixing the two is what made `align`
 *               inconsistent in the first place.
 *  - Reset    — rendered by this component, not by the page, so it looks and
 *               behaves the same everywhere. It appears only when `canReset`,
 *               i.e. when at least one filter differs from its default.
 *
 * Heights: every control inside is --control-h (34px) — see
 * theme/css/components.css. Colour: nothing accented except the active
 * segment; Reset is a ghost button.
 */
import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "./Button";

export interface PageToolbarProps {
  /** Scope / view switch — ds/SegmentedControl or ds/Tabs. */
  left?: ReactNode;
  /** ds/SearchInput. Gets the full width first on a phone. */
  search?: ReactNode;
  /** ds/Select filters, in the order they narrow the list. */
  filters?: ReactNode;
  /** Shown only while `canReset` — puts every filter back to its default. */
  onReset?: () => void;
  /** True when at least one control differs from its default. */
  canReset?: boolean;
  /** Names the row for screen readers, e.g. "Customer filters". */
  "aria-label": string;
}

export function PageToolbar({
  left,
  search,
  filters,
  onReset,
  canReset = false,
  "aria-label": ariaLabel,
}: PageToolbarProps) {
  return (
    <section className="page-toolbar" aria-label={ariaLabel}>
      {left ? <div className="page-toolbar-left">{left}</div> : null}
      {search ? <div className="page-toolbar-search">{search}</div> : null}
      {filters || (onReset && canReset) ? (
        <div className="page-toolbar-filters">
          {filters}
          {onReset && canReset ? (
            <Button variant="ghost" size="sm" icon={<RotateCcw />} onClick={onReset}>
              Reset
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
