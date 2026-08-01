import { Key, Pencil, Plus, Trash2, ShoppingCart, User } from "lucide-react";
import { useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal } from "../components/ds/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { timeAgo, formatDate } from "../utils/format";
import { apiUrl, fetchApi } from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import type { SummaryPayload } from "../types/telemetry";

interface LicenseRecord {
  id: number;
  license_key: string;
  type: string;
  duration_days: number | null;
  hwid: string | null;
  status: string;
  custom_options: string;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  user_label?: string | null;
  client_country?: string | null;
  client_ip?: string | null;
  app_version?: string | null;
  session_last_seen?: string | null;
  session_id?: string | null;
  usage_count: number;
  max_uses: number;
  // Order tracking — who purchased this key and under which order number.
  order_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_discord?: string | null;
  order_source?: string | null;      // 'store' | 'admin'
  order_note?: string | null;
  order_meta?: string | null;        // sanitized storefront payload snapshot
  purchased_at?: string | null;
  verified_discord?: string | null;  // Discord tag verified against this key
}

/** Discord handles render as `@name` — strip a stored leading @ so it never doubles. */
function discordHandle(value: string): string {
  return `@${value.trim().replace(/^@/, "")}`;
}

/**
 * Is this a master (multi-seat) key?
 *
 * Seat count alone is not enough: an infinite master stores max_uses = -1, and a
 * master issued with a single seat stores 1 — both read as "standard" under a
 * `max_uses > 1` test, which is why self-issued master keys were showing up
 * unhighlighted. The generator now stamps custom_options with {"master":true},
 * so that flag is the primary signal and the seat count is the fallback for keys
 * created before it existed.
 */
function isMasterLicense(lic: { max_uses: number; custom_options?: string | null }): boolean {
  if (hasMasterFlag(lic.custom_options)) return true;
  return lic.max_uses === -1 || lic.max_uses > 1;
}

function hasMasterFlag(customOptions?: string | null): boolean {
  if (!customOptions) return false;
  try {
    const parsed: unknown = JSON.parse(customOptions);
    if (parsed && typeof parsed === "object" && "master" in parsed) {
      return Boolean((parsed as { master?: unknown }).master);
    }
  } catch {
    // Legacy rows stored free-form text here — fall through to the substring test.
  }
  return customOptions.toLowerCase().includes("master");
}

interface OrderEditForm {
  order_id: string;
  customer_name: string;
  customer_email: string;
  customer_discord: string;
  order_note: string;
}

const EMPTY_ORDER_FORM: OrderEditForm = {
  order_id: "",
  customer_name: "",
  customer_email: "",
  customer_discord: "",
  order_note: "",
};

interface LicensesPageProps {
  summary?: SummaryPayload | null;
  onOpenSession?: (sessionId: string) => void;
  onOpenWorker?: (hwid: string) => void;
  filterBar?: ReactNode;
}

