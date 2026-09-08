import { Archive, Check, Mail, MessageSquare, Trash2, User, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { matchesFeedbackStatus } from "../utils/feedbackInbox";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { FormError } from "../components/ds/Field";
import { Modal, ModalActions } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SearchInput } from "../components/ds/SearchInput";
import { SegmentedControl, type TabItem } from "../components/ds/SegmentedControl";
import { Skeleton } from "../components/ds/Skeleton";
import type { SummaryPayload } from "../types/telemetry";
import { apiUrl, fetchApi } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import { navigateCustomerUrl } from "../utils/customerNavigation";
import { usePanelPermission } from "../hooks/usePanelPermission";
import { FeedbackReplies } from "../components/FeedbackReplies";

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
  summary?: SummaryPayload | null;
  filterBar?: ReactNode;
}

/** Fixed status tones: new stands out (info), read/archived recede (muted — grey = done/off). */
const STATUS_TONE: Record<FeedbackStatus, "info" | "muted"> = {
  new: "info",
  read: "muted",
  archived: "muted",
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  read: "Read",
  archived: "Archived",
};

/** The inbox filter: every status, plus the "all" pseudo-status. */
type FeedbackTab = "all" | FeedbackStatus;

const STATUS_TABS: TabItem<FeedbackTab>[] = [
  { key: "all", label: "Inbox" },
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
  { key: "archived", label: "Archived" },
];

/** Long messages get clamped to keep card height — and the action buttons — stable. */
const CLAMP_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 4,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

function isLongMessage(message: string): boolean {
  return message.length > 240 || (message.match(/\n/g)?.length ?? 0) >= 4;
}

