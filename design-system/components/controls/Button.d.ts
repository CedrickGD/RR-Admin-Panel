/**
 * @startingPoint section="Controls" subtitle="Console buttons — ghost workhorse, accent-aware primary" viewport="700x180"
 */
export interface ButtonProps {
  /** "ghost" (default, most actions) · "primary" (one per view max) · "accent" (accent-tinted ghost) · "danger" (sign out, destructive) */
  variant?: "primary" | "ghost" | "accent" | "danger";
  size?: "md" | "sm" | "xs";
  /** Optional leading Lucide icon name, e.g. "refresh-cw" */
  icon?: string;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}

export interface IconButtonProps {
  /** Lucide icon name, e.g. "chevron-down", "x", "globe" */
  icon: string;
  /** Icon px size. Default 14 (table rows); 16 for panel chrome. */
  size?: number;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}
