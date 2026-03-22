import { BarChart3, Check, CircleDot, LogOut, Palette, Server, Shield } from "lucide-react";
import { useState } from "react";
import { ACCENT_PRESETS, useAccent } from "../hooks/useAccent";
import { useChartColors } from "../hooks/useChartColors";
import { useDonutColors } from "../hooks/useDonutColors";
import type { AuthMode, AuthUser, HealthPayload, SummaryPayload } from "../types/telemetry";

interface SettingsPageProps {
  user: AuthUser;
  authMode: AuthMode;
  summary: SummaryPayload;
  health: HealthPayload;
  onLogout: () => void;
}

export function SettingsPage({ user, authMode, summary, health, onLogout }: SettingsPageProps) {
  const { hue, setHue, activePreset } = useAccent();
  const { override: chartColorOverride, setPreset: setChartPreset, activeLabel: chartActiveLabel, presets: chartPresets } = useChartColors();
  const { setPreset: setDonutPreset, activeLabel: donutActiveLabel, presets: donutPresets } = useDonutColors();
  const [copied, setCopied] = useState<string | null>(null);

  function copyToClipboard(value: string, key: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  return (
    <div className="page-content page-stack-lg">
      <section className="page-header">
        <div>
          <h1 className="page-title">
            Settings
            <span className="kicker">Configuration</span>
          </h1>
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

      <section className="panel" style={{ position: "relative", overflow: "visible" }}>
        <div style={{ position: "absolute", top: 0, left: "10%", right: "10%", height: 1, background: "linear-gradient(90deg, transparent, var(--accent-glow), transparent)" }} />
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Palette className="h-3 w-3" /> Appearance
            </p>
            <h2 className="section-title">Accent Color</h2>
            <p className="section-sub">Pick any accent hue — all interface highlights, buttons, and glows update instantly. Saved to your browser.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: `hsl(${hue} 83% 62%)`, border: "2px solid rgba(255,255,255,0.15)", boxShadow: `0 0 16px hsl(${hue} 83% 62% / 0.5)` }} />
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem", color: "var(--text-2)" }}>hsl({hue}°)</span>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ marginBottom: 20 }}>
            <p className="label-sm" style={{ marginBottom: 12 }}>Presets</p>
            <div className="accent-picker-swatches">
              {ACCENT_PRESETS.map((preset) => (
                <button key={preset.hue} type="button" className={`accent-swatch${preset.hue === hue ? " active" : ""}`} style={{ background: preset.color }} onClick={() => setHue(preset.hue)} title={preset.label} aria-label={`Set accent to ${preset.label}`} />
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
            <div style={{ padding: "8px 14px", borderRadius: 8, background: "var(--accent-subtle)", border: "1px solid var(--accent-glow)", fontSize: "0.8125rem", color: "var(--accent-text)" }}>Accent card</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart3 className="h-3 w-3" /> Charts
            </p>
            <h2 className="section-title">Chart Colors</h2>
            <p className="section-sub">Choose a color theme for traffic and analytics charts. Saved to your browser.</p>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {chartPresets.map((preset) => {
              const isActive = chartActiveLabel === preset.label;
              return (
                <button key={preset.label} type="button" onClick={() => setChartPreset(preset.label === "Default" ? null : preset)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, border: isActive ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer", background: isActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: preset.users, boxShadow: isActive ? `0 0 8px ${preset.users}` : "none" }} />
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: preset.errors, boxShadow: isActive ? `0 0 8px ${preset.errors}` : "none" }} />
                  </div>
                  <span style={{ fontSize: "0.8rem", color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)", fontWeight: isActive ? 500 : 400 }}>{preset.label}</span>
                  {isActive && <Check className="h-3.5 w-3.5" style={{ color: "var(--accent-text)", marginLeft: 2 }} />}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <CircleDot className="h-3 w-3" /> Donut Charts
            </p>
            <h2 className="section-title">Donut Colors</h2>
            <p className="section-sub">Choose a color palette for geographic donut charts. Saved to your browser.</p>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {donutPresets.map((preset) => {
              const isActive = donutActiveLabel === preset.label;
              return (
                <button key={preset.label} type="button" onClick={() => setDonutPreset(preset.label === "Default" ? null : preset)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, border: isActive ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.06)", cursor: "pointer", background: isActive ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", gap: 3 }}>
                    {preset.colors.slice(0, 4).map((c, i) => (
                      <span key={i} style={{ width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: isActive ? `0 0 6px ${c}` : "none" }} />
                    ))}
                  </div>
                  <span style={{ fontSize: "0.8rem", color: isActive ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)", fontWeight: isActive ? 500 : 400 }}>{preset.label}</span>
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
