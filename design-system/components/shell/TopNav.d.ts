/**
 * @startingPoint section="Shell" subtitle="Frosted top navbar: brand, horizontal nav with accent tick, live status + actions" viewport="900x300"
 */
export interface TopNavProps {
  /** Path to assets/logo.ico relative to the consuming page. Falls back to an accent glyph well. */
  logoSrc?: string;
  brand?: string;
  brandSub?: string;
  /** Flat horizontal nav: overview / traffic / versions / heatmap / live / sessions / errors / settings */
  items: Array<{ key: string; label: string; icon?: string }>;
  /** Active item key */
  active: string;
  onNavigate?: (key: string) => void;
  /** Ingest reachable? Drives the pulsing dot in the right cluster (green/red). */
  live?: boolean;
  liveLabel?: string;
  /** Mono meta line, e.g. "d1 · v1.6.2 · 2m ago" — hidden on narrow viewports */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}
