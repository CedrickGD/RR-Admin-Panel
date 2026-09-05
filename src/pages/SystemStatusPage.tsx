import { useEffect, useState } from "react";
import { Activity, Database, Server } from "lucide-react";
import { PageHeader } from "../components/ds/PageHeader";
import { CollapsiblePanel } from "../components/CollapsiblePanel";
import type { HealthPayload } from "../types/telemetry";
import { apiUrl, fetchApi } from "../utils/api";
import { formatDate, formatNumber } from "../utils/format";
import { systemChecks } from "../utils/systemStatus";

export function SystemStatusPage() {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function check() {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      const started = performance.now();
      try {
        const response = await fetchApi(
          apiUrl("/api/admin/health"),
          { method: "GET", credentials: "include", cache: "no-store" },
          { retry: false },
        );
        const data = (await response.json()) as HealthPayload;
        if (!response.ok || data.api !== "alive" || !data.storage || typeof data.ok !== "boolean")
          throw new Error("Invalid health response");
        if (active) {
          setHealth(data);
          setLatency(Math.round(performance.now() - started));
          setCheckedAt(Date.now());
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
        if (active) setNow(Date.now());
      }
    }
    void check();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void check();
    }, 15_000);
    const visible = () => {
      setNow(Date.now());
      void check();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const checks = systemChecks(health, error, checkedAt, now);
  const icons = [<Server />, <Database />, <Activity />];
  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        title="Backend status"
        sub="API, database and incoming data. Checked automatically every 15 seconds."
      />
      <div className="system-checks">
        {checks.map((check, index) => (
          <section className="panel system-check" key={check.name}>
            <div className="system-check-title">
              {icons[index]}
              <h2>{check.name}</h2>
            </div>
            <strong className={`system-check-state is-${check.tone}`}>{check.state}</strong>
            <p>{check.detail}</p>
          </section>
        ))}
      </div>
      <CollapsiblePanel
        title="Latest successful check"
        sub={
          error
            ? "The current request failed. Values below are from the last successful response."
            : undefined
        }
        padding="body"
      >
        <dl className="system-check-details">
          <div>
            <dt>Checked</dt>
            <dd>
              {checkedAt ? formatDate(new Date(checkedAt).toISOString()) : "Not yet available"}
            </dd>
          </div>
          <div>
            <dt>Response time</dt>
            <dd>{latency === null ? "Not yet available" : `${latency} ms`}</dd>
          </div>
          <div>
            <dt>Latest application event</dt>
            <dd>{health?.lastIngestAt ? formatDate(health.lastIngestAt) : "None reported"}</dd>
          </div>
          <div>
            <dt>Stored events</dt>
            <dd>{health ? formatNumber(health.count) : "Unknown"}</dd>
          </div>
          <div>
            <dt>Environment</dt>
            <dd>{health?.build?.environment ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Backend revision</dt>
            <dd>{health?.build?.commit ?? "Not reported"}</dd>
          </div>
        </dl>
      </CollapsiblePanel>
      <CollapsiblePanel title="NAS services" padding="body">
        <p className="system-check-note">
          Container processes, the Discord bot and backup jobs do not currently report their own
          health to the panel. Their status is unknown here; a reachable API does not confirm that
          those services are healthy.
        </p>
      </CollapsiblePanel>
    </div>
  );
}
