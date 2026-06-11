import React from "react";
import { Icon } from "../icons/Icon.jsx";

/**
 * TopNav — frosted glass top navbar shell. Brand block left, horizontal
 * nav with a glowing accent tick on the navbar's bottom edge, live-status
 * + meta + actions cluster right. Sticky; content scrolls beneath it.
 */
export function TopNav({
  logoSrc,
  brand = "RazorReaper",
  brandSub = "Operations Console",
  items,
  active,
  onNavigate,
  live = true,
  liveLabel,
  meta,
  actions,
}) {
  return (
    <header className="topnav">
      <div className="tn-brand">
        {logoSrc ? (
          <img src={logoSrc} alt={`${brand} logo`} className="tn-brand-img" />
        ) : (
          <span className="tn-brand-img" style={{ display: "grid", placeItems: "center", color: "var(--accent)" }}>
            <Icon name="zap" size={15} />
          </span>
        )}
        <div>
          <span className="tn-brand-name">{brand}</span>
          {brandSub ? <span className="tn-brand-sub">{brandSub}</span> : null}
        </div>
      </div>

      <nav className="tn-nav" aria-label="Primary">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`tn-item${active === item.key ? " active" : ""}`}
            onClick={() => onNavigate && onNavigate(item.key)}
          >
            {item.icon ? <Icon name={item.icon} size={16} /> : null}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="tn-right">
        <div className={`tn-live${live ? "" : " offline"}`}>
          <span className="tn-live-dot" />
          {liveLabel ?? (live ? "Ingest online" : "Ingest offline")}
        </div>
        {meta ? <div className="tn-meta">{meta}</div> : null}
        {actions ? <div className="tn-actions">{actions}</div> : null}
      </div>
    </header>
  );
}