export function FeedbackPage({ summary, filterBar }: FeedbackPageProps) {
  const canOpenCustomer = usePanelPermission("customers.read");
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<FeedbackTab>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleteCandidate, setDeleteCandidate] = useState<FeedbackRecord | null>(null);
  const [replyCandidate, setReplyCandidate] = useState<FeedbackRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Failures report inline — in the dialog for the delete, in the panel head for
  // a status change. Nothing on this page reports itself through window.alert().
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const fetching = useRef(false);

  const fetchFeedback = async (silent = false) => {
    if (fetching.current) return;
    fetching.current = true;
    const request = ++requestVersion.current;
    try {
      if (!silent) setLoading(true);
      const url = new URL(apiUrl("/api/admin/feedback"), window.location.origin);
      url.searchParams.set("_ts", String(Date.now()));
      const res = await fetchApi(url.toString(), { cache: "no-store", credentials: "include" });
      const data = await res.json();
      if (data.ok && request === requestVersion.current) setFeedback(data.feedback ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      fetching.current = false;
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeedback();
  }, []);

  // Header refresh button: silent re-pull from the worker, no skeleton flash.
  useRefreshSignal(() => void fetchFeedback(true));

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
        { retry: false },
      );
      const data = await res.json();
      if (data.ok) {
        ++requestVersion.current;
        setListError(null);
        // Update locally to avoid a full refetch flicker.
        setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, status } : f)));
      } else {
        setListError(data.error || "The status could not be updated.");
      }
    } catch (e) {
      console.error(e);
      setListError("The status could not be updated.");
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const url = new URL(
        apiUrl(`/api/admin/feedback/${deleteCandidate.id}`),
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
      setFeedback((prev) => prev.filter((f) => f.id !== deleteCandidate.id));
      ++requestVersion.current;
      setDeleteCandidate(null);
    } catch (err) {
      console.error(err);
      // The dialog stays open with the reason in it, the way Licenses and
      // Announcements report a failed delete.
      setDeleteError(err instanceof Error ? err.message : "The feedback could not be deleted.");
    } finally {
      setIsDeleting(false);
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const newCount = useMemo(() => feedback.filter((f) => f.status === "new").length, [feedback]);
  // The unread count rides on the "New" tab instead of a separate badge beside it.
  const statusTabs = useMemo<TabItem<FeedbackTab>[]>(
    () => STATUS_TABS.map((t) => (t.key === "new" ? { ...t, count: newCount } : t)),
    [newCount],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return feedback
      .filter((f) => matchesFeedbackStatus(f.status, tab))
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
    <div className="page-content page-stack-lg">
      <PageHeader
        kicker="Inbox"
        page="feedback"
        right={
          <>
            {filterBar}
            {/* A filter over one list, not a panel switch — the default
                radiogroup roles are the honest ones (ds/SegmentedControl). */}
            <SegmentedControl
              aria-label="Filter by status"
              items={statusTabs}
              value={tab}
              onChange={setTab}
            />
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="section-title">Messages</h2>
            <p className="section-sub">Feedback submitted from the app, linked to its author</p>
          </div>
          <div className="panel-head-right">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search message, customer, license…"
              style={{ width: "min(280px, 100%)" }}
            />
          </div>
        </div>
        {listError && (
          <p className="inline-notice danger" role="alert">
            {listError}
          </p>
        )}

        {loading ? (
          <div
            className="panel-body"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
            aria-busy="true"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="feedback-card">
                <Skeleton width={120} />
                <Skeleton width="70%" style={{ marginTop: 10 }} />
                <Skeleton width="45%" style={{ marginTop: 6 }} />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare />}
            title="No feedback"
            action={
              searchQuery || tab !== "all" ? (
                <Button
                  size="sm"
                  icon={<X size={14} />}
                  onClick={() => {
                    setSearchQuery("");
                    setTab("all");
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {searchQuery || tab !== "all"
              ? "Nothing matches the current filter."
              : "Feedback submitted from the app will show up here."}
          </EmptyState>
        ) : (
          <div className="panel-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {filtered.map((f) => {
              const isNew = f.status === "new";
              const long = isLongMessage(f.message);
              const isExpanded = expanded.has(f.id);
              const liveSession = f.hwid
                ? summary?.activeSessions.find(
                    (s) => (s.hwid ?? "").toLowerCase() === f.hwid!.toLowerCase(),
                  )
                : undefined;

              return (
                <div
                  key={f.id}
                  className={`feedback-card ${isNew ? "is-new" : ""}`}
                  style={{
                    padding: "14px 16px",
                    boxShadow: isNew ? "inset 2px 0 0 0 var(--accent)" : undefined,
                  }}
                >
                  {/* header: status + time · actions */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
                    >
                      <Badge tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                      <span
                        style={{
                          fontSize: "var(--fs-tiny)",
                          color: "var(--text-3)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <RelativeTime iso={f.created_at} />
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <Button
                        variant="ghost"
                        icon={<MessageSquare size={16} />}
                        onClick={() => setReplyCandidate(f)}
                      >
                        Replies
                      </Button>
                      {f.status !== "read" ? (
                        <IconButton
                          icon={<Check />}
                          size={16}
                          title="Mark read"
                          permission="support.write"
                          onClick={() => setStatus(f, "read")}
                        />
                      ) : null}
                      {f.status !== "archived" ? (
                        <IconButton
                          icon={<Archive />}
                          size={16}
                          title="Archive"
                          permission="support.write"
                          onClick={() => setStatus(f, "archived")}
                        />
                      ) : null}
                      <IconButton
                        icon={<Trash2 />}
                        size={16}
                        title="Delete"
                        style={{ color: "var(--danger)" }}
                        permission="support.write"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteCandidate(f);
                        }}
                      />
                    </div>
                  </div>

                  {/* message */}
                  <p
                    style={{
                      margin: "0 0 8px",
                      fontSize: "var(--fs-body)",
                      color: "var(--text-1)",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      ...(long && !isExpanded ? CLAMP_STYLE : {}),
                    }}
                  >
                    {f.message}
                  </p>
                  {long ? (
                    <button
                      type="button"
                      onClick={() => toggleExpand(f.id)}
                      className="btn btn-ghost"
                    >
                      {isExpanded ? "Show less" : "Show more"}
                    </button>
                  ) : null}

                  {/* meta: author link + context */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: "6px 14px",
                      fontSize: "var(--fs-small)",
                      color: "var(--text-3)",
                    }}
                  >
                    {canOpenCustomer ? (
                      <a
                        href={`?customerBy=feedback_id&customer=${f.id}#/feedback`}
                        onClick={(event) => {
                          if (
                            event.button !== 0 ||
                            event.ctrlKey ||
                            event.metaKey ||
                            event.shiftKey ||
                            event.altKey
                          )
                            return;
                          event.preventDefault();
                          navigateCustomerUrl(new URL(event.currentTarget.href));
                        }}
                        title="Open this customer's 360 view"
                        className="record-link"
                      >
                        <User size={16} />
                        Customer 360 · {f.machine_name || "Report author"}
                        {liveSession ? <span className="status-dot" title="Online now" /> : null}
                      </a>
                    ) : f.machine_name ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          color: "var(--text-2)",
                        }}
                      >
                        <User size={12} />
                        {f.machine_name}
                      </span>
                    ) : null}
                    {f.contact ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          color: "var(--text-2)",
                        }}
                        title="Contact for a reply"
                      >
                        <Mail size={12} />
                        {f.contact}
                      </span>
                    ) : null}
                    {f.app_version ? <span>v{f.app_version}</span> : null}
                    {f.platform ? <span>{f.platform}</span> : null}
                    {f.license_key ? (
                      <span style={{ fontFamily: "var(--font-mono)" }}>{f.license_key}</span>
                    ) : null}
                    {f.hwid ? (
                      <span style={{ fontFamily: "var(--font-mono)" }} title={f.hwid}>
                        HWID {f.hwid.slice(0, 10)}…
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {replyCandidate && (
        <FeedbackReplies
          key={replyCandidate.id}
          report={replyCandidate}
          onClose={() => setReplyCandidate(null)}
        />
      )}
      <Modal
        open={!!deleteCandidate}
        onClose={() => {
          setDeleteError(null);
          setDeleteCandidate(null);
        }}
        kicker="Danger zone"
        title="Delete feedback"
        sub="This permanently removes this feedback entry. It cannot be recovered."
      >
        <FormError message={deleteError} />
        {/* ModalActions, not an inline-styled row: the action row sticks to the
            bottom of the dialog everywhere else. Cancel carries no permission —
            leaving a dialog is not a privilege (ds/Modal). */}
        <ModalActions>
          <Button variant="ghost" onClick={() => setDeleteCandidate(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            permission="support.write"
            onClick={confirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete feedback"}
          </Button>
        </ModalActions>
      </Modal>
    </div>
  );
}
