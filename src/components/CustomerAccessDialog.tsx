import { useEffect, useState } from "react";
import type { Customer360Customer } from "../types/customer360";
import type { SuspensionRecord } from "../types/telemetry";
import { fetchAdminSuspensions, postLiftSuspension, postSuspend } from "../utils/api";
import { emitRefresh } from "../utils/refreshBus";
import { Button } from "./ds/Button";
import { Modal } from "./ds/Modal";
import { Select } from "./ds/Select";

/** App enforcement belongs to the selected customer, not a second user directory. */
export function CustomerAccessDialog({
  customer,
  onClose,
}: {
  customer: Customer360Customer;
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
        const keys = [
          customer.anchor.identity,
          customer.anchor.hwid,
          customer.anchor.install_id,
        ].filter(Boolean);
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
        if (row?.banned_until) {
          const date = new Date(row.banned_until);
          setUntil(
            new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16),
          );
        }
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
  }, [customer.anchor.identity]);
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
              identity: customer.anchor.identity,
              hwid: customer.anchor.hwid,
              install_id: customer.anchor.install_id,
              user_label: customer.profile.user_label,
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
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="App access"
      sub={
        customer.profile.user_label ?? customer.profile.customer_name ?? customer.anchor.identity
      }
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
            {customer.summary.license_tier === "premium" && (
              <p className="inline-notice">This customer has a paid license.</p>
            )}
            <label>
              Access{" "}
              <Select
                aria-label="App access"
                value={mode}
                onValueChange={(value) => setMode(value as typeof mode)}
                disabled={busy || !ready}
              >
                <option value="allowed">Allowed</option>
                <option value="suspend">Suspend until a date</option>
                <option value="ban">Permanent ban</option>
              </Select>
            </label>
            {mode === "suspend" && (
              <label>
                Suspended until{" "}
                <input
                  className="glass-input"
                  type="datetime-local"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  required
                  disabled={busy}
                />
              </label>
            )}
            {mode !== "allowed" && (
              <label>
                Reason shown to the user{" "}
                <textarea
                  className="glass-input"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="row-actions">
          <Button onClick={onClose} disabled={busy}>
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
        </div>
      </form>
    </Modal>
  );
}
