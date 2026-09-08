/**
 * DS segmented control — the pill row that filters one list in place
 * ("Everyone / Online / Offline", "Standard | Master key", "By customer / By
 * failure"). Same props as ds/Tabs; use Tabs when the choice swaps the panel
 * below, SegmentedControl when it narrows what the panel already shows.
 *
 * Semantics: a filter is a choice among options, not a set of tab panels, so
 * the default roles are radiogroup/radio. Pass as="tablist" for the few places
 * that really do switch panels but want the pill look (Feedback's status row).
 * Keyboard is the roving tabindex from ds/Tabs in both cases.
 */
import { sizedIcon } from "./sizedIcon";
import { useTabRoving, type TabItem } from "./Tabs";

export interface SegmentedControlProps {
  value: string;
  onChange: (key: string) => void;
  items: TabItem[];
  /** Required: names the group for screen readers, e.g. "Activity filter". */
  "aria-label": string;
  /** "radiogroup" (default, a filter) or "tablist" (pill-styled panel switch). */
  as?: "radiogroup" | "tablist";
  className?: string;
}

export type { TabItem };

/** Pill segmented control. */
export function SegmentedControl({
  value,
  onChange,
  items,
  className = "",
  as = "radiogroup",
  "aria-label": ariaLabel,
}: SegmentedControlProps) {
  const { listRef, onKeyDown } = useTabRoving(items, value, onChange);
  const tabs = as === "tablist";
  // See ds/Tabs: one tabbable stop even when `value` matches no item.
  const noneSelected = !items.some((item) => item.key === value);
  return (
    <div
      ref={listRef}
      className={`ds-seg${className ? ` ${className}` : ""}`}
      role={as}
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
            role={tabs ? "tab" : "radio"}
            aria-selected={tabs ? selected : undefined}
            aria-checked={tabs ? undefined : selected}
            tabIndex={selected || (noneSelected && index === 0) ? 0 : -1}
            className={`ds-seg-btn${selected ? " is-active" : ""}`}
            onClick={() => onChange(item.key)}
          >
            {item.icon ? sizedIcon(item.icon, 13) : null}
            <span>{item.label}</span>
            {item.count ? <span className="ds-seg-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
