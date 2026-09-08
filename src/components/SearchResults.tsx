/**
 * Suggestion popover under the workspace search field.
 *
 * The header search used to be write-only: typing changed nothing until Enter,
 * and on a page that did not show what was being searched it changed nothing at
 * all. This lists what the query already matches in the records the page has
 * loaded, grouped by type, and falls back to a single row that says what Enter
 * will do. It never fetches: everything it shows is data already on screen.
 *
 * Purely presentational — the field owns the query, the open state and the
 * active index (see Navbar), because the keyboard contract lives on the input.
 */
import { CornerDownLeft } from "lucide-react";
import type { SearchRecord } from "../hooks/useWorkspaceSearch";

export interface SearchResultsProps {
  /** Id of the listbox; the input points at it with aria-controls. */
  id: string;
  /** Names the list for screen readers, e.g. "Customer search results". */
  "aria-label": string;
  /** Flat, ordered, already capped list of matches. */
  options: SearchRecord[];
  /** Index of the active option, or -1. `options.length` is the hint row. */
  activeIndex: number;
  /** Shown when nothing matched: what Enter does, or why there is nothing. */
  hint?: string;
  /** True when the hint row is selectable (Enter runs the page-level search). */
  hintSelectable?: boolean;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

/** DOM id of one option — the input mirrors it in aria-activedescendant. */
export function searchOptionId(listId: string, index: number): string {
  return `${listId}-o${index}`;
}

export function SearchResults({
  id,
  "aria-label": ariaLabel,
  options,
  activeIndex,
  hint,
  hintSelectable = false,
  onHover,
  onSelect,
}: SearchResultsProps) {
  // Consecutive rows of the same type share one heading; the order is the
  // caller's relevance order, so groups are contiguous by construction.
  const groups: Array<{ label: string; items: Array<{ record: SearchRecord; index: number }> }> =
    [];
  options.forEach((record, index) => {
    const current = groups[groups.length - 1];
    if (current && current.label === record.group) current.items.push({ record, index });
    else groups.push({ label: record.group, items: [{ record, index }] });
  });
  const hintIndex = options.length;

  return (
    <div className="search-results" id={id} role="listbox" aria-label={ariaLabel}>
      {groups.map((group) => (
        <div className="search-results-group" role="group" aria-label={group.label} key={group.label}>
          <p className="search-results-group-label" aria-hidden="true">
            {group.label}
          </p>
          {group.items.map(({ record, index }) => (
            <button
              key={record.id}
              type="button"
              id={searchOptionId(id, index)}
              role="option"
              // Focus never leaves the input: it owns the combobox contract
              // (aria-activedescendant, the Escape handler, Tab out of the
              // field), so the rows must not sit in the tab order themselves.
              tabIndex={-1}
              aria-selected={index === activeIndex}
              className={`search-results-item${index === activeIndex ? " is-active" : ""}`}
              // Keeping focus on the input is what lets a click land at all: the
              // popover closes on blur, and a button steals focus on mousedown.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(index)}
            >
              <span className="search-results-label">{record.label}</span>
              {record.detail ? (
                <span className="search-results-detail">{record.detail}</span>
              ) : null}
            </button>
          ))}
        </div>
      ))}
      {hint ? (
        hintSelectable ? (
          <button
            type="button"
            id={searchOptionId(id, hintIndex)}
            role="option"
            tabIndex={-1}
            aria-selected={activeIndex === hintIndex}
            className={`search-results-hint${activeIndex === hintIndex ? " is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => onHover(hintIndex)}
            onClick={() => onSelect(hintIndex)}
          >
            <CornerDownLeft size={13} aria-hidden="true" />
            <span>{hint}</span>
          </button>
        ) : (
          <div className="search-results-empty" role="option" aria-selected={false} aria-disabled>
            {hint}
          </div>
        )
      ) : null}
    </div>
  );
}
