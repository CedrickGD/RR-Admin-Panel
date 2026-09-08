import { useEffect, useState } from "react";
import type { SuspensionRecord } from "../types/telemetry";
import { fetchAdminSuspensions, postLiftSuspension, postSuspend } from "../utils/api";
import { emitRefresh } from "../utils/refreshBus";
import { Button } from "./ds/Button";
import { Field, FormError } from "./ds/Field";
import { Input, Textarea } from "./ds/Input";
import { Modal, ModalActions } from "./ds/Modal";
import { Select } from "./ds/Select";

/**
 * The identifiers one customer is keyed by, plus what the dialog has to warn
 * about. Every entry point (Customer 360, the customer directory, the app
 * access page) builds this from the row it already has — the dialog itself
 * loads the current restriction.
 */
export interface CustomerAccessTarget {
  /** Primary identity the suspension is written against. */
  identity: string;
  hwid?: string | null;
  install_id?: string | null;
  /** Name shown in the dialog subtitle. Falls back to the identity. */
  label?: string | null;
  /** Paying customer: removing access revokes something they bought. */
  paid?: boolean;
  /** The keys behind `paid`, listed in the warning when they are known. */
  paidKeys?: string[];
}

/** ISO (UTC) -> value for a <input type="datetime-local"> in the admin's local timezone. */
function localDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** App enforcement belongs to the selected customer, not a second user directory. */
export function CustomerAccessDialog({
  target,
  onClose,
}: {
  target: CustomerAccessTarget;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<SuspensionRecord | null>(null);
  const [mode, setMode] = useState<"allowed" | "ban" | "suspend">("allowed");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetchAdminSuspensions()
      .then((result) => {
        if (!active) return;
        if (!result.ok) throw new Error("Could not load the current access state.");
        const keys = [target.identity, target.hwid, target.install_id].filter(Boolean);
        const row =
          result.suspensions?.find(
            (s) =>
              s.is_active === 1 &&
              (!s.banned_until || new Date(s.banned_until).getTime() > Date.now()) &&
              [s.identity, s.hwid, s.install_id].some((key) => key && keys.includes(key)),
          ) ?? null;
        setCurrent(row);
        setReady(true);
        setMode(row?.mode ?? "allowed");
        setReason(row?.reason ?? "");
        setUntil(localDateTimeInput(row?.banned_until));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : "Could not load access.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [target.identity]);
  async function save() {
    if (busy || loading || !ready) return;
    let end: string | null = null;
    if (mode === "suspend") {
      const parsed = new Date(until);
      if (!until || !Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) {
        setError("Choose an end date in the future.");
        return;
      }
      end = parsed.toISOString();
    }
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "allowed"
          ? current
            ? await postLiftSuspension(current.identity)
            : { ok: true }
          : await postSuspend({
              identity: target.identity,
              hwid: target.hwid,
              install_id: target.install_id,
              user_label: target.label,
              mode,
              reason: reason.trim() || null,
              banned_until: end,
            });
      if (!result.ok) throw new Error("Access could not be updated. Please try again.");
      emitRefresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update access.");
    } finally {
      setBusy(false);
    }
  }
  // Differs from the loaded access state → an unfinished restriction the scrim must not discard.
  const dirty = () =>
    ready &&
    (mode !== (current?.mode ?? "allowed") ||
      reason !== (current?.reason ?? "") ||
      (mode === "suspend" && until !== localDateTimeInput(current?.banned_until)));
  const paidKeys = target.paidKeys?.filter(Boolean) ?? [];
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissOnScrim={false}
      isDirty={dirty}
      title="App access"
      sub={target.label ?? target.identity}
    >
      <form
        className="customer-access-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {loading ? (
          <p>Loading current access…</p>
        ) : (
          <>
            <p>
              Current access:{" "}
              <strong>
                {current
                  ? current.mode === "ban"
                    ? "Permanently blocked"
                    : "Temporarily suspended"
                  : "Allowed"}
              </strong>
            </p>
            {target.paid && (
              <p className="inline-notice">
                This customer has paid
                {paidKeys.length > 0 ? ` (${paidKeys.join(", ")})` : ""}. Removing access revokes
                something they bought.
              </p>
            )}
            {/* No aria-label on the Select: Field's <label for> now lands on the
                trigger button, so the visible label is the name — the duplicate
                that used to sit here had already drifted from it. */}
            <Field label="Access">
              <Select
                value={mode}
                onValueChange={(value) => setMode(value as typeof mode)}
                disabled={busy || !ready}
              >
                <option value="allowed">Allowed</option>
                <option value="suspend">Suspend until a date</option>
                <option value="ban">Permanent ban</option>
              </Select>
            </Field>
            {mode === "suspend" && (
              <Field label="Suspended until" hint="required" help="Your local time.">
                <Input
                  type="datetime-local"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  required
                  disabled={busy}
                />
              </Field>
            )}
            {mode !== "allowed" && (
              <Field label="Reason shown to the customer" hint="optional">
                <Textarea
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                />
              </Field>
            )}
          </>
        )}
        <FormError message={error} />
        <ModalActions>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant={mode === "allowed" ? "primary" : "danger"}
            permission="access.write"
            disabled={loading || busy || !ready}
          >
            {busy ? "Saving…" : mode === "allowed" ? "Allow app access" : "Apply restriction"}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
