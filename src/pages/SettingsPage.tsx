import { useState, type ReactNode } from "react";
import {
  Check,
  ImagePlus,
  Moon,
  Network,
  Palette,
  SlidersHorizontal,
  Sun,
  Upload,
} from "lucide-react";
import { useAppearance, DEFAULT_APPEARANCE, type Appearance } from "../hooks/useAppearance";
import { ACCENT_PRESETS } from "../hooks/useAccent";
import type { AuthMode, AuthUser, HealthPayload, SummaryPayload } from "../types/telemetry";
import { PageHeader } from "../components/ds/PageHeader";
type Props = {
  user: AuthUser;
  authMode: AuthMode;
  summary: SummaryPayload;
  health: HealthPayload;
  onLogout: () => void;
  filterBar?: ReactNode;
};
export function SettingsPage({ user, authMode, summary, health, onLogout }: Props) {
  const { appearance: a, updateAppearance: update, syncStatus, retrySync } = useAppearance();
  const [tab, setTab] = useState("appearance"),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const save = (value: Partial<Appearance>) => {
    try {
      update(value);
      setError("");
    } catch {
      setError(
        "Your browser could not save this preference. Try a smaller image or free browser storage.",
      );
    }
  };
  async function upload(file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG or WebP image up to 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1920 / bitmap.width, 1200 / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const image = canvas.toDataURL("image/webp", 0.8);
      if (image.length > 1800000) throw new Error("Image is too large.");
      save({ image, background: "image" });
    } catch {
      setError("This image could not be saved. Try another or a smaller image.");
    } finally {
      setUploading(false);
    }
  }
  const slider = (key: keyof Appearance, label: string, min: number, max: number, suffix = "") => (
    <label className="setting-slider" key={key}>
      <span>
        {label}
        <output>
          {String(a[key])}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={Number(a[key])}
        onChange={(e) => save({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <div className="page-content settings-workspace">
      <PageHeader title="Make it yours" sub="A clear workspace, with your own character." />
      <div className="workspace-tabs">
        {[
          ["appearance", "Appearance"],
          ["account", "My account"],
          ["system", "System"],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="inline-notice danger" role="alert">
          {error}
        </div>
      )}
      {tab === "appearance" && (
        <div className="settings-layout">
          <div className="settings-controls">
            <section className="settings-section">
              <h2>Color mode</h2>
              <p>Choose the foundation of your workspace.</p>
              <div className="theme-options">
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    key={theme}
                    className={`theme-option ${theme} ${a.theme === theme ? "selected" : ""}`}
                    onClick={() => save({ theme })}
                  >
                    <div className="theme-mini">
                      <i />
                      <div>
                        <b />
                        <b />
                        <b />
                      </div>
                    </div>
                    <span>
                      {theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}{" "}
                      {theme === "dark" ? "Dark" : "Light"}
                      {a.theme === theme && <Check size={15} />}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-section">
              <h2>Accent color</h2>
              <p>Highlights, active controls and your network.</p>
              <div className="color-swatches">
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    style={{ background: p.color }}
                    aria-label={p.label}
                    title={p.label}
                    className={a.hue === p.hue ? "selected" : ""}
                    onClick={() => save({ hue: p.hue })}
                  >
                    {a.hue === p.hue && <Check size={15} />}
                  </button>
                ))}
              </div>
              {slider("hue", "Custom hue", 0, 360, "°")}
            </section>
            <section className="settings-section">
              <h2>Navigation</h2>
              <p>
                Let your background show through the sidebar. Text and icons keep their contrast.
              </p>
              {slider("sidebarTransparency", "Sidebar transparency", 0, 90, "%")}
            </section>
            <section className="settings-section">
              <h2>Background</h2>
              <p>Your content stays readable above every background.</p>
              <div className="background-options">
                {(
                  [
                    ["plain", "Clean", <SlidersHorizontal />],
                    ["aurora", "RGB fade", <Palette />],
                    ["network", "Reaper network", <Network />],
                    ["image", "Your image", <ImagePlus />],
                  ] as const
                ).map(([key, label, icon]) => (
                  <button
                    key={key}
                    onClick={() => save({ background: key })}
                    className={a.background === key ? "selected" : ""}
                  >
                    {icon}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {a.background === "image" && (
                <div className="upload-box">
                  <label className="btn btn-secondary">
                    <Upload size={16} />
                    {uploading ? "Processing…" : "Upload image"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={uploading}
                      hidden
                      onChange={(e) => {
                        void upload(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <span>JPG, PNG or WebP · up to 10 MB</span>
                  {a.image && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => save({ image: "", background: "plain" })}
                    >
                      Remove image
                    </button>
                  )}
                </div>
              )}
              {a.background !== "plain" && (
                <div className="background-sliders">
                  {a.background !== "image" && (
                    <>
                      {slider("intensity", "Intensity", 5, 100, "%")}
                      {slider("speed", "Speed", 0, 90)}
                      <label className="toggle-row">
                        <span>
                          Animate background
                          <small>Respects your device’s reduced motion setting.</small>
                        </span>
                        <input
                          type="checkbox"
                          checked={a.motion}
                          onChange={(e) => save({ motion: e.target.checked })}
                        />
                      </label>
                    </>
                  )}
                  {a.background === "network" && (
                    <>
                      {slider("density", "Network density", 15, 100)}
                      {slider("distance", "Connection length", 60, 260, " px")}
                    </>
                  )}
                  {(a.background === "network" || a.background === "image") && (
                    <>
                      {slider("offsetX", "Horizontal offset", -100, 100, "%")}
                      {slider("offsetY", "Vertical offset", -100, 100, "%")}
                    </>
                  )}
                  {a.background === "image" && (
                    <>
                      {slider("dim", "Darken image", 0, 90, "%")}
                      {slider("blur", "Blur", 0, 20, " px")}
                    </>
                  )}
                </div>
              )}
            </section>

            <button
              className="btn btn-ghost"
              onClick={() => save({ ...DEFAULT_APPEARANCE, image: "" })}
            >
              Reset appearance
            </button>
          </div>
          <aside className="appearance-preview">
            <div className="preview-window">
              <div className="preview-title">
                <span className="preview-dot" />
                Your workspace
              </div>
              <strong>Everything in its place.</strong>
              <p>
                Calm surfaces. Clear information.
                <br />A little color where it matters.
              </p>
              <div className="preview-metrics">
                <div>
                  <span>Active</span>
                  <b>128</b>
                  <small>Connected</small>
                </div>
                <div>
                  <span>Resolved</span>
                  <b>
                    98.4<span>%</span>
                  </b>
                  <small>Looking good</small>
                </div>
              </div>
              <div className="preview-list">
                <span>
                  <i />
                  License activated<small>Just now</small>
                </span>
                <span>
                  <i />
                  Feedback resolved<small>2 min ago</small>
                </span>
                <span>
                  <i />
                  New session started<small>5 min ago</small>
                </span>
              </div>
              <button className="btn btn-primary" onClick={() => setTab("account")}>
                Your workspace, your way
              </button>
            </div>
            <p className="settings-caption" role="status">
              {syncStatus === "saved"
                ? "Saved to your account on the NAS. Available on all your devices."
                : syncStatus === "saving"
                  ? "Saving your appearance to the NAS…"
                  : syncStatus === "loading"
                    ? "Loading your account appearance…"
                    : syncStatus === "error"
                      ? "The NAS could not be reached. Your local changes are kept for the next save."
                      : "Sign in to sync your appearance across devices."}
            </p>
            {syncStatus === "error" && (
              <button className="btn btn-ghost" onClick={retrySync}>
                Save again
              </button>
            )}
            <p className="settings-caption">The preview contains example data.</p>
          </aside>
        </div>
      )}
      {tab === "account" && (
        <section className="settings-section account-settings">
          <h2>Your account</h2>
          <dl className="clean-details">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>{user.panelRole ?? user.role}</dd>
            <dt>Sign-in</dt>
            <dd>{authMode === "access" ? "Cloudflare Access" : "Email & password"}</dd>
          </dl>
          <button className="btn btn-secondary" onClick={onLogout}>
            Sign out
          </button>
        </section>
      )}
      {tab === "system" && (
        <section className="settings-section account-settings">
          <h2>System status</h2>
          <dl className="clean-details">
            <dt>API</dt>
            <dd>Connected</dd>
            <dt>Storage</dt>
            <dd>{summary.storage.toUpperCase()}</dd>
            <dt>Build</dt>
            <dd>{health.build?.commit ?? "Unknown"}</dd>
            <dt>Environment</dt>
            <dd>{health.build?.environment ?? "Production"}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
