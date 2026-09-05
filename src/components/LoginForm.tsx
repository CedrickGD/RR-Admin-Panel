import { KeyRound, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "./ds/Button";
const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

interface LoginFormProps {
  isBootstrap: boolean;
  authMode: "app" | "access";
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, confirm: string) => void;
}

/** Brand lockup — logo + name + accent undertitle, mirroring the topnav. */
function AuthBrand() {
  return (
    <div className="auth-brand">
      <img src={brandLogo} alt="RazorReaper logo" className="auth-brand-img" />
      <div>
        <span className="auth-brand-name">RazorReaper</span>
        <span className="auth-brand-sub">Operations Console</span>
      </div>
    </div>
  );
}

export function LoginForm({ isBootstrap, authMode, busy, error, onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  if (authMode === "access") {
    return (
      <div className="auth-shell">
        <div className="auth-card v2-rise">
          <AuthBrand />
          <div className="auth-head">
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-sub">
              Sign in to your RazorReaper workspace. If your access has ended, contact the panel
              owner.
            </p>
          </div>
          <a href="/cdn-cgi/access/logout" className="btn btn-primary auth-submit">
            Sign in again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card v2-rise">
        <AuthBrand />

        <div className="auth-head">
          <h1 className="auth-title">
            {isBootstrap ? "Create your owner account" : "Welcome back"}
          </h1>
          <p className="auth-sub">
            {isBootstrap
              ? "Set up the first admin account for this panel."
              : "Sign in to your RazorReaper workspace."}
          </p>
        </div>

        <div className="auth-meta">
          <div>
            <span className="label-sm">Scope</span>
            <strong>Sessions · Incidents · Rollout Health</strong>
          </div>
          <div>
            <span className="label-sm">Mode</span>
            <strong>{isBootstrap ? "Bootstrap" : "Protected Access"}</strong>
          </div>
        </div>

        {error ? (
          <div className="inline-error" role="alert">
            {error}
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(email, password, confirm);
          }}
          className="auth-form"
        >
          <label className="auth-field">
            <span className="label-sm">Email</span>
            <div className="auth-input">
              <Mail size={16} />
              <input
                type="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
              />
            </div>
          </label>

          <label className="auth-field">
            <span className="label-sm">Password</span>
            <div className="auth-input">
              <KeyRound size={16} />
              <input
                type="password"
                placeholder="Minimum 10 characters"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={10}
              />
            </div>
          </label>

          {isBootstrap ? (
            <label className="auth-field">
              <span className="label-sm">Confirm Password</span>
              <div className="auth-input">
                <KeyRound size={16} />
                <input
                  type="password"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  minLength={10}
                />
              </div>
            </label>
          ) : null}

          <Button variant="primary" type="submit" disabled={busy} className="auth-submit">
            {busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : null}
            {isBootstrap ? "Create Account" : "Sign In"}
          </Button>
        </form>
      </div>
    </div>
  );
}
