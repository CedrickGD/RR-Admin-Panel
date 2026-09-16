import { useEffect, useMemo, useState } from "react";
import { Activity, Archive, Clock, HeartPulse, ServerCrash } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SYSTEM_STATUS_POLL_MS, type SystemStatusPayload } from "../../shared/system-status";
import { ChartLegend } from "../components/charts/ChartLegend";
import { CHART_MARGIN } from "../components/charts/chartMargin";
import { TelemetryChartTooltip } from "../components/charts/TelemetryChartTooltip";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import { DataTable, type DataTableColumn } from "../components/ds/DataTable";
import { EmptyState } from "../components/ds/EmptyState";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
import { RelativeTime } from "../components/ds/RelativeTime";
import { KpiStatCard } from "../components/KpiStatCard";
import { apiUrl, fetchApi } from "../utils/api";
import { formatNumber } from "../utils/format";
import {
  OVERALL_LABEL,
  OVERALL_TONE,
  bucketLabel,
  formatBytes,
  formatUptime,
  serviceRows,
  statusDotClass,
  type ServiceRow,
} from "../utils/systemStatus";

const POLL_MS = SYSTEM_STATUS_POLL_MS;
/** The figure the page quotes; derived so the copy cannot drift from the interval it describes. */
const POLL_SECONDS = POLL_MS / 1000;
const EVENT_LEGEND = [{ label: "Events", color: "var(--chart-sessions)" }];

