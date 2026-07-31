import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Grid-rows clip for a table row's detail cell — same tokens and technique as
 * CollapsiblePanel. Children stay mounted; grid-template-rows animates the
 * fold smoothly. Mounts collapsed and flips open a frame later so the FIRST
 * expansion animates too (grid transitions need a prior 0fr frame). While
 * collapsed the clip is `inert` (and aria-hidden), so the mounted detail
 * content is neither keyboard-tabbable nor exposed to assistive tech, and its
 * retained observers (e.g. Recharts resize) sit behind an inert subtree.
 *
 * Padding lives on .row-expand-content INSIDE .row-expand-inner: the inner is
 * the overflow-clip element, and a border-box can't shrink below its own
 * padding — padding there would floor every collapsed row at ~28px (mirrors
 * CollapsiblePanel's .panel-body-inner + .panel-body split).
 */
export function RowExpandClip({ open, children }: { open: boolean; children: ReactNode }) {
  const clipRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Force the current (collapsed) frame to be style-resolved before the
    // flip: when React flushes the mount and this effect before paint, a lone
    // rAF can coalesce both states into one style recalc and the first
    // expansion snaps open instead of transitioning.
    if (clipRef.current) void clipRef.current.offsetHeight;
    const frame = requestAnimationFrame(() => setShown(open));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <div
      ref={clipRef}
      className="row-expand-clip"
      data-collapsed={shown ? "false" : "true"}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="row-expand-inner">
        <div className="row-expand-content">{children}</div>
      </div>
    </div>
  );
}
