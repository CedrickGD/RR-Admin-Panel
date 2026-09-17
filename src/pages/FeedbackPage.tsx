import "../theme/support-workspace.css";
import {
  Archive,
  Check,
  ChevronDown,
  Inbox,
  Mail,
  MessageSquare,
  RotateCcw,
  Trash2,
  User,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { matchesFeedbackStatus } from "../utils/feedbackInbox";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { FormError } from "../components/ds/Field";
import { Modal, ModalActions } from "../components/ds/Modal";
import { PageHeader } from "../components/ds/PageHeader";
import { PageToolbar } from "../components/ds/PageToolbar";
import { RelativeTime } from "../components/ds/RelativeTime";
import { SearchInput } from "../components/ds/SearchInput";
import { SegmentedControl, type TabItem } from "../components/ds/SegmentedControl";
import { Skeleton } from "../components/ds/Skeleton";
import { Tabs } from "../components/ds/Tabs";
import type {
  FeedbackKind,
  FeedbackRecord,
  FeedbackStatus,
  SummaryPayload,
} from "../types/telemetry";
import { apiUrl, fetchApi } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import { navigateCustomerUrl } from "../utils/customerNavigation";
import { usePanelPermission } from "../hooks/usePanelPermission";
import { FeedbackReplies } from "../components/FeedbackReplies";

interface FeedbackPageProps {
  summary?: SummaryPayload | null;
}

// Read is an inbox state, not a resolution. Only archived reports leave Inbox.
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

type FeedbackTab = "all" | FeedbackStatus;
const STATUS_TABS: TabItem<FeedbackTab>[] = [
  { key: "all", label: "Inbox" },
  { key: "new", label: "New" },
  { key: "read", label: "Read" },
  { key: "archived", label: "Archived" },
];

/**
 * The page's two sections (ds/Tabs — page sections, not a filter): Feedback holds ideas and
 * opinions, Support the "report a problem" submissions with their diagnostics. Each section keeps
 * its own status filter, count line, list and actions; the kind comes from the API row
 * (shared/feedback-contract.ts) and rows without one are feedback.
 */
type FeedbackSection = FeedbackKind;
const SECTIONS: FeedbackSection[] = ["feedback", "support"];

/**
 * The open section lives in the query string, beside Customer 360's `customer`/`customerTab`
 * (the hash is the page key, see utils/pageRouting): `/?section=support#/feedback`.
 */
const SECTION_PARAM = "section";

function readSection(): FeedbackSection {
  return new URLSearchParams(window.location.search).get(SECTION_PARAM) === "support"
    ? "support"
    : "feedback";
}

/** Mirrors the section into the address without a new history entry (as CustomersPage does). */
function writeSection(section: FeedbackSection | null) {
  const url = new URL(window.location.href);
  if (section === "support") url.searchParams.set(SECTION_PARAM, section);
  else url.searchParams.delete(SECTION_PARAM);
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, "", url);
  }
}

const SECTION_COPY: Record<
  FeedbackSection,
  {
    label: string;
    titles: Record<FeedbackTab, string>;
    inboxHint: string;
    archivedHint: string;
    emptyTitle: string;
    emptyBody: string;
    deleteTitle: string;
    deleteSub: string;
  }
> = {
  feedback: {
    label: "Feedback",
    titles: {
      all: "Feedback inbox",
      new: "New feedback",
      read: "Read feedback",
      archived: "Archived feedback",
    },
    inboxHint: "New and read feedback stays here until archived. Read does not mean answered.",
    archivedHint: "Archived separately. Move an entry to Inbox when it needs attention again.",
    emptyTitle: "No feedback yet",
    emptyBody: "Ideas and opinions sent from the app will show up here.",
    deleteTitle: "Delete feedback",
    deleteSub: "This permanently removes this feedback entry. It cannot be recovered.",
  },
  support: {
    label: "Support",
    titles: {
      all: "Support inbox",
      new: "New reports",
      read: "Read reports",
      archived: "Archived reports",
    },
    inboxHint: "New and read reports stay here until archived. Read does not mean resolved.",
    archivedHint: "Archived separately. Move a report to Inbox when it needs attention again.",
    emptyTitle: "No support reports yet",
    emptyBody: "Problem reports sent from the app, with their diagnostics, will show up here.",
    deleteTitle: "Delete report",
    deleteSub: "This permanently removes this support report. It cannot be recovered.",
  },
};

function isLongMessage(message: string): boolean {
  return message.length > 240 || (message.match(/\n/g)?.length ?? 0) >= 4;
}

