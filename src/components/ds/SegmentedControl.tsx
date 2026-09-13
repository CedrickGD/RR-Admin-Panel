/**
 * DS segmented control — the pill row that filters or re-views one list in
 * place ("Everyone / Online / Offline", "Customers / Failures", "Live / All
 * time"). It belongs in a page's ds/PageToolbar.
 *
 * Page SECTIONS (Licenses, Settings, Team) are ds/Tabs. The two are never used
 * for the same job on one page (handoff §2.3), so this control has no tablist
 * mode: a filter is a choice among options, and its roles are always
 * radiogroup/radio. Keyboard is the roving tabindex from ds/Tabs.
 */
import { sizedIcon } from "./sizedIcon";
import { useTabRoving, type TabItem } from "./Tabs";

export interface SegmentedControlProps<K extends string = string> {
  value: K;
  onChange: (key: K) => void;
  items: readonly TabItem<K>[];
  /** Required: names the group for screen readers, e.g. "Activity filter". */
  "aria-label": string;
  className?: string;
}

export type { TabItem };

/** Pill segmented control. */
export function SegmentedControl<K extends string>({
  value,
  onChange,
  items,
  className = "",
  "aria-label": ariaLabel,
}: SegmentedControlProps<K>) {
  const { listRef, onKeyDown } = useTabRoving(items, value, onChange);
  // See ds/Tabs: one tabbable stop even when `value` matches no item.
  const noneSelected = !items.some((item) => item.key === value);
  return (
    <div
      ref={listRef}
      className={`ds-seg${className ? ` ${className}` : ""}`}
      role="radiogroup"
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
            role="radio"
            aria-checked={selected}
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
