import { formatNumber } from "../../utils/format";

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

interface TelemetryChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  labelFormatter?: (label?: string) => string;
}

function formatTooltipValue(value: number | string | undefined): string {
  if (typeof value === "number") {
    return formatNumber(value);
  }

  return value == null ? "0" : String(value);
}

export function TelemetryChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
}: TelemetryChartTooltipProps) {
  const rows = payload?.filter((entry) => entry.value !== undefined) ?? [];

  if (!active || rows.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: "rgba(10, 10, 20, 0.92)",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        border: "1px solid rgba(255, 255, 255, 0.10)",
        borderRadius: 12,
        padding: "10px 14px",
        minWidth: 160,
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255,255,255,0.05) inset",
      }}
    >
      {label ? (
        <p
          style={{
            fontSize: "0.7rem",
            fontWeight: 500,
            color: "rgba(255,255,255,0.45)",
            marginBottom: 8,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((entry, index) => (
          <div
            key={`${entry.name ?? "row"}-${index}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontSize: "0.78rem",
                color: "rgba(255,255,255,0.65)",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: entry.color ?? "rgba(255,255,255,0.72)",
                  boxShadow: `0 0 6px ${entry.color ?? "rgba(255,255,255,0.3)"}`,
                  flexShrink: 0,
                }}
              />
              {entry.name ?? "Value"}
            </span>
            <strong
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "rgba(255,255,255,0.95)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatTooltipValue(entry.value)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
