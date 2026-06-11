export interface SegmentedControlProps {
  /** Strings, or { key, label } pairs. Console ranges: 24 h · 7 d · 30 d · 90 d · All */
  options: Array<string | { key: string; label: string }>;
  /** Active option key */
  value: string;
  onChange?: (key: string) => void;
  className?: string;
}
