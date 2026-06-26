import { Key, Plus, Trash2, Search, User } from "lucide-react";
import { useEffect, useState, useMemo, type ReactNode } from "react";
import { Badge } from "../components/ds/Badge";
import { Button } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Modal } from "../components/ds/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/ds/PageHeader";
import { SearchInput } from "../components/ds/SearchInput";
import { timeAgo, formatDate } from "../utils/format";
import type { SummaryPayload } from "../types/telemetry";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

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
}

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
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  
  const [genType, setGenType] = useState("lifetime");
  const [genDuration, setGenDuration] = useState(30);
  const [genCount, setGenCount] = useState(1);
  const [isMaster, setIsMaster] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [isInfiniteUses, setIsInfiniteUses] = useState(false);
  
  const [deleteCandidate, setDeleteCandidate] = useState<LicenseRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchLicenses = async () => {
    try {
      setLoading(true);
      const url = new URL(API_BASE ? `${API_BASE}/api/admin/licenses` : "/api/admin/licenses", window.location.origin);
      const res = await fetch(url.toString(), { credentials: "include" });
      const data = await res.json();
      if (data.ok) {
        setLicenses(data.licenses);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicenses();
  }, []);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const url = new URL(API_BASE ? `${API_BASE}/api/admin/licenses` : "/api/admin/licenses", window.location.origin);
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
        custom_key: isMaster && customKey.trim() ? customKey.trim() : undefined,
        max_uses: isMaster ? (isInfiniteUses ? -1 : maxUses) : 1
      };
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
      const data = await res.json();
      if (data.ok) {
        await fetchLicenses();
        setIsGenerateModalOpen(false);
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
      const urlPath = `/api/admin/licenses/${encodedKey}`;
      const url = new URL(API_BASE ? `${API_BASE}${urlPath}` : urlPath, window.location.origin);

      const res = await fetch(url.toString(), {
        method: "DELETE",
        credentials: "include"
      });

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

  const sortedLicenses = useMemo(() => {
    return [...licenses.filter(lic => {
      const lowerQuery = searchQuery.toLowerCase();
      return !searchQuery.trim() || 
             lic.license_key.toLowerCase().includes(lowerQuery) || 
             lic.hwid?.toLowerCase().includes(lowerQuery) || 
             lic.user_label?.toLowerCase().includes(lowerQuery) || 
             lic.client_ip?.toLowerCase().includes(lowerQuery);
    })].sort((a, b) => {
      const aIsMaster = a.max_uses > 1 || a.custom_options?.includes("master");
      const bIsMaster = b.max_uses > 1 || b.custom_options?.includes("master");
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
          <Badge tone="muted">{lics.length}</Badge>
        </div>
      </div>
      
      {loading ? (
        <div style={{ padding: "60px", textAlign: "center", color: "var(--text-muted)", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
           <div className="spinner spinner-md" />
           <span>Loading licenses...</span>
        </div>
      ) : lics.length === 0 ? (
        <EmptyState icon={<Key />} title="No Licenses Found">
          {searchQuery ? "No licenses match your current search filter." : "No license keys generated yet."}
        </EmptyState>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="ds-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left", color: "var(--text-muted)", background: "var(--bg-subtle)" }}>
                <th style={{ padding: "14px 20px", fontWeight: 500 }}>License Key</th>
                <th style={{ padding: "14px 20px", fontWeight: 500 }}>Duration</th>
                <th style={{ padding: "14px 20px", fontWeight: 500 }}>Usage</th>
                <th style={{ padding: "14px 20px", fontWeight: 500 }}>Status</th>
                <th style={{ padding: "14px 20px", fontWeight: 500 }}>Linked Session</th>
                <th style={{ padding: "14px 20px", fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {lics.map(lic => {
                const isMaster = lic.max_uses > 1 || lic.custom_options?.includes("master");
                return (
                <tr key={lic.id} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "var(--bg-subtle)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "14px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <Key size={14} style={{ color: isMaster ? "var(--warning)" : "var(--accent)" }} />
                      <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontWeight: 600, letterSpacing: "0.02em", color: isMaster ? "var(--warning)" : "var(--text)" }}>{lic.license_key}</span>
                      {isMaster && (
                        <span style={{ fontSize: "0.65rem", padding: "2px 6px", borderRadius: "4px", background: "var(--warning-subtle)", color: "var(--warning)", fontWeight: 700, letterSpacing: "0.05em" }}>MASTER</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "14px 20px" }}>
                    <span style={{ color: "var(--text)", fontWeight: 500 }}>
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
                  <td style={{ padding: "14px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <div style={{ width: "60px", height: "6px", background: "var(--border)", borderRadius: "3px", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${lic.max_uses === -1 ? 100 : Math.min(100, (lic.usage_count / Math.max(1, lic.max_uses)) * 100)}%`, background: "var(--accent)", transition: "width 0.3s" }} />
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{lic.usage_count} / {lic.max_uses === -1 ? "Infinite" : lic.max_uses}</span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 20px" }}>
                    <StatusBadge 
                      presence={lic.status === "active" ? "online" : lic.status === "revoked" ? "unreachable" : "idle"} 
                      label={lic.status.toUpperCase()} 
                    />
                  </td>
                  <td style={{ padding: "14px 20px" }}>
                    {lic.hwid ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <User size={12} style={{ color: "var(--text-muted)" }} />
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
                          <strong style={{ color: "var(--text)", fontSize: "0.8125rem", maxWidth: "120px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={lic.user_label || "Unknown User"}>
                            {lic.user_label || "Unknown User"}
                          </strong>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.8125rem" }}>Unbound</span>
                    )}
                  </td>
                  <td style={{ padding: "14px 20px" }}>
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
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "var(--danger-subtle)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                      title="Permanently Delete License"
                    >
                      <Trash2 size={16} />
                    </button>
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
    <div className="page-content page-stack-lg v2-rise">
      <PageHeader 
        kicker="Access" 
        title="Licenses" 
        right={
          <>
            {filterBar}
            <Button size="sm" onClick={() => setIsGenerateModalOpen(true)}>Generate Key(s)</Button>
          </>
        }
      />

      <div className="two-col" style={{ alignItems: "flex-start", marginBottom: 24 }}>
        <section className="panel" style={{ flex: "2 1 400px", height: "100%" }}>
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker kicker-row">
                <Plus size={12} /> Generator
              </p>
              <h2 className="section-title">License Generator</h2>
              <p className="section-sub">Create standard or custom master licenses</p>
            </div>
            <div className="panel-head-right">
              <div style={{ display: "flex", alignItems: "center", gap: "4px", background: "var(--bg-card)", padding: "4px", borderRadius: "8px", border: "1px solid var(--border)" }}>
                <button 
                  onClick={() => setIsMaster(false)} 
                  style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", border: "none", background: !isMaster ? "var(--bg-subtle)" : "transparent", color: !isMaster ? "var(--text)" : "var(--text-muted)", boxShadow: !isMaster ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.2s" }}
                >
                  Standard
                </button>
                <button 
                  onClick={() => setIsMaster(true)} 
                  style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", border: "none", background: isMaster ? "var(--bg-subtle)" : "transparent", color: isMaster ? "var(--accent)" : "var(--text-muted)", boxShadow: isMaster ? "0 1px 3px rgba(0,0,0,0.1)" : "none", transition: "all 0.2s" }}
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
                    <label className="label-sm">Custom Key String</label>
                    <input 
                      type="text" 
                      className="glass-input"
                      placeholder="e.g. RR-ADMIN-VIP" 
                      value={customKey}
                      onChange={e => setCustomKey(e.target.value)}
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label className="label-sm">Max Uses (Usability)</label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", color: "var(--text)", cursor: "pointer" }}>
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
                  style={{ cursor: "pointer", appearance: "none" }}
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
            
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button size="md" icon={<Plus size={16} />} onClick={handleGenerate} disabled={generating || (isMaster && !customKey.trim())} variant="primary">
                {generating ? "Generating..." : isMaster ? "Create Master Key" : "Generate Standard Keys"}
              </Button>
            </div>
          </div>
        </section>

        {/* Search Bar */}
        <section className="panel" style={{ flex: "1 1 300px", height: "100%" }}>
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="kicker kicker-row">
                <Search size={12} /> Directory
              </p>
              <h2 className="section-title">Search & Filter</h2>
              <p className="section-sub">Find licenses by user or key</p>
            </div>
          </div>
          <div className="panel-body">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by user, HWID, IP, or key..."
            />
          </div>
        </section>
      </div>

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
    </div>
  );
}
