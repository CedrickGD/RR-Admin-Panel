/**
 * @startingPoint section="Controls" subtitle="Themed select replacement with type-to-filter — never use native selects" viewport="700x320"
 */
export interface DropdownProps {
  /** Empty/"all" state label, e.g. "All versions". Selecting it passes null to onChange. */
  placeholder: string;
  options: string[];
  /** Currently selected option, or null for the placeholder/all state. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Optional display mapping, e.g. "legacy" → "Legacy (pre-1.4)" */
  renderOption?: (option: string) => string;
  /** Show the filter input when the list is longer than this. Default 8. */
  searchThreshold?: number;
  /** Popover anchor edge. Default "right". */
  align?: "left" | "right";
}
