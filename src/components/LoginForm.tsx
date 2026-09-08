import { KeyRound, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "./ds/Button";
const brandLogo = new URL("../img/logo.ico", import.meta.url).href;

/** Mirrors PASSWORD_MIN_LENGTH in functions/_lib/auth.ts (enforced when a password is set). */
const PASSWORD_MIN_LENGTH = 10;
const ERROR_ID = "login-error";

interface LoginFormProps {
  isBootstrap: boolean;
  authMode: "app" | "access";
  busy: boolean;
  error: string | null;
  onSubmit: (email: string, password: string, confirm: string) => void;
}

/** Brand lockup — logo + name + accent undertitle, mirroring the sidebar brand. */
function AuthBrand() {
  return (
    <div className="auth-brand">
      <img src={brandLogo} alt="" className="auth-brand-img" />
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
            <h1 className="auth-title">Sign in</h1>
            <p className="auth-sub">
              This panel is protected by Cloudflare Access. If your access has ended, contact the
              panel owner.
            </p>
          </div>
          <a href="/cdn-cgi/access/logout" className="btn btn-primary auth-submit">
            Sign in with a different account
          </a>
        </div>
      </div>
    );
  }

  const describedBy = error ? ERROR_ID : undefined;
  const passwordHint = isBootstrap ? `Minimum ${PASSWORD_MIN_LENGTH} characters` : "Password";

  return (
    <div className="auth-shell">
      <div className="auth-card v2-rise">
        <AuthBrand />

        <div className="auth-head">
          <h1 className="auth-title">{isBootstrap ? "Create your owner account" : "Sign in"}</h1>
          <p className="auth-sub">
            {isBootstrap
              ? "Set up the first admin account for this panel."
              : "If your access has ended, contact the panel owner."}
          </p>
        </div>

        {error ? (
          <div id={ERROR_ID} className="inline-error" role="alert">
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
          <div className="auth-field">
            <label htmlFor="login-email" className="label-sm">
              Email
            </label>
            <div className="auth-input">
              <Mail size={16} />
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="admin@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoFocus
                aria-describedby={describedBy}
              />
            </div>
          </div>

          <div className="auth-field">
            <label htmlFor="login-password" className="label-sm">
              Password
            </label>
            <div className="auth-input">
              <KeyRound size={16} />
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete={isBootstrap ? "new-password" : "current-password"}
                placeholder={passwordHint}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={isBootstrap ? PASSWORD_MIN_LENGTH : undefined}
                aria-describedby={describedBy}
              />
            </div>
          </div>

          {isBootstrap ? (
            <div className="auth-field">
              <label htmlFor="login-confirm" className="label-sm">
                Confirm password
              </label>
              <div className="auth-input">
                <KeyRound size={16} />
                <input
                  id="login-confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  aria-describedby={describedBy}
                />
              </div>
            </div>
          ) : null}

          <Button variant="primary" type="submit" disabled={busy} className="auth-submit">
            {busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : null}
            {isBootstrap ? "Create account" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
