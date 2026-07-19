import { Megaphone, Plus, Trash2, Pencil } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { formatDate } from "../utils/format";
import { apiUrl, fetchApi } from "../utils/api";

type AnnouncementLevel = "info" | "warning" | "critical";

interface AnnouncementRecord {
  id: number;
  title: string;
  body: string;
  level: AnnouncementLevel;
  is_active: number;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AnnouncementsPageProps {
  filterBar?: ReactNode;
}

interface FormState {
  title: string;
  body: string;
  level: AnnouncementLevel;
  is_active: boolean;
  starts_at: string;
  expires_at: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  body: "",
  level: "info",
  is_active: true,
  starts_at: "",
  expires_at: "",
};

const LEVEL_TONE: Record<AnnouncementLevel, "info" | "warning" | "danger"> = {
  info: "info",
  warning: "warning",
  critical: "danger",
};

/** ISO (UTC) -> value for a <input type="datetime-local"> in the admin's local timezone. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time) -> ISO-8601 UTC string, or null when empty/invalid. */
function localInputToIso(local: string): string | null {
  if (!local.trim()) return null;
  const ts = Date.parse(local);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

/** Live display state derived from the active flag + schedule window. */
function displayStatus(a: AnnouncementRecord): { label: string; tone: "success" | "warning" | "muted" | "info" } {
  if (!a.is_active) return { label: "Off", tone: "muted" };
  const now = Date.now();
  const starts = a.starts_at ? Date.parse(a.starts_at) : null;
  const expires = a.expires_at ? Date.parse(a.expires_at) : null;
  if (starts !== null && Number.isFinite(starts) && now < starts) return { label: "Scheduled", tone: "info" };
  if (expires !== null && Number.isFinite(expires) && now >= expires) return { label: "Expired", tone: "muted" };
  return { label: "Live", tone: "success" };
}

export function AnnouncementsPage({ filterBar }: AnnouncementsPageProps) {
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const [deleteCandidate, setDeleteCandidate] = useState<AnnouncementRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchAnnouncements = async () => {
    try {
      setLoading(true);
      const url = new URL(apiUrl("/api/admin/announcements"), window.location.origin);
      url.searchParams.set("_ts", String(Date.now()));
      const res = await fetchApi(url.toString(), { cache: "no-store", credentials: "include" });
      const data = await res.json();
      if (data.ok) setAnnouncements(data.announcements ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsEditorOpen(true);
  };

  const openEdit = (a: AnnouncementRecord) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      body: a.body,
      level: a.level,
      is_active: a.is_active === 1,
      starts_at: isoToLocalInput(a.starts_at),
      expires_at: isoToLocalInput(a.expires_at),
    });
    setIsEditorOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    if (!form.title.trim() || !form.body.trim()) {
      alert("Title and message are both required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        level: form.level,
        is_active: form.is_active,
        starts_at: localInputToIso(form.starts_at),
        expires_at: localInputToIso(form.expires_at),
      };
      const path = editingId === null ? "/api/admin/announcements" : `/api/admin/announcements/${editingId}`;
      const url = new URL(apiUrl(path), window.location.origin);
      const res = await fetchApi(
        url.toString(),
        {
          method: editingId === null ? "POST" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        },
        { retry: false }
      );
      const data = await res.json();
      if (data.ok) {
        await fetchAnnouncements();
        setIsEditorOpen(false);
      } else {
        alert("Error saving announcement: " + (data.error || JSON.stringify(data)));
      }
    } catch (e: any) {
      console.error(e);
      alert("Exception: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (a: AnnouncementRecord) => {
    try {
      const url = new URL(apiUrl(`/api/admin/announcements/${a.id}`), window.location.origin);
      const res = await fetchApi(
        url.toString(),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ is_active: a.is_active === 1 ? false : true }),
          credentials: "include",
        },
        { retry: false }
      );
      const data = await res.json();
      if (data.ok) await fetchAnnouncements();
      else alert("Error: " + (data.error || "Failed to update"));
    } catch (e) {
      console.error(e);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    try {
      const url = new URL(apiUrl(`/api/admin/announcements/${deleteCandidate.id}`), window.location.origin);
      const res = await fetchApi(url.toString(), { method: "DELETE", credentials: "include" }, { retry: false });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`Failed to delete: ${errData.error || res.statusText}`);
      }
      await fetchAnnouncements();
    } catch (err) {
      console.error(err);
      alert("Error: " + (err instanceof Error ? err.message : "Failed"));
    } finally {
      setIsDeleting(false);
      setDeleteCandidate(null);
    }
  };

  const sorted = useMemo(
    () => [...announcements].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [announcements]
  );

  return (
    <div className="page-content page-stack-lg v2-rise">
      <PageHeader
        kicker="Broadcast"
        title="Announcements"
        right={
          <>
            {filterBar}
            <Button size="sm" icon={<Plus size={16} />} onClick={openCreate}>
              New Announcement
            </Button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">All Announcements</h2>
            <p className="section-sub">Live in-app banners</p>
          </div>
          <div className="panel-head-right">
            <Badge tone="muted">{sorted.length}</Badge>
          </div>
        </div>

        {loading ? (
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "60px 16px", color: "var(--text-3)" }}>
            <div className="spinner spinner-md" />
            <span>Loading announcements…</span>
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState icon={<Megaphone />} title="No Announcements Yet">
            Create one to broadcast a message to everyone using the app.
          </EmptyState>
        ) : (
          <div className="data-table-wrap" style={{ borderRadius: 0, border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Announcement</th>
                  <th>Level</th>
                  <th>Status</th>
                  <th>Window</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => {
                  const status = displayStatus(a);
                  return (
                    <tr key={a.id}>
                      <td style={{ maxWidth: 380 }}>
                        <div style={{ fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>{a.title}</div>
                        <div style={{ fontSize: "var(--fs-small)", color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 }} title={a.body}>
                          {a.body}
                        </div>
                      </td>
                      <td>
                        <Badge tone={LEVEL_TONE[a.level]}>{a.level.toUpperCase()}</Badge>
                      </td>
                      <td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </td>
                      <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "var(--fs-small)" }}>
                        <div>From: {a.starts_at ? formatDate(a.starts_at) : "immediately"}</div>
                        <div>Until: {a.expires_at ? formatDate(a.expires_at) : "no end"}</div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <Button size="xs" variant="ghost" onClick={() => toggleActive(a)} style={{ minWidth: 62, justifyContent: "center" }}>
                            {a.is_active === 1 ? "Turn off" : "Turn on"}
                          </Button>
                          <IconButton icon={<Pencil />} size={16} title="Edit" onClick={() => openEdit(a)} />
                          <IconButton icon={<Trash2 />} size={16} title="Delete" style={{ color: "var(--danger)" }} onClick={() => setDeleteCandidate(a)} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / edit editor */}
      <Modal
        open={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        kicker={editingId === null ? "NEW" : "EDIT"}
        title={editingId === null ? "New Announcement" : "Edit Announcement"}
        sub="Leave start/end empty for show-immediately / no-end."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="label-sm">Title</label>
            <input
              type="text"
              className="glass-input"
              placeholder="e.g. Scheduled maintenance tonight"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
            />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="label-sm">Message</label>
            <textarea
              className="glass-input"
              placeholder="Write your announcement..."
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={4}
              maxLength={4000}
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="label-sm">Level</label>
              <select
                className="glass-input"
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value as AnnouncementLevel })}
                style={{ cursor: "pointer" }}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="label-sm">Active</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem", color: "var(--text)", cursor: "pointer", height: 38 }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                Show in app
              </label>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="label-sm">Show from (optional)</label>
              <input
                type="datetime-local"
                className="glass-input"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="label-sm">Show until (optional)</label>
              <input
                type="datetime-local"
                className="glass-input"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setIsEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingId === null ? "Publish" : "Save Changes"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteCandidate}
        onClose={() => setDeleteCandidate(null)}
        kicker="DANGER ZONE"
        title="Delete Announcement"
        sub="This permanently removes the announcement. It cannot be recovered."
      >
        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <Button variant="ghost" onClick={() => setDeleteCandidate(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
            {isDeleting ? "Processing..." : "Confirm"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
