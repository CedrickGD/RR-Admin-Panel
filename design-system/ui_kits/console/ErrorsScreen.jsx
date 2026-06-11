import React from "react";
import { PageHeader, MetaRow } from "../../components/shell/PageHeader.jsx";
import { Panel } from "../../components/panels/Panel.jsx";
import { EmptyState } from "../../components/panels/EmptyState.jsx";
import { KpiTile } from "../../components/metrics/KpiTile.jsx";
import { Badge } from "../../components/indicators/Badge.jsx";
import { Button } from "../../components/controls/Button.jsx";
import { SegmentedControl } from "../../components/controls/SegmentedControl.jsx";
import { Dropdown } from "../../components/controls/Dropdown.jsx";
import { DataTable } from "../../components/tables/DataTable.jsx";
import { ERROR_SPARK } from "./ConsoleData.jsx";

const ERROR_ROWS = [
  { id: "g1", type: "NullReferenceException", msg: "Object reference not set to an instance of an object", source: "overlay_renderer", count: 4, last: "2m ago" },
  { id: "g2", type: "TimeoutException", msg: "RCON handshake exceeded 5000ms", source: "ark_rcon_client", count: 2, last: "41m ago" },
  { id: "g3", type: "JsonReaderException", msg: "Unexpected token at line 14, position 9", source: "config_loader", count: 1, last: "3h ago" },
];

/** Errors — recent real application failures only, grouped by exception type. */
export function ErrorsScreen() {
  const [range, setRange] = React.useState("today");
  const [source, setSource] = React.useState(null);
  const [cleared, setCleared] = React.useState(false);

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Failures"
        title="Errors"
        right={
          <div className="filter-bar-right">
            <SegmentedControl
              options={[{ key: "today", label: "24 h" }, { key: "7d", label: "7 d" }, { key: "30d", label: "30 d" }, { key: "all", label: "All" }]}
              value={range}
              onChange={setRange}
            />
            <Dropdown placeholder="All sources" options={["overlay_renderer", "ark_rcon_client", "config_loader"]} value={source} onChange={setSource} />
          </div>
        }
      />

      <div className="stat-grid stat-grid-4 v2-stagger">
        <KpiTile label="Errors In Range" value="7" sub="Across 3 exception types" tone="danger" spark={ERROR_SPARK} sparkColor="var(--chart-errors)" />
        <KpiTile label="Affected Users" value="2" sub="Of 3 active in range" icon="users" />
        <KpiTile label="Top Source" value="overlay_renderer" sub="4 of 7 errors" icon="terminal" />
        <KpiTile label="Last Failure" value="2m ago" sub="NullReferenceException" tone="warning" icon="activity" />
      </div>

      <Panel
        kicker="Grouped"
        title="Recent Failures"
        sub="Real application failures only — heartbeats and noise are filtered at ingest."
        padding="flush"
        right={<Button size="sm" icon="rotate-ccw" onClick={() => setCleared(!cleared)}>{cleared ? "Restore" : "Clear list"}</Button>}
      >
        {cleared ? (
          <EmptyState allClear>No failures in the selected range. New errors surface here within seconds of ingest.</EmptyState>
        ) : (
          <DataTable
            flush
            columns={[
              { key: "type", header: "Exception", render: (r) => (
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.8125rem" }}>{r.type}</span>
              ) },
              { key: "msg", header: "Message", render: (r) => <span style={{ color: "var(--text-2)", fontSize: "0.8125rem" }}>{r.msg}</span> },
              { key: "source", header: "Source", mono: true, muted: true },
              { key: "count", header: "Count", render: (r) => <Badge tone="warning">{r.count}×</Badge> },
              { key: "last", header: "Last Seen", muted: true },
            ]}
            rows={ERROR_ROWS}
            rowKey={(r) => r.id}
          />
        )}
      </Panel>
    </div>
  );
}
