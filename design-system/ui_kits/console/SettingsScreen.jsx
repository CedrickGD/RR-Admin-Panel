import React from "react";
import { PageHeader, MetaRow } from "../../components/shell/PageHeader.jsx";
import { Panel } from "../../components/panels/Panel.jsx";
import { KvList } from "../../components/tables/KvList.jsx";
import { Badge } from "../../components/indicators/Badge.jsx";
import { Button } from "../../components/controls/Button.jsx";
import { ACCENT_PRESETS } from "./ConsoleData.jsx";

const CHART_PRESETS = [
  { label: "Default", users: "#6b8de3", errors: "#e06b6b" },
  { label: "Emerald", users: "#34d399", errors: "#f87171" },
  { label: "Amber", users: "#fbbf24", errors: "#ef4444" },
  { label: "Rose", users: "#fb7185", errors: "#a78bfa" },
  { label: "Cyan", users: "#22d3ee", errors: "#f472b6" },
  { label: "Violet", users: "#a78bfa", errors: "#fb923c" },
];

/** Settings — account identity, backend status, accent + chart appearance. */
export function SettingsScreen({ hue, onHueChange }) {
  const [chartPreset, setChartPreset] = React.useState("Default");
  const activePreset = ACCENT_PRESETS.find((p) => p.hue === hue) ?? null;

  const applyChartPreset = (preset) => {
    setChartPreset(preset.label);
    const root = document.documentElement;
    root.style.setProperty("--chart-users", preset.users);
    root.style.setProperty("--chart-errors", preset.errors);
    root.style.setProperty("--chart-sessions", preset.users.startsWith("#") ? `${preset.users}40` : preset.users);
  };

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Configuration"
        title="Settings"
        right={<MetaRow items={[
          { label: "Auth Mode", value: "Zero Trust" },
          { label: "Storage", value: "D1" },
          { label: "API", value: "Online" },
        ]} />}
      />

      <div className="two-col">
        <Panel kicker="Account" title="Identity" padding="tight">
          <KvList items={[
            { k: "Email", v: "ops@razorreaper.app" },
            { k: "Role", v: "admin" },
            { k: "Auth Mode", v: "Cloudflare Access (Zero Trust)" },
          ]} />
        </Panel>
        <Panel kicker="Backend" title="System Status" padding="tight" right={<Badge tone="success">Online</Badge>}>
          <KvList items={[
            { k: "Storage", v: "D1" },
            { k: "API", v: "Alive" },
            { k: "Commit", v: "d4f81c2" },
            { k: "Branch", v: "main" },
            { k: "Environment", v: "production" },
          ]} />
        </Panel>
      </div>

      <Panel
        kicker="Appearance"
        title="Accent Color"
        sub="Pick any accent hue — all interface highlights, buttons, and glows update instantly. Saved to your browser."
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `hsl(${hue} 83% 62%)`, border: "2px solid rgba(255,255,255,0.15)", boxShadow: `0 0 16px hsl(${hue} 83% 62% / 0.5)` }}></div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-2)" }}>hsl({hue}°)</span>
          </div>
        }
      >
        <div style={{ marginBottom: 18 }}>
          <p className="label-sm" style={{ marginBottom: 10 }}>Presets</p>
          <div className="accent-picker-swatches">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.hue}
                type="button"
                className={`accent-swatch${preset.hue === hue ? " active" : ""}`}
                style={{ background: `hsl(${preset.hue} 83% 62%)` }}
                onClick={() => onHueChange(preset.hue)}
                title={preset.label}
                aria-label={`Set accent to ${preset.label}`}
              ></button>
            ))}
          </div>
        </div>
        <div>
          <p className="label-sm" style={{ marginBottom: 10 }}>
            Custom Hue
            <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)", color: "var(--text-2)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {hue}°{activePreset ? ` — ${activePreset.label}` : ""}
            </span>
          </p>
          <input type="range" min={0} max={360} step={1} value={hue} onChange={(e) => onHueChange(Number(e.target.value))} className="accent-hue-slider" />
        </div>
        <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <p className="label-sm" style={{ width: "100%", marginBottom: 2 }}>Preview</p>
          <Button variant="primary" size="sm">Primary Button</Button>
          <Button size="sm">Ghost Button</Button>
          <Badge tone="accent">Accent Badge</Badge>
          <span className="badge-live">Live</span>
        </div>
      </Panel>

      <Panel kicker="Charts" title="Chart Colors" sub="Choose a color theme for traffic and analytics charts. Saved to your browser.">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {CHART_PRESETS.map((preset) => {
            const isActive = chartPreset === preset.label;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyChartPreset(preset)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10,
                  border: isActive ? "1px solid var(--line-hi)" : "1px solid var(--line)",
                  cursor: "pointer", background: isActive ? "var(--surface-3)" : "var(--surface-1)",
                  transition: "all 0.15s",
                }}
              >
                <span style={{ display: "flex", gap: 4 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: preset.users, boxShadow: isActive ? `0 0 8px ${preset.users}` : "none" }}></span>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: preset.errors, boxShadow: isActive ? `0 0 8px ${preset.errors}` : "none" }}></span>
                </span>
                <span style={{ fontSize: "0.8rem", color: isActive ? "var(--text-1)" : "var(--text-2)", fontWeight: isActive ? 500 : 400 }}>{preset.label}</span>
              </button>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
