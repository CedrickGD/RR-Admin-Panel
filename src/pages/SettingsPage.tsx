import { BarChart3, Check, LogOut, Palette, RotateCcw, Server, Shield, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { ACCENT_PRESETS, useAccent } from "../hooks/useAccent";
import { useAppearance } from "../hooks/useAppearance";
import { useChartColors } from "../hooks/useChartColors";
import type { AuthMode, AuthUser, HealthPayload, SummaryPayload } from "../types/telemetry";

interface SettingsPageProps {
  user: AuthUser;
  authMode: AuthMode;
  summary: SummaryPayload;
  health: HealthPayload;
  onLogout: () => void;
}

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, min, max, step, unit = "", onChange }: SliderRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
      <span style={{ fontSize: 12, color: "var(--text-2)", minWidth: 120, fontWeight: 500 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-hue-slider"
        style={{ flex: 1 }}
      />
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "var(--text-3)", minWidth: 48, textAlign: "right" }}>
        {value}{unit}
      </span>
    </div>
  );
}

export function SettingsPage({ user, authMode, summary, health, onLogout }: SettingsPageProps) {
  const { hue, setHue, activePreset } = useAccent();
  const { override: chartColorOverride, setPreset: setChartPreset, activeLabel: chartActiveLabel, presets: chartPresets } = useChartColors();
  const { settings: appearance, update: updateAppearance, reset: resetAppearance, defaults } = useAppearance();
  const [copied, setCopied] = useState<string | null>(null);

  function copyToClipboard(value: string, key: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  const isDefault =
    appearance.panelBrightness === defaults.panelBrightness &&
    appearance.glowIntensity === defaults.glowIntensity &&
    appearance.borderVisibility === defaults.borderVisibility &&
    appearance.textContrast === defaults.textContrast &&
    appearance.navbarBlur === defaults.navbarBlur &&
    appearance.panelRadius === defaults.panelRadius;

  return (
    <div className="page-content page-stack-lg">
      {/* Header */}
      <section className="page-header">
        <div>
          <p className="kicker">Configuration</p>
          <h1 className="page-title" style={{ marginTop: 6 }}>Settings</h1>
          <p className="page-subtitle">Account identity, appearance, and backend configuration.</p>
        </div>
        <div className="page-header-right">
          <div className="meta-row">
            {[
              { label: "Auth Mode", val: authMode === "access" ? "Zero Trust" : "App Auth" },
              { label: "Storage",   val: summary.storage.toUpperCase() },
              { label: "API",       val: health.api === "alive" ? "Online" : "Offline" },
            ].map((m) => (
              <div className="meta-item" key={m.label}><span>{m.label}</span><strong>{m.val}</strong></div>
            ))}
          </div>
        </div>
      </section>

      <div className="two-col">
        {/* Account */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Shield className="h-3 w-3" /> Account
              </p>
              <h2 className="section-title">Identity</h2>
            </div>
          </div>
          <div className="panel-body-tight">
            <div className="kv-list">
              {[
                { k: "Email",     v: user.email },
                { k: "Role",      v: user.role },
                { k: "Auth Mode", v: authMode === "access" ? "Cloudflare Access (Zero Trust)" : "Email & Password" },
              ].map(({ k, v }) => (
                <div className="kv-row" key={k}>
                  <span className="kv-key">{k}</span>
                  <span className="kv-val">{v}</span>
                </div>
              ))}
            </div>
            {authMode === "app" ? (
              <div style={{ marginTop: 16 }}>
                <button type="button" className="btn btn-danger btn-sm" onClick={onLogout}>
                  <LogOut className="h-3.5 w-3.5" /> Sign Out
                </button>
              </div>
            ) : null}
          </div>
        </section>

        {/* System */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Server className="h-3 w-3" /> Backend
              </p>
              <h2 className="section-title">System Status</h2>
            </div>
            <span className={`badge ${health.api === "alive" ? "badge-success" : "badge-danger"}`}>
              {health.api === "alive" ? "Online" : "Offline"}
            </span>
          </div>
          <div className="panel-body-tight">
            <div className="kv-list">
              {[
                { k: "Storage",     v: summary.storage.toUpperCase() },
                { k: "API",         v: health.api === "alive" ? "Alive" : "Down" },
                { k: "Commit",      v: health.build?.commit ?? "unknown" },
                { k: "Branch",      v: health.build?.branch ?? "unknown" },
                { k: "Environment", v: health.build?.environment ?? "unknown" },
              ].map(({ k, v }) => (
                <div className="kv-row" key={k}>
                  <span className="kv-key">{k}</span>
                  <button
                    type="button"
                    className="kv-val"
                    style={{ cursor: "copy", background: "none", border: "none", padding: 0, font: "inherit", color: "inherit" }}
                    onClick={() => copyToClipboard(v, k)}
                    title="Click to copy"
                  >
                    {copied === k ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--success)" }}>
                        <Check className="h-3 w-3" /> Copied
                      </span>
                    ) : v}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Accent color picker */}
      <section className="panel" style={{ position: "relative", overflow: "visible" }}>
        <div style={{ position: "absolute", top: 0, left: "10%", right: "10%", height: 1, background: "linear-gradient(90deg, transparent, var(--accent-glow), transparent)" }} />
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Palette className="h-3 w-3" /> Appearance
            </p>
            <h2 className="section-title">Accent Color</h2>
            <p className="section-sub">All highlights, buttons, map dots, and glows follow this hue.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: `hsl(${hue} 83% 62%)`,
              border: "2px solid rgba(255,255,255,0.15)",
              boxShadow: `0 0 16px hsl(${hue} 83% 62% / 0.5)`,
            }} />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem", color: "var(--text-2)" }}>
              hsl({hue}°)
            </span>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ marginBottom: 20 }}>
            <p className="label-sm" style={{ marginBottom: 12 }}>Presets</p>
            <div className="accent-picker-swatches">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.hue}
                  type="button"
                  className={`accent-swatch${preset.hue === hue ? " active" : ""}`}
                  style={{ background: preset.color }}
                  onClick={() => setHue(preset.hue)}
                  title={preset.label}
                  aria-label={`Set accent to ${preset.label}`}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="label-sm" style={{ marginBottom: 12 }}>
              Custom Hue
              <span style={{ marginLeft: 8, fontFamily: "JetBrains Mono, monospace", color: "var(--text-2)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                {hue}°{activePreset ? ` — ${activePreset.label}` : ""}
              </span>
            </p>
            <input type="range" min={0} max={360} step={1} value={hue} onChange={(e) => setHue(Number(e.target.value))} className="accent-hue-slider" />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
              <span style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>0°</span>
              <span style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>360°</span>
            </div>
          </div>
          <div style={{ marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <p className="label-sm" style={{ width: "100%", marginBottom: 4 }}>Preview</p>
            <button type="button" className="btn btn-primary btn-sm">Primary Button</button>
            <button type="button" className="btn btn-ghost btn-sm">Ghost Button</button>
            <span className="badge badge-accent">Accent Badge</span>
            <span className="badge-live">Live</span>
            <div style={{ padding: "8px 14px", borderRadius: 8, background: "var(--accent-subtle)", border: "1px solid var(--accent-glow)", fontSize: "0.8125rem", color: "var(--accent-text)" }}>
              Accent card
            </div>
          </div>
        </div>
      </section>

      {/* Interface Tuning */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <SlidersHorizontal className="h-3 w-3" /> Interface
            </p>
            <h2 className="section-title">Element Tuning</h2>
            <p className="section-sub">Fine-tune panel surfaces, glow effects, borders, text, and layout.</p>
          </div>
          {!isDefault && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={resetAppearance} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
        <div className="panel-body">
          <SliderRow
            label="Panel Brightness"
            value={Math.round(appearance.panelBrightness * 100)}
            min={40} max={200} step={5} unit="%"
            onChange={(v) => updateAppearance("panelBrightness", v / 100)}
          />
          <SliderRow
            label="Glow Intensity"
            value={Math.round(appearance.glowIntensity * 100)}
            min={0} max={200} step={5} unit="%"
            onChange={(v) => updateAppearance("glowIntensity", v / 100)}
          />
          <SliderRow
            label="Border Visibility"
            value={Math.round(appearance.borderVisibility * 100)}
            min={0} max={200} step={5} unit="%"
            onChange={(v) => updateAppearance("borderVisibility", v / 100)}
          />
          <SliderRow
            label="Text Contrast"
            value={Math.round(appearance.textContrast * 100)}
            min={60} max={100} step={1} unit="%"
            onChange={(v) => updateAppearance("textContrast", v / 100)}
          />
          <SliderRow
            label="Navbar Blur"
            value={appearance.navbarBlur}
            min={0} max={40} step={2} unit="px"
            onChange={(v) => updateAppearance("navbarBlur", v)}
          />
          <SliderRow
            label="Panel Radius"
            value={appearance.panelRadius}
            min={0} max={24} step={1} unit="px"
            onChange={(v) => updateAppearance("panelRadius", v)}
          />
        </div>
      </section>

      {/* Chart color preset */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 className="h-3 w-3" /> Charts
            </p>
            <h2 className="section-title">Chart Colors</h2>
            <p className="section-sub">Color theme for traffic and analytics charts.</p>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chartPresets.map((preset) => {
              const isActive = chartActiveLabel === preset.label;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setChartPreset(preset.label === "Default" ? null : preset)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 16px", borderRadius: 10,
                    border: isActive ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.06)",
                    cursor: "pointer",
                    background: isActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ display: "flex", gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: preset.users, boxShadow: isActive ? `0 0 8px ${preset.users}` : "none" }} />
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: preset.errors, boxShadow: isActive ? `0 0 8px ${preset.errors}` : "none" }} />
                  </div>
                  <span style={{ fontSize: "0.8rem", color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)", fontWeight: isActive ? 500 : 400 }}>
                    {preset.label}
                  </span>
                  {isActive && <Check className="h-3.5 w-3.5" style={{ color: "var(--accent-text)", marginLeft: 2 }} />}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
