/**
 * One name per page — the single source of truth for the sidebar item, the
 * breadcrumb, the page H1 (PageHeader `page` prop) and the browser tab title.
 * Pages must not invent their own titles: change the label here instead.
 */
import type { PageKey } from "./types/telemetry";

export type PageGroup =
  | "Customers"
  | "Monitoring"
  | "Communication"
  | "Diagnostics"
  | "Administration";

export interface PageMeta {
  /** Sidebar group; doubles as the breadcrumb prefix. */
  group: PageGroup;
  /** Sentence-case page name, e.g. "Live sessions". The sidebar item. */
  label: string;
  /**
   * The page's own name where it differs from its sidebar item: the page H1, the breadcrumb and
   * the tab title (read them through pageHeading()). Only for a page whose ds/Tabs sections outgrow
   * the item that opens it, and whose natural name is its group's: Customers holds the directory
   * and the restrictions, but a rail item named "Customers" would repeat the group header above it.
   */
  heading?: string;
}

export const PAGE_META: Record<PageKey, PageMeta> = {
  // The rail item is not plain "Customers": that is this page's own group name, and the sidebar
  // would render the group header and its first child as the same word and icon. The page itself
  // holds two sections (Directory | Restrictions), so its H1, breadcrumb and tab title name the
  // whole page, the way Licenses & orders and Panel access name theirs above their tabs.
  customers: { group: "Customers", label: "Customer directory", heading: "Customers" },
  licenses: { group: "Customers", label: "Licenses & orders" },
  // No "access" entry: the App access page was folded into the directory above
  // and "#/access" is only an alias now (see src/utils/pageRouting.ts). A label
  // here would put the retired page back in the rail, the breadcrumb and the
  // tab title, which is exactly what retiring it was meant to stop.
  overview: { group: "Monitoring", label: "Overview" },
  live: { group: "Monitoring", label: "Live sessions" },
  workers: { group: "Monitoring", label: "Session history" },
  traffic: { group: "Monitoring", label: "Traffic" },
  versions: { group: "Monitoring", label: "Versions" },
  heatmap: { group: "Monitoring", label: "World map" },
  announcements: { group: "Communication", label: "Announcements" },
  feedback: { group: "Communication", label: "Feedback" },
  errors: { group: "Diagnostics", label: "Errors" },
  team: { group: "Administration", label: "Panel access" },
  system: { group: "Administration", label: "Backend status" },
  settings: { group: "Administration", label: "Settings" },
};

/** The name a page goes by on screen (H1, breadcrumb, tab title): its heading, else its label. */
export function pageHeading(page: PageKey): string {
  return PAGE_META[page].heading ?? PAGE_META[page].label;
}