export function LicensesPage({ summary, onOpenSession, onOpenWorker, filterBar }: LicensesPageProps) {
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // The header's "Generate Key(s)" button used to flip an isGenerateModalOpen
  // flag that no modal was ever bound to, so it did nothing. It now jumps to the
  // generator panel — which matters once the licenses table runs long.
  const generatorRef = useRef<HTMLElement | null>(null);

  const [genType, setGenType] = useState("lifetime");
  const [genDuration, setGenDuration] = useState(30);
  const [genCount, setGenCount] = useState(1);
  const [isMaster, setIsMaster] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [isInfiniteUses, setIsInfiniteUses] = useState(false);
  
  const [deleteCandidate, setDeleteCandidate] = useState<LicenseRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Customer/order attribution editor (per-license pencil action)
  const [editCandidate, setEditCandidate] = useState<LicenseRecord | null>(null);
  const [editForm, setEditForm] = useState<OrderEditForm>(EMPTY_ORDER_FORM);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Optional buyer attribution stamped onto keys at generation time
  const [genOrderId, setGenOrderId] = useState("");
  const [genCustomerName, setGenCustomerName] = useState("");
  const [genCustomerEmail, setGenCustomerEmail] = useState("");
  const [genCustomerDiscord, setGenCustomerDiscord] = useState("");

  const fetchLicenses = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const url = new URL(apiUrl("/api/admin/licenses"), window.location.origin);
      url.searchParams.set("_ts", String(Date.now()));
      const res = await fetchApi(url.toString(), { cache: "no-store", credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        setLicenses(data.licenses);
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicenses();
  }, []);

  // Header refresh button: silent re-pull from the worker, no skeleton flash.
  useRefreshSignal(() => void fetchLicenses(true));

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const url = new URL(apiUrl("/api/admin/licenses"), window.location.origin);
      let calculatedDays: number | null = null;
      if (genType === 'days') calculatedDays = genDuration;
      else if (genType === 'weeks') calculatedDays = genDuration * 7;
      else if (genType === 'months') calculatedDays = genDuration * 30;
      else if (genType === 'years') calculatedDays = genDuration * 365;
      else if (genType === 'hours') calculatedDays = genDuration / 24;
      else if (genType === 'minutes') calculatedDays = genDuration / 1440;

      const payload = {
        type: genType === 'lifetime' ? 'lifetime' : 'trial',
        count: isMaster ? 1 : genCount,
        duration_days: calculatedDays,
        // Optional for master keys: blank means "give it a random key like a
        // standard one", which is the common case.
        custom_key: isMaster && customKey.trim() ? customKey.trim() : undefined,
        max_uses: isMaster ? (isInfiniteUses ? -1 : maxUses) : 1,
        // Persist what was actually picked. The directory can't infer it from the
        // seat count — infinite masters store -1 and single-seat masters store 1,
        // so both used to read as standard keys.
        custom_options: isMaster ? { master: true } : undefined,
        // Optional manual-sale attribution — stamped on every generated key.
        order_id: genOrderId.trim() || undefined,
        customer_name: genCustomerName.trim() || undefined,
        customer_email: genCustomerEmail.trim() || undefined,
        customer_discord: genCustomerDiscord.trim() || undefined,
      };
      // No retry: generating keys is not idempotent.
      const res = await fetchApi(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      }, { retry: false });
      const data = await res.json();
      if (data.ok) {
        await fetchLicenses();
        setCustomKey("");
        // Clear the one-shot buyer attribution so the next batch never
        // accidentally inherits the previous customer.
        setGenOrderId("");
        setGenCustomerName("");
        setGenCustomerEmail("");
        setGenCustomerDiscord("");
      } else {
        alert("Error generating license: " + (data.error || JSON.stringify(data)));
      }
    } catch (e: any) {
      console.error(e);
      alert("Exception: " + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    try {
      // Always hard-delete: removes the row and instantly cuts access on every bound machine
      // (the app's next license poll gets "Invalid license key"). Master keys carry a custom
      // key string, so the path segment MUST be encoded — a raw space / "+" / "/" in the key
      // breaks the request, which is exactly why master keys were erroring before.
      const encodedKey = encodeURIComponent(deleteCandidate.license_key);
      const url = new URL(apiUrl(`/api/admin/licenses/${encodedKey}`), window.location.origin);

      const res = await fetchApi(url.toString(), {
        method: "DELETE",
        credentials: "include"
      }, { retry: false });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`Failed to delete license: ${errData.error || res.statusText}`);
      }

      await fetchLicenses();
    } catch (err) {
      console.error(err);
      alert("Error: " + (err instanceof Error ? err.message : "Failed"));
    } finally {
      setIsDeleting(false);
      setDeleteCandidate(null);
    }
  };

  const openEdit = (lic: LicenseRecord) => {
    setEditForm({
      order_id: lic.order_id ?? "",
      customer_name: lic.customer_name ?? "",
      customer_email: lic.customer_email ?? "",
      customer_discord: lic.customer_discord ?? "",
      order_note: lic.order_note ?? "",
    });
    setEditError(null);
    setEditCandidate(lic);
  };

  const saveEdit = async () => {
    if (!editCandidate || isSavingEdit) return;
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const encodedKey = encodeURIComponent(editCandidate.license_key);
      const url = new URL(apiUrl(`/api/admin/licenses/${encodedKey}`), window.location.origin);
      // All five fields are sent every save: present-but-empty clears a value.
      const res = await fetchApi(url.toString(), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editForm),
        credentials: "include"
      }, { retry: false });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || res.statusText || "Failed to save.");
      }
      await fetchLicenses(true);
      setEditCandidate(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save customer info.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const sortedLicenses = useMemo(() => {
    return [...licenses.filter(lic => {
      const lowerQuery = searchQuery.toLowerCase();
      return !searchQuery.trim() ||
             lic.license_key.toLowerCase().includes(lowerQuery) ||
             lic.hwid?.toLowerCase().includes(lowerQuery) ||
             lic.user_label?.toLowerCase().includes(lowerQuery) ||
             lic.client_ip?.toLowerCase().includes(lowerQuery) ||
             lic.order_id?.toLowerCase().includes(lowerQuery) ||
             lic.customer_name?.toLowerCase().includes(lowerQuery) ||
             lic.customer_email?.toLowerCase().includes(lowerQuery) ||
             lic.customer_discord?.toLowerCase().includes(lowerQuery) ||
             lic.verified_discord?.toLowerCase().includes(lowerQuery);
    })].sort((a, b) => {
      const aIsMaster = isMasterLicense(a);
      const bIsMaster = isMasterLicense(b);
      if (aIsMaster && !bIsMaster) return -1;
      if (!aIsMaster && bIsMaster) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [licenses, searchQuery]);

  const renderTable = (lics: LicenseRecord[], title: string) => (
    <section className="panel" style={{ marginBottom: 24 }}>
      <div className="panel-head">
        <div className="panel-head-left">
          <h2 className="section-title">{title}</h2>
        </div>
        <div className="panel-head-right">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search key, user, customer, order…"
            style={{ width: 280, maxWidth: "100%" }}
          />
          <Badge tone="muted">{lics.length}</Badge>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "60px", textAlign: "center", color: "var(--text-2)", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
           <div className="spinner spinner-md" />
           <span>Loading licenses...</span>
        </div>
      ) : lics.length === 0 ? (
        <EmptyState icon={<Key />} title="No Licenses Found">
          {searchQuery ? "No licenses match your current search filter." : "No license keys generated yet."}
        </EmptyState>
      ) : (
        <div className="data-table-wrap">
          {/* DS .data-table — same anatomy as every other directory table so the
              whole console reads as one system (uppercase hairline header,
              sticky head, hover rows, density ladder, column priority). */}
          <table className="data-table">
            <thead>
              <tr>
                <th>License Key</th>
                <th>Customer</th>
                <th>Order</th>
                <th>Duration</th>
                <th className="col-md">Usage</th>
                <th>Status</th>
                <th className="col-lg">Linked Session</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lics.map(lic => {
                const isMaster = isMasterLicense(lic);
                return (
                <tr key={lic.id} className={isMaster ? "row-master" : undefined}>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Key size={14} style={{ color: isMaster ? "var(--warning)" : "var(--accent)", flex: "none" }} />
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78125rem", fontWeight: 600, letterSpacing: "0.02em", color: isMaster ? "var(--warning)" : "var(--text-1)", whiteSpace: "nowrap", maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis" }} title={lic.license_key}>{lic.license_key}</span>
                      {isMaster && (
                        <span style={{ fontSize: "0.65rem", padding: "2px 6px", borderRadius: "4px", background: "var(--warning-sub)", color: "var(--warning)", fontWeight: 700, letterSpacing: "0.05em" }}>MASTER</span>
                      )}
                    </span>
                  </td>
                  <td style={{ maxWidth: 200 }}>
                    {(lic.customer_name || lic.customer_email || lic.customer_discord || lic.verified_discord) ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                        {lic.customer_name ? (
                          <span style={{ color: "var(--text-1)", fontWeight: 600, fontSize: "0.8125rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={lic.customer_name}>
                            {lic.customer_name}
                          </span>
                        ) : null}
                        {lic.customer_email ? (
                          <span style={{ color: "var(--text-2)", fontSize: "0.71875rem", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={lic.customer_email}>
                            {lic.customer_email}
                          </span>
                        ) : null}
                        {lic.customer_discord ? (
                          <span style={{ color: "var(--text-2)", fontSize: "0.71875rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={`Discord: ${lic.customer_discord}`}>
                            {discordHandle(lic.customer_discord)}
                          </span>
                        ) : null}
                        {lic.verified_discord ? (
                          <span style={{ color: "var(--success-text)", fontSize: "0.71875rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title="This Discord account verified with this key">
                            ✓ {discordHandle(lic.verified_discord)}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-3)", fontStyle: "italic", fontSize: "0.8125rem" }}>No customer yet</span>
                    )}
                  </td>
                  <td>
                    {(lic.order_id || lic.order_source) ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                        {lic.order_id ? (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78125rem", color: "var(--text-1)", fontWeight: 600, whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }} title={`Order ${lic.order_id}`}>
                            {lic.order_id}
                          </span>
                        ) : null}
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          {lic.order_source ? (
                            <span style={{ fontSize: "0.625rem", padding: "1px 6px", borderRadius: 4, background: lic.order_source === "store" ? "var(--accent-subtle)" : "var(--surface-3)", color: lic.order_source === "store" ? "var(--accent-text)" : "var(--text-2)", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }} title={lic.order_source === "store" ? "Issued by the storefront delivery API" : "Attributed by an admin"}>
                              {lic.order_source}
                            </span>
                          ) : null}
                          {lic.purchased_at ? (
                            <span style={{ fontSize: "0.6875rem", color: "var(--text-3)" }} title={formatDate(lic.purchased_at)}>
                              {timeAgo(lic.purchased_at)}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-3)", fontSize: "0.8125rem" }}>—</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span style={{ color: "var(--text-1)", fontWeight: 500 }}>
                      {lic.type === "lifetime" ? "Lifetime" : (
                        lic.duration_days && lic.duration_days < 1 / 24 ? `${Math.round(lic.duration_days * 1440)} Mins` :
                        lic.duration_days && lic.duration_days < 1 ? `${Math.round(lic.duration_days * 24)} Hours` :
                        lic.duration_days && lic.duration_days % 365 === 0 ? `${lic.duration_days / 365} Years` :
                        lic.duration_days && lic.duration_days % 30 === 0 ? `${lic.duration_days / 30} Months` :
                        lic.duration_days && lic.duration_days % 7 === 0 ? `${lic.duration_days / 7} Weeks` :
                        `${Math.round(lic.duration_days || 0)} Days`
                      )}
                    </span>
                  </td>
                  <td className="col-md">
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: "60px", height: "6px", background: "var(--line)", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: "100%", transformOrigin: "left", transform: `scaleX(${lic.max_uses === -1 ? 1 : Math.min(1, lic.usage_count / Math.max(1, lic.max_uses))})`, background: "var(--accent)", transition: "transform var(--t-fill) var(--ease-out)" }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>{lic.usage_count} / {lic.max_uses === -1 ? "Infinite" : lic.max_uses}</span>
                    </div>
                  </td>
                  <td>
                    <StatusBadge
                      presence={lic.status === "active" ? "online" : lic.status === "revoked" ? "unreachable" : "idle"} 
                      label={lic.status.toUpperCase()} 
                    />
                  </td>
                  <td className="col-lg">
                    {lic.hwid ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <User size={12} style={{ color: "var(--text-2)" }} />
                        {lic.session_id || lic.hwid ? (() => {
                          const isLive = lic.session_id && summary?.activeSessions.some(s => s.id === lic.session_id);
                          return (
                            <button 
                              type="button"
                              onClick={() => {
                                if (isLive && onOpenSession && lic.session_id) {
                                  onOpenSession(lic.session_id);
                                } else if (onOpenWorker && lic.hwid) {
                                  onOpenWorker(lic.hwid);
                                }
                              }}
                              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--accent)", padding: 0, fontSize: "0.8125rem", fontWeight: 600, maxWidth: "120px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: "underline", textDecorationStyle: "dotted" }}
                              title={isLive ? "View Live Session" : "View User Sessions"}
                            >
                              {lic.user_label || "Unknown User"}
                            </button>
                          );
                        })() : (
                          <strong style={{ color: "var(--text-1)", fontSize: "0.8125rem", maxWidth: "120px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={lic.user_label || "Unknown User"}>
                            {lic.user_label || "Unknown User"}
                          </strong>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-2)", fontStyle: "italic", fontSize: "0.8125rem" }}>Unbound</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        onClick={() => openEdit(lic)}
                        style={{
                          background: "transparent",
                          border: "1px solid transparent",
                          color: "var(--accent-text)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "6px",
                          borderRadius: "6px",
                          transition: "background var(--t-med) var(--ease-smooth), color var(--t-med) var(--ease-smooth)"
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--accent-subtle)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        title="Edit customer / order info"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => setDeleteCandidate(lic)}
                        style={{
                          background: "transparent",
                          border: "1px solid transparent",
                          color: "var(--danger)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "6px",
                          borderRadius: "6px",
                          transition: "background var(--t-med) var(--ease-smooth), color var(--t-med) var(--ease-smooth)"
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "var(--danger-sub)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        title="Permanently Delete License"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="page-content page-stack-lg">
      <PageHeader 
        kicker="Access" 
        title="Licenses" 
        right={
          <>
            {filterBar}
            <Button
              size="sm"
              onClick={() => generatorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              Generate Key(s)
            </Button>
          </>
        }
      />

      {/* Generator spans the full row — the old two-col layout paired it with a
          search panel that was 90% dead space; search now lives in the All
          Licenses table head like every other directory page. */}
      <section className="panel" ref={generatorRef}>
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker kicker-row">
                <Plus size={12} /> Generator
              </p>
              <h2 className="section-title">License Generator</h2>
              <p className="section-sub">Create standard or custom master licenses</p>
            </div>
            <div className="panel-head-right">
              <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "var(--surface-2)", padding: "4px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <button 
                  onClick={() => setIsMaster(false)} 
                  style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", border: "none", background: !isMaster ? "var(--surface-2)" : "transparent", color: !isMaster ? "var(--text-1)" : "var(--text-2)", boxShadow: !isMaster ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "background var(--t-med) var(--ease-smooth), color var(--t-med) var(--ease-smooth), box-shadow var(--t-med) var(--ease-smooth)" }}
                >
                  Standard
                </button>
                <button 
                  onClick={() => setIsMaster(true)} 
                  style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", border: "none", background: isMaster ? "var(--surface-2)" : "transparent", color: isMaster ? "var(--accent)" : "var(--text-2)", boxShadow: isMaster ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "background var(--t-med) var(--ease-smooth), color var(--t-med) var(--ease-smooth), box-shadow var(--t-med) var(--ease-smooth)" }}
                >
                  Master Key
                </button>
              </div>
            </div>
          </div>

          <div className="panel-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px", marginBottom: "16px" }}>
              {isMaster ? (
                <>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label className="label-sm">Custom Key String (optional)</label>
                    <input
                      type="text"
                      className="glass-input"
                      placeholder="Blank = random key"
                      value={customKey}
                      onChange={e => setCustomKey(e.target.value)}
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label className="label-sm">Max Uses (Usability)</label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text-1)", cursor: "pointer" }}>
                        <input type="checkbox" checked={isInfiniteUses} onChange={e => setIsInfiniteUses(e.target.checked)} />
                        Infinite
                      </label>
                    </div>
                    {!isInfiniteUses && (
                      <input 
                        type="number" 
                        className="glass-input"
                        min={1}
                        value={maxUses}
                        onChange={e => setMaxUses(Number(e.target.value))}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label className="label-sm">Quantity to Gen</label>
                  <input 
                    type="number" 
                    className="glass-input"
                    value={genCount} 
                    min={1} 
                    max={50} 
                    onChange={e => setGenCount(Number(e.target.value))}
                  />
                </div>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label className="label-sm">Duration Type</label>
                <select 
                  className="glass-input" 
                  value={genType} 
                  onChange={e => setGenType(e.target.value)}
                  style={{ cursor: "pointer" }}
                >
                  <option value="lifetime">Lifetime</option>
                  <option value="years">Years</option>
                  <option value="months">Months</option>
                  <option value="weeks">Weeks</option>
                  <option value="days">Days</option>
                  <option value="hours">Hours</option>
                  <option value="minutes">Minutes</option>
                </select>
              </div>

              {genType !== "lifetime" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label className="label-sm">Duration Value</label>
                  <input 
                    type="number" 
                    className="glass-input"
                    value={genDuration} 
                    onChange={e => setGenDuration(Number(e.target.value))}
                  />
                </div>
              )}
            </div>

            {/* Optional buyer attribution for manual sales — stamped on every
                generated key so the directory shows who it was sold to. */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, marginBottom: 16 }}>
              <p className="label-sm" style={{ marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ShoppingCart size={12} /> Customer / Order (optional — for manual sales)
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label className="label-sm">Order No.</label>
                  <input type="text" className="glass-input" placeholder="e.g. ORD-1042" value={genOrderId} onChange={e => setGenOrderId(e.target.value)} style={{ fontFamily: "monospace" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label className="label-sm">Customer Name</label>
                  <input type="text" className="glass-input" placeholder="Buyer name" value={genCustomerName} onChange={e => setGenCustomerName(e.target.value)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label className="label-sm">Customer Email</label>
                  <input type="email" className="glass-input" placeholder="buyer@mail.com" value={genCustomerEmail} onChange={e => setGenCustomerEmail(e.target.value)} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label className="label-sm">Discord</label>
                  <input type="text" className="glass-input" placeholder="@buyer" value={genCustomerDiscord} onChange={e => setGenCustomerDiscord(e.target.value)} />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button size="md" icon={<Plus size={16} />} onClick={handleGenerate} disabled={generating} variant="primary">
                {generating ? "Generating..." : isMaster ? "Create Master Key" : "Generate Standard Keys"}
              </Button>
            </div>
          </div>
      </section>

      {renderTable(sortedLicenses, "All Licenses")}

      <Modal 
        open={!!deleteCandidate} 
        onClose={() => setDeleteCandidate(null)}
        kicker="DANGER ZONE"
        title="Delete License"
        sub={deleteCandidate?.hwid
          ? "This permanently wipes the license from the database and instantly kills access on every bound machine. It cannot be recovered."
          : "This will permanently wipe this license from the database. It cannot be recovered."}
      >
        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <Button variant="ghost" onClick={() => setDeleteCandidate(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete} disabled={isDeleting}>
            {isDeleting ? "Processing..." : "Confirm"}
          </Button>
        </div>
      </Modal>

      {/* Customer / order attribution editor */}
      <Modal
        open={!!editCandidate}
        onClose={() => (isSavingEdit ? null : setEditCandidate(null))}
        kicker="Order Tracking"
        title="Customer & Order"
        sub={editCandidate ? `License ${editCandidate.license_key}` : undefined}
      >
        {editCandidate ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Machine-owned facts about this key (read-only) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: "0.71875rem", color: "var(--text-3)" }}>
              <span>Source: <strong style={{ color: "var(--text-2)", textTransform: "uppercase" }}>{editCandidate.order_source || "—"}</strong></span>
              <span>Issued: <strong style={{ color: "var(--text-2)" }}>{editCandidate.purchased_at ? formatDate(editCandidate.purchased_at) : formatDate(editCandidate.created_at)}</strong></span>
              {editCandidate.verified_discord ? (
                <span>Verified Discord: <strong style={{ color: "var(--success-text)" }}>{discordHandle(editCandidate.verified_discord)}</strong></span>
              ) : null}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="label-sm">Order No.</label>
                <input type="text" className="glass-input" placeholder="e.g. ORD-1042 / invoice id" value={editForm.order_id} onChange={e => setEditForm(f => ({ ...f, order_id: e.target.value }))} style={{ fontFamily: "monospace" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="label-sm">Customer Name</label>
                <input type="text" className="glass-input" placeholder="Buyer name" value={editForm.customer_name} onChange={e => setEditForm(f => ({ ...f, customer_name: e.target.value }))} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="label-sm">Customer Email</label>
                <input type="email" className="glass-input" placeholder="buyer@mail.com" value={editForm.customer_email} onChange={e => setEditForm(f => ({ ...f, customer_email: e.target.value }))} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label className="label-sm">Discord</label>
                <input type="text" className="glass-input" placeholder="@buyer" value={editForm.customer_discord} onChange={e => setEditForm(f => ({ ...f, customer_discord: e.target.value }))} />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label className="label-sm">Note</label>
              <textarea
                className="glass-input"
                rows={3}
                placeholder="Anything worth remembering about this sale…"
                value={editForm.order_note}
                onChange={e => setEditForm(f => ({ ...f, order_note: e.target.value }))}
                style={{ resize: "vertical", minHeight: 64 }}
              />
            </div>

            {editCandidate.order_meta ? (
              <details>
                <summary style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-2)" }}>
                  Raw storefront payload (what the shop sent when this key was issued)
                </summary>
                <pre style={{ marginTop: 8, padding: "10px 12px", background: "rgba(3, 5, 12, 0.4)", border: "1px solid var(--line)", borderRadius: 10, fontSize: "0.6875rem", color: "var(--text-2)", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 180, overflow: "auto" }}>
                  {(() => { try { return JSON.stringify(JSON.parse(editCandidate.order_meta), null, 2); } catch { return editCandidate.order_meta; } })()}
                </pre>
              </details>
            ) : null}

            {editError ? (
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--danger-text)" }} role="alert">{editError}</p>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
              <Button variant="ghost" onClick={() => setEditCandidate(null)} disabled={isSavingEdit}>Cancel</Button>
              <Button variant="primary" onClick={saveEdit} disabled={isSavingEdit}>
                {isSavingEdit ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
