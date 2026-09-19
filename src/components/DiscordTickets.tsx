import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DiscordTicketRecord } from "../types/customer360";
import { deleteDiscordTicket, downloadDiscordTicketTranscript } from "../utils/api";
import { formatDate } from "../utils/format";
import { Badge, type BadgeProps } from "./ds/Badge";
import { Button } from "./ds/Button";

/**
 * The archived Discord tickets of one customer, in the two places that show them: the Customer 360
 * commerce grid and the Licenses "Customer & order" dialog. One list, so a row reads the same in
 * both — each site only supplies its own heading.
 *
 * The transcript is downloaded, never rendered: it is HTML a third party wrote.
 */

const STATUS_LABEL: Record<string, string> = {
  closed: "Closed",
  deleted: "Deleted",
  false_topic: "False topic",
};

function statusTone(status: string): BadgeProps["tone"] {
  if (status === "closed") return "success";
  if (status === "false_topic") return "warning";
  return "muted";
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "no transcript";
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

function ticketTitle(ticket: DiscordTicketRecord): string {
  const number = ticket.ticket_no
    ? `Ticket #${ticket.ticket_no}`
    : (ticket.channel_name ?? "Ticket");
  return ticket.category ? `${number} · ${ticket.category}` : number;
}

export function DiscordTicketList({
  tickets,
  empty = "No Discord ticket is archived for this customer.",
  onDeleted,
}: {
  tickets: DiscordTicketRecord[];
  empty?: string;
  /** Called after a successful delete so the owning view can reload its count. */
  onDeleted?: (id: number) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [armedId, setArmedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: number, action: () => Promise<void>, fallback: string) => {
    if (busyId !== null) return;
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusyId(null);
    }
  };

  const remove = (id: number) =>
    run(
      id,
      async () => {
        const result = await deleteDiscordTicket(id);
        if (!result.ok) {
          throw new Error(
            result.data?.error ?? `Could not delete the ticket (HTTP ${result.status}).`,
          );
        }
        setArmedId(null);
        onDeleted?.(id);
      },
      "Could not delete the ticket.",
    );

  if (tickets.length === 0) return <p className="discord-ticket-empty">{empty}</p>;

  return (
    <div className="discord-tickets">
      <ul className="discord-ticket-list">
        {tickets.map((ticket) => (
          <li className="discord-ticket-row" key={ticket.id}>
            <div>
              <strong>{ticketTitle(ticket)}</strong>
              <span className="discord-ticket-meta">
                {[
                  ticket.closed_at ? formatDate(ticket.closed_at) : "date unknown",
                  `${ticket.ai_replies} AI ${ticket.ai_replies === 1 ? "reply" : "replies"}`,
                  formatSize(ticket.size_bytes),
                ].join(" · ")}
              </span>
            </div>
            <Badge tone={statusTone(ticket.status)}>
              {STATUS_LABEL[ticket.status] ?? ticket.status}
            </Badge>
            <Button
              size="xs"
              icon={<Download />}
              disabled={busyId !== null || ticket.size_bytes <= 0}
              aria-label={`Open transcript of ${ticketTitle(ticket)}`}
              onClick={() =>
                void run(
                  ticket.id,
                  () => downloadDiscordTicketTranscript(ticket.id),
                  "Could not download the transcript.",
                )
              }
            >
              Open transcript
            </Button>
            <Button
              size="xs"
              variant="danger"
              permission="support.write"
              icon={<Trash2 />}
              disabled={busyId !== null}
              aria-label={`Delete ${ticketTitle(ticket)}`}
              onClick={() =>
                armedId === ticket.id ? void remove(ticket.id) : setArmedId(ticket.id)
              }
            >
              {armedId === ticket.id ? "Confirm delete" : "Delete"}
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="discord-ticket-empty" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
