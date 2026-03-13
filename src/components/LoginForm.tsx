import { KeyRound, Loader2, Mail } from "lucide-react";
import { useState } from "react";
const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface LoginFormProps {
  isBootstrap: boolean;
  authMode: "app" | "access";
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, confirm: string) => void;
}

export function LoginForm({
  isBootstrap,
  authMode,
  busy,
  error,
  onSubmit,
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (authMode === "access") {
    return (
      <div className="auth-shell">
        <div className="auth-panel auth-panel-compact">
          <div className="auth-brand">
            <div className="auth-brand-mark">
              <img src={brandLogo} alt="RazorReaper logo" className="auth-brand-image" />
            </div>
            <div>
              <p className="auth-kicker">Zero Trust</p>
              <h1 className="auth-title">Cloudflare Access gate</h1>
            </div>
          </div>
          <p className="auth-copy">
            This dashboard stays behind Cloudflare Access. Continue through the protected portal and return here once
            the session is established.
          </p>
          <a href="/" className="btn-primary w-full inline-flex items-center justify-center">
            Open Access Portal
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="auth-brand-mark">
            <img src={brandLogo} alt="RazorReaper logo" className="auth-brand-image" />
          </div>
          <div>
            <p className="auth-kicker">{isBootstrap ? "First-time setup" : "Operator sign-in"}</p>
            <h1 className="auth-title">{isBootstrap ? "Create Admin Account" : "Enter the dashboard"}</h1>
          </div>
        </div>

        <p className="auth-copy">
          {isBootstrap
            ? "Set up the first admin account for this panel."
            : "Use your operator credentials to access live telemetry, sessions, and error feeds."}
        </p>

        <div className="auth-note-grid">
          <div>
            <span>Scope</span>
            <strong>Sessions, incidents, rollout health</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{isBootstrap ? "Bootstrap" : "Protected access"}</strong>
          </div>
        </div>

        {error ? <div className="inline-error">{error}</div> : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(email, password, confirm);
          }}
          className="auth-form"
        >
          <div>
            <label className="auth-label">Email</label>
            <div className="input-group">
              <Mail className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="email"
                placeholder="admin@example.com"
                className="input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="auth-label">Password</label>
            <div className="input-group">
              <KeyRound className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="password"
                placeholder="Minimum 10 characters"
                className="input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={10}
              />
            </div>
          </div>

          {isBootstrap ? (
            <div>
              <label className="auth-label">Confirm Password</label>
              <div className="input-group">
                <KeyRound className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                <input
                  type="password"
                  placeholder="Re-enter password"
                  className="input"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  minLength={10}
                />
              </div>
            </div>
          ) : null}

          <button className="btn-primary w-full flex items-center justify-center gap-2" type="submit" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isBootstrap ? "Create Account" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
