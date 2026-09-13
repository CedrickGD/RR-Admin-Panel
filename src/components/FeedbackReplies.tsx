import "../theme/support-workspace.css";
import { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, RotateCcw, Send } from "lucide-react";
import { Badge } from "./ds/Badge";
import { Button } from "./ds/Button";
import { Field, FormError } from "./ds/Field";
import { Textarea } from "./ds/Input";
import { Modal, ModalActions } from "./ds/Modal";
import { apiUrl, fetchApi } from "../utils/api";
import { formatDate } from "../utils/format";
import { usePanelPermission } from "../hooks/usePanelPermission";

type Reply = { id: number; message: string; created_at: string; read_at: string | null };
export function FeedbackReplies({
  report,
  onClose,
}: {
  report: { id: number; message: string; machine_name: string | null };
  onClose: () => void;
}) {
  const [replies, setReplies] = useState<Reply[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [ready, setReady] = useState(false);
  const [canReply, setCanReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [reportExpanded, setReportExpanded] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const loaded = useRef(false);
  const fetching = useRef(false);
  const allowed = usePanelPermission("support.write");
  const endpoint = apiUrl(`/api/admin/feedback/${report.id}/replies`);
  const longReport = report.message.length > 480 || (report.message.match(/\n/g)?.length ?? 0) >= 6;
  const merge = (items: Reply[]) =>
    setReplies((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      items.forEach((item) => byId.set(item.id, item));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  async function load(cursor?: number) {
    if (fetching.current) return;
    fetching.current = true;
    setLoadingReplies(true);
    try {
      const response = await fetchApi(endpoint + (cursor ? `?before=${cursor}` : ""), {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.replies))
        throw new Error("Could not load replies.");
      merge(data.replies);
      setCanReply(data.can_reply === true);
      if (cursor || !loaded.current) setBefore(data.next_before ?? null);
      loaded.current = true;
      setReady(true);
      setLoadError("");
    } catch {
      setLoadError("Replies could not be loaded. Please try again.");
    } finally {
      fetching.current = false;
      setLoadingReplies(false);
    }
  }
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 20000);
    return () => window.clearInterval(timer);
  }, []);
  async function send() {
    if (sending || !draft.trim() || !allowed || !canReply) return;
    setSending(true);
    setError("");
    try {
      const response = await fetchApi(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: draft.trim(), request_id: requestId.current }),
        },
        { retry: false },
      );
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error("Could not send your reply.");
      merge([data.reply]);
      setDraft("");
      requestId.current = crypto.randomUUID();
    } catch {
      setError("Your reply could not be sent. Your draft is still here; please try again.");
    } finally {
      setSending(false);
    }
  }
  return (
    <Modal
      open
      onClose={sending ? undefined : onClose}
      dismissOnScrim={false}
      isDirty={() => draft.trim().length > 0}
      title="Reply to report"
      sub={`Report #${report.id} / ${report.machine_name || "Report author"}`}
    >
      <div className="feedback-reply-body support-conversation">
        <section className="support-original-report" aria-label="Customer report">
          <div className="support-conversation-label">
            <MessageSquare aria-hidden="true" />
            <strong>Customer's report</strong>
          </div>
          <p
            id={`reply-source-${report.id}`}
            className={`feedback-reply-text${longReport && !reportExpanded ? " support-source-clamped" : ""}`}
          >
            {report.message}
          </p>
          {longReport && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={reportExpanded}
              aria-controls={`reply-source-${report.id}`}
              onClick={() => setReportExpanded((current) => !current)}
            >
              {reportExpanded ? "Show less" : "Show full report"}
            </Button>
          )}
        </section>

        <section className="support-conversation-history" aria-label="Reply history">
          <div className="support-conversation-heading">
            <h3>Reply history</h3>
            <span>Private in-app replies</span>
          </div>
          {before && (
            <Button variant="ghost" disabled={loadingReplies} onClick={() => void load(before)}>
              Earlier replies
            </Button>
          )}
          {replies.length > 0 && (
            <ol className="support-reply-list">
              {replies.map((reply) => (
                <li key={reply.id}>
                  <article
                    className="support-reply-message"
                    aria-label={`Support reply ${reply.id}`}
                  >
                    <div className="support-reply-meta">
                      <strong>Support</strong>
                      <time dateTime={reply.created_at}>{formatDate(reply.created_at)}</time>
                      <Badge tone={reply.read_at ? "success" : "muted"}>
                        {reply.read_at && <Check size={12} aria-hidden="true" />}
                        {reply.read_at ? "Read in app" : "Unread in app"}
                      </Badge>
                    </div>
                    <p className="feedback-reply-text">{reply.message}</p>
                  </article>
                </li>
              ))}
            </ol>
          )}
          {!ready && !loadError && (
            <p className="support-conversation-note" role="status">
              Loading replies...
            </p>
          )}
          {ready && replies.length === 0 && (
            <p className="support-conversation-note">No replies recorded yet.</p>
          )}
          {loadError && (
            <div className="support-reply-error">
              <FormError message={loadError} />
              <Button
                variant="ghost"
                icon={<RotateCcw />}
                disabled={loadingReplies}
                onClick={() => void load()}
              >
                Retry
              </Button>
            </div>
          )}
        </section>

        {ready && !canReply && (
          <p className="support-delivery-notice">
            This report has no verified recipient. In-app replies are only available for reports
            from verified installations.
          </p>
        )}
        {ready && canReply && !allowed && (
          <p className="support-delivery-notice">
            Read-only access. Sending replies requires support write permission.
          </p>
        )}
        {ready && canReply && allowed && (
          <form
            className="support-reply-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Field
              label="Your reply"
              hint="required"
              help="Private reply delivered to the customer's app inbox. This does not change the report status."
              htmlFor="feedback-reply"
            >
              <Textarea
                id="feedback-reply"
                className="feedback-reply-draft"
                rows={5}
                maxLength={4000}
                required
                disabled={sending}
                placeholder="Write an answer for this customer..."
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  requestId.current = crypto.randomUUID();
                }}
              />
            </Field>
            <span className="support-draft-count">
              {draft.length.toLocaleString()} / 4,000 characters
            </span>
            <FormError message={error} />
            <ModalActions>
              <Button variant="ghost" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                permission="support.write"
                disabled={sending || !draft.trim()}
                icon={<Send />}
              >
                {sending ? "Sending..." : "Send reply"}
              </Button>
            </ModalActions>
          </form>
        )}
      </div>
    </Modal>
  );
}
