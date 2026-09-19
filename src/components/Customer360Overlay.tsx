import {
  Activity,
  ArrowLeft,
  AlertTriangle,
  Braces,
  ChevronDown,
  KeyRound,
  Laptop,
  MessageSquareText,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Ticket,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  Customer360Customer,
  Customer360DatabaseRow,
  Customer360Feedback,
  CustomerConfidence,
  Customer360Selector,
  DiagnosticBundle,
} from "../types/customer360";
import type { AppSessionRecord, ErrorEventDetail } from "../types/telemetry";
import { fetchCustomer360 } from "../utils/api";
import { getCustomer360Overview } from "../utils/customer360Overview";
import {
  describeBackgroundReport,
  isBackgroundErrorKind,
  isRealErrorRow,
  summarizeBackgroundRows,
} from "../utils/errorEvents";
import { useRefreshSignal } from "../utils/refreshBus";
import {
  formatDate,
  formatDuration,
  formatEventName,
  formatNumber,
  timeAgo,
} from "../utils/format";
import { Badge, type BadgeProps } from "./ds/Badge";
import { Button } from "./ds/Button";
import { Modal, ModalActions } from "./ds/Modal";
import { RelativeTime } from "./ds/RelativeTime";
import { usePanelPermission } from "../hooks/usePanelPermission";
import { PanelBackground } from "./PanelBackground";
import { CustomerAvatar, useCustomerProfiles } from "./CustomerProfiles";
import { DiscordTicketList } from "./DiscordTickets";
import { FEEDBACK_KIND_BADGE } from "./FeedbackReplies";
import { resolveCountry } from "../utils/geography";
import { setWorkspaceSearch } from "../hooks/useWorkspaceSearch";
import { CustomerAccessDialog } from "./CustomerAccessDialog";
import {
  customerActionUrl,
  navigateCustomerUrl,
  openCustomerWorkspace,
} from "../utils/customerNavigation";

export interface Customer360Anchor {
  selector: Customer360Selector;
  value: string;
  label?: string | null;
  detail?: string | null;
}

export interface Customer360OverlayProps {
  session: AppSessionRecord | null;
  anchor?: Customer360Anchor | null;
  open: boolean;
  onClose: () => void;
  /**
   * Set while the workspace hands the screen to another page (CustomerWorkspaceRouter):
   * "hold" keeps it on top but inert, "fade" fades it out.
   */
  handoff?: "hold" | "fade";
}

type TabKey = "summary" | "commerce" | "sessions" | "activity";

const TABS: Array<{ key: TabKey; label: string; shortLabel: string; icon: ReactNode }> = [
  { key: "summary", label: "Overview", shortLabel: "Overview", icon: <UserRound /> },
  { key: "commerce", label: "Licenses & orders", shortLabel: "Licenses", icon: <KeyRound /> },
  { key: "sessions", label: "Devices & sessions", shortLabel: "Devices", icon: <Laptop /> },
  { key: "activity", label: "Support & history", shortLabel: "Support", icon: <Activity /> },
];

function confidenceLabel(confidence: CustomerConfidence): string {
  switch (confidence) {
    case "verified_customer":
      return "Verified customer";
    case "linked_license":
      return "Linked by license";
    default:
      return "Device only";
  }
}

function confidenceTone(confidence: CustomerConfidence): BadgeProps["tone"] {
  return confidence === "verified_customer"
    ? "success"
    : confidence === "linked_license"
      ? "info"
      : "warning";
}

function statusTone(value: unknown): BadgeProps["tone"] {
  const status = String(value ?? "").toLowerCase();
  if (["ok", "pass", "active", "resolved", "success", "online"].includes(status)) return "success";
  if (["fail", "failed", "error", "revoked", "banned", "down"].includes(status)) return "danger";
  if (["warning", "new", "open", "suspended", "unavailable", "degraded"].includes(status))
    return "warning";
  return "muted";
}

/**
 * A real error stands out; a background fault stays as calm as the caption above the list.
 * The shared predicate decides, so every kind the Errors page counts as real ("unhandled",
 * "crash", ...) gets the error tone, not only the literal "error" statusTone knows.
 */
function errorKindTone(row: Customer360DatabaseRow): BadgeProps["tone"] {
  return isBackgroundErrorKind(row.kind) ? "muted" : "danger";
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return Number.isFinite(value) ? value.toLocaleString() : String(value);
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function humanKey(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (first) => first.toUpperCase());
}

