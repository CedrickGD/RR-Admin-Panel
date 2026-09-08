import { TableFrame, RecordCell } from "../components/ds/TableFrame";
import { Select } from "../components/ds/Select";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Clock3,
  Eye,
  EyeOff,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import {
  PERMISSIONS,
  ROLE_LABELS,
  effectivePermissions,
  type PanelRole,
  type PermissionOverrides,
} from "../../shared/panel-policy";
import { PageHeader } from "../components/ds/PageHeader";
import { Button, IconButton } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Field } from "../components/ds/Field";
import { Input } from "../components/ds/Input";
import { Modal, ModalActions } from "../components/ds/Modal";
import { Skeleton, SkeletonRows } from "../components/ds/Skeleton";
import { Tabs, type TabItem } from "../components/ds/Tabs";
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
type TeamTab = "members" | "sessions" | "audit";
const TEAM_TABS: TabItem<TeamTab>[] = [
  { key: "members", label: "Members", panelId: "team-panel-members" },
  { key: "sessions", label: "Active sessions", panelId: "team-panel-sessions" },
  { key: "audit", label: "Access history", panelId: "team-panel-audit" },
];
function localDate(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function displayDate(iso: string) {
  return new Date(iso).toLocaleString();
}
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
/**
 * 16 characters from a CSPRNG. The owner has to read the password out to the
 * new member, so the alphabet leaves out the glyph pairs that get misread
 * (0/O, 1/l/I).
 */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(16));
  return [...bytes].map((n) => PASSWORD_ALPHABET[n % PASSWORD_ALPHABET.length]).join("");
}
export function TeamPage() {
  const [data, setData] = useState<Data | null>(null),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState<TeamTab>("members"),
    [editor, setEditor] = useState<Editor | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirm, setConfirm] = useState<{ email: string; sessionId?: string } | null>(null);
  // What the editor opened with (overrides nest, so compare serialised) — anything
  // beyond it is unsaved work the Modal must not discard.
  const editorBaseline = useRef("");
  // A password is only readable while the owner is setting it, never on reopen.
  const [showPassword, setShowPassword] = useState(false);
  function openEditor(next: Editor) {
    editorBaseline.current = JSON.stringify(next);
    setShowPassword(false);
    setEditor(next);
  }
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
    openEditor({
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
        page="team"
        right={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() => {
              setError("");
              openEditor(emptyEditor());
            }}
          >
            Add member
          </Button>
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
          <Button size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {notice && (
        <div className="inline-notice" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <Tabs aria-label="Panel access sections" items={TEAM_TABS} value={tab} onChange={setTab} />
      {tab === "members" && (
        <section
          className="panel"
          role="tabpanel"
          id="team-panel-members"
          aria-labelledby="team-panel-members-tab"
        >
          <div className="panel-head">
            <h2 className="section-title">Members</h2>
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
          <TableFrame stickyActions mobileLayout="stack" aria-busy={!data || undefined}>
            <caption className="table-caption">Panel members and their access</caption>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Role</th>
                <th scope="col">Access</th>
                <th scope="col">Valid until</th>
                <th scope="col" aria-label="Member actions" />
              </tr>
            </thead>
            <tbody>
              {!data && <SkeletonRows columns={5} rows={4} />}
              {shown.map((m) => {
                const expired = !!m.expires_at && Date.parse(m.expires_at) <= Date.now();
                return (
                  <tr key={m.email}>
                    <td>
                      <RecordCell
                        primary={m.display_name || m.email.split("@")[0]}
                        secondary={m.email}
                      />
                    </td>
                    <td data-label="Role">{ROLE_LABELS[m.role]}</td>
                    <td data-label="Access">
                      <span className={`status-text ${m.enabled && !expired ? "success" : "danger"}`}>
                        <i />
                        {!m.enabled ? "Disabled" : expired ? "Expired" : "Active"}
                      </span>
                    </td>
                    <td data-label="Valid until">
                      {m.expires_at ? displayDate(m.expires_at) : "No expiry"}
                    </td>
                    <td>
                      {m.role === "owner" ? (
                        <span className="text-muted">Protected owner</span>
                      ) : (
                        <div className="row-actions">
                          <Button size="sm" onClick={() => edit(m)}>
                            Manage
                          </Button>
                          <IconButton
                            icon={<LogOut />}
                            size={16}
                            title="End all sessions"
                            aria-label={`End all sessions for ${m.email}`}
                            onClick={() => setConfirm({ email: m.email })}
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
          {data && !shown.length && (
            <EmptyState
              icon={<UsersRound />}
              title={query ? "No matching members" : "No panel members yet"}
              action={
                query ? (
                  <Button size="sm" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Plus size={16} />}
                    onClick={() => {
                      setError("");
                      openEditor(emptyEditor());
                    }}
                  >
                    Add member
                  </Button>
                )
              }
            >
              {query
                ? "No member matches this search. Clear it to see everyone with panel access."
                : "Add a member to give someone access to this panel."}
            </EmptyState>
          )}
        </section>
      )}
      {tab === "sessions" && (
        <section
          className="panel"
          role="tabpanel"
          id="team-panel-sessions"
          aria-labelledby="team-panel-sessions-tab"
        >
          <div className="panel-head">
            <h2 className="section-title">Signed-in devices</h2>
          </div>
          <TableFrame stickyActions mobileLayout="stack" aria-busy={!data || undefined}>
            <caption className="table-caption">Panel sessions that are currently signed in</caption>
            <thead>
              <tr>
                <th scope="col">Member / browser</th>
                <th scope="col">Last activity</th>
                <th scope="col">Expires</th>
                <th scope="col" aria-label="Session actions" />
              </tr>
            </thead>
            <tbody>
              {!data && <SkeletonRows columns={4} rows={3} />}
              {data?.sessions.map((s) => (
                <tr key={s.id}>
                  <td>
                    <RecordCell primary={s.email} secondary={s.user_agent} />
                  </td>
                  <td data-label="Last activity">{displayDate(s.last_seen_at)}</td>
                  <td data-label="Expires">{displayDate(s.expires_at)}</td>
                  <td>
                    {s.email !== data.actor && (
                      <Button
                        size="sm"
                        onClick={() => setConfirm({ email: s.email, sessionId: s.id })}
                      >
                        End session
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
          {data && !data.sessions.length && (
            <EmptyState icon={<Clock3 />} title="No active sessions">
              Nobody is signed in to the panel right now.
            </EmptyState>
          )}
        </section>
      )}
      {tab === "audit" && (
        <section
          className="panel"
          role="tabpanel"
          id="team-panel-audit"
          aria-labelledby="team-panel-audit-tab"
        >
          <div className="panel-head">
            <h2 className="section-title">Recent access changes</h2>
          </div>
          <div className="audit-list" aria-busy={!data || undefined}>
            {!data && (
              <div>
                <span className="audit-icon">
                  <ShieldCheck size={16} />
                </span>
                <div>
                  <Skeleton width={160} />
                  <Skeleton width="40%" style={{ marginTop: 6 }} />
                </div>
              </div>
            )}
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
            <EmptyState icon={<ShieldCheck />} title="No access changes yet">
              Role and permission changes are recorded here as they happen.
            </EmptyState>
          )}
        </section>
      )}
      <Modal
        open={!!editor}
        onClose={() => !busy && setEditor(null)}
        dismissOnScrim={false}
        isDirty={() => !!editor && JSON.stringify(editor) !== editorBaseline.current}
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
              <Field label="Display name" hint="optional">
                <Input
                  value={editor.displayName}
                  onChange={(e) => setEditor({ ...editor, displayName: e.target.value })}
                />
              </Field>
              <Field label="Email" hint="required">
                <Input
                  type="email"
                  required
                  readOnly={editor.existing}
                  value={editor.email}
                  onChange={(e) => setEditor({ ...editor, email: e.target.value })}
                />
              </Field>
              <Field label="Base role">
                <Select
                  aria-label="Base role"
                  value={editor.role}
                  onValueChange={(value) => setEditor({ ...editor, role: value as PanelRole })}
                >
                  {["admin", "support", "viewer"].map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role as PanelRole]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Access expires"
                hint="optional"
                help="Leave empty for unlimited access. Your local time."
              >
                <Input
                  type="datetime-local"
                  value={editor.expiresAt}
                  onChange={(e) => setEditor({ ...editor, expiresAt: e.target.value })}
                />
              </Field>
              {data?.authMode === "app" && (
                <Field
                  label={editor.existing ? "Reset password" : "Initial password"}
                  hint={editor.existing ? "optional" : "required"}
                  htmlFor="member-password"
                >
                  {/* The owner reads this password out to the member, so it can be
                      revealed and generated instead of typed blind. */}
                  <div className="input-with-action" id="member-password-controls">
                    <Input
                      id="member-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      required={!editor.existing}
                      value={editor.password}
                      onChange={(e) => setEditor({ ...editor, password: e.target.value })}
                    />
                    <IconButton
                      icon={showPassword ? <EyeOff /> : <Eye />}
                      size={16}
                      title={showPassword ? "Hide password" : "Show password"}
                      /* The name stays put and aria-pressed carries the state —
                         swapping both said "Hide password, pressed", which reads
                         as the opposite of what the button would do. */
                      aria-label="Show password"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditor({ ...editor, password: generatePassword() });
                        setShowPassword(true);
                      }}
                    >
                      Generate
                    </Button>
                  </div>
                </Field>
              )}
              <label className="toggle-row member-toggle">
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
            {/* The matrix is the exception, not the rule: it stays folded until
                someone wants to deviate from the base role. */}
            <details className="member-permissions">
              <summary className="permissions-heading">
                <ChevronDown className="member-permissions-chevron" size={14} aria-hidden="true" />
                <h3>Individual permissions</h3>
                <span>{allowed.length} effective permissions</span>
              </summary>
              <p className="settings-caption">
                Inherit the role, explicitly allow, or deny. Optional expiry applies to the
                override; the role applies again afterward.
              </p>
              <div className="table-scroll">
                <TableFrame className="clean-table permission-table" minWidth="auto">
                  <caption className="table-caption">
                    Permissions for this member, with any override and its effect
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Permission</th>
                      <th scope="col">Rule</th>
                      <th scope="col">Override expires</th>
                      <th scope="col">Effective now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERMISSIONS.map((p) => (
                      <tr key={p.key}>
                        <td>
                          {p.label}
                          <small>{p.group}</small>
                        </td>
                        <td data-label="Rule">
                          <Select
                            aria-label={`Rule for ${p.label}`}
                            value={editor.overrides[p.key]?.effect ?? "inherit"}
                            onValueChange={(value) => {
                              const overrides = { ...editor.overrides };
                              if (value === "inherit") delete overrides[p.key];
                              else
                                overrides[p.key] = {
                                  effect: value as "allow" | "deny",
                                  expiresAt: overrides[p.key]?.expiresAt ?? null,
                                };
                              setEditor({ ...editor, overrides });
                            }}
                          >
                            <option value="inherit">Inherit role</option>
                            <option value="allow">Allow</option>
                            <option value="deny">Deny</option>
                          </Select>
                        </td>
                        <td data-label="Override expires">
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
                        <td data-label="Effective now">
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
                </TableFrame>
              </div>
            </details>
            <ModalActions>
              <Button variant="ghost" disabled={busy} onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Save access"}
              </Button>
            </ModalActions>
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
        <ModalActions>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={<LogOut />}
            disabled={busy}
            onClick={() =>
              confirm &&
              void action({ action: confirm.sessionId ? "end-session" : "kick", ...confirm })
            }
          >
            {busy ? "Ending…" : "End access"}
          </Button>
        </ModalActions>
      </Modal>
    </div>
  );
}
