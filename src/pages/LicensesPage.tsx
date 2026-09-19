import { isDiscordSnowflake } from "../../shared/discord-id";
import { TableFrame, RecordCell, RecordLink } from "../components/ds/TableFrame";
import "../theme/license-workspace.css";
import { Select } from "../components/ds/Select";
import { usePanelPermission } from "../hooks/usePanelPermission";
import {
  Eye,
  EyeOff,
  Check,
  Copy,
  X,
  Key,
  Link2,
  MessageSquareText,
  Pencil,
  PlayCircle,
  Plus,
  SearchCheck,
  Ticket,
  Trash2,
  ShoppingCart,
  User,
} from "lucide-react";
import { useEffect, useState, useMemo, useRef, type FormEvent } from "react";
import { Badge } from "../components/ds/Badge";
import { Button, IconButton } from "../components/ds/Button";
import { EmptyState } from "../components/ds/EmptyState";
import { Field, FormError } from "../components/ds/Field";
import { Input, Textarea } from "../components/ds/Input";
import { Modal, ModalActions } from "../components/ds/Modal";
import { SegmentedControl } from "../components/ds/SegmentedControl";
import { SkeletonRows, type SkeletonColumn } from "../components/ds/Skeleton";
import { Tabs, type TabItem } from "../components/ds/Tabs";
import { PageHeader } from "../components/ds/PageHeader";
import { PageToolbar } from "../components/ds/PageToolbar";
import { SearchInput } from "../components/ds/SearchInput";
import { RelativeTime } from "../components/ds/RelativeTime";
import { CustomerReturnLink } from "../components/CustomerReturnLink";
import { DiscordTicketList } from "../components/DiscordTickets";
import { useWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { formatDate } from "../utils/format";
import {
  activateAdminLicense,
  apiUrl,
  bindAdminLicense,
  fetchApi,
  fetchDiscordTickets,
  fetchLicenseDiscordLinks,
  issueAdminLicense,
  linkLicenseDiscord,
  searchAdminLicenses,
  unlinkLicenseDiscord,
  type LicenseDiscordLink,
} from "../utils/api";
import { useRefreshSignal } from "../utils/refreshBus";
import type { SummaryPayload } from "../types/telemetry";
import type { DiscordTicketRecord, LicenseOperationResponse } from "../types/customer360";

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
  order_source?: string | null; // 'store' | 'admin'
  order_note?: string | null;
  order_meta?: string | null; // sanitized storefront payload snapshot
  purchased_at?: string | null;
  verified_discord?: string | null; // Discord tag verified against this key
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

function orderFormFor(lic: LicenseRecord): OrderEditForm {
  return {
    order_id: lic.order_id ?? "",
    customer_name: lic.customer_name ?? "",
    customer_email: lic.customer_email ?? "",
    customer_discord: lic.customer_discord ?? "",
    order_note: lic.order_note ?? "",
  };
}

/** Shallow field-by-field comparison — "has the operator changed anything since the dialog opened?" */
function formsEqual<T extends object>(a: T, b: T): boolean {
  return (Object.keys(a) as Array<keyof T>).every((key) => a[key] === b[key]);
}

type LookupMode = "order_id" | "customer";
type LicenseActionMode = "activate" | "bind";
type WorkspaceTab = "inventory" | "lookup" | "generate";

interface IssueForm {
  order_id: string;
  customer_name: string;
  customer_email: string;
  customer_discord: string;
  order_note: string;
  type: "lifetime" | "trial";
  duration_days: number;
  max_uses: number;
  custom_key: string;
}

const EMPTY_ISSUE_FORM: IssueForm = {
  order_id: "",
  customer_name: "",
  customer_email: "",
  customer_discord: "",
  order_note: "",
  type: "lifetime",
  duration_days: 30,
  max_uses: 1,
  custom_key: "",
};

function makeOperationKey(): string {
  return `admin-${crypto.randomUUID()}`;
}

function maskLicenseKey(value: string): string {
  if (value.length <= 8) return `••••${value.slice(-2)}`;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/** Standard batch vs. one multi-seat master key — the generator's only mode switch. */
const GENERATOR_KINDS: TabItem<"standard" | "master">[] = [
  { key: "standard", label: "Standard" },
  { key: "master", label: "Master key" },
];

interface CopyKeyButtonProps {
  value: string;
  copied: boolean;
  onCopy: (value: string) => void;
  /** Icon px — 12 in dense rows, 14 in dialogs. */
  size?: number;
}

/**
 * A license key is worthless if it cannot leave the screen. Every place that
 * shows one (creation notice, inventory row, lookup card, issue result) gets
 * the same control, and it confirms with a checkmark the way Customer 360's
 * "Copy JSON" does.
 */
function CopyKeyButton({ value, copied, onCopy, size = 12 }: CopyKeyButtonProps) {
  return (
    <IconButton
      icon={copied ? <Check /> : <Copy />}
      size={size}
      title={copied ? "Copied" : "Copy license key"}
      aria-label={copied ? `License key ${value} copied` : `Copy license key ${value}`}
      onClick={() => onCopy(value)}
    />
  );
}

function licenseDuration(license: LicenseRecord): string {
  if (license.type === "lifetime") return "Lifetime";
  const days = license.duration_days || 0;
  if (days && days < 1 / 24) return `${Math.round(days * 1440)} Mins`;
  if (days && days < 1) return `${Math.round(days * 24)} Hours`;
  if (days && days % 365 === 0) return `${days / 365} Years`;
  if (days && days % 30 === 0) return `${days / 30} Months`;
  if (days && days % 7 === 0) return `${days / 7} Weeks`;
  return `${Math.round(days)} Days`;
}

function LicenseOrderFacts({ license }: { license: LicenseRecord }) {
  return (
    <div className="license-order-context">
      <p className="license-context-note">Recorded order information, not payment confirmation.</p>
      <dl className="license-context-facts">
        <div>
          <dt>Order ID</dt>
          <dd className="mono">{license.order_id || "Not recorded"}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{license.order_source || "Not recorded"}</dd>
        </div>
        <div>
          <dt>Purchased</dt>
          <dd>{license.purchased_at ? formatDate(license.purchased_at) : "Not recorded"}</dd>
        </div>
        <div>
          <dt>Buyer Discord</dt>
          <dd>
            {license.customer_discord ? discordHandle(license.customer_discord) : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt>Verified Discord</dt>
          <dd>
            {license.verified_discord ? discordHandle(license.verified_discord) : "Not reported"}
          </dd>
        </div>
        {license.order_note ? (
          <div className="license-context-wide">
            <dt>Order note</dt>
            <dd>{license.order_note}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function LicenseOrderDetails({ license }: { license: LicenseRecord }) {
  return (
    <details className="license-order-details">
      <summary>Order details</summary>
      <LicenseOrderFacts license={license} />
    </details>
  );
}

function LicenseDeviceFacts({ license }: { license: LicenseRecord }) {
  return (
    <dl className="license-context-facts">
      <div>
        <dt>Duration</dt>
        <dd>{licenseDuration(license)}</dd>
      </div>
      <div>
        <dt>Seats used</dt>
        <dd>
          {license.usage_count} / {license.max_uses === -1 ? "Unlimited" : license.max_uses}
        </dd>
      </div>
      <div>
        <dt>Hardware ID</dt>
        <dd className="mono">{license.hwid || "Unbound"}</dd>
      </div>
      <div>
        <dt>Session ID</dt>
        <dd className="mono">{license.session_id || "Not reported"}</dd>
      </div>
      <div>
        <dt>App version</dt>
        <dd>{license.app_version || "Not reported"}</dd>
      </div>
      <div>
        <dt>Country</dt>
        <dd>{license.client_country || "Not reported"}</dd>
      </div>
      <div>
        <dt>IP address</dt>
        <dd className="mono">{license.client_ip || "Not reported"}</dd>
      </div>
      <div>
        <dt>Last session activity</dt>
        <dd>
          {license.session_last_seen ? formatDate(license.session_last_seen) : "Not reported"}
        </dd>
      </div>
      <div>
        <dt>Created</dt>
        <dd>{formatDate(license.created_at)}</dd>
      </div>
      <div>
        <dt>Activated</dt>
        <dd>{license.activated_at ? formatDate(license.activated_at) : "Not activated"}</dd>
      </div>
      <div>
        <dt>Expires</dt>
        <dd>
          {license.expires_at
            ? formatDate(license.expires_at)
            : license.type === "lifetime"
              ? "No expiry"
              : "Not started"}
        </dd>
      </div>
    </dl>
  );
}

interface LicenseSessionLinkProps {
  license: LicenseRecord;
  isLive: boolean;
  onOpenSession?: (sessionId: string) => void;
  onOpenWorker?: (hwid: string) => void;
}

function LicenseSessionLink({
  license,
  isLive,
  onOpenSession,
  onOpenWorker,
}: LicenseSessionLinkProps) {
  if (!license.hwid) return <span className="license-binding-state">Unbound</span>;
  const canOpen =
    (isLive && Boolean(onOpenSession) && Boolean(license.session_id)) || Boolean(onOpenWorker);
  return (
    <div className="license-session-context">
      {canOpen ? (
        <RecordLink
          onClick={() => {
            if (isLive && onOpenSession && license.session_id) onOpenSession(license.session_id);
            else if (onOpenWorker && license.hwid) onOpenWorker(license.hwid);
          }}
          title={isLive ? "View live session" : "View customer sessions"}
        >
          {license.user_label || "Customer sessions"}
        </RecordLink>
      ) : (
        <span>{license.user_label || "Bound device"}</span>
      )}
      <span className="license-session-state">{isLive ? "Live session" : "Session history"}</span>
    </div>
  );
}

interface LicenseInventoryRowProps extends LicenseSessionLinkProps {
  copiedValue: string | null;
  highlighted?: boolean;
  onCopy: (value: string) => void;
  onActivate: (license: LicenseRecord) => void;
  onBind: (license: LicenseRecord) => void;
  onEdit: (license: LicenseRecord) => void;
  onDelete: (license: LicenseRecord) => void;
}

/** Presentation only: all mutations, permission checks and navigation stay with their existing owners. */
export function LicenseInventoryRow({
  license,
  isLive,
  copiedValue,
  highlighted = false,
  onCopy,
  onOpenSession,
  onOpenWorker,
  onActivate,
  onBind,
  onEdit,
  onDelete,
}: LicenseInventoryRowProps) {
  const customer =
    license.customer_name ||
    license.customer_email ||
    (license.customer_discord || license.verified_discord
      ? discordHandle((license.customer_discord || license.verified_discord)!)
      : license.user_label || "Unassigned");
  const sessionProps = { license, isLive, onOpenSession, onOpenWorker };
  return (
    <tr className={highlighted ? "license-inventory-row row-created" : "license-inventory-row"}>
      <td className="license-customer-cell" data-label="Customer">
        <div className="license-customer-identity">
          <span className="license-customer-icon" aria-hidden="true">
            <User size={15} />
          </span>
          <RecordCell
            primary={customer}
            secondary={
              <>
                {license.customer_name && license.customer_email ? (
                  <span>{license.customer_email}</span>
                ) : null}
                {license.customer_discord ? (
                  <span>{discordHandle(license.customer_discord)}</span>
                ) : null}
                {!license.customer_name &&
                !license.customer_email &&
                !license.customer_discord &&
                !license.verified_discord ? (
                  <span>No buyer attribution</span>
                ) : null}
              </>
            }
          />
        </div>
      </td>
      <td className="license-inventory-key" data-label="License key">
        <RecordCell
          primary={
            <span className="license-key-cell">
              <span className="mono">{license.license_key}</span>
              <CopyKeyButton
                value={license.license_key}
                copied={copiedValue === license.license_key}
                onCopy={onCopy}
              />
            </span>
          }
          secondary={
            <>
              {isMasterLicense(license) ? "Master license" : "License"}
              {highlighted ? <span className="created-label"> · New</span> : null}
            </>
          }
        />
      </td>
      <td className="license-row-secondary license-order-cell" data-label="Order">
        <RecordCell
          primary={license.order_id || "No order recorded"}
          secondary={license.order_source || undefined}
        />
        <LicenseOrderDetails license={license} />
      </td>
      <td className="license-row-secondary license-duration-cell col-md" data-label="Duration">
        {licenseDuration(license)}
      </td>
      <td className="license-row-secondary license-usage-cell col-md" data-label="Usage">
        {license.usage_count} / {license.max_uses === -1 ? "Unlimited" : license.max_uses}
      </td>
      <td className="license-status-cell" data-label="License status">
        <Badge
          tone={
            license.status === "active"
              ? "success"
              : license.status === "revoked"
                ? "danger"
                : "warning"
          }
        >
          {license.status ? license.status[0].toUpperCase() + license.status.slice(1) : "Unknown"}
        </Badge>
        <span className="license-binding-state">{license.hwid ? "Bound" : "Unbound"}</span>
      </td>
      <td className="license-row-secondary" data-label="Linked session">
        <LicenseSessionLink {...sessionProps} />
        <details className="license-technical-details">
          <summary>Device details</summary>
          <LicenseDeviceFacts license={license} />
        </details>
      </td>
      <td className="license-actions-cell">
        <div className="row-actions license-row-actions">
          <Button
            size="xs"
            permission="licenses.write"
            title="Activate for a registered install"
            icon={<PlayCircle />}
            aria-label={`Activate ${license.license_key} for an install`}
            onClick={() => onActivate(license)}
            disabled={license.status === "revoked"}
          >
            <span className="license-action-label">Activate</span>
          </Button>
          <Button
            size="xs"
            permission="licenses.write"
            title="Bind another device"
            icon={<Link2 />}
            aria-label={`Bind ${license.license_key} to a device`}
            onClick={() => onBind(license)}
            disabled={license.status === "revoked"}
          >
            <span className="license-action-label">Bind device</span>
          </Button>
          <Button
            size="xs"
            permission="licenses.write"
            title="Edit customer / order info"
            icon={<Pencil />}
            aria-label={`Edit customer / order info for ${license.license_key}`}
            onClick={() => onEdit(license)}
          >
            <span className="license-action-label">Edit order</span>
          </Button>
          <Button
            size="xs"
            variant="danger"
            permission="licenses.write"
            title="Permanently delete license"
            icon={<Trash2 />}
            aria-label={`Permanently delete ${license.license_key}`}
            onClick={() => onDelete(license)}
          >
            <span className="license-action-label">Delete</span>
          </Button>
        </div>
        <details className="license-mobile-context">
          <summary>Order &amp; device details</summary>
          <LicenseOrderFacts license={license} />
          <LicenseDeviceFacts license={license} />
          <LicenseSessionLink {...sessionProps} />
        </details>
      </td>
    </tr>
  );
}

/**
 * Width floor of the inventory table: the measured max-content width of its
 * narrowest layout (Duration and Usage bowed out, long values capped, actions
 * two by two — see the tier note above the table head). A 1440px window leaves
 * 1110px next to the rail, so that layout fits without the frame scrolling.
 */
export const LICENSE_TABLE_FLOOR = 1093;

/**
 * The inventory head as the skeleton sees it: one entry per column, in the same
 * order and carrying the same priority tier, so a placeholder cell bows out
 * exactly when its column does.
 */
const INVENTORY_SKELETON_COLUMNS: SkeletonColumn[] = [
  {}, // Customer
  {}, // License key
  {}, // Order
  { className: "col-md" }, // Duration
  { className: "col-md" }, // Usage
  {}, // License status
  {}, // Linked session
  {}, // License actions
];

interface LicensesPageProps {
  summary?: SummaryPayload | null;
  onOpenSession?: (sessionId: string) => void;
  onOpenWorker?: (hwid: string) => void;
}

export function LicensesPage({ summary, onOpenSession, onOpenWorker }: LicensesPageProps) {
  const canWrite = usePanelPermission("licenses.write");
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [createdKeys, setCreatedKeys] = useState<string[]>([]);
  const [createdOnly, setCreatedOnly] = useState(false);
  const [highlightCreated, setHighlightCreated] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("inventory");
  const workspaceTabs = useMemo<TabItem<WorkspaceTab>[]>(
    () => [
      { key: "inventory", label: "All licenses", panelId: "licenses-panel-inventory" },
      { key: "lookup", label: "Find a purchase", panelId: "licenses-panel-lookup" },
      // "Bulk generate": the batch/master path, not the audited single sale.
      ...(canWrite
        ? ([
            { key: "generate", label: "Bulk generate", panelId: "licenses-panel-generate" },
          ] satisfies TabItem<WorkspaceTab>[])
        : []),
    ],
    [canWrite],
  );
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!createdKeys.length || workspaceTab !== "inventory") return;
    setHighlightCreated(true);
    const timer = window.setTimeout(() => setHighlightCreated(false), 45000);
    return () => window.clearTimeout(timer);
  }, [createdKeys, workspaceTab]);
  const [generating, setGenerating] = useState(false);
  const [searchQuery, setSearchQuery] = useWorkspaceSearch("licenses");
  useEffect(() => {
    if (searchQuery.trim()) setWorkspaceTab("inventory");
  }, [searchQuery]);
  // Which key was copied last — one flag, because only one confirmation shows at a time.
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);
  useEffect(() => () => window.clearTimeout(copyTimer.current ?? undefined), []);
  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      window.clearTimeout(copyTimer.current ?? undefined);
      copyTimer.current = window.setTimeout(() => setCopiedValue(null), 1800);
    } catch {
      setCopiedValue(null);
    }
  };

  const [genType, setGenType] = useState("lifetime");
  const [genDuration, setGenDuration] = useState(30);
  const [genCount, setGenCount] = useState(1);
  const [isMaster, setIsMaster] = useState(false);
  const [customKey, setCustomKey] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [isInfiniteUses, setIsInfiniteUses] = useState(false);
  // Inline, in the form — the generator used to report failures with window.alert().
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [deleteCandidate, setDeleteCandidate] = useState<LicenseRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Customer/order attribution editor (per-license pencil action)
  const [editCandidate, setEditCandidate] = useState<LicenseRecord | null>(null);
  const [editForm, setEditForm] = useState<OrderEditForm>(EMPTY_ORDER_FORM);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Verified Discord accounts of the license being edited. They are written straight away (link /
  // unlink are their own calls), unlike the order fields the dialog's Save commits.
  const [discordLinks, setDiscordLinks] = useState<LicenseDiscordLink[] | null>(null);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [newDiscordId, setNewDiscordId] = useState("");
  const [newDiscordTag, setNewDiscordTag] = useState("");
  const [replaceDiscord, setReplaceDiscord] = useState(false);

  // Archived Discord support tickets of the same key, loaded by the same effect below.
  const [tickets, setTickets] = useState<DiscordTicketRecord[] | null>(null);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [ticketError, setTicketError] = useState<string | null>(null);

  // Optional buyer attribution stamped onto keys at generation time
  const [genOrderId, setGenOrderId] = useState("");
  const [genCustomerName, setGenCustomerName] = useState("");
  const [genCustomerEmail, setGenCustomerEmail] = useState("");
  const [genCustomerDiscord, setGenCustomerDiscord] = useState("");

  // Deliberate server lookup and fulfilment workflow. It is separate from the
  // table's instant local filter because order IDs must be exact and auditable.
  const [lookupMode, setLookupMode] = useState<LookupMode>("order_id");
  const [lookupValue, setLookupValue] = useState("");
  const [lookupResults, setLookupResults] = useState<LicenseRecord[] | null>(null);
  const [revealedLookupKeys, setRevealedLookupKeys] = useState<Set<string>>(new Set());
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueForm, setIssueForm] = useState<IssueForm>(EMPTY_ISSUE_FORM);
  // What the dialog opened with — anything beyond it is unsaved work the Modal must not discard.
  const issueBaseline = useRef<IssueForm>(EMPTY_ISSUE_FORM);
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issueResult, setIssueResult] = useState<LicenseOperationResponse | null>(null);
  const [issueOperationKey, setIssueOperationKey] = useState(makeOperationKey);

  const [licenseAction, setLicenseAction] = useState<{
    mode: LicenseActionMode;
    license: LicenseRecord;
  } | null>(null);
  const [actionInstallId, setActionInstallId] = useState("");
  const [actionHwid, setActionHwid] = useState("");
  const [actionReason, setActionReason] = useState("");
  const actionBaseline = useRef({ installId: "", hwid: "", reason: "" });
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<LicenseOperationResponse | null>(null);
  const [actionOperationKey, setActionOperationKey] = useState(makeOperationKey);

  const licenseRequest = useRef(0);
  const fetchLicenses = async (silent = false) => {
    const seq = ++licenseRequest.current;
    try {
      if (!silent) setLoading(true);
      const url = new URL(apiUrl("/api/admin/licenses"), window.location.origin);
      url.searchParams.set("_ts", String(Date.now()));
      const res = await fetchApi(url.toString(), { cache: "no-store", credentials: "include" });
      const data = await res.json();
      if (data.ok && seq === licenseRequest.current) {
        setLicenses(data.licenses);
      }
    } catch (e) {
      console.error(e);
    } finally {
      if (seq === licenseRequest.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLicenses();
  }, []);

  // Header refresh button: silent re-pull from the worker, no skeleton flash.
  useRefreshSignal(() => void fetchLicenses(true));

  const performLookup = async (value = lookupValue, mode = lookupMode) => {
    const query = value.trim();
    if (!query || lookupLoading) return;
    setLookupLoading(true);
    setLookupError(null);
    try {
      const result = await searchAdminLicenses(mode, query);
      if (!result.ok || !result.data?.licenses) {
        throw new Error(result.data?.error ?? `Lookup failed (HTTP ${result.status}).`);
      }
      setLookupResults(result.data.licenses as LicenseRecord[]);
      setRevealedLookupKeys(new Set());
    } catch (error) {
      setLookupResults(null);
      setLookupError(error instanceof Error ? error.message : "Could not search licenses.");
    } finally {
      setLookupLoading(false);
    }
  };

  const submitLookup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void performLookup();
  };

  /**
   * The one way into the audited issue flow. It is the page's primary action
   * (header, every tab) and the follow-up of an empty lookup; in the second
   * case the search the operator just ran pre-fills the form.
   */
  const openIssue = () => {
    const query = lookupValue.trim();
    const form: IssueForm = {
      ...EMPTY_ISSUE_FORM,
      order_id: lookupMode === "order_id" ? query : "",
      customer_name: lookupMode === "customer" ? query : "",
    };
    issueBaseline.current = form;
    setIssueForm(form);
    setIssueOperationKey(makeOperationKey());
    setIssueError(null);
    setIssueResult(null);
    setIssueOpen(true);
  };

  const submitIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (issueBusy) return;
    if (!issueForm.order_id.trim()) {
      setIssueError("Order ID is required so this issue can be found and audited later.");
      return;
    }
    if (
      issueForm.type === "trial" &&
      (!Number.isInteger(issueForm.duration_days) ||
        issueForm.duration_days < 1 ||
        issueForm.duration_days > 3650)
    ) {
      setIssueError("Trial duration must be a whole number from 1 to 3650 days.");
      return;
    }
    if (
      !Number.isInteger(issueForm.max_uses) ||
      issueForm.max_uses < 1 ||
      issueForm.max_uses > 1000
    ) {
      setIssueError("Seats / maximum uses must be a whole number from 1 to 1000.");
      return;
    }
    setIssueBusy(true);
    setIssueError(null);
    try {
      const result = await issueAdminLicense({
        order_id: issueForm.order_id.trim(),
        customer_name: issueForm.customer_name.trim() || undefined,
        customer_email: issueForm.customer_email.trim() || undefined,
        customer_discord: issueForm.customer_discord.trim() || undefined,
        order_note: issueForm.order_note.trim() || undefined,
        type: issueForm.type,
        duration_days: issueForm.type === "trial" ? issueForm.duration_days : undefined,
        max_uses: issueForm.max_uses,
        custom_key: issueForm.custom_key.trim() || undefined,
        custom_options: { issued_from: "admin_customer_workflow" },
        idempotency_key: issueOperationKey,
      });
      if (!result.ok || !result.data?.license) {
        throw new Error(result.data?.error ?? `Could not issue license (HTTP ${result.status}).`);
      }
      setIssueResult(result.data);
      setCreatedKeys([result.data.license.license_key]);
      await fetchLicenses(true);
      if (lookupMode === "order_id" && lookupValue.trim() === issueForm.order_id.trim()) {
        await performLookup(issueForm.order_id, "order_id");
      }
    } catch (error) {
      setIssueError(error instanceof Error ? error.message : "Could not issue license.");
    } finally {
      setIssueBusy(false);
    }
  };

  const openLicenseAction = (license: LicenseRecord, mode: LicenseActionMode) => {
    const linkedSession = [
      ...(summary?.activeSessions ?? []),
      ...(summary?.recentSessions ?? []),
    ].find(
      (session) =>
        session.id === license.session_id || (license.hwid && session.hwid === license.hwid),
    );
    setLicenseAction({ license, mode });
    actionBaseline.current = {
      installId: linkedSession?.installId ?? "",
      hwid: license.hwid ?? linkedSession?.hwid ?? "",
      reason: "",
    };
    setActionInstallId(actionBaseline.current.installId);
    setActionHwid(actionBaseline.current.hwid);
    setActionReason("");
    setActionError(null);
    setActionResult(null);
    setActionOperationKey(makeOperationKey());
  };

  const submitLicenseAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!licenseAction || actionBusy) return;
    if (licenseAction.mode === "activate" && !actionInstallId.trim()) {
      setActionError("Install ID is required to activate this license.");
      return;
    }
    if (licenseAction.mode === "bind" && !actionHwid.trim()) {
      setActionError("Hardware ID is required to bind this license.");
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const result =
        licenseAction.mode === "activate"
          ? await activateAdminLicense(licenseAction.license.license_key, {
              install_id: actionInstallId.trim(),
              reason: actionReason.trim() || undefined,
              idempotency_key: actionOperationKey,
            })
          : await bindAdminLicense(licenseAction.license.license_key, {
              hwid: actionHwid.trim(),
              install_id: actionInstallId.trim() || undefined,
              reason: actionReason.trim() || undefined,
              idempotency_key: actionOperationKey,
            });
      if (!result.ok || !result.data?.license) {
        throw new Error(
          result.data?.error ?? `Could not ${licenseAction.mode} license (HTTP ${result.status}).`,
        );
      }
      setActionResult(result.data);
      await fetchLicenses(true);
      if (lookupResults) await performLookup();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : `Could not ${licenseAction.mode} license.`,
      );
    } finally {
      setActionBusy(false);
    }
  };

  const updateIssueForm = (patch: Partial<IssueForm>) => {
    setIssueForm((current) => ({ ...current, ...patch }));
    setIssueOperationKey(makeOperationKey());
    setIssueError(null);
    setIssueResult(null);
  };

  const touchLicenseAction = () => {
    setActionOperationKey(makeOperationKey());
    setActionError(null);
    setActionResult(null);
  };

  const submitGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (generating) return;
    if (!isMaster && (!Number.isInteger(genCount) || genCount < 1 || genCount > 50)) {
      setGenerateError("Quantity must be a whole number from 1 to 50.");
      return;
    }
    if (
      isMaster &&
      !isInfiniteUses &&
      (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 1000)
    ) {
      setGenerateError("Seats must be a whole number from 1 to 1000.");
      return;
    }
    if (genType !== "lifetime" && (!Number.isFinite(genDuration) || genDuration < 1)) {
      setGenerateError("Duration value must be at least 1.");
      return;
    }
    setGenerating(true);
    setGenerateError(null);
    try {
      const url = new URL(apiUrl("/api/admin/licenses"), window.location.origin);
      let calculatedDays: number | null = null;
      if (genType === "days") calculatedDays = genDuration;
      else if (genType === "weeks") calculatedDays = genDuration * 7;
      else if (genType === "months") calculatedDays = genDuration * 30;
      else if (genType === "years") calculatedDays = genDuration * 365;
      else if (genType === "hours") calculatedDays = genDuration / 24;
      else if (genType === "minutes") calculatedDays = genDuration / 1440;

      const payload = {
        type: genType === "lifetime" ? "lifetime" : "trial",
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
      const res = await fetchApi(
        url.toString(),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        },
        { retry: false },
      );
      const data = await res.json();
      if (data.ok) {
        setCreatedKeys(Array.isArray(data.generated_keys) ? data.generated_keys : []);
        setCreatedOnly(false);
        setSearchQuery("");
        setWorkspaceTab("inventory");
        await fetchLicenses();
        setCustomKey("");
        // Clear the one-shot buyer attribution so the next batch never
        // accidentally inherits the previous customer.
        setGenOrderId("");
        setGenCustomerName("");
        setGenCustomerEmail("");
        setGenCustomerDiscord("");
      } else {
        setGenerateError(data.error || "The licenses could not be generated.");
      }
    } catch (e) {
      console.error(e);
      setGenerateError(e instanceof Error ? e.message : "The licenses could not be generated.");
    } finally {
      setGenerating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteCandidate) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      // Always hard-delete: removes the row and instantly cuts access on every bound machine
      // (the app's next license poll gets "Invalid license key"). Master keys carry a custom
      // key string, so the path segment MUST be encoded — a raw space / "+" / "/" in the key
      // breaks the request, which is exactly why master keys were erroring before.
      const encodedKey = encodeURIComponent(deleteCandidate.license_key);
      const url = new URL(apiUrl(`/api/admin/licenses/${encodedKey}`), window.location.origin);

      const res = await fetchApi(
        url.toString(),
        {
          method: "DELETE",
          credentials: "include",
        },
        { retry: false },
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`Failed to delete license: ${errData.error || res.statusText}`);
      }

      await fetchLicenses();
      setDeleteCandidate(null);
    } catch (err) {
      console.error(err);
      // The dialog stays open with the reason — a failed delete used to close
      // the dialog and report itself in a native alert().
      setDeleteError(err instanceof Error ? err.message : "The license could not be deleted.");
    } finally {
      setIsDeleting(false);
    }
  };

  const openEdit = (lic: LicenseRecord) => {
    setEditForm(orderFormFor(lic));
    setEditError(null);
    setEditCandidate(lic);
  };

  // The dialog's Discord sections load themselves; every link write answers with the new list, so
  // this runs once per opened license.
  useEffect(() => {
    if (!editCandidate) return;
    let cancelled = false;
    setDiscordLinks(null);
    setDiscordError(null);
    setNewDiscordId("");
    setNewDiscordTag("");
    setReplaceDiscord(false);
    setTickets(null);
    setTicketTotal(0);
    setTicketError(null);
    void (async () => {
      try {
        const result = await fetchLicenseDiscordLinks(editCandidate.license_key);
        if (cancelled) return;
        if (!result.ok) {
          throw new Error(
            result.data?.error ?? `Could not load Discord accounts (HTTP ${result.status}).`,
          );
        }
        setDiscordLinks(result.data?.links ?? []);
      } catch (err) {
        if (cancelled) return;
        setDiscordLinks([]);
        setDiscordError(
          err instanceof Error ? err.message : "Could not load the Discord accounts.",
        );
      }
    })();
    void (async () => {
      try {
        const result = await fetchDiscordTickets({ license_key: editCandidate.license_key });
        if (cancelled) return;
        if (!result.ok) {
          throw new Error(
            result.data?.error ?? `Could not load Discord tickets (HTTP ${result.status}).`,
          );
        }
        setTickets(result.data?.tickets ?? []);
        setTicketTotal(result.data?.total ?? 0);
      } catch (err) {
        if (cancelled) return;
        setTickets([]);
        setTicketError(err instanceof Error ? err.message : "Could not load the Discord tickets.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editCandidate]);

  /** Both Discord writes answer with the license's links, so they share one result handler. */
  const applyDiscordResult = async (
    run: () => Promise<{
      ok: boolean;
      data?: { error?: string; links?: LicenseDiscordLink[] };
      status: number;
    }>,
    fallbackMessage: string,
  ) => {
    if (discordBusy) return;
    setDiscordBusy(true);
    setDiscordError(null);
    try {
      const result = await run();
      if (!result.ok)
        throw new Error(result.data?.error ?? `${fallbackMessage} (HTTP ${result.status}).`);
      setDiscordLinks(result.data?.links ?? []);
      // The inventory shows the verified handle in its own column — pull it fresh.
      await fetchLicenses(true);
    } catch (err) {
      setDiscordError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      setDiscordBusy(false);
    }
  };

  const submitDiscordLink = async () => {
    if (!editCandidate) return;
    const discordId = newDiscordId.trim();
    if (!isDiscordSnowflake(discordId)) {
      setDiscordError("Enter the Discord user id (17-20 digits), not the @name.");
      return;
    }
    await applyDiscordResult(
      () =>
        linkLicenseDiscord(editCandidate.license_key, {
          discord_id: discordId,
          discord_tag: newDiscordTag.trim() || undefined,
          replace: replaceDiscord || undefined,
        }),
      "Could not link that Discord account",
    );
    setNewDiscordId("");
    setNewDiscordTag("");
    setReplaceDiscord(false);
  };

  const unlinkDiscord = (discordId: string) => {
    if (!editCandidate) return;
    void applyDiscordResult(
      () => unlinkLicenseDiscord(editCandidate.license_key, discordId),
      "Could not unlink that Discord account",
    );
  };

  const saveEdit = async () => {
    if (!editCandidate || isSavingEdit) return;
    setIsSavingEdit(true);
    setEditError(null);
    try {
      const encodedKey = encodeURIComponent(editCandidate.license_key);
      const url = new URL(apiUrl(`/api/admin/licenses/${encodedKey}`), window.location.origin);
      // All five fields are sent every save: present-but-empty clears a value.
      const res = await fetchApi(
        url.toString(),
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(editForm),
          credentials: "include",
        },
        { retry: false },
      );
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
    return [
      ...licenses.filter((lic) => {
        if (createdOnly && !createdKeys.includes(lic.license_key)) return false;
        const lowerQuery = searchQuery.toLowerCase();
        return (
          !searchQuery.trim() ||
          lic.license_key.toLowerCase().includes(lowerQuery) ||
          lic.hwid?.toLowerCase().includes(lowerQuery) ||
          lic.user_label?.toLowerCase().includes(lowerQuery) ||
          lic.client_ip?.toLowerCase().includes(lowerQuery) ||
          lic.order_id?.toLowerCase().includes(lowerQuery) ||
          lic.customer_name?.toLowerCase().includes(lowerQuery) ||
          lic.customer_email?.toLowerCase().includes(lowerQuery) ||
          lic.customer_discord?.toLowerCase().includes(lowerQuery) ||
          lic.verified_discord?.toLowerCase().includes(lowerQuery)
        );
      }),
    ].sort((a, b) => {
      if (highlightCreated) {
        const recentlyCreated =
          Number(createdKeys.includes(b.license_key)) - Number(createdKeys.includes(a.license_key));
        if (recentlyCreated) return recentlyCreated;
      }
      const aIsMaster = isMasterLicense(a);
      const bIsMaster = isMasterLicense(b);
      if (aIsMaster && !bIsMaster) return -1;
      if (!aIsMaster && bIsMaster) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [licenses, searchQuery, createdOnly, createdKeys, highlightCreated]);

  /** The two things that can filter the inventory down to nothing. */
  const hasLicenseFilters = searchQuery.trim().length > 0 || createdOnly;
  const clearLicenseFilters = () => {
    setSearchQuery("");
    setCreatedOnly(false);
  };

  /* The one filter place on this page (handoff §2.3), directly above the
     inventory it filters. The section switch above it is ds/Tabs (Inventory /
     Order lookup / Bulk generate are page sections, not filters). The scope
     only exists while freshly created keys do — it is the same "created only"
     filter the creation notice toggles, nothing new. Reset replaces the
     "Clear filters" that used to appear only inside the empty state. */
  const inventoryToolbar = (
    <PageToolbar
      aria-label="License filters"
      canReset={hasLicenseFilters}
      onReset={clearLicenseFilters}
      left={
        createdKeys.length > 0 ? (
          <SegmentedControl
            aria-label="License scope"
            items={[
              { key: "all", label: "All licenses" },
              { key: "created", label: "Just created", count: createdKeys.length },
            ]}
            value={createdOnly ? "created" : "all"}
            onChange={(key) => setCreatedOnly(key === "created")}
          />
        ) : undefined
      }
      search={
        <SearchInput
          aria-label="Search licenses"
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search licenses, customers, orders…"
        />
      }
    />
  );

  const renderTable = (lics: LicenseRecord[], title: string) => (
    <section
      className="panel license-inventory-panel"
      role="tabpanel"
      id="licenses-panel-inventory"
      aria-labelledby="licenses-panel-inventory-tab"
    >
      <div className="panel-head">
        <div className="panel-head-left">
          <h2 className="section-title">{title}</h2>
          <p className="section-sub">
            Customers, license state and recorded orders. Device activity is shown separately.
          </p>
        </div>
        <div className="panel-head-right">
          <span className="license-inventory-count" role="status">
            {loading && !licenses.length
              ? "Loading inventory..."
              : `${lics.length} shown / ${licenses.length} loaded`}
          </span>
        </div>
      </div>
      {!loading && lics.length === 0 ? (
        <EmptyState icon={<Key />} title="No licenses found">
          {hasLicenseFilters
            ? "No licenses match your current search filter."
            : "No license keys generated yet."}
        </EmptyState>
      ) : (
        /*
          Column priority: Duration and Usage carry .col-md and bow out when the
          frame can no longer afford them (app-glue.css, measured); both read back
          in every row's Device details (Duration, Seats used). Nothing else is
          tiered — Linked session holds the only in-table button that opens a bound
          session, and the rest has no second home on the row. Below that, long
          values wrap sooner and the four actions sit two by two
          (license-workspace.css); LICENSE_TABLE_FLOOR is that layout's own width.
        */
        <TableFrame
          className="license-table"
          minWidth={LICENSE_TABLE_FLOOR}
          stickyActions
          mobileLayout="stack"
          aria-busy={loading || undefined}
        >
          <caption className="table-caption">
            All licenses with their customer, order and binding state
          </caption>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">License key</th>
              <th scope="col">Order</th>
              <th scope="col" className="col-md">
                Duration
              </th>
              <th scope="col" className="col-md">
                Usage
              </th>
              <th scope="col">License status</th>
              <th scope="col">Linked session</th>
              <th scope="col" aria-label="License actions" />
            </tr>
          </thead>
          <tbody>
            {loading && lics.length === 0 && <SkeletonRows columns={INVENTORY_SKELETON_COLUMNS} />}
            {lics.map((lic) => (
              <LicenseInventoryRow
                key={lic.id}
                license={lic}
                isLive={Boolean(
                  lic.session_id &&
                  summary?.activeSessions.some((session) => session.id === lic.session_id),
                )}
                copiedValue={copiedValue}
                highlighted={highlightCreated && createdKeys.includes(lic.license_key)}
                onCopy={(value) => void copyValue(value)}
                onOpenSession={onOpenSession}
                onOpenWorker={onOpenWorker}
                onActivate={(license) => openLicenseAction(license, "activate")}
                onBind={(license) => openLicenseAction(license, "bind")}
                onEdit={openEdit}
                onDelete={(license) => {
                  setDeleteError(null);
                  setDeleteCandidate(license);
                }}
              />
            ))}
          </tbody>
        </TableFrame>
      )}
    </section>
  );

  return (
    <div className="page-content page-stack-lg license-workspace">
      <CustomerReturnLink />
      <PageHeader
        page="licenses"
        right={
          <>
            {/* One primary way to sell a license, reachable from every tab. */}
            <Button
              variant="primary"
              size="sm"
              icon={<Plus />}
              permission="licenses.write"
              onClick={openIssue}
            >
              Issue license
            </Button>
          </>
        }
      />
      {createdKeys.length > 0 && (
        <div className="creation-notice" role="status">
          <span className="creation-notice-icon">
            <Check />
          </span>
          <div>
            <strong>
              {createdKeys.length === 1
                ? "License created"
                : `${createdKeys.length} licenses created`}
            </strong>
            <span>The new licenses are marked in your inventory.</span>
            <ul className="creation-notice-keys">
              {createdKeys.map((key) => (
                <li key={key}>
                  <code className="customer360-mono">{key}</code>
                  <CopyKeyButton
                    value={key}
                    copied={copiedValue === key}
                    onCopy={(value) => void copyValue(value)}
                  />
                </li>
              ))}
            </ul>
          </div>
          {createdKeys.length > 1 && (
            <Button
              size="sm"
              icon={copiedValue === createdKeys.join("\n") ? <Check /> : <Copy />}
              onClick={() => void copyValue(createdKeys.join("\n"))}
            >
              {copiedValue === createdKeys.join("\n") ? "Copied" : "Copy all"}
            </Button>
          )}
          <Button
            size="sm"
            variant="accent"
            onClick={() => {
              setWorkspaceTab("inventory");
              setSearchQuery("");
              setCreatedOnly(!createdOnly);
            }}
          >
            {createdOnly ? "Show all licenses" : "Show created licenses"}
          </Button>
          <IconButton
            icon={<X />}
            aria-label="Dismiss creation notice"
            onClick={() => {
              setCreatedKeys([]);
              setCreatedOnly(false);
              setHighlightCreated(false);
            }}
          />
        </div>
      )}
      <Tabs
        aria-label="License workspace"
        items={workspaceTabs}
        value={workspaceTab}
        onChange={setWorkspaceTab}
      />
      {workspaceTab === "inventory" && inventoryToolbar}
      {workspaceTab === "inventory" && renderTable(sortedLicenses, "All licenses")}
      {workspaceTab === "lookup" && (
        <section
          className="panel license-lookup-panel"
          role="tabpanel"
          id="licenses-panel-lookup"
          aria-labelledby="license-order-lookup-title"
        >
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="license-workspace-eyebrow">
                <SearchCheck size={12} /> Customer fulfilment
              </p>
              <h2 className="section-title" id="license-order-lookup-title">
                Find a purchase
              </h2>
              <p className="section-sub">
                Start with the order ID from the customer. Search by customer only when the order is
                unknown.
              </p>
            </div>
          </div>
          <div className="panel-body license-lookup-body">
            <form className="license-lookup-form" onSubmit={submitLookup}>
              <Field label="Search by">
                <Select
                  aria-label="Search by"
                  value={lookupMode}
                  onValueChange={(value) => {
                    setLookupMode(value as LookupMode);
                    setLookupResults(null);
                    setRevealedLookupKeys(new Set());
                    setLookupError(null);
                  }}
                >
                  <option value="order_id">Exact order ID</option>
                  <option value="customer">Customer name, email or Discord</option>
                </Select>
              </Field>
              <Field label={lookupMode === "order_id" ? "Order ID" : "Customer"} hint="required">
                <Input
                  value={lookupValue}
                  onChange={(event) => {
                    setLookupValue(event.target.value);
                    setLookupResults(null);
                    setRevealedLookupKeys(new Set());
                    setLookupError(null);
                  }}
                  placeholder={
                    lookupMode === "order_id" ? "e.g. ORD-1042" : "Name, email or Discord"
                  }
                  autoComplete="off"
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                icon={<SearchCheck />}
                disabled={!lookupValue.trim() || lookupLoading}
              >
                {lookupLoading ? "Searching…" : "Search purchases"}
              </Button>
            </form>

            <FormError message={lookupError} />

            {lookupResults !== null ? (
              <div className="license-lookup-results" aria-live="polite">
                <div className="license-lookup-results-head">
                  <div>
                    <strong>
                      {lookupResults.length === 0
                        ? "No license found"
                        : `${lookupResults.length} license${lookupResults.length === 1 ? "" : "s"} returned`}
                    </strong>
                    <span>
                      {lookupMode === "order_id"
                        ? `Exact order ${lookupValue.trim()}`
                        : `Customer match for “${lookupValue.trim()}” (up to 200 results)`}
                    </span>
                  </div>
                  {lookupResults.length === 0 ? (
                    <Button
                      size="sm"
                      icon={<Plus />}
                      permission="licenses.write"
                      onClick={openIssue}
                    >
                      Issue purchased license
                    </Button>
                  ) : null}
                </div>
                {lookupResults.length > 0 ? (
                  <div className="license-lookup-cards">
                    {lookupResults.map((license) => (
                      <article
                        className="license-lookup-card"
                        key={license.id || license.license_key}
                      >
                        <div className="license-lookup-card-main">
                          <strong className="license-lookup-customer">
                            {license.customer_name ||
                              license.customer_email ||
                              license.customer_discord ||
                              "Customer not named"}
                          </strong>
                          {license.customer_name && license.customer_email ? (
                            <span className="license-lookup-contact">{license.customer_email}</span>
                          ) : null}
                          <span className="license-lookup-key customer360-mono">
                            {revealedLookupKeys.has(license.license_key)
                              ? license.license_key
                              : maskLicenseKey(license.license_key)}
                            <IconButton
                              icon={
                                revealedLookupKeys.has(license.license_key) ? <EyeOff /> : <Eye />
                              }
                              size={12}
                              title={
                                revealedLookupKeys.has(license.license_key)
                                  ? "Hide license key"
                                  : "Reveal license key"
                              }
                              aria-label={
                                revealedLookupKeys.has(license.license_key)
                                  ? "Hide license key"
                                  : "Reveal license key"
                              }
                              onClick={() =>
                                setRevealedLookupKeys((current) => {
                                  const next = new Set(current);
                                  if (!next.delete(license.license_key))
                                    next.add(license.license_key);
                                  return next;
                                })
                              }
                            />
                            <CopyKeyButton
                              value={license.license_key}
                              copied={copiedValue === license.license_key}
                              onCopy={(value) => void copyValue(value)}
                            />
                          </span>
                          <div>
                            <Badge
                              tone={
                                license.status === "active"
                                  ? "success"
                                  : license.status === "revoked"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {license.status}
                            </Badge>
                            <span>
                              {license.type === "lifetime"
                                ? "Lifetime"
                                : `${license.duration_days ?? "?"} days`}
                            </span>
                            <span>
                              {license.hwid
                                ? `Bound · ${license.usage_count}/${license.max_uses === -1 ? "∞" : license.max_uses}`
                                : "Not bound yet"}
                            </span>
                          </div>
                          <LicenseOrderDetails license={license} />
                        </div>
                        <div className="license-lookup-card-actions">
                          <Button
                            size="sm"
                            icon={<PlayCircle />}
                            permission="licenses.write"
                            onClick={() => openLicenseAction(license, "activate")}
                            disabled={license.status === "revoked"}
                          >
                            Activate install
                          </Button>
                          <Button
                            size="sm"
                            icon={<Link2 />}
                            permission="licenses.write"
                            onClick={() => openLicenseAction(license, "bind")}
                            disabled={license.status === "revoked"}
                          >
                            Bind device
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="license-lookup-empty">
                    Confirm the order details, then issue the license. The new key will stay tied to
                    this order for future searches.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      )}

      {workspaceTab === "generate" && canWrite && (
        <section
          className="panel"
          role="tabpanel"
          id="licenses-panel-generate"
          aria-labelledby="licenses-panel-generate-tab"
        >
          <div className="panel-head">
            <div className="panel-head-left">
              <p className="license-workspace-eyebrow">
                <Plus size={12} /> Bulk generate
              </p>
              <h2 className="section-title">License generator</h2>
              <p className="section-sub">Create standard or custom master licenses</p>
            </div>
            <div className="panel-head-right">
              <SegmentedControl
                aria-label="Key kind"
                items={GENERATOR_KINDS}
                value={isMaster ? "master" : "standard"}
                onChange={(key) => setIsMaster(key === "master")}
              />
            </div>
          </div>

          <form className="panel-body license-generator-form" onSubmit={submitGenerate}>
            {/* The generator is the batch path; a single sale belongs in the
                audited issue flow, which is one click away in the header. */}
            <p className="license-generator-note">
              Bulk generation is a separate batch workflow. For a single purchase use{" "}
              <strong>Issue license</strong> in the page header — it requires an order ID and is
              replay-safe.
            </p>

            <div className="license-generator-grid">
              {isMaster ? (
                <>
                  <Field label="Custom key" hint="optional">
                    <Input
                      mono
                      placeholder="Blank = random key"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Seats (max uses)"
                    help="A master key can be activated on this many machines."
                  >
                    <Input
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      disabled={isInfiniteUses}
                      value={isInfiniteUses ? "" : maxUses}
                      placeholder={isInfiniteUses ? "Unlimited" : undefined}
                      onChange={(e) => setMaxUses(Number(e.target.value))}
                    />
                  </Field>
                  <label className="toggle-row license-generator-toggle">
                    <span>Unlimited seats</span>
                    <input
                      type="checkbox"
                      checked={isInfiniteUses}
                      onChange={(e) => setIsInfiniteUses(e.target.checked)}
                    />
                  </label>
                </>
              ) : (
                <Field label="Quantity" help="Up to 50 keys per batch.">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    step={1}
                    value={genCount}
                    onChange={(e) => setGenCount(Number(e.target.value))}
                  />
                </Field>
              )}

              <Field label="Duration type">
                <Select
                  aria-label="Duration type"
                  value={genType}
                  onValueChange={(value) => setGenType(value)}
                >
                  <option value="lifetime">Lifetime</option>
                  <option value="years">Years</option>
                  <option value="months">Months</option>
                  <option value="weeks">Weeks</option>
                  <option value="days">Days</option>
                  <option value="hours">Hours</option>
                  <option value="minutes">Minutes</option>
                </Select>
              </Field>

              {genType !== "lifetime" && (
                <Field label="Duration value">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={genDuration}
                    onChange={(e) => setGenDuration(Number(e.target.value))}
                  />
                </Field>
              )}
            </div>

            {/* Optional buyer attribution for manual sales — stamped on every
                generated key so the directory shows who it was sold to. */}
            <fieldset className="license-generator-section">
              <legend className="label-sm">
                <ShoppingCart size={12} /> Customer / order — for manual sales
              </legend>
              <div className="license-generator-grid">
                <Field label="Order ID" hint="optional">
                  <Input
                    mono
                    placeholder="e.g. ORD-1042"
                    value={genOrderId}
                    onChange={(e) => setGenOrderId(e.target.value)}
                  />
                </Field>
                <Field label="Customer name" hint="optional">
                  <Input
                    placeholder="Buyer name"
                    value={genCustomerName}
                    onChange={(e) => setGenCustomerName(e.target.value)}
                  />
                </Field>
                <Field label="Customer email" hint="optional">
                  <Input
                    type="email"
                    placeholder="buyer@mail.com"
                    value={genCustomerEmail}
                    onChange={(e) => setGenCustomerEmail(e.target.value)}
                  />
                </Field>
                <Field label="Discord" hint="optional">
                  <Input
                    placeholder="@buyer"
                    value={genCustomerDiscord}
                    onChange={(e) => setGenCustomerDiscord(e.target.value)}
                  />
                </Field>
              </div>
            </fieldset>

            <FormError message={generateError} />

            <div className="license-generator-actions">
              <Button
                type="submit"
                size="md"
                icon={<Plus size={16} />}
                permission="licenses.write"
                disabled={generating}
                variant="primary"
              >
                {generating ? "Creating…" : isMaster ? "Create master key" : "Create licenses"}
              </Button>
            </div>
          </form>
        </section>
      )}

      <Modal
        className="license-workspace-dialog"
        open={issueOpen}
        onClose={() => (issueBusy ? undefined : setIssueOpen(false))}
        dismissOnScrim={false}
        isDirty={() => !issueResult && !formsEqual(issueForm, issueBaseline.current)}
        kicker="Customer fulfilment"
        title={issueResult ? "License issued" : "Issue purchased license"}
        sub={
          issueResult
            ? `Operation ${issueResult.operation_id ?? "completed"}`
            : "Creates one traceable license tied to the customer order."
        }
      >
        {issueResult?.license ? (
          <div className="license-workflow-success" role="status">
            <div className="license-workflow-success-icon">
              <Key />
            </div>
            <p>The key is ready for the customer.</p>
            <code>{issueResult.license.license_key}</code>
            <Button
              size="sm"
              icon={copiedValue === issueResult.license.license_key ? <Check /> : <Copy />}
              onClick={() => void copyValue(issueResult.license!.license_key)}
            >
              {copiedValue === issueResult.license.license_key ? "Copied" : "Copy key"}
            </Button>
            <div className="license-workflow-result-grid">
              <span>
                Order<strong>{issueResult.license.order_id ?? issueForm.order_id}</strong>
              </span>
              <span>
                Status<strong>{issueResult.license.status}</strong>
              </span>
              <span>
                Replay-safe<strong>{issueResult.replayed ? "Replayed" : "New operation"}</strong>
              </span>
            </div>
            <ModalActions>
              <Button variant="ghost" onClick={() => setIssueOpen(false)}>
                Done
              </Button>
              <Button
                variant="primary"
                icon={<PlayCircle />}
                onClick={() => {
                  const issued = issueResult.license as LicenseRecord;
                  setIssueOpen(false);
                  openLicenseAction(issued, "activate");
                }}
              >
                Activate for install
              </Button>
            </ModalActions>
          </div>
        ) : (
          <form className="license-workflow-form" onSubmit={submitIssue}>
            <div className="license-workflow-grid">
              <Field label="Order ID" hint="required">
                <Input
                  required
                  value={issueForm.order_id}
                  onChange={(event) => updateIssueForm({ order_id: event.target.value })}
                  placeholder="ORD-1042"
                  autoFocus
                />
              </Field>
              <Field label="Customer name" hint="optional">
                <Input
                  value={issueForm.customer_name}
                  onChange={(event) => updateIssueForm({ customer_name: event.target.value })}
                  placeholder="Buyer name"
                />
              </Field>
              <Field label="Customer email" hint="optional">
                <Input
                  type="email"
                  value={issueForm.customer_email}
                  onChange={(event) => updateIssueForm({ customer_email: event.target.value })}
                  placeholder="buyer@example.com"
                />
              </Field>
              <Field label="Customer Discord" hint="optional">
                <Input
                  value={issueForm.customer_discord}
                  onChange={(event) => updateIssueForm({ customer_discord: event.target.value })}
                  placeholder="@buyer"
                />
              </Field>
              <Field label="License plan">
                <Select
                  aria-label="License plan"
                  value={issueForm.type}
                  onValueChange={(value) => updateIssueForm({ type: value as IssueForm["type"] })}
                >
                  <option value="lifetime">Lifetime</option>
                  <option value="trial">Trial</option>
                </Select>
              </Field>
              {issueForm.type === "trial" ? (
                <Field label="Duration in days">
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    value={issueForm.duration_days}
                    onChange={(event) =>
                      updateIssueForm({ duration_days: Number(event.target.value) })
                    }
                  />
                </Field>
              ) : null}
              <Field label="Seats (max uses)">
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  step={1}
                  value={issueForm.max_uses}
                  onChange={(event) => updateIssueForm({ max_uses: Number(event.target.value) })}
                />
              </Field>
              <Field label="Custom key" hint="optional">
                <Input
                  mono
                  minLength={8}
                  maxLength={128}
                  value={issueForm.custom_key}
                  onChange={(event) => updateIssueForm({ custom_key: event.target.value })}
                  placeholder="Blank creates a secure random key"
                />
              </Field>
            </div>
            <Field label="Order note" hint="optional">
              <Textarea
                rows={3}
                value={issueForm.order_note}
                onChange={(event) => updateIssueForm({ order_note: event.target.value })}
                placeholder="Purchase context or anything support should know"
              />
            </Field>
            <p className="license-workflow-note">
              This action is protected by an idempotency key, so retrying the same submission cannot
              issue a duplicate license.
            </p>
            <FormError message={issueError} />
            <ModalActions>
              <Button variant="ghost" onClick={() => setIssueOpen(false)} disabled={issueBusy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon={<Key />}
                permission="licenses.write"
                disabled={issueBusy}
              >
                {issueBusy ? "Issuing…" : "Issue license"}
              </Button>
            </ModalActions>
          </form>
        )}
      </Modal>

      <Modal
        className="license-workspace-dialog"
        open={licenseAction !== null}
        onClose={() => (actionBusy ? undefined : setLicenseAction(null))}
        dismissOnScrim={false}
        isDirty={() =>
          !actionResult &&
          !formsEqual(
            { installId: actionInstallId, hwid: actionHwid, reason: actionReason },
            actionBaseline.current,
          )
        }
        kicker="Customer fulfilment"
        title={
          actionResult
            ? "Access updated"
            : licenseAction?.mode === "activate"
              ? "Activate on an install"
              : "Bind a device"
        }
        sub={licenseAction ? `License ${licenseAction.license.license_key}` : undefined}
      >
        {actionResult ? (
          <div className="license-workflow-success" role="status">
            <div className="license-workflow-success-icon">
              <Link2 />
            </div>
            <p>
              {actionResult.changed
                ? "The license was updated successfully."
                : "The requested access was already in place; nothing was duplicated."}
            </p>
            <div className="license-workflow-result-grid">
              <span>
                Action<strong>{actionResult.action ?? licenseAction?.mode}</strong>
              </span>
              <span>
                Install<strong>{actionResult.target?.install_id ?? "—"}</strong>
              </span>
              <span>
                Hardware ID<strong>{actionResult.target?.hwid ?? "—"}</strong>
              </span>
              <span>
                Activated<strong>{actionResult.activated ? "Yes" : "No change"}</strong>
              </span>
              <span>
                Operation<strong>{actionResult.operation_id ?? "—"}</strong>
              </span>
              <span>
                Replay-safe<strong>{actionResult.replayed ? "Replayed" : "New operation"}</strong>
              </span>
            </div>
            <ModalActions>
              {/* A success screen has nothing left to commit, so the dismissal is
                  a ghost here too — primary always means "commit something". */}
              <Button variant="ghost" onClick={() => setLicenseAction(null)}>
                Done
              </Button>
            </ModalActions>
          </div>
        ) : licenseAction ? (
          <form className="license-workflow-form" onSubmit={submitLicenseAction}>
            <div className="license-action-explainer">
              {licenseAction.mode === "activate"
                ? "Use the registered install ID from the customer's app. The server resolves and verifies its hardware ID, then performs the first binding if needed."
                : "Bind an additional verified hardware ID. Add the install ID when you have it so the server can verify they match."}
            </div>
            <Field
              label="Install ID"
              hint={licenseAction.mode === "activate" ? "required" : "recommended"}
            >
              <Input
                mono
                required={licenseAction.mode === "activate"}
                value={actionInstallId}
                onChange={(event) => {
                  setActionInstallId(event.target.value);
                  touchLicenseAction();
                }}
                placeholder="Install ID from Customer 360 or the app"
                autoFocus
              />
            </Field>
            {licenseAction.mode === "bind" ? (
              <Field label="Hardware ID" hint="required">
                <Input
                  mono
                  required
                  value={actionHwid}
                  onChange={(event) => {
                    setActionHwid(event.target.value);
                    touchLicenseAction();
                  }}
                  placeholder="Verified HWID"
                />
              </Field>
            ) : null}
            <Field
              label="Reason"
              hint="optional"
              help="Saved with the operation for the audit log."
            >
              <Textarea
                rows={3}
                value={actionReason}
                onChange={(event) => {
                  setActionReason(event.target.value);
                  touchLicenseAction();
                }}
                placeholder="e.g. Paid order verified in support ticket"
              />
            </Field>
            <p className="license-workflow-note">
              Only a registered, non-revoked install or a hardware ID already seen by telemetry can
              be used.
            </p>
            <FormError message={actionError} />
            <ModalActions>
              <Button variant="ghost" onClick={() => setLicenseAction(null)} disabled={actionBusy}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon={licenseAction.mode === "activate" ? <PlayCircle /> : <Link2 />}
                permission="licenses.write"
                disabled={actionBusy}
              >
                {actionBusy
                  ? "Saving…"
                  : licenseAction.mode === "activate"
                    ? "Activate license"
                    : "Bind device"}
              </Button>
            </ModalActions>
          </form>
        ) : null}
      </Modal>

      <Modal
        className="license-workspace-dialog"
        open={!!deleteCandidate}
        onClose={() => (isDeleting ? undefined : setDeleteCandidate(null))}
        kicker="Danger zone"
        title="Delete license"
        sub={
          deleteCandidate?.hwid
            ? "This permanently wipes the license from the database and instantly kills access on every bound machine. It cannot be recovered."
            : "This will permanently wipe this license from the database. It cannot be recovered."
        }
      >
        <FormError message={deleteError} />
        <ModalActions>
          <Button variant="ghost" onClick={() => setDeleteCandidate(null)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            icon={<Trash2 />}
            permission="licenses.write"
            onClick={confirmDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete license"}
          </Button>
        </ModalActions>
      </Modal>

      {/* Customer / order attribution editor */}
      <Modal
        className="license-workspace-dialog"
        open={!!editCandidate}
        onClose={() => (isSavingEdit ? null : setEditCandidate(null))}
        dismissOnScrim={false}
        isDirty={() => !!editCandidate && !formsEqual(editForm, orderFormFor(editCandidate))}
        kicker="Order tracking"
        title="Customer & order"
        sub={editCandidate ? `License ${editCandidate.license_key}` : undefined}
      >
        {editCandidate ? (
          <form
            className="license-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdit();
            }}
          >
            {/* Machine-owned facts about this key (read-only) */}
            <div className="license-edit-facts">
              <span>
                Source: <strong className="is-source">{editCandidate.order_source || "—"}</strong>
              </span>
              <span>
                Issued:{" "}
                <strong>
                  {editCandidate.purchased_at
                    ? formatDate(editCandidate.purchased_at)
                    : formatDate(editCandidate.created_at)}
                </strong>
              </span>
              {editCandidate.verified_discord ? (
                <span>
                  Verified Discord:{" "}
                  <strong className="is-verified">
                    {discordHandle(editCandidate.verified_discord)}
                  </strong>
                </span>
              ) : null}
            </div>

            <div className="license-edit-grid">
              <Field label="Order ID" hint="optional">
                <Input
                  mono
                  placeholder="e.g. ORD-1042 / invoice id"
                  value={editForm.order_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, order_id: e.target.value }))}
                />
              </Field>
              <Field label="Customer name" hint="optional">
                <Input
                  placeholder="Buyer name"
                  value={editForm.customer_name}
                  onChange={(e) => setEditForm((f) => ({ ...f, customer_name: e.target.value }))}
                />
              </Field>
              <Field label="Customer email" hint="optional">
                <Input
                  type="email"
                  placeholder="buyer@mail.com"
                  value={editForm.customer_email}
                  onChange={(e) => setEditForm((f) => ({ ...f, customer_email: e.target.value }))}
                />
              </Field>
              <Field label="Discord" hint="optional">
                <Input
                  placeholder="@buyer"
                  value={editForm.customer_discord}
                  onChange={(e) => setEditForm((f) => ({ ...f, customer_discord: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Note" hint="optional">
              <Textarea
                rows={3}
                placeholder="Anything worth remembering about this sale…"
                value={editForm.order_note}
                onChange={(e) => setEditForm((f) => ({ ...f, order_note: e.target.value }))}
              />
            </Field>

            {/* Verified Discord accounts. Saved on click, not with the dialog's Save button. */}
            <section className="license-discord" aria-label="Discord accounts">
              <h3 className="license-discord-title">
                <MessageSquareText size={14} aria-hidden="true" /> Discord accounts
              </h3>
              <p className="license-workflow-note">
                The bot applies role changes within its next sync (up to 30 minutes), or right away
                when the member runs /verify.
              </p>
              {discordLinks === null ? (
                <p className="license-discord-empty">Loading…</p>
              ) : discordLinks.length === 0 ? (
                <p className="license-discord-empty">No Discord account is linked to this key.</p>
              ) : (
                <ul className="license-discord-list">
                  {discordLinks.map((link) => (
                    <li key={link.discord_id} className="license-discord-row">
                      <div>
                        <strong>
                          {link.discord_tag ? discordHandle(link.discord_tag) : "Unnamed account"}
                        </strong>
                        <span className="mono">{link.discord_id}</span>
                        <span className="license-discord-meta">
                          {link.source ?? "unknown"} · {formatDate(link.verified_at)}
                        </span>
                      </div>
                      <Badge tone={link.is_active === 1 ? "success" : "warning"}>
                        {link.is_active === 1 ? "Linked" : "Revoked"}
                      </Badge>
                      {link.is_active === 1 ? (
                        <Button
                          size="xs"
                          variant="danger"
                          permission="licenses.write"
                          icon={<X />}
                          disabled={discordBusy}
                          aria-label={`Unlink Discord account ${link.discord_id}`}
                          onClick={() => unlinkDiscord(link.discord_id)}
                        >
                          Unlink
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className="license-discord-form">
                <Field label="Discord user id" hint="17-20 digits">
                  <Input
                    mono
                    inputMode="numeric"
                    placeholder="e.g. 123456789012345678"
                    value={newDiscordId}
                    onChange={(e) => setNewDiscordId(e.target.value)}
                  />
                </Field>
                <Field label="Discord name" hint="optional">
                  <Input
                    placeholder="@member"
                    value={newDiscordTag}
                    onChange={(e) => setNewDiscordTag(e.target.value)}
                  />
                </Field>
                <label className="toggle-row">
                  <span>Replace existing account(s)</span>
                  <input
                    type="checkbox"
                    checked={replaceDiscord}
                    onChange={(e) => setReplaceDiscord(e.target.checked)}
                  />
                </label>
                <Button
                  size="sm"
                  icon={<Link2 />}
                  permission="licenses.write"
                  disabled={discordBusy}
                  onClick={() => void submitDiscordLink()}
                >
                  {discordBusy ? "Saving…" : replaceDiscord ? "Rebind account" : "Link account"}
                </Button>
              </div>
              <p className="license-discord-empty">
                Replacing revokes the other accounts on this key; leaving it off adds this one, even
                past the seat limit.
              </p>
              <FormError message={discordError} />
            </section>

            {/* Archived support tickets of the same accounts. Read-only apart from Delete. */}
            <section className="license-discord" aria-label="Discord tickets">
              <h3 className="license-discord-title">
                <Ticket size={14} aria-hidden="true" /> Discord tickets ({ticketTotal})
              </h3>
              {tickets === null ? (
                <p className="license-discord-empty">Loading…</p>
              ) : (
                <DiscordTicketList
                  tickets={tickets}
                  empty="No support ticket is archived for this key."
                  onDeleted={(id) => {
                    setTickets((current) => (current ?? []).filter((row) => row.id !== id));
                    setTicketTotal((current) => Math.max(0, current - 1));
                  }}
                />
              )}
              <FormError message={ticketError} />
            </section>

            {editCandidate.order_meta ? (
              <details className="license-edit-raw">
                <summary>
                  Raw storefront payload (what the shop sent when this key was issued)
                </summary>
                <pre>
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(editCandidate.order_meta), null, 2);
                    } catch {
                      return editCandidate.order_meta;
                    }
                  })()}
                </pre>
              </details>
            ) : null}

            <FormError message={editError} />

            <ModalActions>
              <Button
                variant="ghost"
                onClick={() => setEditCandidate(null)}
                disabled={isSavingEdit}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                permission="licenses.write"
                disabled={isSavingEdit}
              >
                {isSavingEdit ? "Saving…" : "Save"}
              </Button>
            </ModalActions>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
