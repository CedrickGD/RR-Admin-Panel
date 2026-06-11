import React from "react";
import { PageHeader, MetaRow } from "../../components/shell/PageHeader.jsx";
import { Panel } from "../../components/panels/Panel.jsx";
import { DataTable, DetailGrid } from "../../components/tables/DataTable.jsx";
import { Badge, LiveBadge } from "../../components/indicators/Badge.jsx";
import { StatusBadge } from "../../components/indicators/StatusBadge.jsx";
import { IconButton } from "../../components/controls/Button.jsx";
import { LIVE_SESSIONS } from "./ConsoleData.jsx";

/** Live — only genuinely active sessions (last 6 minutes), stable sort. */
export function LiveScreen() {
  const [openId, setOpenId] = React.useState(null);

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Realtime"
        title="Live Sessions"
        right={<>
          <LiveBadge>{LIVE_SESSIONS.length} live</LiveBadge>
          <Badge tone="accent" title="2 active sessions report Discord Rich Presence on">Discord RPC · 2</Badge>
          <MetaRow items={[
            { label: "Live Errors", value: "1" },
            { label: "Last Ingest", value: "2m ago" },
            { label: "Updated", value: "8s ago" },
          ]} />
        </>}
      />

      <Panel
        kicker="Active"
        title="Open Sessions"
        sub="Showing sessions active within the last 6 minutes."
        padding="flush"
        right={<>
          <LiveBadge>{LIVE_SESSIONS.length}</LiveBadge>
          <Badge tone="danger">1 errors</Badge>
        </>}
      >
        <DataTable
          flush
          columns={[
            { key: "user", header: "User", render: (r) => (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.8125rem" }}>{r.user}</span>
                {r.discord ? <span style={{ fontSize: "0.6875rem", color: "var(--text-2)" }} title={`Discord: ${r.discord}`}>@{r.discord}</span> : null}
                {r.rpc ? <Badge tone="accent" title="Discord Rich Presence on">RPC</Badge> : null}
              </span>
            ) },
            { key: "location", header: "Location", muted: true },
            { key: "version", header: "Version", render: (r) => <Badge tone="muted">{r.version}</Badge> },
            { key: "platform", header: "Platform", muted: true },
            { key: "duration", header: "Duration", muted: true },
            { key: "lastEvent", header: "Last Event", render: (r) => <span style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>{r.lastEvent}</span> },
            { key: "status", header: "Status", render: (r) => <StatusBadge presence={r.presence} /> },
            { key: "actions", header: "", render: (r) => (
              <span style={{ display: "inline-flex", gap: 4 }}>
                <IconButton icon="globe" title="View on map" />
                <IconButton
                  icon={openId === r.id ? "chevron-up" : "chevron-down"}
                  title={openId === r.id ? "Collapse" : "Expand"}
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                />
              </span>
            ) },
          ]}
          rows={LIVE_SESSIONS}
          rowKey={(r) => r.id}
          expandedKey={openId}
          renderExpanded={(r) => (
            <div>
              <p className="label-sm" style={{ marginBottom: 8 }}>Session Timeline</p>
              <div className="timeline-track" style={{ marginBottom: 14 }}>
                <div className="timeline-fill" style={{ width: "100%" }}></div>
                {r.errors > 0 ? <div className="timeline-marker is-error" style={{ left: "62%" }} title="NullReferenceException at 13:18"></div> : null}
              </div>
              <DetailGrid items={[
                { k: "Install ID", v: `install:${r.id.slice(2, 6)}-91bb` },
                { k: "Session ID", v: r.id },
                { k: "Client IP", v: r.ip },
                { k: "Started", v: r.started },
                { k: "Events", v: String(r.events) },
                { k: "Error Count", v: String(r.errors) },
                { k: "Discord RPC", v: r.rpc ? "On" : "Off" },
                { k: "Discord User", v: r.discord || "—" },
                { k: "Timezone", v: r.timezone },
                { k: "Geo Source", v: "IP (precise)" },
              ]} />
            </div>
          )}
        />
      </Panel>
    </div>
  );
}
