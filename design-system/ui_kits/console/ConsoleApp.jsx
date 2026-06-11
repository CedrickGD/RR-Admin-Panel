import React from "react";
import { TopNav } from "../../components/shell/TopNav.jsx";
import { Button } from "../../components/controls/Button.jsx";
import { NAV_GROUPS } from "./ConsoleData.jsx";
import { OverviewScreen, PlaceholderScreen } from "./OverviewScreen.jsx";
import { LiveScreen } from "./LiveScreen.jsx";
import { ErrorsScreen } from "./ErrorsScreen.jsx";
import { VersionsScreen } from "./VersionsScreen.jsx";
import { SettingsScreen } from "./SettingsScreen.jsx";

const HUE_KEY = "rr-kit-accent-hue";

/**
 * RazorReaper Operations Console — interactive UI-kit recreation.
 * Frosted top-navbar shell + Overview / Versions / Live / Errors / Settings.
 * Traffic, Heatmap and Sessions are intentionally placeholders (see notes).
 */
export function ConsoleApp({ logoSrc = "../../assets/logo.ico" }) {
  const [page, setPage] = React.useState("overview");
  const [hue, setHue] = React.useState(() => {
    try {
      const stored = Number(localStorage.getItem(HUE_KEY));
      return Number.isFinite(stored) && stored > 0 ? stored : 262;
    } catch {
      return 262;
    }
  });

  React.useEffect(() => {
    document.documentElement.style.setProperty("--ah", String(hue));
    try { localStorage.setItem(HUE_KEY, String(hue)); } catch { /* ignore */ }
  }, [hue]);

  return (
    <div className="v2-shell">
      <TopNav
        logoSrc={logoSrc}
        active={page}
        onNavigate={setPage}
        items={NAV_GROUPS.flatMap((g) => g.items)}
        live
        liveLabel="Ingest online"
        meta={<span>d1 · v1.6.2 · ingest 2m ago</span>}
        actions={<Button size="sm" icon="refresh-cw">Refresh</Button>}
      />
      <main className="v2-main">
        {page === "overview" ? <OverviewScreen /> : null}
        {page === "versions" ? <VersionsScreen /> : null}
        {page === "live" ? <LiveScreen /> : null}
        {page === "errors" ? <ErrorsScreen /> : null}
        {page === "settings" ? <SettingsScreen hue={hue} onHueChange={setHue} /> : null}
        {page === "traffic" ? (
          <PlaceholderScreen
            kicker="Hourly Patterns"
            title="Traffic"
            icon="clock-3"
            note="Production shows hourly/timezone usage charts — same TrendChart + Panel patterns as Overview, omitted here to avoid inventing data."
          />
        ) : null}
        {page === "heatmap" ? (
          <PlaceholderScreen
            kicker="Geography"
            title="Heatmap"
            icon="map"
            note="Production renders a MapLibre world map with pulsing accent session nodes (.map-node-*) over dark tiles. Left blank here — a static recreation would misrepresent it."
          />
        ) : null}
        {page === "sessions" ? (
          <PlaceholderScreen
            kicker="Archive"
            title="Sessions"
            icon="history"
            note="The searchable session archive uses the exact table pattern shown on Live, plus SearchInput and a .txt export Button."
          />
        ) : null}
      </main>
    </div>
  );
}
