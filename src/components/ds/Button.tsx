/**
 * DS port of design-system/components/controls/Button (Button + IconButton).
 *
 * Console button. Ghost is the workhorse; primary is reserved for the one true
 * action (at most one per view); danger only for destructive/auth actions.
 *
 * ICON APPROACH: the DS contract takes a Lucide icon NAME string; this port
 * accepts a ReactNode — pass a lucide-react element, e.g. icon={<RefreshCw />}.
 * If the element has no explicit `size`, the DS size is injected automatically
 * (14px, 12px on size="xs"; IconButton uses its `size` prop, default 14px).
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { sizedIcon } from "./sizedIcon";
import { usePanelPermission } from "../../hooks/usePanelPermission";
import type { Permission } from "../../../shared/panel-policy";

const VARIANT_CLASS: Record<string, string> = {
  primary: "btn-primary",
  ghost: "btn-ghost",
  accent: "btn-accent-ghost",
  danger: "btn-danger",
};
const SIZE_CLASS: Record<string, string> = { md: "", sm: " btn-sm", xs: " btn-xs" };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  permission?: Permission;
  /** "ghost" (default, most actions) · "primary" (one per view max) · "accent" (accent-tinted ghost) · "danger" (sign out, destructive) */
  variant?: "primary" | "ghost" | "accent" | "danger";
  size?: "md" | "sm" | "xs";
  /** Optional leading lucide-react element, e.g. icon={<RefreshCw />} */
  icon?: ReactNode;
}

export function Button({
  permission,
  variant = "ghost",
  size = "md",
  icon,
  children,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const allowed = usePanelPermission(permission);
  if (!allowed) return null;
  return (
    <button
      type={type}
      className={`btn ${VARIANT_CLASS[variant] ?? VARIANT_CLASS.ghost}${SIZE_CLASS[size] ?? ""}${className ? ` ${className}` : ""}`}
      {...rest}
    >
      {icon ? sizedIcon(icon, size === "xs" ? 12 : 14) : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  permission?: Permission;
  /** lucide-react element, e.g. icon={<ChevronDown />} */
  icon: ReactNode;
  /** Icon px size. Default 14 (table rows); 16 for panel chrome. */
  size?: number;
}

/** Square icon-only button for table rows and panel chrome. */
export function IconButton({
  permission,
  icon,
  size = 14,
  className = "",
  type = "button",
  ...rest
}: IconButtonProps) {
  const allowed = usePanelPermission(permission);
  if (!allowed) return null;
  return (
    <button type={type} className={`btn-icon${className ? ` ${className}` : ""}`} {...rest}>
      {sizedIcon(icon, size)}
    </button>
  );
}