function useSystemStatus() {
  const [payload, setPayload] = useState<SystemStatusPayload | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function load() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const response = await fetchApi(
          apiUrl("/api/admin/system"),
          { method: "GET", credentials: "include", cache: "no-store" },
          { retry: false },
        );
        const data = (await response.json()) as SystemStatusPayload;
        if (!response.ok || data.ok !== true || !Array.isArray(data.incidents))
          throw new Error("Invalid system status response");
        if (active) {
          setPayload(data);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        pending = false;
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const visible = () => void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return { payload, failed };
}

/**
 * The Restarts column, for every row. Docker reports RestartCount only through inspect, and the
 * NAS gateway refuses inspect for every container because the same response carries Config.Env
 * (deploy/nas/docker-gateway/Caddyfile). The column stays, because losing it silently would be
 * the dishonest version; a dash is the page saying it does not know, the same dash every other
 * unreported figure uses.
 */
const RESTARTS_UNAVAILABLE = "—";

export function SystemStatusPage() {
  const { payload, failed } = useSystemStatus();
  const loading = !payload && !failed;
  /*
   * A failed poll keeps the last payload on screen. It is the best information there is, but it
   * is no longer a live health check, so the page says "Stale" instead of repeating the green
   * summary it happened to end on: the tiles, the dots and the incident copy all step back to
   * "last known" rather than "current".
   */
  const stale = failed && payload !== null;
  const rows = useMemo(() => (payload ? serviceRows(payload, { stale }) : []), [payload, stale]);
  const chartData = useMemo(
    () =>
      payload?.events?.buckets.map((bucket) => ({
        label: bucketLabel(bucket.start),
        count: bucket.count,
      })) ?? [],
    [payload],
  );

  const columns: Array<DataTableColumn<ServiceRow>> = [
    {
      key: "service",
      header: "Service",
      render: (row) => (
        <span className="system-service">
          <span className={statusDotClass(row.tone)} aria-hidden="true" />
          <span className="system-service-text">
            <span className="system-service-name">{row.key}</span>
            <span className="system-service-detail">{row.detail}</span>
          </span>
        </span>
      ),
    },
    { key: "health", header: "Health", render: (row) => row.health },
    {
      key: "uptime",
      header: "Uptime",
      // Docker's own rounded phrase ("12 days"), printed as it arrives: splitting it into units
      // would add a "0 h" the container list never measured.
      render: (row) => row.uptime ?? "—",
    },
    {
      key: "restarts",
      header: "Restarts",
      numeric: true,
      render: () => RESTARTS_UNAVAILABLE,
    },
    {
      key: "cpu",
      header: "CPU",
      numeric: true,
      render: (row) => (row.cpuPercent === null ? "—" : `${row.cpuPercent.toFixed(1)} %`),
    },
    {
      key: "memory",
      header: "Memory",
      numeric: true,
      render: (row) => formatBytes(row.memoryBytes),
    },
  ];

  const events = payload?.events ?? null;
  const backup = payload?.backup ?? null;
  // Without the success marker the backup figures come from the newest file alone: it was
  // written, whether it is intact is not known (shared/system-status.ts), and the line says so.
  const backupLine = !backup
    ? "Backup folder not mounted"
    : backup.newestFile === null
      ? "No backup file yet"
      : backup.verified === false
        ? `${backup.newestFile} · not verified`
        : backup.newestFile;
  const incidents = payload?.incidents ?? [];
  const incidentLine =
    incidents.length === 0
      ? "No incidents"
      : `${incidents.length} open incident${incidents.length === 1 ? "" : "s"}`;
  const overall = !payload
    ? null
    : stale
      ? { tone: "unknown" as const, label: "Stale" }
      : { tone: OVERALL_TONE[payload.overall], label: OVERALL_LABEL[payload.overall] };
  /*
   * At most two short lines. The container line names docker-gateway because that is the call
   * rr-api made: whether the gateway, docker-proxy behind it or the socket failed is not
   * something a failed call can tell apart, so the note stops at what was observed.
   */
  const servicesNote = [
    stale ? "Last successful check." : null,
    payload?.containers === null
      ? `${
          payload.sources?.containers === "not-configured"
            ? "No container data on this runtime."
            : "The call to docker-gateway did not answer, so there is no container data."
        } rr-api, bot and database come from their own checks.`
      : null,
    payload?.containers
      ? "Uptime is Docker's rounded figure; restart counts are not available."
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        page="system"
        sub={
          stale
            ? `The last refresh failed. Showing the previous result; retrying every ${POLL_SECONDS} seconds.`
            : `rr-api, database, Discord bot and NAS containers. Refreshes every ${POLL_SECONDS} seconds.`
        }
      />

      <div className="stat-grid stat-grid-4">
        <KpiStatCard
          label="Overall"
          loading={loading}
          value={
            overall ? (
              <span className="system-overall">
                <span className={statusDotClass(overall.tone)} aria-hidden="true" />
                {overall.label}
              </span>
            ) : (
              "Unknown"
            )
          }
          sub={
            !payload
              ? "Backend did not answer"
              : stale
                ? `${incidentLine} at the last check`
                : incidentLine
          }
          icon={<HeartPulse size={14} />}
        />
        <KpiStatCard
          label="Uptime"
          loading={loading}
          value={
            payload?.runtime.uptimeSeconds != null
              ? formatUptime(payload.runtime.uptimeSeconds)
              : "Unknown"
          }
          sub={payload?.runtime.uptimeSeconds != null ? "rr-api process" : "Not reported here"}
          icon={<Clock size={14} />}
        />
        <KpiStatCard
          label="Events last 60 min"
          loading={loading}
          value={events ? formatNumber(events.last60Minutes) : "Unknown"}
          sub={
            events ? `${formatNumber(events.last5Minutes)} in the last 5 min` : "Event query failed"
          }
          icon={<Activity size={14} />}
        />
        <KpiStatCard
          label="Last backup"
          loading={loading}
          value={backup?.newestAt ? <RelativeTime iso={backup.newestAt} /> : "Unknown"}
          sub={backupLine}
          icon={<Archive size={14} />}
        />
      </div>

      {!payload && failed ? (
        <section className="panel">
          <EmptyState icon={<ServerCrash />} title="System health unavailable">
            The backend did not answer. Retrying every {POLL_SECONDS} seconds.
          </EmptyState>
        </section>
      ) : null}

      {payload ? (
        <>
          <CollapsiblePanel title="Services" sub={servicesNote || undefined} padding="flush">
            <DataTable
              flush
              mobileLayout="stack"
              caption="NAS services with health, uptime, CPU and memory. Restart counts are not available."
              columns={columns}
              rows={rows}
              rowKey={(row) => row.key}
            />
          </CollapsiblePanel>

          <div className="system-split">
            <CollapsiblePanel
              title="Event rate"
              sub="Stored events per five minutes, last hour."
              right={
                events ? (
                  <div className="chart-head-tools">
                    <ChartLegend items={EVENT_LEGEND} />
                    <MetaRow
                      items={[
                        { label: "Last 5 min", value: formatNumber(events.last5Minutes) },
                        { label: "Last ingest", value: <RelativeTime iso={events.lastIngestAt} /> },
                      ]}
                    />
                  </div>
                ) : undefined
              }
            >
              <div className="panel-body">
                {events ? (
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={chartData} margin={CHART_MARGIN}>
                        <defs>
                          <linearGradient id="systemEventsFill" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="0%"
                              stopColor="var(--chart-sessions)"
                              stopOpacity={0.22}
                            />
                            <stop
                              offset="100%"
                              stopColor="var(--chart-sessions)"
                              stopOpacity={0.01}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid
                          stroke="var(--chart-grid)"
                          vertical={false}
                          strokeDasharray="3 6"
                        />
                        <XAxis
                          dataKey="label"
                          tickLine={false}
                          axisLine={false}
                          minTickGap={24}
                          tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={32}
                          allowDecimals={false}
                          tick={{ fill: "var(--chart-axis-soft)", fontSize: 11 }}
                          tickFormatter={(value: number) => formatNumber(Number(value))}
                        />
                        <Tooltip
                          isAnimationActive={false}
                          cursor={false}
                          content={({ active, payload: entries, label }) => (
                            <TelemetryChartTooltip
                              active={active}
                              label={label}
                              payload={
                                entries?.map((entry) => ({
                                  name: String(entry.name ?? ""),
                                  value: Number(entry.value ?? 0),
                                  color: entry.color,
                                })) ?? []
                              }
                            />
                          )}
                        />
                        <Area
                          isAnimationActive={false}
                          type="monotone"
                          dataKey="count"
                          name="Events"
                          stroke="var(--chart-sessions)"
                          strokeWidth={2}
                          fill="url(#systemEventsFill)"
                          dot={false}
                          activeDot={{ r: 4, strokeWidth: 0, fill: "var(--chart-sessions)" }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState icon={<Activity />} title="Event rate unavailable">
                    The database query for recent events failed on this refresh.
                  </EmptyState>
                )}
              </div>
            </CollapsiblePanel>

            <CollapsiblePanel title="Incidents" padding="body">
              {incidents.length === 0 && stale ? (
                <EmptyState icon={<Clock />} title="No incidents at the last check">
                  The refresh after it failed, so nothing here was verified just now.
                </EmptyState>
              ) : incidents.length === 0 ? (
                <EmptyState allClear title="No incidents">
                  Every check passed on the last refresh.
                </EmptyState>
              ) : (
                <ul className="system-incidents">
                  {incidents.map((incident) => (
                    <li className="system-incident" key={incident.id}>
                      <span
                        className={statusDotClass(
                          incident.severity === "critical" ? "danger" : "warning",
                        )}
                        aria-hidden="true"
                      />
                      <div className="system-incident-text">
                        <p className="system-incident-title">
                          {incident.title}
                          <span className="sr-only">
                            {incident.severity === "critical" ? " (critical)" : " (warning)"}
                          </span>
                        </p>
                        <p className="system-incident-detail">{incident.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CollapsiblePanel>
          </div>

          <p className="system-footnote">
            Build {payload.build.commit} · Node {payload.runtime.node ?? "not reported"} · checked{" "}
            <RelativeTime iso={payload.generatedAt} />
          </p>
        </>
      ) : null}
    </div>
  );
}
