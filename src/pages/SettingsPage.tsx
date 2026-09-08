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
import { accentColor, resolveAccentContrast } from "../utils/accentContrast";
import type { AuthMode, AuthUser } from "../types/telemetry";
import { PageHeader } from "../components/ds/PageHeader";
import { Button } from "../components/ds/Button";
import { Tabs, type TabItem } from "../components/ds/Tabs";
import { useSignOut } from "../hooks/useSignOut";
import { canVisit } from "../../shared/panel-policy";
const SETTINGS_TABS: TabItem[] = [
  { key: "appearance", label: "Appearance", panelId: "settings-panel-appearance" },
  { key: "account", label: "Account", panelId: "settings-panel-account" },
];
type Props = {
  user: AuthUser;
  authMode: AuthMode;
  onLogout: () => void;
  filterBar?: ReactNode;
};
export function SettingsPage({ user, authMode, onLogout }: Props) {
  const { appearance: a, updateAppearance: update, syncStatus, retrySync } = useAppearance();
  // Same confirm step as the sidebar footer — one sign-out, one behaviour.
  const signOut = useSignOut(onLogout);
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
      <PageHeader page="settings" />
      <Tabs aria-label="Settings sections" items={SETTINGS_TABS} value={tab} onChange={setTab} />
      {error && (
        <div className="inline-notice danger" role="alert">
          {error}
        </div>
      )}
      {tab === "appearance" && (
        <div
          className="settings-layout"
          role="tabpanel"
          id="settings-panel-appearance"
          aria-labelledby="settings-panel-appearance-tab"
        >
          <div className="settings-controls">
            <section className="settings-section">
              <h2>Color mode</h2>
              <p>Choose the foundation of your workspace.</p>
              <div className="theme-options">
                {/* aria-pressed, not just the `.selected` class and a Check icon:
                    the icon carries no name, so which mode is active was a purely
                    visual cue. Same for the two pickers below. */}
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    key={theme}
                    className={`theme-option ${theme} ${a.theme === theme ? "selected" : ""}`}
                    aria-pressed={a.theme === theme}
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
                {/* Each swatch paints the accent exactly as the current theme would
                    render it, with the ink that hue actually gets — a green swatch
                    carries a dark check, not the invisible white one. */}
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    style={{
                      background: accentColor(p.hue, a.theme),
                      color: resolveAccentContrast(p.hue, a.theme).onAccent,
                    }}
                    aria-label={p.label}
                    aria-pressed={a.hue === p.hue}
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
                    aria-pressed={a.background === key}
                    className={a.background === key ? "selected" : ""}
                  >
                    {icon}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {a.background === "image" && (
                <div className="upload-box">
                  <label className="btn btn-ghost">
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
                    <Button size="sm" onClick={() => save({ image: "", background: "plain" })}>
                      Remove image
                    </Button>
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

            <Button onClick={() => save({ ...DEFAULT_APPEARANCE, image: "" })}>
              Reset appearance
            </Button>
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
            {syncStatus === "error" && <Button onClick={retrySync}>Save again</Button>}
          </div>
        </div>
      )}
      {tab === "account" && (
        <section
          className="settings-section account-settings"
          role="tabpanel"
          id="settings-panel-account"
          aria-labelledby="settings-panel-account-tab"
        >
          <h2>Your account</h2>
          <dl className="clean-details">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Role</dt>
            <dd>{user.panelRole ?? user.role}</dd>
            <dt>Sign-in</dt>
            <dd>{authMode === "access" ? "Cloudflare Access" : "Email & password"}</dd>
          </dl>
          {canVisit("system", user) && (
            <a className="btn btn-ghost" href="#/system">
              See Backend status
            </a>
          )}
          <Button variant="danger" onClick={signOut.requestSignOut}>
            Sign out
          </Button>
        </section>
      )}
      {signOut.dialog}
    </div>
  );
}
