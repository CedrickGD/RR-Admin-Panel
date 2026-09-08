/**
 * DS tabs — the underline sub-view switcher.
 *
 * The console had three hand-rolled variants of "pick a sub-view": the
 * `.workspace-tabs` underline (Licenses / Team / Settings), the `.seg-control`
 * pills (Access, Errors, Feedback, Heatmap, Licenses, Traffic) and the
 * `.monitor-scopes` filter pills (Session history, Live). Two primitives own
 * that job now: `Tabs` when the choice swaps the panel below it,
 * `SegmentedControl` when it filters one list in place.
 *
 * Keyboard: roving tabindex — only the selected tab is tabbable, Arrow keys
 * (plus Home/End) move focus and select. Automatic activation is the right
 * WAI-ARIA variant here because every panel is already in memory; no tab
 * costs a fetch.
 *
 * ICON APPROACH: as everywhere in ds/, pass a lucide-react element
 * (icon={<KeyRound />}); the DS size (14px) is injected when it has none.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { sizedIcon } from "./sizedIcon";

/**
 * `K` is the page's own key union (`TabItem<ViewKey>[]`). Leaving it at the
 * default `string` is what forced every call site to launder the key back with
 * an unchecked `as`, which also swallowed a key in `items` that the state union
 * never had — the page then switched to a view it has no branch for.
 */
export interface TabItem<K extends string = string> {
  key: K;
  /** Sentence case, e.g. "Active sessions" — never Title Case (docs/panel-workspace.md). */
  label: string;
  /** Optional leading lucide-react element. */
  icon?: ReactNode;
  /** Optional trailing count pill, e.g. unread feedback. Hidden when 0. */
  count?: number;
  /**
   * Spells out an abbreviated `label` (Heatmap's "NA" → "North America").
   * Only for abbreviations — a full label needs no tooltip.
   */
  title?: string;
  /**
   * `id` of the panel this tab switches to. The tab then points at it with
   * `aria-controls` and takes the id `${panelId}-tab`, which the panel names
   * itself with (`role="tabpanel" aria-labelledby`). Without it a screen reader
   * hears "tab 1 of 3" with no way to reach the content it controls.
   */
  panelId?: string;
}

export interface TabsProps<K extends string = string> {
  /** Selected item key. */
  value: K;
  onChange: (key: K) => void;
  items: readonly TabItem<K>[];
  /** Required: names the tab list for screen readers, e.g. "License workspace". */
  "aria-label": string;
  className?: string;
}

/**
 * Shared roving-tabindex keyboard handling for Tabs and SegmentedControl.
 * Returns the ref the container must carry and its keydown handler.
 */
export function useTabRoving<K extends string>(
  items: readonly TabItem<K>[],
  value: K,
  onChange: (key: K) => void,
) {
  const listRef = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (items.length === 0) return;
    const current = items.findIndex((item) => item.key === value);
    let next = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (Math.max(current, 0) + 1) % items.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (Math.max(current, 0) - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    if (items[next].key !== value) onChange(items[next].key);
    // Focus follows selection: the roving tabindex has just moved to `next`.
    listRef.current?.querySelectorAll<HTMLButtonElement>("button").item(next)?.focus();
  }
  return { listRef, onKeyDown };
}

/** Underline tabs for switching the sub-view of a page. */
export function Tabs<K extends string>({
  value,
  onChange,
  items,
  className = "",
  "aria-label": ariaLabel,
}: TabsProps<K>) {
  const { listRef, onKeyDown } = useTabRoving(items, value, onChange);
  // Roving tabindex needs exactly one tabbable stop; if `value` matches nothing
  // (a filtered-away tab) the first item keeps the group reachable by keyboard.
  const noneSelected = !items.some((item) => item.key === value);
  return (
    <div
      ref={listRef}
      className={`ds-tabs${className ? ` ${className}` : ""}`}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            title={item.title}
            role="tab"
            id={item.panelId ? `${item.panelId}-tab` : undefined}
            aria-controls={item.panelId}
            aria-selected={selected}
            tabIndex={selected || (noneSelected && index === 0) ? 0 : -1}
            className={`ds-tab${selected ? " is-active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.icon ? sizedIcon(item.icon, 14) : null}
            <span>{item.label}</span>
            {item.count ? <span className="ds-tab-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
