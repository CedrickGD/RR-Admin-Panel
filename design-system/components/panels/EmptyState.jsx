import React from "react";
import { Icon } from "../icons/Icon.jsx";

/**
 * Empty states. Default: neutral icon well + title + line.
 * `allClear` variant: glowing green ring — good news is shown proudly.
 */
export function EmptyState({ allClear = false, icon = "inbox", title, children }) {
  if (allClear) {
    return (
      <div className="empty-state" style={{ padding: "26px 16px 28px" }}>
        <div className="empty-ring">
          <Icon name="check" size={18} strokeWidth={2.4} />
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
      <div className="empty-state-icon"><Icon name={icon} size={20} /></div>
      {title ? <strong>{title}</strong> : null}
      {children ? <p>{children}</p> : null}
    </div>
  );
}
