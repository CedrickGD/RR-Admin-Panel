export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  /** Uppercase accent micro-label, e.g. the KPI label being drilled into */
  kicker?: string;
  title?: string;
  sub?: string;
  children?: React.ReactNode;
}

export interface TimespanGridProps {
  /** e.g. [{ label: "Today", value: "18" }, { label: "7 d", value: "124", hint: "limited to 7d range" }] */
  spans: Array<{ label: string; value: string; hint?: string }>;
}

export interface BreakdownListProps {
  /** Kicker above the rows, e.g. "Users by current version" */
  title?: string;
  /** share is 0–1; bars are accent-gradient */
  rows: Array<{ label: string; value: string; share?: number }>;
}
