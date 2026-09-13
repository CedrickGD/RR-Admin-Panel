import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { Customer360Anchor } from "./Customer360Overlay";
import type { AuthUser } from "../types/telemetry";
import { canVisit } from "../../shared/panel-policy";
import { useHistoryLayer } from "../hooks/useHistoryLayer";
const View = lazy(() =>
  import("./Customer360Overlay").then((m) => ({ default: m.Customer360View })),
);

/** The query params that describe an open workspace. customerReturn is the Licenses page's, not ours. */
const WORKSPACE_PARAMS = ["customer", "customerBy", "customerTab"] as const;

function readAnchor(): Customer360Anchor | null {
  const query = new URLSearchParams(location.search),
    selector = query.get("customerBy"),
    value = query.get("customer");
  if (
    !value ||
    !["session_id", "hwid", "install_id", "license_key", "order_id", "feedback_id"].includes(
      selector ?? "",
    )
  )
    return null;
  return { selector: selector as Customer360Anchor["selector"], value };
}

/** The current address describing `anchor`. A different customer drops the old tab. */
function urlWith(anchor: Customer360Anchor): string {
  const url = new URL(location.href);
  if (
    url.searchParams.get("customer") !== anchor.value ||
    url.searchParams.get("customerBy") !== anchor.selector
  )
    url.searchParams.delete("customerTab");
  url.searchParams.set("customer", anchor.value);
  url.searchParams.set("customerBy", anchor.selector);
  return url.toString();
}

/** The current address without the workspace: the page it opens over. */
function urlWithout(): string {
  const url = new URL(location.href);
  for (const key of WORKSPACE_PARAMS) url.searchParams.delete(key);
  return url.toString();
}

/**
 * Mounts Customer 360 over whatever page is open, addressed by the
 * customer/customerBy query pair.
 *
 * The workspace is one history layer (useHistoryLayer, key "customer"):
 * opening it pushes the customer's address, Back or its own "Back to workspace"
 * steps back to the page underneath, and a navigation away (another page,
 * "Manage licenses") leaves the entry in place under the new page, so Back from
 * there reopens the same customer. Arriving on that entry again — Back,
 * Forward, a reload — adopts it rather than pushing a copy.
 */
export function CustomerWorkspaceRouter({ user }: { user: AuthUser }) {
  const [anchor, setAnchor] = useState(readAnchor);
  const allowed = canVisit("customers", user);
  const open = Boolean(anchor) && allowed;
  const openRef = useRef(open);
  openRef.current = open;
  // "Manage licenses" hands the screen to the Licenses page. Unmounting the
  // workspace in that same frame left the page's Suspense spinner (and then its
  // fade-in from transparent) over the bare background, which read as the
  // workspace turning see-through. The closing workspace is held on top, inert,
  // until the page underneath has content, and only then fades out.
  const handoffRef = useRef(false);
  const [leaving, setLeaving] = useState<Customer360Anchor | null>(null);
  const [fading, setFading] = useState(false);

  useHistoryLayer(
    open,
    (reason) => {
      if (handoffRef.current && anchor) setLeaving(anchor);
      handoffRef.current = false;
      setAnchor(null);
      // A navigation away pushed the new page from the workspace's address, so
      // that entry still carries the customer params: drop them in place, or a
      // reload of the new page would reopen the workspace over it.
      if (reason === "navigate" && readAnchor())
        history.replaceState(history.state, "", urlWithout());
    },
    {
      key: "customer",
      url: () => (anchor ? urlWith(anchor) : location.href),
      baseUrl: urlWithout,
    },
  );

  useEffect(() => {
    if (!open) return;
    const main = document.querySelector("main");
    // Locked on <html>, not <body>: see ds/Modal. A body overflow turned body
    // into its own scroller and dropped the sticky navbar (and with it the
    // phone back arrow) out of view whenever the page underneath was scrolled.
    const previousOverflow = document.documentElement.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (main) main.inert = true;
    document.documentElement.style.overflow = "hidden";
    return () => {
      if (main) main.inert = false;
      document.documentElement.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!leaving) return;
    let frame = 0;
    let timer = 0;
    const started = performance.now();
    const settle = () => {
      const page = document.querySelector("main .page-enter");
      const painted =
        page !== null &&
        !page.querySelector('[aria-label="Loading page"]') &&
        !page.getAnimations().some((animation) => animation.playState === "running");
      // Never hold longer than 1.5s: a page that cannot render must not stay hidden.
      if (!painted && performance.now() - started < 1500) {
        frame = requestAnimationFrame(settle);
        return;
      }
      setFading(true);
      // The fade in consistency.css (.customer-workspace.is-leaving) is 200ms.
      timer = window.setTimeout(() => {
        setLeaving(null);
        setFading(false);
      }, 240);
    };
    frame = requestAnimationFrame(settle);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [leaving]);

  useEffect(() => {
    const openCustomer = (event: Event) => {
      const target = (event as CustomEvent<Customer360Anchor>).detail;
      // Switching customers inside an open workspace keeps its one entry.
      if (openRef.current) history.replaceState(history.state, "", urlWith(target));
      setAnchor(target);
    };
    // Back/Forward onto (or off) a workspace address; the layer hook has
    // already closed or will adopt the workspace itself.
    const pop = () => setAnchor(readAnchor());
    const close = () => setAnchor(null);
    const handoff = () => {
      handoffRef.current = true;
    };
    window.addEventListener("rr:open-customer", openCustomer);
    window.addEventListener("popstate", pop);
    window.addEventListener("rr:close-customer", close);
    window.addEventListener("rr:customer-handoff", handoff);
    return () => {
      window.removeEventListener("rr:open-customer", openCustomer);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("rr:close-customer", close);
      window.removeEventListener("rr:customer-handoff", handoff);
    };
  }, []);

  const shown = anchor && open ? anchor : leaving;
  if (!shown) return null;
  return (
    <Suspense fallback={<div className="customer-workspace">Loading customer…</div>}>
      <View
        key={`${shown.selector}:${shown.value}:${JSON.stringify(user.permissions)}`}
        open
        session={null}
        anchor={shown}
        handoff={shown === anchor && open ? undefined : fading ? "fade" : "hold"}
        onClose={() => setAnchor(null)}
      />
    </Suspense>
  );
}
