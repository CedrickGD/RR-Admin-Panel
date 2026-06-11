/**
 * DS port of design-system/components/indicators/Tag (Tag + Spinner).
 *
 * Tags are squared mini-chips (6px radius) for configuration values
 * ("UTC fixed", "D1", "Active-first") — they read as "machine value",
 * unlike pill badges which read as "state". Spinner is the standard loader.
 */
import type { ReactNode } from "react";

export interface TagProps {
  /** Accent-tinted variant for the currently-relevant value */
  accent?: boolean;
  children?: ReactNode;
  title?: string;
}

/** Small squared chip for config values in headers and kv rows. */
export function Tag({ accent = false, children, title }: TagProps) {
  return <span className={`kv-tag${accent ? " kv-tag-accent" : ""}`} title={title}>{children}</span>;
}

export interface SpinnerProps {
  small?: boolean;
}

/** Loading spinner. */
export function Spinner({ small = false }: SpinnerProps) {
  return <span className={`spinner${small ? " spinner-sm" : ""}`} style={{ display: "inline-block" }} />;
}
