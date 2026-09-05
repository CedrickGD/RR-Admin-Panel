import { lazy, Suspense, useEffect, useState } from "react";
import type { Customer360Anchor } from "./Customer360Overlay";
import type { AuthUser } from "../types/telemetry";
import { canVisit } from "../../shared/panel-policy";
const View = lazy(() =>
  import("./Customer360Overlay").then((m) => ({ default: m.Customer360View })),
);
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
export function CustomerWorkspaceRouter({ user }: { user: AuthUser }) {
  const [anchor, setAnchor] = useState(readAnchor);
  useEffect(() => {
    if (!anchor || !canVisit("customers", user)) return;
    const main = document.querySelector("main");
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (main) main.inert = true;
    document.body.style.overflow = "hidden";
    return () => {
      if (main) main.inert = false;
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [anchor, user.role, user.panelRole, JSON.stringify(user.permissions)]);
  function close() {
    const url = new URL(location.href);
    url.searchParams.delete("customer");
    url.searchParams.delete("customerBy");
    url.searchParams.delete("customerTab");
    url.searchParams.delete("customerReturn");
    history.replaceState(null, "", url);
    setAnchor(null);
  }
  useEffect(() => {
    const open = (event: Event) => {
      const target = (event as CustomEvent<Customer360Anchor>).detail;
      const url = new URL(location.href);
      url.searchParams.set("customer", target.value);
      url.searchParams.set("customerBy", target.selector);
      history.pushState(null, "", url);
      setAnchor(target);
    };
    const pop = () => setAnchor(readAnchor());
    window.addEventListener("rr:open-customer", open);
    window.addEventListener("popstate", pop);
    window.addEventListener("rr:close-customer", close);
    return () => {
      window.removeEventListener("rr:open-customer", open);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("rr:close-customer", close);
    };
  }, []);
  if (!anchor || !canVisit("customers", user)) return null;
  return (
    <Suspense fallback={<div className="customer-workspace">Loading customer…</div>}>
      <View
        key={`${anchor.selector}:${anchor.value}:${JSON.stringify(user.permissions)}`}
        open
        session={null}
        anchor={anchor}
        embedded
        onClose={close}
      />
    </Suspense>
  );
}
