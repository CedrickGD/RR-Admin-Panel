import { Activity, KeyRound, Loader2, Mail, Shield } from "lucide-react";
import { useState } from "react";

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
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] p-4">
        <div className="card p-8 w-full max-w-sm text-center animate-fade-in">
          <div className="flex justify-center mb-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
              <Shield className="h-7 w-7" />
            </div>
          </div>
          <h1 className="text-lg font-bold mb-1">Cloudflare Access</h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))] mb-5">
            This dashboard is protected by Cloudflare Access. Please
            authenticate through the access portal.
          </p>
          <a
            href="/"
            className="btn-primary w-full inline-flex items-center justify-center"
          >
            Open Access Portal
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--background))] p-4">
      <div className="card p-8 w-full max-w-sm animate-fade-in">
        {/* Logo */}
        <div className="flex justify-center mb-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
            <Activity className="h-7 w-7" />
          </div>
        </div>

        <h1 className="text-lg font-bold text-center mb-0.5">
          {isBootstrap ? "Create Admin Account" : "Sign In"}
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))] text-center mb-5">
          {isBootstrap
            ? "Set up the first admin account for this panel."
            : "Enter your credentials to access the dashboard."}
        </p>

        {error ? (
          <div className="mb-4 p-3 rounded-lg bg-rose-500/10 text-rose-400 text-sm border border-rose-500/20">
            {error}
          </div>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(email, password, confirm);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
              Email
            </label>
            <div className="input-group">
              <Mail className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="email"
                placeholder="admin@example.com"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
              Password
            </label>
            <div className="input-group">
              <KeyRound className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="password"
                placeholder="Minimum 10 characters"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={10}
              />
            </div>
          </div>

          {isBootstrap ? (
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--muted-foreground))] mb-1.5">
                Confirm Password
              </label>
              <div className="input-group">
                <KeyRound className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                <input
                  type="password"
                  placeholder="Re-enter password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={10}
                />
              </div>
            </div>
          ) : null}

          <button
            className="btn-primary w-full flex items-center justify-center gap-2"
            type="submit"
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            {isBootstrap ? "Create Account" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
