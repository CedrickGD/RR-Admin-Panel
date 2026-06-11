import React from "react";
import { PageHeader } from "../../components/shell/PageHeader.jsx";
import { Panel } from "../../components/panels/Panel.jsx";
import { KpiTile } from "../../components/metrics/KpiTile.jsx";
import { RankList } from "../../components/metrics/RankList.jsx";
import { RadialGauge } from "../../components/metrics/RadialGauge.jsx";
import { Badge } from "../../components/indicators/Badge.jsx";
import { VERSIONS, COUNTRIES } from "./ConsoleData.jsx";

/** Versions — adoption funnel: rank bars, gauges, release context. */
export function VersionsScreen() {
  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Adoption"
        title="Versions"
        right={<Badge tone="accent">Latest · 1.6.2</Badge>}
      />

      <div className="stat-grid stat-grid-4 v2-stagger">
        <KpiTile label="Latest Version" value="1.6.2" sub="Released 2 days ago" icon="package" />
        <KpiTile label="On Latest" value="144" sub="63% of lifetime users" tone="success" icon="circle-check" />
        <KpiTile label="Outdated" value="73" sub="Including 12 on legacy" tone="warning" icon="layers" />
        <KpiTile label="Update Velocity" value="44%" sub="Adoption within 48h of release" icon="trending-up" />
      </div>

      <div className="main-side">
        <Panel kicker="Distribution" title="Users by Version" sub="Lifetime users, current version reported at last ingest.">
          <RankList items={VERSIONS.map((v) => ({ label: v.label, value: String(v.users), share: v.share }))} />
        </Panel>
        <div className="side-stack">
          <Panel kicker="Health" title="Coverage">
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <RadialGauge ratio={0.74} title="On 1.6.x" sub="162 of 220 users" />
              <RadialGauge ratio={0.41} title="Discord RPC on" sub="90 of 220 reporting" />
            </div>
          </Panel>
          <Panel kicker="Geography" title="Top Countries" padding="body">
            <RankList items={COUNTRIES.map((c) => ({ label: c.label, value: String(c.users), share: c.share }))} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
