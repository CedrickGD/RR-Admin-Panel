import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

interface CollapsiblePanelProps {
  kicker: string;
  title: string;
  sub?: string;
  /** Extra controls rendered on the right side of the head (kept clickable). */
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Panel with a clickable head that folds the body away — big charts/tables can
 * be collapsed so a page never forces a wall of content on the user.
 */
export function CollapsiblePanel({ kicker, title, sub, right, defaultOpen = true, children }: CollapsiblePanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`panel${open ? "" : " panel-collapsed"}`}>
      <div
        className="panel-head panel-head-clickable"
        onClick={() => setOpen((current) => !current)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
      >
        <div className="panel-head-left">
          <p className="kicker">{kicker}</p>
          <h2 className="section-title">{title}</h2>
          {sub && open ? <p className="section-sub">{sub}</p> : null}
        </div>
        <div className="panel-head-right" onClick={(event) => event.stopPropagation()}>
          {open ? right : null}
          <button
            type="button"
            className="btn-icon panel-collapse-btn"
            title={open ? "Collapse" : "Expand"}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((current) => !current);
            }}
          >
            <ChevronDown className={`h-3.5 w-3.5 panel-collapse-chevron${open ? "" : " panel-collapse-chevron-closed"}`} />
          </button>
        </div>
      </div>
      {/* Children stay mounted; grid-template-rows animates the fold smoothly. */}
      <div className="panel-body-clip" aria-hidden={!open}>
        <div className="panel-body-inner">{children}</div>
      </div>
    </section>
  );
}
