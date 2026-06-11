/**
 * DS port of design-system/components/panels/EmptyState.
 *
 * Empty states. Default: neutral icon well + title + one short, factual line.
 * `allClear` variant: glowing green ring — good news is shown proudly, never
 * greyed out ("All clear — No failures in the selected range.").
 *
 * ICON APPROACH: the DS contract takes a Lucide icon NAME string; this port
 * accepts a ReactNode — pass a lucide-react element, e.g. icon={<Radio />}.
 * If the element has no explicit `size`, the DS well size (20px) is injected.
 * Default icon is <Inbox />; the allClear check (18px) is internal.
 */
import type { ReactNode } from "react";
import { Check, Inbox } from "lucide-react";
import { sizedIcon } from "./sizedIcon";

export interface EmptyStateProps {
  /** Green glowing ring variant for "no errors" — celebrate the quiet. */
  allClear?: boolean;
  /** lucide-react element for the neutral variant. Default <Inbox />; use <Radio /> for no live sessions. */
  icon?: ReactNode;
  title?: string;
  /** One short, factual line: what's empty and when it will fill. */
  children?: ReactNode;
}

export function EmptyState({ allClear = false, icon, title, children }: EmptyStateProps) {
  if (allClear) {
    return (
      <div className="empty-state" style={{ padding: "26px 16px 28px" }}>
        <div className="empty-ring">
          <Check size={18} strokeWidth={2.4} />
        </div>
        <p className="empty-title">{title ?? "All clear"}</p>
        {children ? (
          <p style={{ fontSize: "0.71875rem", color: "var(--text-3)", maxWidth: 240, margin: "4px auto 0", lineHeight: 1.5 }}>
            {children}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{sizedIcon(icon ?? <Inbox />, 20)}</div>
      {title ? <strong>{title}</strong> : null}
      {children ? <p>{children}</p> : null}
    </div>
  );
}
