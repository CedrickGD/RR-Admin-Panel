import { useLayoutEffect, useRef } from "react";

/** Every row follows the document clock, including rows mounted after a refresh. */
export function LiveStatusDot() {
  const dot = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = dot.current;
    if (!element) return;
    const synchronize = () => {
      for (const animation of element.getAnimations({ subtree: true })) animation.startTime = 0;
    };
    synchronize();
    element.addEventListener("animationstart", synchronize);
    return () => element.removeEventListener("animationstart", synchronize);
  }, []);
  return <span ref={dot} className="live-online-dot" aria-hidden="true" />;
}