function maskedIdentifier(value: string | null): string {
  if (!value) return "Not recorded";
  return value.length > 8 ? `****${value.slice(-4)}` : "********";
}

/** A row as the API sends it; the kind is normalized so an older payload lands in Feedback. */
function normalizeRecord(row: FeedbackRecord & { kind?: unknown }): FeedbackRecord {
  return { ...row, kind: row.kind === "support" ? "support" : "feedback" };
}

export function FeedbackPage({ summary }: FeedbackPageProps) {
  const canOpenCustomer = usePanelPermission("customers.read");
  const canManage = usePanelPermission("support.write");
  const [feedback, setFeedback] = useState<FeedbackRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<FeedbackTab>("all");
  const [section, setSection] = useState<FeedbackSection>(readSection);
  const feedbackFiltersActive = searchQuery.trim().length > 0 || tab !== "all";
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleteCandidate, setDeleteCandidate] = useState<FeedbackRecord | null>(null);
  const [replyCandidate, setReplyCandidate] = useState<FeedbackRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const fetching = useRef(false);
  const changingStatus = useRef(false);
  const copy = SECTION_COPY[section];

  useEffect(() => {
    writeSection(section);
    // Leaving the page takes the parameter with it, so it never rides along to another page.
    return () => writeSection(null);
  }, [section]);

  // Back/Forward onto an entry of this page whose section differs (Customer 360 opened over one
  // section, closed over the other) — follow the address.
  useEffect(() => {
    const follow = () => setSection(readSection());
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

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
      if (!res.ok || !data.ok || !Array.isArray(data.feedback)) {
        throw new Error("Feedback could not be loaded.");
      }
      if (request === requestVersion.current) {
        setFeedback((data.feedback as FeedbackRecord[]).map(normalizeRecord));
        setHasLoaded(true);
        setLoadError(null);
      }
    } catch {
      if (request === requestVersion.current)
        setLoadError("Feedback could not be loaded. Please try again.");
    } finally {
      fetching.current = false;
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchFeedback();
  }, []);
  useRefreshSignal(() => void fetchFeedback(true));

  const setStatus = async (item: FeedbackRecord, status: FeedbackStatus) => {
    if (!canManage || changingStatus.current || isDeleting) return;
    changingStatus.current = true;
    setPendingStatus(item.id);
    setListError(null);
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
      if (!res.ok || !data.ok) throw new Error("Status update failed.");
      ++requestVersion.current;
      setFeedback((prev) => prev.map((f) => (f.id === item.id ? { ...f, status } : f)));
    } catch {
      setListError("The status could not be updated. The report has not been moved.");
    } finally {
      changingStatus.current = false;
      setPendingStatus(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate || !canManage || isDeleting || changingStatus.current) return;
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
      if (!res.ok) throw new Error("Delete failed.");
      setFeedback((prev) => prev.filter((f) => f.id !== deleteCandidate.id));
      ++requestVersion.current;
      setDeleteCandidate(null);
    } catch {
      setDeleteError("The feedback could not be deleted. Please try again.");
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

  /*
   * ── Sections ──────────────────────────────────────────────────────────────
   * One load serves both inboxes; the tab label carries the unread count of each, the way the
   * Restrictions tab on Customers carries what is in force — neutral text, not an alert pill.
   */
  const unreadByKind = useMemo(() => {
    const counts: Record<FeedbackSection, number> = { feedback: 0, support: 0 };
    for (const f of feedback) if (f.status === "new") counts[f.kind] += 1;
    return counts;
  }, [feedback]);

  const sectionTabs: TabItem<FeedbackSection>[] = SECTIONS.map((key) => ({
    key,
    label:
      hasLoaded && unreadByKind[key] > 0
        ? `${SECTION_COPY[key].label} · ${unreadByKind[key]}`
        : SECTION_COPY[key].label,
    panelId: `feedback-panel-${key}`,
  }));

  const sectionRows = useMemo(
    () => feedback.filter((f) => f.kind === section),
    [feedback, section],
  );

  const statusTabs = useMemo<TabItem<FeedbackTab>[]>(
    () =>
      STATUS_TABS.map((item) => ({
        ...item,
        count: hasLoaded
          ? sectionRows.filter((f) => matchesFeedbackStatus(f.status, item.key)).length
          : undefined,
      })),
    [sectionRows, hasLoaded],
  );

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sectionRows
      .filter((f) => matchesFeedbackStatus(f.status, tab))
      .filter(
        (f) =>
          !q ||
          [
            f.message,
            f.contact,
            f.machine_name,
            f.license_key,
            f.hwid,
            f.install_id,
            String(f.id),
          ].some((value) => value?.toLowerCase().includes(q)),
      );
  }, [sectionRows, tab, searchQuery]);

  const deleteCopy = SECTION_COPY[deleteCandidate?.kind ?? section];

  return (
    <div className="page-content page-stack-lg support-workspace">
      <PageHeader kicker="Customer support" page="feedback" />

      <Tabs
        aria-label="Feedback sections"
        items={sectionTabs}
        value={section}
        onChange={setSection}
      />

      <div
        className="page-stack-lg"
        role="tabpanel"
        id={`feedback-panel-${section}`}
        aria-labelledby={`feedback-panel-${section}-tab`}
      >
        <PageToolbar
          aria-label={`${copy.label} filters`}
          canReset={feedbackFiltersActive}
          onReset={() => {
            setSearchQuery("");
            setTab("all");
          }}
          left={
            <SegmentedControl
              aria-label="Filter by status"
              items={statusTabs}
              value={tab}
              onChange={setTab}
            />
          }
          search={
            <SearchInput
              aria-label="Search feedback"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search message, customer, report..."
            />
          }
        />

        <section className="panel support-inbox" aria-labelledby="support-inbox-title">
          <div className="panel-head support-inbox-head">
            <div className="panel-head-left">
              <h2 className="section-title" id="support-inbox-title">
                {copy.titles[tab]}
              </h2>
              <p className="section-sub">
                {tab === "archived" ? copy.archivedHint : copy.inboxHint}
              </p>
            </div>
            {hasLoaded && (
              <span className="support-result-count" role="status">
                {filtered.length} of {sectionRows.length} loaded reports
              </span>
            )}
          </div>

          {listError && (
            <p className="inline-notice danger support-notice" role="alert">
              {listError}
            </p>
          )}
          {loadError && hasLoaded && (
            <div className="inline-notice danger support-notice" role="alert">
              <span>Could not refresh feedback. Showing the last loaded reports.</span>
              <Button variant="ghost" icon={<RotateCcw />} onClick={() => void fetchFeedback(true)}>
                Retry
              </Button>
            </div>
          )}

          {loading ? (
            <div className="support-inbox-list" aria-busy="true" aria-label="Loading feedback">
              {[0, 1, 2].map((i) => (
                <div key={i} className="support-report support-loading">
                  <Skeleton width={150} />
                  <Skeleton width="85%" />
                  <Skeleton width="60%" />
                </div>
              ))}
            </div>
          ) : loadError && !hasLoaded ? (
            <EmptyState
              icon={<MessageSquare />}
              title="Feedback unavailable"
              action={
                <Button variant="ghost" icon={<RotateCcw />} onClick={() => void fetchFeedback()}>
                  Retry
                </Button>
              }
            >
              {loadError}
            </EmptyState>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={tab === "archived" ? <Archive /> : <Inbox />}
              title={
                sectionRows.length === 0
                  ? copy.emptyTitle
                  : searchQuery.trim()
                    ? "No matching reports"
                    : tab === "archived"
                      ? "No archived reports"
                      : "Nothing in the inbox"
              }
            >
              {sectionRows.length === 0
                ? copy.emptyBody
                : feedbackFiltersActive
                  ? "Nothing matches the current filter."
                  : "Everything in this section is archived."}
            </EmptyState>
          ) : (
            <div className="support-inbox-list">
              {filtered.map((f) => {
                const isNew = f.status === "new";
                const long = isLongMessage(f.message);
                const isExpanded = expanded.has(f.id);
                const liveSession = f.hwid
                  ? summary?.activeSessions.find(
                      (s) => (s.hwid ?? "").toLowerCase() === f.hwid!.toLowerCase(),
                    )
                  : undefined;
                const author = f.machine_name || f.contact || "Report author";
                return (
                  <article
                    key={f.id}
                    aria-label={`Feedback report ${f.id}`}
                    className={`support-report${isNew ? " is-new" : ""}`}
                    aria-busy={pendingStatus === f.id || undefined}
                    data-kind={f.kind}
                  >
                    <div className="support-report-identity">
                      <span className="support-author-avatar" aria-hidden="true">
                        <User />
                      </span>
                      <div className="support-author">
                        <h3>{author}</h3>
                        {f.contact && f.contact !== author && (
                          <span className="support-contact">
                            <Mail aria-hidden="true" />
                            {f.contact}
                          </span>
                        )}
                      </div>
                      <div className="support-report-state">
                        <Badge tone={STATUS_TONE[f.status] ?? "muted"}>
                          {STATUS_LABEL[f.status] ?? "Unknown"}
                        </Badge>
                        <RelativeTime iso={f.created_at} />
                      </div>
                    </div>

                    <div className="support-report-content">
                      <p
                        id={`feedback-message-${f.id}`}
                        className={`support-report-message${long && !isExpanded ? " is-clamped" : ""}`}
                      >
                        {f.message}
                      </p>
                      {long && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="support-expand"
                          aria-expanded={isExpanded}
                          aria-controls={`feedback-message-${f.id}`}
                          onClick={() => toggleExpand(f.id)}
                        >
                          {isExpanded ? "Show less" : "Show more"}
                        </Button>
                      )}
                    </div>

                    <div className="support-report-footer">
                      <div className="support-report-context">
                        <span className="support-report-id">Report #{f.id}</span>
                        {canOpenCustomer && (
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
                            className="record-link support-customer-link"
                          >
                            <User aria-hidden="true" />
                            Customer 360
                          </a>
                        )}
                        {liveSession && (
                          <span className="support-presence">
                            <span className="status-dot" />
                            Online now
                          </span>
                        )}
                      </div>
                      <div className="support-report-actions">
                        {f.status === "new" && (
                          <Button
                            variant="ghost"
                            icon={<Check />}
                            permission="support.write"
                            disabled={pendingStatus !== null || isDeleting}
                            onClick={() => void setStatus(f, "read")}
                          >
                            Mark read
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          icon={f.status === "archived" ? <Inbox /> : <Archive />}
                          permission="support.write"
                          disabled={pendingStatus !== null || isDeleting}
                          onClick={() =>
                            void setStatus(f, f.status === "archived" ? "read" : "archived")
                          }
                        >
                          {f.status === "archived" ? "Move to inbox" : "Archive"}
                        </Button>
                        <Button
                          variant="accent"
                          icon={<MessageSquare />}
                          onClick={() => setReplyCandidate(f)}
                        >
                          Replies
                        </Button>
                      </div>
                    </div>

                    <details className="support-report-details">
                      <summary>
                        <span>Report details</span>
                        <ChevronDown aria-hidden="true" />
                      </summary>
                      <dl className="support-report-facts">
                        <div>
                          <dt>Report ID</dt>
                          <dd>#{f.id}</dd>
                        </div>
                        <div>
                          <dt>App version</dt>
                          <dd>{f.app_version || "Not recorded"}</dd>
                        </div>
                        <div>
                          <dt>Platform</dt>
                          <dd>{f.platform || "Not recorded"}</dd>
                        </div>
                        <div>
                          <dt>Installation</dt>
                          <dd>
                            <code>{maskedIdentifier(f.install_id)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>License key</dt>
                          <dd>
                            <code>{maskedIdentifier(f.license_key)}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Device ID</dt>
                          <dd>
                            <code>{maskedIdentifier(f.hwid)}</code>
                          </dd>
                        </div>
                      </dl>
                      <p className="support-details-help">
                        Identifiers are masked. Full customer context is available in Customer 360.
                      </p>
                      <Button
                        variant="danger"
                        icon={<Trash2 />}
                        permission="support.write"
                        disabled={pendingStatus !== null || isDeleting}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteCandidate(f);
                        }}
                      >
                        Delete report
                      </Button>
                    </details>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {replyCandidate && (
        <FeedbackReplies
          key={replyCandidate.id}
          report={replyCandidate}
          onClose={() => setReplyCandidate(null)}
        />
      )}
      <Modal
        open={!!deleteCandidate}
        onClose={
          isDeleting
            ? undefined
            : () => {
                setDeleteError(null);
                setDeleteCandidate(null);
              }
        }
        kicker="Danger zone"
        title={deleteCopy.deleteTitle}
        sub={deleteCopy.deleteSub}
      >
        <p className="support-delete-context">
          Report #{deleteCandidate?.id} from{" "}
          {deleteCandidate?.machine_name || deleteCandidate?.contact || "Report author"}
        </p>
        <FormError message={deleteError} />
        <ModalActions>
          <Button variant="ghost" disabled={isDeleting} onClick={() => setDeleteCandidate(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            permission="support.write"
            onClick={confirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : deleteCopy.deleteTitle}
          </Button>
        </ModalActions>
      </Modal>
    </div>
  );
}
