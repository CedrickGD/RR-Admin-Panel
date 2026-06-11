import React, { useState } from "react";
import { Icon } from "../icons/Icon.jsx";

/**
 * Core surface: flat panel with hairline border, kicker + section title head.
 * Optional collapse (animated grid-rows technique) and header-right slot.
 */
export function Panel({ kicker, title, sub, right, collapsible = false, defaultCollapsed = false, padding = "body", children, style, className = "" }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const hasHead = kicker || title || sub || right || collapsible;
  const bodyClass = padding === "flush" ? "panel-body-flush" : padding === "tight" ? "panel-body-tight" : "panel-body";

  const body = (
    <div className={bodyClass}>
      {children}
    </div>
  );

  return (
    <section className={`panel${collapsed ? " panel-collapsed" : ""}${className ? ` ${className}` : ""}`} style={style}>
      {hasHead ? (
        <div
          className={`panel-head${collapsible ? " panel-head-clickable" : ""}`}
          onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        >
          <div className="panel-head-left">
            {kicker ? <p className="kicker">{kicker}</p> : null}
            {title ? <h2 className="section-title">{title}</h2> : null}
            {sub ? <p className="section-sub">{sub}</p> : null}
          </div>
          <div className="panel-head-right">
            {right}
            {collapsible ? (
              <span className={`panel-collapse-chevron${collapsed ? " panel-collapse-chevron-closed" : ""}`}>
                <Icon name="chevron-down" size={15} />
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {collapsible ? (
        <div className="panel-body-clip">
          <div className="panel-body-inner">{body}</div>
        </div>
      ) : (
        body
      )}
    </section>
  );
}
