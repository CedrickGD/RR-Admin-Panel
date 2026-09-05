import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "./ds/Button";
import { Modal } from "./ds/Modal";
import { apiUrl, fetchApi } from "../utils/api";
import { formatDate } from "../utils/format";
import { usePanelPermission } from "../hooks/usePanelPermission";
import "./feedbackReplies.css";

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
  const [ready, setReady] = useState(false);
  const [canReply, setCanReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const loaded = useRef(false);
  const allowed = usePanelPermission("support.write");
  const endpoint = apiUrl(`/api/admin/feedback/${report.id}/replies`);
  const merge = (items: Reply[]) =>
    setReplies((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      items.forEach((item) => byId.set(item.id, item));
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  async function load(cursor?: number) {
    try {
      const response = await fetchApi(endpoint + (cursor ? `?before=${cursor}` : ""), {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load replies.");
      merge(data.replies ?? []);
      setCanReply(data.can_reply);
      if (cursor || !loaded.current) setBefore(data.next_before);
      loaded.current = true;
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load replies.");
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
    if (sending || !draft.trim()) return;
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
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not send your reply.");
      merge([data.reply]);
      setDraft("");
      requestId.current = crypto.randomUUID();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your reply.");
    } finally {
      setSending(false);
    }
  }
  return (
    <Modal
      open
      onClose={sending ? undefined : onClose}
      title="Reply to report"
      className="feedback-reply-modal"
      sub={report.machine_name ?? "Report author"}
    >
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        <div>
          <strong>Customer's report</strong>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{report.message}</p>
        </div>
        {before && (
          <Button variant="ghost" onClick={() => void load(before)}>
            Earlier replies
          </Button>
        )}
        {replies.map((reply) => (
          <article
            key={reply.id}
            style={{ borderLeft: "2px solid var(--accent)", padding: "4px 12px", minWidth: 0 }}
          >
            <div style={{ color: "var(--text-2)", fontSize: "var(--fs-small)" }}>
              Support · {formatDate(reply.created_at)} ·{" "}
              {reply.read_at ? "Read in app" : "Unread in app"}
            </div>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: "8px 0" }}>
              {reply.message}
            </p>
          </article>
        ))}
        {!ready && !error && <p>Loading replies…</p>}
        {ready && !canReply && (
          <p>
            This old report has no verified recipient. In-app replies are available for reports from
            verified installations.
          </p>
        )}
        {ready && canReply && allowed && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="feedback-reply">Your reply</label>
            <textarea
              id="feedback-reply"
              className="input"
              rows={5}
              maxLength={4000}
              required
              disabled={sending}
              placeholder="Write an answer for this customer…"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                requestId.current = crypto.randomUUID();
              }}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                margin: "8px 0",
                minHeight: 120,
                resize: "vertical",
                border: "1px solid var(--line-hi)",
                borderRadius: 8,
                padding: 12,
                fontFamily: "inherit",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "var(--text-2)" }}>
                Private reply · delivered to their app inbox
              </span>
              <Button type="submit" disabled={sending || !draft.trim()} icon={<Send size={16} />}>
                {sending ? "Sending…" : "Send reply"}
              </Button>
            </div>
          </form>
        )}
        {error && (
          <p role="alert" style={{ color: "var(--danger)", overflowWrap: "anywhere" }}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
