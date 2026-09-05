import type { HealthPayload } from "../types/telemetry";

export type SystemCheck = {
  name: string;
  state: string;
  detail: string;
  tone: "ok" | "warning" | "unknown";
};

export function systemChecks(
  health: HealthPayload | null,
  failed: boolean,
  checkedAt: number | null,
  now: number,
): SystemCheck[] {
  const current = !failed && checkedAt !== null && now - checkedAt < 45_000;
  if (!current || !health)
    return [
      {
        name: "Backend API",
        state: failed ? "Unreachable" : checkedAt ? "Check overdue" : "Checking",
        detail: "No current response has been verified.",
        tone: failed ? "warning" : "unknown",
      },
      {
        name: "Database",
        state: "Unknown",
        detail: "A fresh backend check is required.",
        tone: "unknown",
      },
      {
        name: "Telemetry",
        state: "Unknown",
        detail: "Incoming data cannot be checked right now.",
        tone: "unknown",
      },
    ];
  const lastIngest = Date.parse(health.lastIngestAt ?? "");
  const receiving = Number.isFinite(lastIngest) && now - lastIngest < 10 * 60_000;
  return [
    {
      name: "Backend API",
      state: health.ok && health.api === "alive" ? "Reachable" : "Needs attention",
      detail: "The backend answered the health request.",
      tone: health.ok ? "ok" : "warning",
    },
    {
      name: "Database",
      state:
        health.storage.available === true
          ? "Connected"
          : health.storage.available === false
            ? "Unavailable"
            : "Unknown",
      detail:
        health.storage.available === true
          ? "The backend verified a database read."
          : "No successful database read was reported.",
      tone:
        health.storage.available === true
          ? "ok"
          : health.storage.available === false
            ? "warning"
            : "unknown",
    },
    {
      name: "Telemetry",
      state: receiving ? "Receiving data" : "No recent events",
      detail: receiving
        ? "An application event arrived within the last 10 minutes."
        : "No recent event was reported. Idle apps alone do not indicate an outage.",
      tone: receiving ? "ok" : "unknown",
    },
  ];
}
