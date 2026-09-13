import { navigateOverLayers } from "../hooks/useHistoryLayer";

export type CustomerSelector =
  | "session_id"
  | "hwid"
  | "install_id"
  | "license_key"
  | "order_id"
  | "feedback_id";

const SELECTORS = new Set<string>([
  "session_id",
  "hwid",
  "install_id",
  "license_key",
  "order_id",
  "feedback_id",
]);

/**
 * What a row hands to the Customer 360 workspace. Structurally a
 * `Customer360Anchor` — `label`/`detail` stay nullable so an anchor built from a
 * record with missing copy passes straight through without a cast.
 */
export interface CustomerWorkspaceTarget {
  selector: CustomerSelector;
  value: string;
  label?: string | null;
  detail?: string | null;
}

/**
 * Single entry point into the addressable Customer 360 workspace.
 * CustomerWorkspaceRouter listens for this event, pushes the customer/customerBy
 * query pair and mounts the overlay over whatever page is open.
 */
export function openCustomerWorkspace(target: CustomerWorkspaceTarget) {
  window.dispatchEvent(new CustomEvent("rr:open-customer", { detail: target }));
}

export function customerActionUrl(current: URL, tab: string): URL {
  const previous = new URL(current);
  previous.searchParams.delete("customerReturn");
  previous.searchParams.set("customerTab", tab);
  const next = new URL(current);
  for (const key of ["customer", "customerBy", "customerTab"]) next.searchParams.delete(key);
  next.searchParams.set("customerReturn", previous.pathname + previous.search + previous.hash);
  next.hash = "/licenses";
  return next;
}

export function customerReturnUrl(current: URL): URL | null {
  const saved = current.searchParams.get("customerReturn");
  if (!saved) return null;
  try {
    const target = new URL(saved, current);
    if (
      target.origin !== current.origin ||
      target.pathname !== current.pathname ||
      !target.searchParams.get("customer") ||
      !SELECTORS.has(target.searchParams.get("customerBy") ?? "")
    )
      return null;
    target.searchParams.delete("customerReturn");
    return target;
  } catch {
    return null;
  }
}

/**
 * Goes to a customer address (the Licenses hand-off, "Back to customer", a
 * Customer 360 link) through the history layers: an open Customer 360 closes
 * as a navigation and keeps its entry under the new one, and App and the
 * router follow the new address.
 */
export function navigateCustomerUrl(target: URL) {
  navigateOverLayers(target);
}
