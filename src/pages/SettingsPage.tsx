import { Check, CircleDot, KeyRound, LogOut, Palette, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, LiveBadge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { KvList } from "../components/ds/KvList";
import { MetaRow, PageHeader } from "../components/ds/PageHeader";
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

/* ── Accent glow preference ──────────────────────────────────────
   The DS exposes --glow as a multiplier on every accent halo
   (tokens/accent.css — "set to 0 to kill all accent glows").
   Persisted per-browser; applied at module load so the choice
   holds on every page from boot, mirroring useChartColors. */
const GLOW_STORAGE_KEY = "rr-accent-glow";

function readGlowEnabled(): boolean {
  try {
    return localStorage.getItem(GLOW_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function applyGlow(enabled: boolean) {
  const root = document.documentElement.style;
  if (enabled) root.removeProperty("--glow"); // fall back to the DS default (1)
  else root.setProperty("--glow", "0");
}

applyGlow(readGlowEnabled());

export function SettingsPage({ user, authMode, summary, health, onLogout }: SettingsPageProps) {
  const { hue, setHue, activePreset } = useAccent();
  const { setPreset: setChartPreset, activeLabel: chartActiveLabel, presets: chartPresets } = useChartColors();
  const { setPreset: setDonutPreset, activeLabel: donutActiveLabel, presets: donutPresets } = useDonutColors();
  const [copied, setCopied] = useState<string | null>(null);
  const [glowEnabled, setGlowEnabled] = useState<boolean>(readGlowEnabled);

  useEffect(() => {
    applyGlow(glowEnabled);
    try {
      localStorage.setItem(GLOW_STORAGE_KEY, glowEnabled ? "on" : "off");
    } catch {
      /* ignore */
    }
  }, [glowEnabled]);

  function copyToClipboard(value: string, key: string) {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  const apiOnline = health.api === "alive";

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Configuration"
        title="Settings"
        sub="Account identity, appearance, and backend configuration."
        right={
          <MetaRow
            items={[
              { label: "Auth Mode", value: authMode === "access" ? "Zero Trust" : "App Auth" },
              { label: "Storage", value: summary.storage.toUpperCase() },
              { label: "API", value: apiOnline ? "Online" : "Offline" },
            ]}
          />
        }
      />

      <div className="two-col">
        {/* Account identity */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker kicker-row">
                <KeyRound size={12} /> Account
              </p>
              <h2 className="section-title">Identity</h2>
            </div>
          </div>
          <div className="panel-body-tight">
            <KvList
              items={[
                { k: "Email", v: user.email },
                { k: "Role", v: user.role },
                { k: "Auth Mode", v: authMode === "access" ? "Cloudflare Access (Zero Trust)" : "Email & Password" },
              ]}
            />
            {authMode === "app" ? (
              <div style={{ margin: "12px 0 8px" }}>
                <Button variant="danger" size="sm" icon={<LogOut />} onClick={onLogout}>
                  Sign Out
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        {/* Backend status */}
        <section className="panel">
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker kicker-row">
                <ShieldCheck size={12} /> Backend
              </p>
              <h2 className="section-title">System Status</h2>
            </div>
            <div className="panel-head-right">
              <Badge tone={apiOnline ? "success" : "danger"}>{apiOnline ? "Online" : "Offline"}</Badge>
            </div>
          </div>
          <div className="panel-body-tight">
            <div className="kv-list">
              {[
                { k: "Storage", v: summary.storage.toUpperCase() },
                { k: "API", v: apiOnline ? "Alive" : "Down" },
                { k: "Commit", v: health.build?.commit ?? "unknown" },
                { k: "Branch", v: health.build?.branch ?? "unknown" },
                { k: "Environment", v: health.build?.environment ?? "unknown" },
              ].map(({ k, v }) => (
                <div className="kv-row" key={k}>
                  <span className="kv-key">{k}</span>
                  <button
                    type="button"
                    className="kv-val kv-val-copy"
                    onClick={() => copyToClipboard(v, k)}
                    title="Click to copy"
                  >
                    {copied === k ? (
                      <span className="kv-copied">
                        <Check size={12} /> Copied
                      </span>
                    ) : (
                      v
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Accent color */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker kicker-row">
              <Palette size={12} /> Appearance
            </p>
            <h2 className="section-title">Accent Color</h2>
            <p className="section-sub">
              Pick any accent hue — all interface highlights, buttons, and glows update instantly. Saved to your browser.
            </p>
          </div>
          <div className="panel-head-right">
            <div className="accent-current">
              <div className="accent-current-chip" />
              <span className="accent-current-value">hsl({hue}°)</span>
            </div>
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
              <span className="label-sm-suffix">
                {hue}°{activePreset ? ` — ${activePreset.label}` : ""}
              </span>
            </p>
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={hue}
              onChange={(e) => setHue(Number(e.target.value))}
              className="accent-hue-slider"
              aria-label="Custom accent hue"
            />
            <div className="hue-scale">
              <span>0°</span>
              <span>360°</span>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <p className="label-sm" style={{ marginBottom: 10 }}>Accent Glow</p>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div className="seg-control">
                <button
                  type="button"
                  className={`seg-btn${glowEnabled ? " active" : ""}`}
                  onClick={() => setGlowEnabled(true)}
                  title="Accent elements carry their soft glow halos"
                >
                  On
                </button>
                <button
                  type="button"
                  className={`seg-btn${!glowEnabled ? " active" : ""}`}
                  onClick={() => setGlowEnabled(false)}
                  title="Disable every accent glow halo"
                >
                  Off
                </button>
              </div>
              <span className="section-sub">Halos on accent elements — Off disables every glow. Saved to your browser.</span>
            </div>
          </div>
          <div style={{ marginTop: 24, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <p className="label-sm" style={{ width: "100%", marginBottom: 4 }}>Preview</p>
            <Button variant="primary" size="sm">Primary Button</Button>
            <Button size="sm">Ghost Button</Button>
            <Badge tone="accent">Accent Badge</Badge>
            <LiveBadge>Live</LiveBadge>
            <div className="accent-preview-card">Accent card</div>
          </div>
        </div>
      </section>

      {/* Chart colors — writes the DS tokens (--chart-users/sessions/errors) */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker kicker-row">
              <SlidersHorizontal size={12} /> Charts
            </p>
            <h2 className="section-title">Chart Colors</h2>
            <p className="section-sub">Choose a color theme for traffic and analytics charts. Saved to your browser.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="preset-row">
            {chartPresets.map((preset) => {
              const isActive = chartActiveLabel === preset.label;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={`preset-chip${isActive ? " active" : ""}`}
                  onClick={() => setChartPreset(preset.label === "Default" ? null : preset)}
                >
                  <span className="preset-chip-dots">
                    <span
                      className="preset-dot"
                      style={{ background: preset.users, boxShadow: isActive ? `0 0 8px ${preset.users}` : "none" }}
                    />
                    <span
                      className="preset-dot"
                      style={{ background: preset.errors, boxShadow: isActive ? `0 0 8px ${preset.errors}` : "none" }}
                    />
                  </span>
                  {preset.label}
                  {isActive ? (
                    <span className="preset-check">
                      <Check size={14} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Donut palette */}
      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <p className="kicker kicker-row">
              <CircleDot size={12} /> Donut Charts
            </p>
            <h2 className="section-title">Donut Colors</h2>
            <p className="section-sub">Choose a color palette for geographic donut charts. Saved to your browser.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="preset-row">
            {donutPresets.map((preset) => {
              const isActive = donutActiveLabel === preset.label;
              return (
                <button
                  key={preset.label}
                  type="button"
                  className={`preset-chip${isActive ? " active" : ""}`}
                  onClick={() => setDonutPreset(preset.label === "Default" ? null : preset)}
                >
                  <span className="preset-chip-dots">
                    {preset.colors.slice(0, 4).map((c, i) => (
                      <span
                        key={i}
                        className="preset-dot preset-dot-sm"
                        style={{ background: c, boxShadow: isActive ? `0 0 6px ${c}` : "none" }}
                      />
                    ))}
                  </span>
                  {preset.label}
                  {isActive ? (
                    <span className="preset-check">
                      <Check size={14} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
