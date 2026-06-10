import type { CSSProperties } from "react";
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
  /** Render a summed total row beneath entries (only shown when 2+ numeric entries). */
  showTotal?: boolean;
  /** Label for the total row. Defaults to "Total". */
  totalLabel?: string;
  /** Custom value formatter applied to every entry (and the total). */
  valueFormatter?: (value: number | string) => string;
}

function defaultFormatValue(value: number | string | undefined): string {
  if (typeof value === "number") {
    return formatNumber(value);
  }

  return value == null ? "0" : String(value);
}

const rowLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
  fontSize: "0.76rem",
  color: "var(--text-2)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const rowValueStyle: CSSProperties = {
  fontSize: "0.82rem",
  fontWeight: 600,
  color: "var(--text-1)",
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "0.01em",
};

function ColorDot({ color }: { color?: string }) {
  const resolved = color ?? "var(--text-3)";
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: resolved,
        boxShadow: `0 0 0 2px color-mix(in srgb, ${resolved} 22%, transparent), 0 0 7px color-mix(in srgb, ${resolved} 42%, transparent)`,
        flexShrink: 0,
      }}
    />
  );
}

export function TelemetryChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  showTotal = false,
  totalLabel = "Total",
  valueFormatter,
}: TelemetryChartTooltipProps) {
  const rows = payload?.filter((entry) => entry.value !== undefined) ?? [];

  if (!active || rows.length === 0) {
    return null;
  }

  const formatValue = valueFormatter ?? defaultFormatValue;
  const numericValues = rows
    .map((entry) => entry.value)
    .filter((value): value is number => typeof value === "number");
  const shouldShowTotal = showTotal && numericValues.length >= 2;
  const total = numericValues.reduce((sum, value) => sum + value, 0);

  return (
    <div
      style={{
        background: "color-mix(in srgb, var(--bg2) 88%, transparent)",
        backdropFilter: "var(--glass-blur, blur(20px) saturate(180%))",
        WebkitBackdropFilter: "var(--glass-blur, blur(20px) saturate(180%))",
        border: "1px solid var(--glass-border2, rgba(255,255,255,0.14))",
        borderRadius: 12,
        padding: "10px 14px 11px",
        minWidth: 168,
        maxWidth: 280,
        boxShadow:
          "0 12px 36px -8px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.06)",
        pointerEvents: "none",
      }}
    >
      {label ? (
        <p
          style={{
            margin: 0,
            marginBottom: 8,
            fontSize: "0.66rem",
            fontWeight: 600,
            color: "var(--text-3)",
            letterSpacing: "0.09em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
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
              gap: 18,
            }}
          >
            <span style={rowLabelStyle}>
              <ColorDot color={entry.color} />
              {entry.name ?? "Value"}
            </span>
            <strong style={rowValueStyle}>{formatValue(entry.value ?? 0)}</strong>
          </div>
        ))}
      </div>

      {shouldShowTotal ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            marginTop: 8,
            paddingTop: 7,
            borderTop: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 600,
              color: "var(--text-3)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {totalLabel}
          </span>
          <strong style={rowValueStyle}>{formatValue(total)}</strong>
        </div>
      ) : null}
    </div>
  );
}
