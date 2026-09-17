import { TableFrame } from "../components/ds/TableFrame";
import { Select } from "../components/ds/Select";
import { Megaphone, Plus, Trash2, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Field, FormError } from "../components/ds/Field";
import { Input, Textarea } from "../components/ds/Input";
import { Modal, ModalActions } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { SkeletonRows } from "../components/ds/Skeleton";
import { formatDate } from "../utils/format";
import { apiUrl, fetchApi } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";

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

/** Sentence case, like every other label in the console (docs/panel-workspace.md). */
const LEVEL_LABEL: Record<AnnouncementLevel, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
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
function displayStatus(a: AnnouncementRecord): {
  label: string;
  tone: "success" | "warning" | "muted" | "info";
} {
  if (!a.is_active) return { label: "Off", tone: "muted" };
  const now = Date.now();
  const starts = a.starts_at ? Date.parse(a.starts_at) : null;
  const expires = a.expires_at ? Date.parse(a.expires_at) : null;
  if (starts !== null && Number.isFinite(starts) && now < starts)
    return { label: "Scheduled", tone: "info" };
  if (expires !== null && Number.isFinite(expires) && now >= expires)
    return { label: "Expired", tone: "muted" };
  return { label: "Live", tone: "success" };
}

export function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Inline in the dialog, not a native alert(): a failed save keeps the typed
  // announcement on screen next to the reason it did not go out.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Same rule for the row-level active toggle, which still used alert().
  const [listError, setListError] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // What the editor opened with — anything beyond it is unsaved work the Modal must not discard.
  const editorBaseline = useRef<FormState>(EMPTY_FORM);

  const [deleteCandidate, setDeleteCandidate] = useState<AnnouncementRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchAnnouncements = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const url = new URL(apiUrl("/api/admin/announcements"), window.location.origin);
      url.searchParams.set("_ts", String(Date.now()));
      const res = await fetchApi(url.toString(), { cache: "no-store", credentials: "include" });
      const data = await res.json();
      if (data.ok) setAnnouncements(data.announcements ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnnouncements();
  }, []);

  // Header refresh button: silent re-pull from the worker, no skeleton flash.
  useRefreshSignal(() => void fetchAnnouncements(true));

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    editorBaseline.current = EMPTY_FORM;
    setIsEditorOpen(true);
  };

  const openEdit = (a: AnnouncementRecord) => {
    setEditingId(a.id);
    const loaded: FormState = {
      title: a.title,
      body: a.body,
      level: a.level,
      is_active: a.is_active === 1,
      starts_at: isoToLocalInput(a.starts_at),
      expires_at: isoToLocalInput(a.expires_at),
    };
    setForm(loaded);
    editorBaseline.current = loaded;
    setIsEditorOpen(true);
  };

  const submitEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (!form.title.trim() || !form.body.trim()) {
      setSaveError("Title and message are both required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        level: form.level,
        is_active: form.is_active,
        starts_at: localInputToIso(form.starts_at),
        expires_at: localInputToIso(form.expires_at),
      };
      const path =
        editingId === null ? "/api/admin/announcements" : `/api/admin/announcements/${editingId}`;
      const url = new URL(apiUrl(path), window.location.origin);
      const res = await fetchApi(
        url.toString(),
        {
          method: editingId === null ? "POST" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        },
        { retry: false },
      );
      const data = await res.json();
      if (data.ok) {
        await fetchAnnouncements();
        setIsEditorOpen(false);
      } else {
        setSaveError(data.error || "The announcement could not be saved.");
      }
    } catch (e) {
      console.error(e);
      setSaveError(e instanceof Error ? e.message : "The announcement could not be saved.");
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
        { retry: false },
      );
      const data = await res.json();
      if (data.ok) {
        setListError(null);
        await fetchAnnouncements();
      } else {
        setListError(data.error || "The announcement could not be updated.");
      }
    } catch (e) {
      console.error(e);
      setListError("The announcement could not be updated.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const url = new URL(
        apiUrl(`/api/admin/announcements/${deleteCandidate.id}`),
        window.location.origin,
      );
      const res = await fetchApi(
        url.toString(),
        { method: "DELETE", credentials: "include" },
        { retry: false },
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`Failed to delete: ${errData.error || res.statusText}`);
      }
      await fetchAnnouncements();
      setDeleteCandidate(null);
    } catch (err) {
      console.error(err);
      // The dialog stays open with the reason instead of closing on a failure.
      setDeleteError(err instanceof Error ? err.message : "The announcement could not be deleted.");
    } finally {
      setIsDeleting(false);
    }
  };

  const sorted = useMemo(
    () =>
      [...announcements].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [announcements],
  );

  return (
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Broadcast"
        page="announcements"
        right={
          <>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={16} />}
              permission="announcements.write"
              onClick={openCreate}
            >
              New announcement
            </Button>
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">All announcements</h2>
            <p className="section-sub">Live in-app banners</p>
          </div>
          <div className="panel-head-right">
            <Badge tone="muted">{sorted.length}</Badge>
          </div>
        </div>
        {listError && (
          <p className="inline-notice danger" role="alert">
            {listError}
          </p>
        )}

        {!loading && sorted.length === 0 ? (
          <EmptyState
            icon={<Megaphone />}
            title="No announcements yet"
            action={
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={16} />}
                permission="announcements.write"
                onClick={openCreate}
              >
                New announcement
              </Button>
            }
          >
            Create one to broadcast a message to everyone using the app.
          </EmptyState>
        ) : (
          <TableFrame stickyActions mobileLayout="stack" aria-busy={loading || undefined}>
            <caption className="table-caption">Announcements and their schedule</caption>
            <thead>
              <tr>
                <th scope="col">Announcement</th>
                <th scope="col">Level</th>
                <th scope="col">Status</th>
                <th scope="col">Window</th>
                <th scope="col" aria-label="Announcement actions" />
              </tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows columns={5} rows={3} />}
              {sorted.map((a) => {
                const status = displayStatus(a);
                return (
                  <tr key={a.id}>
                    <td style={{ maxWidth: 380 }}>
                      <div style={{ fontWeight: 600, color: "var(--text-1)", marginBottom: 2 }}>
                        {a.title}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--fs-small)",
                          color: "var(--text-3)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 360,
                        }}
                        title={a.body}
                      >
                        {a.body}
                      </div>
                    </td>
                    <td data-label="Level">
                      <Badge tone={LEVEL_TONE[a.level]}>{LEVEL_LABEL[a.level]}</Badge>
                    </td>
                    <td data-label="Status">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    {/* One wrapper, no inline nowrap: the stacked card lays the cell
                        out as a flex row (label + value), so two loose divs sat side by
                        side on one unbreakable line and Until ran past the viewport.
                        Desktop keeps its nowrap from the record-table cell rule. */}
                    <td
                      className="muted"
                      data-label="Window"
                      style={{ fontSize: "var(--fs-small)" }}
                    >
                      <div>
                        <div>From: {a.starts_at ? formatDate(a.starts_at) : "immediately"}</div>
                        <div>Until: {a.expires_at ? formatDate(a.expires_at) : "no end"}</div>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Button
                          size="xs"
                          variant="ghost"
                          permission="announcements.write"
                          onClick={() => toggleActive(a)}
                          style={{ minWidth: 62, justifyContent: "center" }}
                        >
                          {a.is_active === 1 ? "Turn off" : "Turn on"}
                        </Button>
                        <IconButton
                          icon={<Pencil />}
                          size={16}
                          title="Edit"
                          permission="announcements.write"
                          onClick={() => openEdit(a)}
                        />
                        <IconButton
                          icon={<Trash2 />}
                          size={16}
                          title="Delete"
                          style={{ color: "var(--danger)" }}
                          permission="announcements.write"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleteCandidate(a);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </section>

      {/* Create / edit editor */}
      <Modal
        open={isEditorOpen}
        onClose={() => (saving ? undefined : setIsEditorOpen(false))}
        dismissOnScrim={false}
        isDirty={() =>
          (Object.keys(form) as Array<keyof FormState>).some(
            (key) => form[key] !== editorBaseline.current[key],
          )
        }
        kicker={editingId === null ? "New" : "Edit"}
        title={editingId === null ? "New announcement" : "Edit announcement"}
        sub="Leave start/end empty for show-immediately / no-end."
      >
        <form className="announcement-form" onSubmit={submitEditor}>
          <Field label="Title" hint="required">
            <Input
              required
              placeholder="e.g. Scheduled maintenance tonight"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={200}
            />
          </Field>

          <Field label="Message" hint="required">
            <Textarea
              required
              placeholder="Write your announcement…"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={4}
              maxLength={4000}
            />
          </Field>

          <div className="announcement-form-grid">
            <Field label="Level">
              <Select
                aria-label="Level"
                value={form.level}
                onValueChange={(value) => setForm({ ...form, level: value as AnnouncementLevel })}
              >
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </Select>
            </Field>
            <label className="toggle-row announcement-toggle">
              <span>Show in app</span>
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
            </label>
          </div>

          <div className="announcement-form-grid">
            <Field label="Show from" hint="optional">
              <Input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              />
            </Field>
            <Field label="Show until" hint="optional">
              <Input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
              />
            </Field>
          </div>

          <FormError message={saveError} />

          <ModalActions>
            <Button variant="ghost" onClick={() => setIsEditorOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              permission="announcements.write"
              disabled={saving}
            >
              {saving ? "Saving…" : editingId === null ? "Publish" : "Save changes"}
            </Button>
          </ModalActions>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!deleteCandidate}
        onClose={() => (isDeleting ? undefined : setDeleteCandidate(null))}
        kicker="Danger zone"
        title="Delete announcement"
        sub="This permanently removes the announcement. It cannot be recovered."
      >
        <FormError message={deleteError} />
        <ModalActions>
          <Button variant="ghost" onClick={() => setDeleteCandidate(null)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 />}
            permission="announcements.write"
            onClick={confirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete announcement"}
          </Button>
        </ModalActions>
      </Modal>
    </div>
  );
}
