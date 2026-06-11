export interface EmptyStateProps {
  /** Green glowing ring variant for "no errors" — celebrate the quiet. */
  allClear?: boolean;
  /** Lucide icon for the neutral variant. Default "inbox"; "radio" for no live sessions. */
  icon?: string;
  title?: string;
  /** One short, factual line: what's empty and when it will fill. */
  children?: React.ReactNode;
}
