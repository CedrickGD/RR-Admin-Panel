const SELECTORS = new Set([
  "session_id",
  "hwid",
  "install_id",
  "license_key",
  "order_id",
  "feedback_id",
]);

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

export function navigateCustomerUrl(target: URL) {
  history.pushState(null, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
