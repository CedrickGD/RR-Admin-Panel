import React from "react";

/**
 * Segmented range control — the console's standard time-range switcher
 * (24 h / 7 d / 30 d / 90 d / All). Inset pill row, accent ring on active.
 */
export function SegmentedControl({ options, value, onChange, className = "" }) {
  return (
    <div className={`seg-control${className ? ` ${className}` : ""}`}>
      {options.map((option) => {
        const key = typeof option === "string" ? option : option.key;
        const label = typeof option === "string" ? option : option.label;
        return (
          <button
            key={key}
            type="button"
            className={`seg-btn${value === key ? " active" : ""}`}
            onClick={() => onChange && onChange(key)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
