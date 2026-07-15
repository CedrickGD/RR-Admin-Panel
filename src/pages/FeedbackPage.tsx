import { MessageSquare, Trash2, Check, Archive, Mail } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { formatDate, timeAgo } from "../utils/format";
import { apiUrl, fetchApi } from "../utils/api";

type FeedbackStatus = "new" | "read" | "archived";

interface FeedbackRecord {
  id: number;
  message: string;
  contact: string | null;
  hwid: string | null;
  install_id: string | null;
  license_key: string | null;
  machine_name: string | null;
  app_version: string | null;
  platform: string | null;
  status: FeedbackStatus;
  created_at: string;
}

interface FeedbackPageProps {
  filterBar?: ReactNode;
}

const STATUS_TONE: Record<FeedbackStatus, "info" | "muted" | "success"> = {
  new: "info",
  read: "muted",
  archived: "success",
};

const STATUS_TABS: Array<{ key: "all" | FeedbackStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
  { key: "archived", label: "Archived" },
];

export function FeedbackPage({ filterBar }: FeedbackPageProps) {
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<"all" | FeedbackStatus>("all");
  const [deleteCandidate, setDeleteCandidate] = useState<FeedbackRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchFeedback = async () => {
    try {
      setLoading(true);
      const url = new URL(apiUrl("/api/admin/feedback"), window.location.origin);
      url.searchParams.set("_ts", String(Date.now()));
      const res = await fetchApi(url.toString(), { cache: "no-store", credentials: "include" });
      const data = await res.json();
      if (data.ok) setFeedback(data.feedback ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeedback();
  }, []);

  const setStatus = async (item: FeedbackRecord, status: FeedbackStatus) => {
    try {
      const url = new URL(apiUrl(`/api/admin/feedback/${item.id}`), window.location.origin);
      const res = await fetchApi(
        url.toString(),
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status }),
          credentials: "include",
        },
        { retry: false }
      );
      const data = await res.json();
      if (data.ok) {
        // Update locally to avoid a full refetch flicker.
        setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, status } : f)));
      } else {
        alert("Error: " + (data.error || "Failed to update"));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    try {
      const url = new URL(apiUrl(`/api/admin/feedback/${deleteCandidate.id}`), window.location.origin);
      const res = await fetchApi(url.toString(), { method: "DELETE", credentials: "include" }, { retry: false });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`Failed to delete: ${errData.error || res.statusText}`);
      }
      setFeedback((prev) => prev.filter((f) => f.id !== deleteCandidate.id));
    } catch (err) {
      console.error(err);
      alert("Error: " + (err instanceof Error ? err.message : "Failed"));
    } finally {
      setIsDeleting(false);
      setDeleteCandidate(null);
    }
  };

  const newCount = useMemo(() => feedback.filter((f) => f.status === "new").length, [feedback]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return feedback
      .filter((f) => (tab === "all" ? true : f.status === tab))
      .filter((f) => {
        if (!q) return true;
        return (
          f.message.toLowerCase().includes(q) ||
          f.contact?.toLowerCase().includes(q) ||
          f.machine_name?.toLowerCase().includes(q) ||
          f.license_key?.toLowerCase().includes(q) ||
          f.hwid?.toLowerCase().includes(q)
        );
      });
  }, [feedback, tab, searchQuery]);

  return (
    <div className="page-content page-stack-lg v2-rise">
      <PageHeader
        kicker="Inbox"
        title="Feedback"
        right={
          <>
            {filterBar}
            {newCount > 0 ? <Badge tone="info">{newCount} new</Badge> : null}
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "1px solid var(--border)",
                  background: tab === t.key ? "var(--bg-subtle)" : "transparent",
                  color: tab === t.key ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="panel-head-right" style={{ minWidth: 220 }}>
            <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Search feedback, user, license..." />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
            <div className="spinner spinner-md" />
            <span>Loading feedback...</span>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<MessageSquare />} title="No Feedback">
            {searchQuery || tab !== "all" ? "Nothing matches the current filter." : "User feedback submitted from the app will show up here."}
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
            {filtered.map((f) => (
              <div
                key={f.id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  background: f.status === "new" ? "var(--bg-subtle)" : "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Badge tone={STATUS_TONE[f.status]}>{f.status.toUpperCase()}</Badge>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }} title={formatDate(f.created_at)}>
                      {timeAgo(f.created_at)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {f.status !== "read" ? (
                      <button title="Mark read" onClick={() => setStatus(f, "read")} style={iconBtnStyle("var(--text-muted)")}>
                        <Check size={16} />
                      </button>
                    ) : null}
                    {f.status !== "archived" ? (
                      <button title="Archive" onClick={() => setStatus(f, "archived")} style={iconBtnStyle("var(--text-muted)")}>
                        <Archive size={16} />
                      </button>
                    ) : null}
                    <button title="Delete" onClick={() => setDeleteCandidate(f)} style={iconBtnStyle("var(--danger)")}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <p style={{ color: "var(--text)", fontSize: "0.9rem", lineHeight: 1.6, whiteSpace: "pre-wrap", margin: "0 0 10px" }}>
                  {f.message}
                </p>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  {f.contact ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--accent)" }}>
                      <Mail size={12} /> {f.contact}
                    </span>
                  ) : null}
                  {f.machine_name ? <span>User: {f.machine_name}</span> : null}
                  {f.app_version ? <span>v{f.app_version}</span> : null}
                  {f.platform ? <span>{f.platform}</span> : null}
                  {f.license_key ? (
                    <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{f.license_key}</span>
                  ) : null}
                  {f.hwid ? <span title={f.hwid}>HWID: {f.hwid.slice(0, 12)}…</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={!!deleteCandidate}
        onClose={() => setDeleteCandidate(null)}
        kicker="DANGER ZONE"
        title="Delete Feedback"
        sub="This permanently removes this feedback entry. It cannot be recovered."
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

function iconBtnStyle(color: string): React.CSSProperties {
  return {
    background: "transparent",
    border: "1px solid transparent",
    color,
    cursor: "pointer",
    padding: "6px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
  };
}
