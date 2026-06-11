import React from "react";
import { PageHeader, MetaRow } from "../../components/shell/PageHeader.jsx";
import { Panel } from "../../components/panels/Panel.jsx";
import { EmptyState } from "../../components/panels/EmptyState.jsx";
import { KpiTile } from "../../components/metrics/KpiTile.jsx";
import { TrendChart } from "../../components/charts/TrendChart.jsx";
import { KvList } from "../../components/tables/KvList.jsx";
import { Feed } from "../../components/tables/Feed.jsx";
import { Badge } from "../../components/indicators/Badge.jsx";
import { SegmentedControl } from "../../components/controls/SegmentedControl.jsx";
import { Dropdown } from "../../components/controls/Dropdown.jsx";
import { HOURS, RECENT_ERRORS, SESSION_SPARK, ERROR_SPARK } from "./ConsoleData.jsx";

/** Overview — summary-only: KPI row, traffic chart, system context + recent errors. */
export function OverviewScreen() {
  const [range, setRange] = React.useState("today");
  const [version, setVersion] = React.useState(null);
  const [win, setWin] = React.useState("24h");

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Production Operations"
        title="Overview"
        right={
          <div className="filter-bar-right">
            <SegmentedControl
              options={[{ key: "today", label: "24 h" }, { key: "7d", label: "7 d" }, { key: "30d", label: "30 d" }, { key: "90d", label: "90 d" }, { key: "all", label: "All" }]}
              value={range}
              onChange={setRange}
            />
            <Dropdown
              placeholder="All versions"
              options={["1.6.2", "1.6.1", "1.6.0", "1.5.3", "legacy"]}
              value={version}
              onChange={setVersion}
              renderOption={(o) => (o === "legacy" ? "Legacy (pre-1.4)" : o)}
            />
          </div>
        }
      />

      <div className="main-side main-side-stretch">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="stat-grid stat-grid-6 v2-stagger">
            <KpiTile label="Active Users" value="3" sub="3 sessions open" icon="users" />
            <KpiTile
              label="Sessions"
              value="1,284"
              sub="In range · 5,931 all-time"
              spark={SESSION_SPARK}
              drilldown={{
                timespans: [{ label: "Today", value: "18" }, { label: "7 d", value: "124" }, { label: "30 d", value: "486" }, { label: "Lifetime", value: "5,931" }],
                breakdown: [{ label: "Windows 11", value: "912", share: 0.71 }, { label: "Windows 10", value: "367", share: 0.29 }],
                breakdownTitle: "Sessions by platform",
              }}
            />
            <KpiTile
              label="Avg Session"
              value="38m 12s"
              sub="In range · legacy excluded"
              icon="clock"
              drilldown={{
                timespans: [{ label: "Avg duration", value: "38m 12s", hint: "selected range" }, { label: "Sessions in range", value: "1,284" }, { label: "Lifetime events", value: "182,409" }],
                note: "Computed server-side over the full session history. Legacy install-scoped pseudo-sessions (install:*) are excluded from the average.",
              }}
            />
            <KpiTile label="Errors" value="3" sub="Last 24 hours" tone="danger" spark={ERROR_SPARK} sparkColor="var(--chart-errors)" />
            <KpiTile
              label="Primary Region"
              value="Germany"
              sub="64 users"
              icon="earth"
              drilldown={{
                breakdown: [
                  { label: "Germany", value: "64", share: 0.29 },
                  { label: "United States", value: "51", share: 0.23 },
                  { label: "Brazil", value: "27", share: 0.12 },
                ],
                breakdownTitle: "Users by country",
              }}
            />
            <KpiTile label="Latest Error" value="2m ago" sub="NullReferenceException" tone="danger" icon="activity" />
          </div>

          <Panel
            kicker="Traffic"
            title="Last 24 Hours"
            sub="Scroll inside chart to zoom in"
            collapsible
            right={<MetaRow items={[{ label: "Peak Users/h", value: "11" }, { label: "Sessions", value: "27" }, { label: "Errors", value: "3" }]} />}
          >
            <div style={{ display: "flex", paddingBottom: 6 }}>
              <SegmentedControl options={["1h", "3h", "6h", "12h", "24h"]} value={win} onChange={setWin} />
            </div>
            <div className="chart-wrap chart-wrap-tall">
              <TrendChart
                data={HOURS}
                height={280}
                areas={[
                  { key: "users", name: "Active users", color: "var(--chart-users)" },
                  { key: "errors", name: "Errors", color: "var(--chart-errors)", strokeWidth: 1.8 },
                ]}
                bars={[{ key: "started", name: "New sessions", color: "var(--chart-sessions)" }]}
              />
            </div>
          </Panel>
        </div>

        <div className="side-stack">
          <Panel kicker="System" title="Context" padding="tight">
            <KvList items={[
              { k: "Traffic Clock", v: "UTC fixed", tag: "default" },
              { k: "Geography Source", v: "Active-first", tag: "accent" },
              { k: "Storage Backend", v: "D1", tag: "default" },
              { k: "Last Ingest", v: "2m ago" },
              { k: "Generated", v: "8s ago" },
            ]} />
          </Panel>
          <Panel kicker="Failures" title="Recent Errors" padding="tight" right={<Badge tone="danger">3</Badge>} style={{ flex: 1 }}>
            <div style={{ padding: "8px 0 4px" }}>
              <Feed items={RECENT_ERRORS} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Pages that exist in production but are intentionally not recreated in this kit. */
export function PlaceholderScreen({ title, kicker, note, icon = "map" }) {
  return (
    <div className="page-content page-stack-lg">
      <PageHeader kicker={kicker} title={title} />
      <Panel padding="body">
        <EmptyState icon={icon} title={`${title} is not recreated in this kit`}>{note}</EmptyState>
      </Panel>
    </div>
  );
}
