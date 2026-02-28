import type { Timeframe } from "../types/telemetry";
import { TIMEFRAMES } from "../utils/telemetry";

interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
}

export function TimeframeSelector({ value, onChange }: TimeframeSelectorProps) {
  return (
    <div className="timeframe-bar">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf}
          className={`timeframe-btn ${tf === value ? "timeframe-btn-active" : ""}`}
          onClick={() => onChange(tf)}
          type="button"
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
