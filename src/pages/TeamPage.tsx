import { useEffect, useState } from "react";
import { Check, Clock3, LogOut, Plus, Search, ShieldCheck, UsersRound, X } from "lucide-react";
import {
  PERMISSIONS,
  ROLE_LABELS,
  effectivePermissions,
  type PanelRole,
  type PermissionOverrides,
} from "../../shared/panel-policy";
import { PageHeader } from "../components/ds/PageHeader";
import { Modal } from "../components/ds/Modal";
import { apiUrl } from "../utils/api";
type Member = {
  email: string;
  display_name: string;
  role: PanelRole;
  enabled: number;
  expires_at: string | null;
  overrides: PermissionOverrides;
  permissions: string[];
};
type Session = {
  id: string;
  email: string;
  user_agent: string;
  last_seen_at: string;
  expires_at: string;
  auth_mode: string;
};
type Audit = {
  id: number;
  actor: string;
  target: string;
  action: string;
  detail: string;
  created_at: string;
};
type Data = {
  members: Member[];
  sessions: Session[];
  audit: Audit[];
  authMode: string;
  actor: string;
};
type Editor = {
  email: string;
  displayName: string;
  role: PanelRole;
  enabled: boolean;
  expiresAt: string;
  overrides: PermissionOverrides;
  password: string;
  existing: boolean;
};
const emptyEditor = (): Editor => ({
  email: "",
  displayName: "",
  role: "viewer",
  enabled: true,
  expiresAt: "",
  overrides: {},
  password: "",
  existing: false,
});
function localDate(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function displayDate(iso: string) {
  return new Date(iso).toLocaleString();
}
export function TeamPage() {
  const [data, setData] = useState<Data | null>(null),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("members"),
    [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState<{ email: string; sessionId?: string } | null>(null);
  async function load() {
    try {
      const response = await fetch(apiUrl("/api/admin/team"), {
        credentials: "include",
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load panel access.");
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load panel access.");
    }
  }
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(apiUrl("/api/admin/team"), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The change could not be saved.");
      setEditor(null);
      setConfirm(null);
      setNotice(
        body.action === "save"
          ? "Access updated. The new permissions apply immediately."
          : "Session access ended.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  const shown =
    data?.members.filter((m) =>
      [m.email, m.display_name, m.role].some((v) => v.toLowerCase().includes(query.toLowerCase())),
    ) ?? [];
  const allowed = editor ? effectivePermissions(editor.role, editor.overrides) : [];
  function edit(m: Member) {
    setError("");
    setEditor({
      email: m.email,
      displayName: m.display_name,
      role: m.role,
      enabled: Boolean(m.enabled),
      expiresAt: localDate(m.expires_at),
      overrides: m.overrides,
      password: "",
      existing: true,
    });
  }
  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        title="Panel access"
        sub="The right people. The right permissions. For the right amount of time."
        right={
          <button
            className="btn btn-primary"
            onClick={() => {
              setError("");
              setEditor(emptyEditor());
            }}
          >
            <Plus size={16} />
            Add member
          </button>
        }
      />
      <div className="team-summary">
        <span>
          <UsersRound />
          <strong>{data?.members.length ?? "—"}</strong>members
        </span>
        <span>
          <ShieldCheck />
          <strong>
            {data?.members.filter(
              (m) => m.enabled && (!m.expires_at || Date.parse(m.expires_at) > Date.now()),
            ).length ?? "—"}
          </strong>
          with access
        </span>
        <span>
          <Clock3 />
          <strong>{data?.sessions.length ?? "—"}</strong>active sessions
        </span>
      </div>
      {error && !editor && !confirm && (
        <div className="inline-notice danger" role="alert">
          {error}
          <button className="btn btn-ghost btn-sm" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {notice && (
        <div className="inline-notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <div className="workspace-tabs">
        {[
          ["members", "Members"],
          ["sessions", "Active sessions"],
          ["audit", "Access history"],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "members" && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="section-title">Your team</h2>
            <label className="search-field">
              <Search size={16} />
              <input
                aria-label="Find a panel member"
                placeholder="Find a member…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="table-scroll">
            <table className="clean-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Access</th>
                  <th>Valid until</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => {
                  const expired = !!m.expires_at && Date.parse(m.expires_at) <= Date.now();
                  return (
                    <tr key={m.email}>
                      <td>
                        <strong>{m.display_name || m.email.split("@")[0]}</strong>
                        <small>{m.email}</small>
                      </td>
                      <td>{ROLE_LABELS[m.role]}</td>
                      <td>
                        <span
                          className={`status-text ${m.enabled && !expired ? "success" : "danger"}`}
                        >
                          <i />
                          {!m.enabled ? "Disabled" : expired ? "Expired" : "Active"}
                        </span>
                      </td>
                      <td>{m.expires_at ? displayDate(m.expires_at) : "No expiry"}</td>
                      <td>
                        {m.role === "owner" ? (
                          <span className="text-muted">Protected owner</span>
                        ) : (
                          <div className="row-actions">
                            <button className="btn btn-secondary btn-sm" onClick={() => edit(m)}>
                              Manage
                            </button>
                            <button
                              className="btn-icon"
                              title="End all sessions"
                              aria-label={`End all sessions for ${m.email}`}
                              onClick={() => setConfirm({ email: m.email })}
                            >
                              <LogOut size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!shown.length && (
            <p className="empty-copy">{data ? "No matching members." : "Loading panel members…"}</p>
          )}
        </section>
      )}
      {tab === "sessions" && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="section-title">Signed-in devices</h2>
          </div>
          <div className="table-scroll">
            <table className="clean-table">
              <thead>
                <tr>
                  <th>Member / browser</th>
                  <th>Last activity</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.email}</strong>
                      <small className="session-agent" title={s.user_agent}>
                        {s.user_agent}
                      </small>
                    </td>
                    <td>{displayDate(s.last_seen_at)}</td>
                    <td>{displayDate(s.expires_at)}</td>
                    <td>
                      {s.email !== data.actor && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setConfirm({ email: s.email, sessionId: s.id })}
                        >
                          End session
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && !data.sessions.length && <p className="empty-copy">No active sessions.</p>}
        </section>
      )}
      {tab === "audit" && (
        <section className="panel">
          <div className="panel-head">
            <h2 className="section-title">Recent access changes</h2>
          </div>
          <div className="audit-list">
            {data?.audit.map((a) => (
              <div key={a.id}>
                <span className="audit-icon">
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <strong>
                    {a.action === "save"
                      ? "Access updated"
                      : a.action === "kick"
                        ? "All sessions ended"
                        : "Session ended"}
                  </strong>
                  <p>
                    {a.target} · by {a.actor}
                  </p>
                  {a.detail && (
                    <details>
                      <summary>View permission changes</summary>
                      <pre>{JSON.stringify(JSON.parse(a.detail), null, 2)}</pre>
                    </details>
                  )}
                </div>
                <time>{displayDate(a.created_at)}</time>
              </div>
            ))}
          </div>
          {data && !data.audit.length && (
            <p className="empty-copy">Access changes will appear here.</p>
          )}
        </section>
      )}
      <Modal
        open={!!editor}
        onClose={() => !busy && setEditor(null)}
        size="viewport"
        className="team-editor"
        title={editor?.existing ? "Manage access" : "Add panel member"}
        sub="Changes apply to this panel account only."
      >
        {editor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action({
                action: "save",
                ...editor,
                expiresAt: editor.expiresAt ? new Date(editor.expiresAt).toISOString() : null,
              });
            }}
            className="member-form"
          >
            {error && (
              <div className="inline-notice danger" role="alert">
                {error}
              </div>
            )}
            <div className="member-fields">
              <label>
                Display name
                <input
                  value={editor.displayName}
                  onChange={(e) => setEditor({ ...editor, displayName: e.target.value })}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  required
                  readOnly={editor.existing}
                  value={editor.email}
                  onChange={(e) => setEditor({ ...editor, email: e.target.value })}
                />
              </label>
              <label>
                Base role
                <select
                  value={editor.role}
                  onChange={(e) => setEditor({ ...editor, role: e.target.value as PanelRole })}
                >
                  {["admin", "support", "viewer"].map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role as PanelRole]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Access expires
                <input
                  type="datetime-local"
                  value={editor.expiresAt}
                  onChange={(e) => setEditor({ ...editor, expiresAt: e.target.value })}
                />
                <small>Leave empty for unlimited access. Your local time.</small>
              </label>
              {data?.authMode === "app" && (
                <label>
                  {editor.existing ? "Reset password (optional)" : "Initial password"}
                  <input
                    type="password"
                    autoComplete="new-password"
                    required={!editor.existing}
                    value={editor.password}
                    onChange={(e) => setEditor({ ...editor, password: e.target.value })}
                  />
                </label>
              )}
              <label className="toggle-row">
                <span>Panel access enabled</span>
                <input
                  type="checkbox"
                  checked={editor.enabled}
                  onChange={(e) => setEditor({ ...editor, enabled: e.target.checked })}
                />
              </label>
            </div>
            {data?.authMode === "access" && (
              <p className="inline-notice">
                This member signs in through Cloudflare Access. Its application policy must also
                allow their email.
              </p>
            )}
            <div className="permissions-heading">
              <h3>Individual permissions</h3>
              <span>{allowed.length} effective permissions</span>
            </div>
            <p className="settings-caption">
              Inherit the role, explicitly allow, or deny. Optional expiry applies to the override;
              the role applies again afterward.
            </p>
            <div className="table-scroll">
              <table className="clean-table permission-table">
                <thead>
                  <tr>
                    <th>Permission</th>
                    <th>Rule</th>
                    <th>Override expires</th>
                    <th>Effective now</th>
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((p) => (
                    <tr key={p.key}>
                      <td>
                        {p.label}
                        <small>{p.group}</small>
                      </td>
                      <td>
                        <select
                          aria-label={`Rule for ${p.label}`}
                          value={editor.overrides[p.key]?.effect ?? "inherit"}
                          onChange={(e) => {
                            const overrides = { ...editor.overrides };
                            if (e.target.value === "inherit") delete overrides[p.key];
                            else
                              overrides[p.key] = {
                                effect: e.target.value as "allow" | "deny",
                                expiresAt: overrides[p.key]?.expiresAt ?? null,
                              };
                            setEditor({ ...editor, overrides });
                          }}
                        >
                          <option value="inherit">Inherit role</option>
                          <option value="allow">Allow</option>
                          <option value="deny">Deny</option>
                        </select>
                      </td>
                      <td>
                        <input
                          aria-label={`Expiry for ${p.label}`}
                          type="datetime-local"
                          disabled={!editor.overrides[p.key]}
                          value={localDate(editor.overrides[p.key]?.expiresAt ?? null)}
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              overrides: {
                                ...editor.overrides,
                                [p.key]: {
                                  effect: editor.overrides[p.key]!.effect,
                                  expiresAt: e.target.value
                                    ? new Date(e.target.value).toISOString()
                                    : null,
                                },
                              },
                            })
                          }
                        />
                      </td>
                      <td>
                        <span
                          className={`status-text ${allowed.includes(p.key) ? "success" : "muted"}`}
                        >
                          {allowed.includes(p.key) ? <Check size={14} /> : <X size={14} />}{" "}
                          {allowed.includes(p.key) ? "Allowed" : "Denied"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-footer">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save access"}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={!!confirm}
        onClose={() => !busy && setConfirm(null)}
        title={confirm?.sessionId ? "End this session?" : "End all sessions?"}
        sub={confirm?.email}
      >
        {error && (
          <p className="inline-notice danger" role="alert">
            {error}
          </p>
        )}
        <p className="confirm-copy">
          The selected session access ends immediately. The member can sign in again if their panel
          access is still enabled.
        </p>
        <div className="form-footer">
          <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() =>
              confirm &&
              void action({ action: confirm.sessionId ? "end-session" : "kick", ...confirm })
            }
          >
            {busy ? "Ending…" : "End access"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
