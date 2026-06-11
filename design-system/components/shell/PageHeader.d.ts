export interface PageHeaderProps {
  /** Uppercase accent micro-label above the title, e.g. "Production Operations", "Realtime" */
  kicker?: string;
  /** One or two words: "Overview", "Live Sessions" */
  title: string;
  /** Filter bar, badges, MetaRow */
  right?: React.ReactNode;
}

export interface MetaRowProps {
  /** e.g. [{ label: "Peak Users/h", value: "14" }, { label: "Errors", value: "3" }] */
  items: Array<{ label: string; value: string }>;
}
