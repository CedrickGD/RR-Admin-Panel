import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { InstallRecord } from "../types/telemetry";
import { fetchInstalls, revokeInstall } from "../utils/api";
import { formatDate } from "../utils/format";
import { Badge } from "./ds/Badge";
import { Button } from "./ds/Button";
import { Input } from "./ds/Input";
import { RelativeTime } from "./ds/RelativeTime";
import { versionLabel } from "../utils/versionLabel";
interface InstallsPanelProps {
  hwid: string | null;
}

/**
 * Registered installs of one device: short install id, version, last seen, a Verified badge
 * when a license is bound, and a two-step Revoke that invalidates the install's signing key.
 * Loaded on first expand (the detail row stays mounted) and refreshed after every revoke.
 */
export function InstallsPanel({ hwid }: InstallsPanelProps) {
  const [installs, setInstalls] = useState<InstallRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(() => {
    if (!hwid) return;
    const seq = ++requestSeq.current;
    setLoadError(null);
    void fetchInstalls(hwid)
      .then((result) => {
        if (requestSeq.current !== seq) return;
        if (result.ok && result.installs) setInstalls(result.installs);
        else setLoadError(`Could not load installs (HTTP ${result.status}).`);
      })
      .catch(() => {
        if (requestSeq.current === seq) setLoadError("Could not load installs.");
      });
  }, [hwid]);

  useEffect(() => {
    load();
  }, [load]);

  async function revoke(installId: string) {
    setBusyId(installId);
    setActionError(null);
    try {
      const result = await revokeInstall(installId, reason.trim() || null);
      if (!result.ok) {
        setActionError(result.error ?? `Could not revoke install (HTTP ${result.status}).`);
        return;
      }
      setConfirmId(null);
      setReason("");
      load();
    } catch {
      setActionError("Could not revoke install.");
    } finally {
      setBusyId(null);
    }
  }

  let body: ReactNode;
  if (!hwid) {
    body = <p className="installs-note">No hardware ID reported — installs are keyed by device.</p>;
  } else if (loadError) {
    body = (
      <p className="installs-error">
        {loadError}
        <Button size="xs" onClick={load}>
          Retry
        </Button>
      </p>
    );
  } else if (installs === null) {
    body = <div className="skeleton installs-skeleton" />;
  } else if (installs.length === 0) {
    body = (
      <p className="installs-note">
        No registered installs yet — clients before 1.4.9 never register.
      </p>
    );
  } else {
    body = (
      <div className="installs-list">
        {installs.map((install) => {
          const revoked = install.revokedAt !== null;
          const confirming = confirmId === install.installId;
          const busy = busyId === install.installId;
          return (
            <div
              key={install.installId}
              className={`glass-inset installs-row${revoked ? " is-revoked" : ""}`}
            >
              <span className="installs-id" title={install.installId}>
                {install.installId.slice(0, 8)}
              </span>
              <Badge tone="muted">{versionLabel(install.appVersion)}</Badge>
              {install.licenseId !== null ? (
                <Badge tone="accent" title="A license is bound to this install">
                  Verified
                </Badge>
              ) : null}
              {revoked ? (
                <Badge
                  tone="danger"
                  title={`Revoked ${formatDate(install.revokedAt)}${install.revokeReason ? ` — ${install.revokeReason}` : ""}`}
                >
                  Revoked
                </Badge>
              ) : null}
              <span className="installs-seen">
                {install.lastSeenAt ? (
                  <>
                    seen <RelativeTime iso={install.lastSeenAt} />
                  </>
                ) : (
                  "not seen yet"
                )}
              </span>
              {!revoked ? (
                <span className="installs-actions">
                  {confirming ? (
                    <>
                      {/* Stays inline: the font-size has to outrank
                          consistency.css's 16px mobile-zoom guard, which it
                          only does from a style attribute. */}
                      <Input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason (optional)"
                        maxLength={500}
                        disabled={busy}
                        style={{ height: 26, fontSize: "var(--fs-tiny)", width: 180 }}
                      />
                      <Button
                        size="xs"
                        onClick={() => {
                          setConfirmId(null);
                          setReason("");
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        permission="monitoring.write"
                        onClick={() => void revoke(install.installId)}
                        disabled={busy}
                      >
                        {busy ? "Revoking…" : "Confirm revoke"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="xs"
                      variant="danger"
                      permission="monitoring.write"
                      title="Invalidate this install's signing key — the app must register a new install"
                      onClick={() => {
                        setConfirmId(install.installId);
                        setReason("");
                        setActionError(null);
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </span>
              ) : null}
            </div>
          );
        })}
        {actionError ? <p className="installs-action-error">{actionError}</p> : null}
      </div>
    );
  }

  return (
    <div className="detail-block">
      <p className="label-sm detail-label">Installs</p>
      {body}
    </div>
  );
}