function maskLicenseKey(value: unknown): string {
  const key = String(value ?? "");
  if (!key) return "License";
  if (key.length <= 8) return `••••${key.slice(-2)}`;
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function titleFor(
  customer: Customer360Customer | null,
  session: AppSessionRecord | null,
  anchor: Customer360Anchor | null,
): string {
  return (
    customer?.profile.customer_name ??
    customer?.profile.user_label ??
    session?.userLabel ??
    anchor?.label ??
    customer?.profile.email ??
    "Customer 360"
  );
}

function InfoGrid({ items }: { items: Array<{ label: string; value: unknown; mono?: boolean }> }) {
  return (
    <dl className="customer360-info-grid">
      {items
        .filter((item) => item.value !== null && item.value !== undefined && item.value !== "")
        .map((item) => (
          <div className="customer360-info" key={item.label}>
            <dt>{item.label}</dt>
            <dd className={item.mono ? "customer360-mono" : undefined}>
              {displayValue(item.value)}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function SectionHeading({
  icon,
  title,
  count,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
}) {
  return (
    <div className="customer360-section-heading">
      <span className="customer360-section-icon">{icon}</span>
      <h3>{title}</h3>
      {typeof count === "number" ? <Badge tone="muted">{count}</Badge> : null}
    </div>
  );
}

function SectionErrors({ customer, names }: { customer: Customer360Customer; names: string[] }) {
  const messages = names
    .map((name) => customer.section_errors[name])
    .filter((message): message is string => Boolean(message));
  if (messages.length === 0) return null;
  return (
    <div className="customer360-callout customer360-callout-warning" role="status">
      <AlertTriangle />
      <div>
        <strong>This section is incomplete</strong>
        {messages.map((message, index) => (
          <p key={`${message}-${index}`}>{message}</p>
        ))}
      </div>
    </div>
  );
}

function RecordDetails({ record }: { record: object }) {
  return (
    <dl className="customer360-record-fields">
      {Object.entries(record).map(([key, value]) => (
        <div
          key={key}
          className={displayValue(value).length > 160 ? "customer360-field-wide" : undefined}
        >
          <dt>{humanKey(key)}</dt>
          <dd
            className={key.includes("id") || key.includes("key") ? "customer360-mono" : undefined}
          >
            {displayValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RecordList({
  rows,
  empty,
  label,
  meta,
  badge,
  badgeTone = statusTone,
}: {
  rows: object[];
  empty: string;
  label: (row: Customer360DatabaseRow, index: number) => string;
  meta?: (row: Customer360DatabaseRow) => ReactNode;
  badge?: (row: Customer360DatabaseRow) => string | null;
  /** Tone for the badge; defaults to reading the badge text as a status. */
  badgeTone?: (row: Customer360DatabaseRow, badgeValue: string) => BadgeProps["tone"];
}) {
  if (rows.length === 0) return <p className="customer360-empty">{empty}</p>;
  return (
    <div className="customer360-record-list">
      {rows.map((raw, index) => {
        const row = raw as Customer360DatabaseRow;
        const badgeValue = badge?.(row);
        return (
          <details className="customer360-record" key={`${label(row, index)}-${index}`}>
            <summary>
              <span>
                <strong>{label(row, index)}</strong>
                {meta ? <small>{meta(row)}</small> : null}
              </span>
              {badgeValue ? <Badge tone={badgeTone(row, badgeValue)}>{badgeValue}</Badge> : null}
            </summary>
            <RecordDetails record={raw} />
          </details>
        );
      })}
    </div>
  );
}

/**
 * Errors for one customer. The heading counts what Key figures counts — real
 * errors — while background faults stay listed and labelled below it, because
 * support needs to see the noise without it being called a crash. The caption
 * explaining the noise sits above the rows: below them it was read only after
 * scrolling past every alarming-looking line it was there to explain.
 */
function ErrorsSection({ errors }: { errors: ErrorEventDetail[] }) {
  const realErrors = errors.filter(isRealErrorRow).length;
  // Rows, and the faults they stand for: from client 1.5.3 one row can be a 5-minute rollup.
  const background = summarizeBackgroundRows(errors);
  return (
    <section className="customer360-card">
      <SectionHeading icon={<AlertTriangle />} title="Errors" count={realErrors} />
      {background.reports > 0 ? (
        <p className="customer360-caption customer360-caption-lead">
          {background.reports === 1
            ? "1 background fault report is listed below"
            : `${formatNumber(background.reports)} background fault reports are listed below`}
          {background.faults > background.reports
            ? `, standing for ${formatNumber(background.faults)} faults`
            : ""}
          {background.reports === 1
            ? " — a known client bug that does not crash the app, so it is never counted as an error."
            : " — a known client bug that does not crash the app, so they are never counted as errors."}
        </p>
      ) : null}
      <RecordList
        rows={errors}
        empty="No errors are linked to this customer."
        label={(row, index) => displayValue(row.message ?? row.type ?? `Error ${index + 1}`)}
        meta={(row) =>
          [
            displayValue(row.type ?? row.kind),
            // A rollup or suppressed-I/O row says so, right where its date is.
            describeBackgroundReport(row.report),
            row.timestamp ? formatDate(String(row.timestamp)) : "time unknown",
          ]
            .filter(Boolean)
            .join(" · ")
        }
        badge={(row) => String(row.kind ?? "error")}
        badgeTone={errorKindTone}
      />
    </section>
  );
}

function DiagnosticReport({ report }: { report: DiagnosticBundle | null }) {
  if (!report)
    return <p className="customer360-empty">No structured diagnostic report was attached.</p>;
  return (
    <div className="customer360-stack">
      <InfoGrid
        items={[
          { label: "Report ID", value: report.report_id, mono: true },
          { label: "Generated", value: formatDate(report.generated_at) },
          { label: "Providers", value: report.providers.length },
        ]}
      />
      <div className="customer360-card-grid">
        {report.providers.map((provider, providerIndex) => (
          <section className="customer360-card" key={`${provider.provider}-${providerIndex}`}>
            <div className="customer360-card-title">
              <div>
                <strong>{provider.provider}</strong>
                <small>{provider.version ? `v${provider.version}` : "Version not reported"}</small>
              </div>
              <Badge tone={statusTone(provider.status)}>{provider.status}</Badge>
            </div>
            {provider.summary ? <p className="customer360-copy">{provider.summary}</p> : null}
            {typeof provider.duration_ms === "number" ? (
              <p className="customer360-caption">
                Collected in {provider.duration_ms.toLocaleString()} ms
              </p>
            ) : null}
            <div className="customer360-checks">
              {provider.checks.map((check) => (
                <div className="customer360-check" key={check.key}>
                  <span className={`customer360-check-dot is-${check.status}`} aria-hidden="true" />
                  <div>
                    <strong>{check.label}</strong>
                    {check.value !== undefined ? <span>{displayValue(check.value)}</span> : null}
                    {check.detail ? <small>{check.detail}</small> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Technical context belongs with devices, not ahead of the customer relationship. */
function EnvironmentSummary({ customer }: { customer: Customer360Customer }) {
  const { summary } = customer;
  return (
    <div className="customer360-environment">
      <section className="customer360-card">
        <SectionHeading icon={<Laptop />} title="App & device" />
        <InfoGrid
          items={[
            { label: "App version", value: summary.display_version ?? summary.app_version },
            { label: "Platform", value: summary.platform },
            { label: "OS", value: summary.os_version },
            { label: "Device", value: summary.device_model },
          ]}
        />
      </section>
      <section className="customer360-card">
        <SectionHeading icon={<RefreshCw />} title="Location & activity" />
        <InfoGrid
          items={[
            {
              label: "Country",
              value: resolveCountry(summary.country)?.label ?? summary.country,
            },
            {
              label: "City / region",
              value: [summary.city, summary.region].filter(Boolean).join(", "),
            },
            { label: "Timezone", value: summary.timezone },
            {
              label: "First seen",
              value: summary.first_seen ? formatDate(summary.first_seen) : null,
            },
            {
              label: "Last seen",
              value: summary.last_seen
                ? `${formatDate(summary.last_seen)} (${timeAgo(summary.last_seen)})`
                : null,
            },
          ]}
        />
      </section>
    </div>
  );
}

/** Customer-facing context first; partial sources never become an all-clear state. */
export function Customer360Overview({
  customer,
  onOpenSection,
}: {
  customer: Customer360Customer;
  onOpenSection: (tab: TabKey) => void;
}) {
  const canReadAccess = usePanelPermission("access.read");
  const canReadLicenses = usePanelPermission("licenses.read");
  const canReadSupport = usePanelPermission("support.read");
  const canMonitor = usePanelPermission("monitoring.read");
  const overview = getCustomer360Overview(customer);
  const report = overview.openReports[0] ?? overview.latestReport;
  const events: Array<{ id: string; label: string; detail: string; at: string; tab: TabKey }> = [
    ...(canReadSupport
      ? customer.feedback.map((item, index) => ({
          id: `feedback-${item.report_id ?? item.id ?? index}`,
          label: item.kind === "support" ? "Support report received" : "Feedback received",
          detail: item.category
            ? humanKey(item.category)
            : item.kind === "support"
              ? "Problem report"
              : "Customer feedback",
          at: item.created_at ?? "",
          tab: "activity" as const,
        }))
      : []),
    ...(canMonitor
      ? customer.sessions.map((item) => ({
          id: `session-${item.id}`,
          label: "Session last seen",
          detail: item.displayVersion ?? item.appVersion ?? "App session",
          at: item.lastSeenAt ?? "",
          tab: "sessions" as const,
        }))
      : []),
    ...(canReadLicenses
      ? customer.licenses.map((item) => ({
          id: `license-${item.id}`,
          label: "License activated",
          detail: maskLicenseKey(item.license_key),
          at: item.activated_at ?? "",
          tab: "commerce" as const,
        }))
      : []),
  ];
  const recentEvents = events
    .filter((event) => Number.isFinite(Date.parse(event.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 6);

  return (
    <div className="customer360-stack customer360-overview">
      <section
        className="customer360-card customer360-account-overview"
        aria-label="Account overview"
      >
        <div className="customer360-overview-heading">
          <span className="customer360-eyebrow">Customer overview</span>
          <h2>Account at a glance</h2>
        </div>
        <dl className="customer360-account-facts">
          {canReadAccess ? (
            <div>
              <dt>App access</dt>
              <dd>
                <Badge tone={overview.access.tone}>{overview.access.label}</Badge>
              </dd>
              <small>{overview.access.detail}</small>
            </div>
          ) : null}
          {canReadLicenses ? (
            <div>
              <dt>License</dt>
              <dd>
                <Badge tone={overview.license.tone}>{overview.license.label}</Badge>
              </dd>
              <small>{overview.license.detail}</small>
            </div>
          ) : null}
          {canReadSupport ? (
            <>
              <div>
                <dt>Open reports</dt>
                <dd>
                  <Badge
                    tone={
                      overview.reportsUnavailable
                        ? "muted"
                        : overview.openReports.length
                          ? "warning"
                          : "muted"
                    }
                  >
                    {overview.reportsUnavailable
                      ? "Incomplete"
                      : formatNumber(overview.openReports.length)}
                  </Badge>
                </dd>
                <small>
                  {overview.reportsUnavailable
                    ? "Support data is incomplete"
                    : "New and read, not archived"}
                </small>
              </div>
              <div>
                <dt>Last contact</dt>
                <dd>
                  {overview.latestContact ? (
                    <RelativeTime iso={overview.latestContact} />
                  ) : (
                    "Not recorded"
                  )}
                </dd>
                <small>In-app feedback</small>
              </div>
            </>
          ) : null}
        </dl>
      </section>

      {canReadSupport ? (
        <section className="customer360-card customer360-priority" aria-label="Support focus">
          <div className="customer360-priority-top">
            <span className="customer360-eyebrow">
              <MessageSquareText aria-hidden="true" />
              {overview.openReports.length ? "Needs attention" : "Latest support"}
            </span>
            {report ? (
              <Badge tone={statusTone(report.status)}>{report.status ?? "Unknown status"}</Badge>
            ) : null}
          </div>
          {report ? (
            <>
              <h2>{report.category ? humanKey(report.category) : "In-app report"}</h2>
              <p className="customer360-priority-copy">{report.message || "No message body."}</p>
              <div className="customer360-priority-meta">
                <span className="customer360-mono">
                  {report.report_id ?? report.id ?? "Report"}
                </span>
                {report.created_at ? <RelativeTime iso={report.created_at} /> : null}
                {report.diagnostics ? <span>Diagnostics attached</span> : null}
              </div>
            </>
          ) : (
            <p className="customer360-copy">
              {overview.reportsUnavailable
                ? "Support data is unavailable. Open the history for details."
                : "No in-app reports recorded for this customer."}
            </p>
          )}
          {overview.reportsUnavailable && report ? (
            <p className="customer360-caption">
              Some support data is unavailable; this is not the complete history.
            </p>
          ) : null}
          <Button
            variant={overview.openReports.length ? "accent" : "ghost"}
            icon={<MessageSquareText />}
            onClick={() => onOpenSection("activity")}
          >
            Open support history
          </Button>
        </section>
      ) : null}

      <section className="customer360-card" aria-label="Recent customer history">
        <SectionHeading icon={<Activity />} title="Recent history" />
        {recentEvents.length ? (
          <ol className="customer360-history">
            {recentEvents.map((event) => (
              <li key={event.id}>
                <span className="customer360-history-dot" aria-hidden="true" />
                <div>
                  <strong>{event.label}</strong>
                  <span>{event.detail}</span>
                </div>
                <RelativeTime iso={event.at} />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`View ${event.label.toLowerCase()}`}
                  onClick={() => onOpenSection(event.tab)}
                >
                  View
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="customer360-empty">
            No dated history is available in the sections you can access.
          </p>
        )}
        <p className="customer360-caption customer360-history-note">
          Recent records only. Each tab contains its available history.
        </p>
      </section>
    </div>
  );
}

/** Secondary usage figures retain the existing shared type scale. */
function KeyFigures({ customer }: { customer: Customer360Customer }) {
  const { summary } = customer;
  return (
    <section className="customer360-card" aria-label="Key figures">
      <dl className="customer360-figures">
        <div>
          <dt>Installations</dt>
          <dd>{formatNumber(customer.installs.length)}</dd>
        </div>
        <div>
          <dt>Sessions</dt>
          <dd>{formatNumber(summary.total_sessions)}</dd>
        </div>
        <div>
          <dt>Recorded use</dt>
          <dd>{formatDuration(summary.total_duration_seconds)}</dd>
        </div>
        <div>
          <dt>Errors</dt>
          <dd className={summary.error_count > 0 ? "is-danger" : undefined}>
            {formatNumber(summary.error_count)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** The identifier the workspace was opened by, in words. */
const ANCHOR_LABELS: Record<string, string> = {
  session_id: "session",
  hwid: "HWID",
  install_id: "install ID",
  license_key: "license key",
  order_id: "order",
  feedback_id: "feedback report",
};

function IdentityCard({
  customer,
  linkedAccount,
  onRawData,
}: {
  customer: Customer360Customer;
  linkedAccount: string | null;
  onRawData: () => void;
}) {
  const { profile, anchor, summary } = customer;
  const contactFacts = [
    { label: "Email", value: profile.email },
    { label: "Discord", value: profile.verified_discord || profile.discord || linkedAccount },
    { label: "Contact", value: profile.contact },
  ].filter(
    (fact, index, facts) =>
      Boolean(fact.value) && facts.findIndex((other) => other.value === fact.value) === index,
  );
  // Where the newest session came from: the address the owner looks up first, and under
  // it the place that session resolved to and how many addresses the identity was seen
  // from. The place repeats the Location card on purpose — it belongs next to the IP.
  const lastIp = summary.last_ip?.trim() || null;
  const ipCount = summary.ip_count ?? 0;
  const ipMeta = [
    [summary.city, resolveCountry(summary.country)?.label ?? summary.country]
      .filter((value) => Boolean(value?.trim()))
      .join(", "),
    ipCount > 1 ? `${formatNumber(ipCount)} addresses seen` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const requestedBy = String(anchor.requested_by ?? "");
  return (
    <section className="customer360-card customer360-identity">
      <SectionHeading icon={<UserRound />} title="Contact" />
      <div className="customer360-badges">
        <Badge tone={confidenceTone(anchor.confidence)}>{confidenceLabel(anchor.confidence)}</Badge>
      </div>
      {contactFacts.length ? null : (
        <p className="customer360-caption">No contact details have been linked to this identity.</p>
      )}
      {contactFacts.length || lastIp ? (
        <dl className="customer360-facts">
          {contactFacts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{displayValue(fact.value)}</dd>
            </div>
          ))}
          {lastIp ? (
            <div className="customer360-last-ip">
              <dt>Last IP</dt>
              <dd>
                <span className="customer360-mono">{lastIp}</span>
                {ipMeta ? <small>{ipMeta}</small> : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <details className="customer360-contact-details">
        <summary>
          <span>Identity &amp; technical details</span>
          <ChevronDown aria-hidden="true" />
        </summary>
        <InfoGrid
          items={[
            { label: "Customer", value: profile.customer_name },
            { label: "App label", value: profile.user_label },
            { label: "Linked account", value: linkedAccount },
            { label: "Install ID", value: anchor.install_id, mono: true },
            { label: "Hardware ID", value: anchor.hwid, mono: true },
          ]}
        />
        {anchor.requested_value ? (
          <p className="customer360-anchor">
            Opened from {ANCHOR_LABELS[requestedBy] ?? humanKey(requestedBy)}{" "}
            <span className="customer360-mono">
              {requestedBy === "license_key"
                ? maskLicenseKey(anchor.requested_value)
                : anchor.requested_value}
            </span>
          </p>
        ) : null}
        <Button size="sm" icon={<Braces />} onClick={onRawData}>
          Raw data
        </Button>
      </details>
    </section>
  );
}

function SettingsTab({ customer }: { customer: Customer360Customer }) {
  const featureEntries = Object.entries(customer.settings.features ?? {});
  return (
    <div className="customer360-stack">
      <SectionErrors customer={customer} names={["settings"]} />
      <section className="customer360-card">
        <SectionHeading icon={<Settings2 />} title="Captured app settings" />
        <InfoGrid
          items={[
            { label: "Discord Rich Presence", value: customer.settings.rpc_enabled },
            ...Object.entries(customer.settings)
              .filter(([key]) => key !== "rpc_enabled" && key !== "features")
              .map(([key, value]) => ({ label: humanKey(key), value })),
          ]}
        />
      </section>
      <section className="customer360-card">
        <SectionHeading
          icon={<PackageCheck />}
          title="Feature state"
          count={featureEntries.length}
        />
        {featureEntries.length > 0 ? (
          <div className="customer360-feature-grid">
            {featureEntries.map(([name, value]) => (
              <div key={name}>
                <span>{humanKey(name)}</span>
                <strong>{displayValue(value)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="customer360-empty">No feature settings have been reported.</p>
        )}
      </section>
    </div>
  );
}

function ActivityTab({ customer }: { customer: Customer360Customer }) {
  const activity = customer.activity;
  return (
    <div className="customer360-stack">
      <SectionErrors customer={customer} names={["activity", "errors"]} />
      <section className="customer360-card">
        <SectionHeading icon={<Activity />} title="Recorded activity" />
        {activity ? (
          <>
            <InfoGrid
              items={[
                { label: "Timezone", value: activity.timezone },
                { label: "Recorded online", value: formatDuration(activity.totalSeconds) },
                { label: "Sessions", value: activity.sessionCount },
                { label: "Average session", value: formatDuration(activity.averageSessionSeconds) },
                {
                  label: "First seen",
                  value: activity.firstSeen ? formatDate(activity.firstSeen) : null,
                },
                {
                  label: "Last seen",
                  value: activity.lastSeen ? formatDate(activity.lastSeen) : null,
                },
                { label: "Legacy-only history", value: activity.legacyOnly },
                { label: "Intervals complete", value: activity.intervalsComplete },
              ]}
            />
            <details className="customer360-record customer360-activity-details">
              <summary>
                <strong>Daily and interval history</strong>
                <Badge tone="muted">{activity.days.length} days</Badge>
              </summary>
              <RecordDetails
                record={{
                  days: activity.days,
                  intervals: activity.intervals,
                  hourOfDay: activity.hourOfDay,
                  weekdayTotals: activity.weekdayTotals,
                  hourOfWeek: activity.hourOfWeek,
                }}
              />
            </details>
          </>
        ) : (
          <p className="customer360-empty">No activity history is available.</p>
        )}
      </section>
      <ErrorsSection errors={customer.errors} />
    </div>
  );
}

function CommerceTab({ customer }: { customer: Customer360Customer }) {
  return (
    <div className="customer360-stack">
      <SectionErrors
        customer={customer}
        names={["licenses", "orders", "access", "discord_links", "discord_tickets", "usage"]}
      />
      <div className="customer360-two-col">
        <section className="customer360-card">
          <SectionHeading icon={<KeyRound />} title="Licenses" count={customer.licenses.length} />
          <RecordList
            rows={customer.licenses}
            empty="No license is linked to this identity."
            label={(row, index) =>
              row.license_key ? maskLicenseKey(row.license_key) : `License ${index + 1}`
            }
            meta={(row) =>
              `${displayValue(row.type)} · ${row.expires_at ? `expires ${formatDate(String(row.expires_at))}` : "no expiry"}`
            }
            badge={(row) => String(row.status ?? "unknown")}
          />
        </section>
        <section className="customer360-card">
          <SectionHeading icon={<ReceiptText />} title="Orders" count={customer.orders.length} />
          <RecordList
            rows={customer.orders}
            empty="No order attribution is available."
            label={(row, index) => displayValue(row.order_id ?? `Order ${index + 1}`)}
            meta={(row) =>
              `${displayValue(row.customer_name ?? row.customer_email)} · ${displayValue(row.license_count)} license(s)`
            }
            badge={(row) => (row.order_source ? String(row.order_source) : null)}
          />
        </section>
      </div>
      <div className="customer360-three-col">
        <section className="customer360-card">
          <SectionHeading
            icon={<ShieldCheck />}
            title="Access controls"
            count={customer.access.length}
          />
          <RecordList
            rows={customer.access}
            empty="No suspensions or access overrides."
            label={(row, index) => displayValue(row.mode ?? `Rule ${index + 1}`)}
            meta={(row) => displayValue(row.reason)}
            badge={(row) => (Number(row.is_active) === 1 ? "active" : "inactive")}
          />
        </section>
        <section className="customer360-card">
          <SectionHeading
            icon={<MessageSquareText />}
            title="Discord links"
            count={customer.discord_links.length}
          />
          <RecordList
            rows={customer.discord_links}
            empty="No Discord link records."
            label={(row, index) =>
              displayValue(row.discord_user ?? row.discord ?? `Link ${index + 1}`)
            }
            meta={(row) => displayValue(row.license_key ?? row.install_id)}
            badge={(row) => (row.status ? String(row.status) : null)}
          />
        </section>
        <section className="customer360-card">
          <SectionHeading icon={<Activity />} title="Usage limits" count={customer.usage.length} />
          <RecordList
            rows={customer.usage}
            empty="No metered usage records."
            label={(row, index) => displayValue(row.feature ?? `Usage ${index + 1}`)}
            meta={(row) =>
              `${displayValue(row.count)} used · ${displayValue(row.remaining)} remaining`
            }
          />
        </section>
        <DiscordTicketsCard customer={customer} />
      </div>
    </div>
  );
}

/**
 * The count stays visible even at zero — "Discord tickets (0)" answers "did this customer ever
 * open one" without a second click. A delete drops the row here and decrements the count; the next
 * overlay open reloads it from the server anyway.
 */
function DiscordTicketsCard({ customer }: { customer: Customer360Customer }) {
  const [removed, setRemoved] = useState<number[]>([]);
  const tickets = (customer.discord_tickets ?? []).filter((row) => !removed.includes(row.id));
  const total = Math.max(0, (customer.discord_tickets_total ?? tickets.length) - removed.length);
  return (
    <section className="customer360-card">
      <SectionHeading icon={<Ticket />} title="Discord tickets" count={total} />
      <DiscordTicketList
        tickets={tickets}
        onDeleted={(id) => setRemoved((current) => [...current, id])}
      />
    </section>
  );
}

function FeedbackReport({ item, index }: { item: Customer360Feedback; index: number }) {
  return (
    <article className="customer360-feedback">
      <div className="customer360-card-title">
        <div>
          <strong>{item.report_id ?? `Feedback ${index + 1}`}</strong>
          <small>{item.created_at ? formatDate(item.created_at) : "Time unknown"}</small>
        </div>
        <div className="customer360-card-badges">
          {item.kind ? (
            <Badge tone={FEEDBACK_KIND_BADGE[item.kind].tone}>
              {FEEDBACK_KIND_BADGE[item.kind].label}
            </Badge>
          ) : null}
          <Badge tone={statusTone(item.status)}>{item.status ?? "Unknown status"}</Badge>
        </div>
      </div>
      <p>{item.message ?? "No message body."}</p>
      <div className="customer360-priority-meta">
        {item.category ? <span>{humanKey(item.category)}</span> : null}
        {item.diagnostics ? <span>Diagnostics attached</span> : null}
      </div>
      <details className="customer360-inline-details">
        <summary>Report details</summary>
        <InfoGrid
          items={[
            { label: "Category", value: item.category },
            { label: "Contact", value: item.contact },
            { label: "Authentication", value: item.auth_mode },
            { label: "Verified install", value: item.verified_install_id, mono: true },
            { label: "Diagnostics", value: item.diagnostics?.report_id },
          ]}
        />
        <RecordDetails record={item} />
      </details>
    </article>
  );
}

function FeedbackTab({ customer }: { customer: Customer360Customer }) {
  const { openReports, reportsUnavailable } = getCustomer360Overview(customer);
  const archived = customer.feedback.filter((item) => item.status?.toLowerCase() === "archived");
  const otherReports = customer.feedback.filter(
    (item) => !["new", "read", "archived"].includes(item.status?.toLowerCase() ?? ""),
  );
  return (
    <div className="customer360-stack">
      <SectionErrors customer={customer} names={["feedback"]} />
      <section className="customer360-card">
        <SectionHeading
          icon={<MessageSquareText />}
          title="Open in-app reports"
          count={reportsUnavailable ? undefined : openReports.length}
        />
        <p className="customer360-caption customer360-caption-lead">
          New and read reports stay open until archived. Reading a report does not resolve it.
        </p>
        {openReports.length ? (
          <div className="customer360-feedback-list">
            {openReports.map((item, index) => (
              <FeedbackReport
                key={String(item.report_id ?? item.id ?? index)}
                item={item}
                index={index}
              />
            ))}
          </div>
        ) : (
          <p className="customer360-empty">
            {reportsUnavailable
              ? "A complete open-report count is unavailable."
              : "No open in-app reports."}
          </p>
        )}
        {otherReports.length ? (
          <div className="customer360-feedback-list">
            <p className="customer360-caption">Reports with an unrecognized status</p>
            {otherReports.map((item, index) => (
              <FeedbackReport
                key={String(item.report_id ?? item.id ?? index)}
                item={item}
                index={index}
              />
            ))}
          </div>
        ) : null}
        {archived.length ? (
          <details className="customer360-support-archive">
            <summary>
              <span>Archived reports</span>
              <Badge tone="muted">{archived.length}</Badge>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className="customer360-feedback-list">
              {archived.map((item, index) => (
                <FeedbackReport
                  key={String(item.report_id ?? item.id ?? index)}
                  item={item}
                  index={index}
                />
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </div>
  );
}

function SessionsTab({ customer }: { customer: Customer360Customer }) {
  return (
    <div className="customer360-stack">
      <SectionErrors customer={customer} names={["installs", "sessions"]} />
      <div className="customer360-two-col">
        <section className="customer360-card">
          <SectionHeading
            icon={<PackageCheck />}
            title="Registered installs"
            count={customer.installs.length}
          />
          <RecordList
            rows={customer.installs}
            empty="No registered installs found."
            label={(row, index) => displayValue(row.installId ?? `Install ${index + 1}`)}
            meta={(row) => (
              <>
                {displayValue(row.appVersion)} ·{" "}
                {row.lastSeenAt ? <RelativeTime iso={String(row.lastSeenAt)} /> : "never seen"}
              </>
            )}
            badge={(row) => (row.revokedAt ? "revoked" : "active")}
          />
        </section>
        <section className="customer360-card">
          <SectionHeading icon={<Laptop />} title="Sessions" count={customer.sessions.length} />
          <RecordList
            rows={customer.sessions}
            empty="No sessions found."
            label={(row, index) => displayValue(row.id ?? `Session ${index + 1}`)}
            meta={(row) => (
              <>
                {displayValue(row.displayVersion ?? row.appVersion)} ·{" "}
                {row.lastSeenAt ? <RelativeTime iso={String(row.lastSeenAt)} /> : "time unknown"}
              </>
            )}
            badge={(row) => (Boolean(row.isActive) ? "online" : String(row.lastStatus ?? "ended"))}
          />
        </section>
      </div>
    </div>
  );
}

function SessionFallback({ session }: { session: AppSessionRecord }) {
  return (
    <section className="customer360-card">
      <SectionHeading icon={<Laptop />} title="Session snapshot still available" />
      <InfoGrid
        items={[
          { label: "Session ID", value: session.id, mono: true },
          { label: "Install ID", value: session.installId, mono: true },
          { label: "Hardware ID", value: session.hwid, mono: true },
          { label: "User label", value: session.userLabel },
          { label: "App", value: session.displayVersion ?? session.appVersion },
          { label: "OS", value: session.osVersion },
          { label: "Last seen", value: formatDate(session.lastSeenAt) },
          { label: "Last event", value: formatEventName(session.lastEvent) },
        ]}
      />
    </section>
  );
}

export function Customer360View({
  session,
  anchor = null,
  open,
  onClose,
  handoff,
}: Customer360OverlayProps) {
  const [customer, setCustomer] = useState<Customer360Customer | null>(null);
  const canReadLicenses = usePanelPermission("licenses.read");
  const canMonitor = usePanelPermission("monitoring.read");
  const canReadSupport = usePanelPermission("support.read");
  const visibleTabs = TABS.filter(
    (tab) =>
      tab.key === "summary" ||
      (tab.key === "commerce" && canReadLicenses) ||
      (tab.key === "sessions" && canMonitor) ||
      (tab.key === "activity" && canReadSupport),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  // The workspace is its own scroll container, so the sticky bar compacts itself
  // from the container's scroll position rather than the window's.
  const workspaceRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const findProfile = useCustomerProfiles();
  const accountProfile = findProfile(customer?.anchor.install_id, customer?.anchor.hwid);
  useEffect(() => {
    if (open) (document.querySelector(".customer-workspace h1") as HTMLElement | null)?.focus();
  }, [open, customer?.anchor.identity]);

  // Escape belongs to the workspace, not to whatever happens to hold focus: a
  // window listener answers it from anywhere on the page, and steps aside while
  // a dialog is open on top (which owns Escape itself — see ds/Modal).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[data-modal-root="true"][data-state="open"]')) return;
      // …but not when focus is somewhere else entirely. The topbar search stays
      // reachable above the workspace, and Escape there clears the field — it
      // must not tear the whole record down instead. Nothing focused (body) is
      // still the workspace's, which is the case the window listener is for.
      const root = workspaceRef.current;
      const focused = document.activeElement;
      if (root && focused && focused !== document.body && !root.contains(focused)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // "Manage licenses" swaps this workspace for the Licenses page. Load that
  // page's code while the workspace is open, so the swap lands on the page
  // itself instead of an empty screen with only a spinner over the background
  // while the chunk downloads.
  useEffect(() => {
    if (open && canReadLicenses) void import("../pages/LicensesPage");
  }, [open, canReadLicenses]);

  // Compact the sticky bar as soon as the workspace scrolls under it.
  useEffect(() => {
    const element = workspaceRef.current;
    if (!open || !element) return;
    const update = () => setScrolled(element.scrollTop > 4);
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, [open]);
  const requestSeq = useRef(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selector: Customer360Selector | null = session ? "session_id" : (anchor?.selector ?? null);
  const value = session?.id ?? anchor?.value?.trim() ?? "";

  useEffect(() => {
    if (!open || !selector || !value) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setCustomer(null);
    setCopied(false);
    void fetchCustomer360(selector, value)
      .then((result) => {
        if (requestSeq.current !== seq) return;
        if (result.ok && result.data?.customer) {
          setCustomer(result.data.customer);
        } else {
          setError(result.data?.error ?? `Could not load Customer 360 (HTTP ${result.status}).`);
        }
      })
      .catch((reason: unknown) => {
        if (requestSeq.current === seq)
          setError(reason instanceof Error ? reason.message : "Could not load Customer 360.");
      })
      .finally(() => {
        if (requestSeq.current === seq) setLoading(false);
      });
    return () => {
      if (requestSeq.current === seq) requestSeq.current += 1;
    };
  }, [open, selector, value, reloadKey]);

  useRefreshSignal(() => {
    if (!open || !selector || !value || loading) return;
    const seq = ++requestSeq.current;
    void fetchCustomer360(selector, value)
      .then((result) => {
        if (seq === requestSeq.current && result.ok && result.data?.customer) {
          setCustomer(result.data.customer);
          setError(null);
        }
      })
      .catch(() => {
        /* Keep the current customer visible until the next refresh. */
      });
  });

  useEffect(() => {
    if (open) {
      const saved = new URLSearchParams(location.search).get("customerTab");
      setActiveTab(visibleTabs.find((tab) => tab.key === saved)?.key ?? "summary");
    }
  }, [open, selector, value]);

  function openSection(key: TabKey) {
    const index = visibleTabs.findIndex((tab) => tab.key === key);
    if (index < 0) return;
    setActiveTab(key);
    window.requestAnimationFrame(() => tabRefs.current[index]?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % visibleTabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + visibleTabs.length) % visibleTabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = visibleTabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(visibleTabs[next].key);
    tabRefs.current[next]?.focus();
  }

  async function copyAllFields() {
    if (!customer) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(customer, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  // Tabs precede contact details in DOM order, so phone navigation stays reachable.
  // The desktop grid keeps the compact identity rail beside the active record.
  const body = customer ? (
    <div className="customer360-layout">
      <div className="customer360-tabs" role="tablist" aria-label="Customer information sections">
        {visibleTabs.map((tab, index) => (
          <button
            key={tab.key}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-label={tab.label}
            id={`customer360-tab-${tab.key}`}
            aria-selected={activeTab === tab.key}
            aria-controls={`customer360-panel-${tab.key}`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            className={activeTab === tab.key ? "active" : undefined}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {tab.icon}
            <span className="customer360-tab-label">{tab.label}</span>
            <span className="customer360-tab-short" aria-hidden="true">
              {tab.shortLabel}
            </span>
          </button>
        ))}
      </div>
      <aside className="customer360-side" aria-label="Customer summary">
        <SectionErrors customer={customer} names={["profile", "summary"]} />
        <IdentityCard
          customer={customer}
          linkedAccount={accountProfile ? `@${accountProfile.discordUsername}` : null}
          onRawData={() => setRawOpen(true)}
        />
        <details className="customer360-usage-details">
          <summary>
            <span>Devices &amp; usage</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <KeyFigures customer={customer} />
        </details>
      </aside>
      <div className="customer360-main">
        <div
          className="customer360-content"
          role="tabpanel"
          id={`customer360-panel-${activeTab}`}
          aria-labelledby={`customer360-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === "summary" ? (
            <Customer360Overview customer={customer} onOpenSection={openSection} />
          ) : null}
          {activeTab === "activity" ? (
            <>
              <FeedbackTab customer={customer} />
              <details className="customer-advanced">
                <summary>Session activity &amp; errors</summary>
                <ActivityTab customer={customer} />
              </details>
              <details className="customer-advanced">
                <summary>Diagnostics</summary>
                <DiagnosticReport report={customer.diagnostics} />
              </details>
            </>
          ) : null}
          {activeTab === "commerce" ? <CommerceTab customer={customer} /> : null}
          {activeTab === "sessions" ? (
            <>
              <SessionsTab customer={customer} />
              <EnvironmentSummary customer={customer} />
              <details className="customer-advanced">
                <summary>App settings & features</summary>
                <SettingsTab customer={customer} />
              </details>
            </>
          ) : null}
        </div>
      </div>
    </div>
  ) : (
    <div className="customer360-content customer360-load-state">
      {loading ? (
        <>
          <div className="spinner" />
          <strong>Connecting customer, license, device, and support records…</strong>
          <span>Each section will remain usable if another data source is unavailable.</span>
        </>
      ) : null}
      {error ? (
        <>
          <div className="customer360-callout customer360-callout-danger" role="alert">
            <AlertTriangle />
            <div>
              <strong>Customer 360 could not be loaded</strong>
              <p>{error}</p>
            </div>
          </div>
          {session ? <SessionFallback session={session} /> : null}
          <Button icon={<RefreshCw />} onClick={() => setReloadKey((value) => value + 1)}>
            Try again
          </Button>
        </>
      ) : null}
    </div>
  );

  function openCustomerAction() {
    const value = customer?.anchor.hwid ?? customer?.anchor.identity ?? "";
    setWorkspaceSearch("licenses", value);
    // The workspace entry remembers the open tab, and Licenses is pushed ON TOP
    // of it instead of replacing it: navigateCustomerUrl closes the workspace as
    // a navigation (useHistoryLayer's "navigate", no step back), and Back from
    // Licenses lands on the workspace entry again, which reopens this customer.
    const here = new URL(location.href);
    here.searchParams.set("customerTab", activeTab);
    history.replaceState(history.state, "", here);
    window.dispatchEvent(new Event("rr:customer-handoff"));
    navigateCustomerUrl(customerActionUrl(here, activeTab));
  }
  return (
    <section
      className={`customer-workspace customer-glass${handoff === "fade" ? " is-leaving" : ""}`}
      aria-label="Customer 360"
      aria-hidden={handoff ? true : undefined}
      inert={Boolean(handoff)}
      ref={workspaceRef}
    >
      <PanelBackground />
      {/* Identity and the customer's actions stay reachable while the record
            scrolls: one sticky bar that compacts once the content moves under it. */}
      <div className={`customer-workspace-bar${scrolled ? " is-stuck" : ""}`}>
        <header className="customer-workspace-head">
          <Button className="customer-back" icon={<ArrowLeft />} onClick={onClose}>
            Back to workspace
          </Button>
          <div className="customer-heading-identity">
            <CustomerAvatar
              profile={accountProfile}
              label={accountProfile?.displayName ?? titleFor(customer, session, anchor)}
            />
            <div>
              <h1 tabIndex={-1}>
                {accountProfile?.displayName ?? titleFor(customer, session, anchor)}
              </h1>
              <div className="customer360-heading-meta">
                {/* The one name the directory's card head and row action open it under. */}
                <span>Customer 360</span>
                {customer ? (
                  <Badge tone={customer.summary.is_active ? "success" : "muted"}>
                    {customer.summary.is_active ? "Online" : "Offline"}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </header>
        {customer && (
          <div className="customer-action-bar">
            <Button permission="licenses.read" icon={<KeyRound />} onClick={openCustomerAction}>
              Manage licenses
            </Button>
            <Button
              permission="access.read"
              icon={<ShieldCheck />}
              onClick={() => setAccessOpen(true)}
            >
              Manage app access
            </Button>
            <Button
              permission="support.read"
              icon={<MessageSquareText />}
              onClick={() => openSection("activity")}
            >
              Support history
            </Button>
          </div>
        )}
      </div>
      <div className="customer360-shell">{body}</div>
      {customer ? (
        <Modal
          open={rawOpen}
          onClose={() => setRawOpen(false)}
          title="Raw data"
          sub="The complete Customer 360 record, exactly as the API returned it."
          className="customer360-raw-dialog"
          initialFocus="close"
        >
          {rawOpen ? (
            <pre className="customer360-json">{JSON.stringify(customer, null, 2)}</pre>
          ) : null}
          <ModalActions>
            <Button variant="ghost" onClick={() => setRawOpen(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void copyAllFields()}>
              {copied ? "Copied" : "Copy JSON"}
            </Button>
          </ModalActions>
        </Modal>
      ) : null}
      {accessOpen && customer && (
        <CustomerAccessDialog
          target={{
            identity: customer.anchor.identity,
            hwid: customer.anchor.hwid,
            install_id: customer.anchor.install_id,
            label:
              customer.profile.user_label ??
              customer.profile.customer_name ??
              customer.anchor.identity,
            paid: customer.summary.license_tier === "premium",
          }}
          onClose={() => setAccessOpen(false)}
        />
      )}
    </section>
  );
}

/** Every old entry point opens the same addressable customer workspace. */
export function Customer360Overlay({ open, session, anchor, onClose }: Customer360OverlayProps) {
  useEffect(() => {
    if (!open) return;
    const target = anchor ?? (session ? { selector: "session_id", value: session.id } : null);
    if (target) openCustomerWorkspace(target);
    onClose();
  }, [open, anchor?.value, session?.id]);
  return null;
}
