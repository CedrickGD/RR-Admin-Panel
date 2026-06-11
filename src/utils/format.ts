export function formatRate(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

export function formatDate(value: string | null): string {
  if (!value) return "Never";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toLocaleString();
}

export function formatUtc(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  return new Date(ts).toISOString().replace("T", " ").replace(".000Z", "Z");
}

export function formatNumber(n: number): string {
  // Exact counts below a million — abbreviating to "3.0K" read like a cap.
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString("en-US");
}

export function timeAgo(value: string | null): string {
  if (!value) return "never";
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return "open";
  }

  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

export function formatAccuracy(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return "—";
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km`;
  }

  return `${Math.round(value)} m`;
}

export function formatGeoSource(source: string | null | undefined, signalSource?: string | null | undefined): string {
  const base = (() => {
    switch (source) {
      case "device_fused":
        return "Device fused";
      case "device_current":
        return "Device current";
      case "device_last_known":
        return "Device cache";
      case "edge_ip":
        return "Edge IP";
      case "edge_ip_country":
        return "Edge IP country";
      default:
        return source?.trim() || "Unknown";
    }
  })();

  const signal = signalSource?.trim();
  if (!signal) {
    return base;
  }

  return `${base} · ${signal}`;
}

export function formatEventName(value: string | null): string {
  switch (value) {
    case "session_start":
      return "Started";
    case "session_active":
      return "Heartbeat";
    case "session_end":
      return "Ended";
    case "app_error":
      return "App error";
    default:
      return value ? value.replaceAll("_", " ") : "Unknown";
  }
}
