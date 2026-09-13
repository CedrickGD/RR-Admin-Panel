import {
  Activity,
  ArrowLeft,
  AlertTriangle,
  Braces,
  KeyRound,
  Laptop,
  MessageSquareText,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  Customer360Customer,
  Customer360DatabaseRow,
  CustomerConfidence,
  Customer360Selector,
  DiagnosticBundle,
} from "../types/customer360";
import type { AppSessionRecord } from "../types/telemetry";
import { fetchCustomer360 } from "../utils/api";
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
import { RecordFacts, RecordSection } from "./ds/RecordSection";
import { RelativeTime } from "./ds/RelativeTime";
import { usePanelPermission } from "../hooks/usePanelPermission";
import { PanelBackground } from "./PanelBackground";
import { CustomerAvatar, useCustomerProfiles } from "./CustomerProfiles";
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

const TABS: Array<{ key: TabKey; label: string; icon: ReactNode }> = [
  { key: "summary", label: "Overview", icon: <UserRound /> },
  { key: "commerce", label: "Licenses & orders", icon: <KeyRound /> },
  { key: "sessions", label: "Devices & sessions", icon: <Laptop /> },
  { key: "activity", label: "Support & history", icon: <Activity /> },
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
}: {
  rows: object[];
  empty: string;
  label: (row: Customer360DatabaseRow, index: number) => string;
  meta?: (row: Customer360DatabaseRow) => ReactNode;
  badge?: (row: Customer360DatabaseRow) => string | null;
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
              {badgeValue ? <Badge tone={statusTone(badgeValue)}>{badgeValue}</Badge> : null}
            </summary>
            <RecordDetails record={raw} />
          </details>
        );
      })}
    </div>
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

function reportedValue(value: string | null | undefined): ReactNode {
  return value?.trim() ? value : <span className="customer-record-missing">Not reported</span>;
}

/** The Overview tab. Identity and access remain visible alongside every section. */
function SummaryTab({
  customer,
  showActivity,
  onOpenHistory,
}: {
  customer: Customer360Customer;
  showActivity: boolean;
  onOpenHistory: () => void;
}) {
  const { summary } = customer;
  return (
    <div className="customer-record-overview">
      <div className="customer-record-environment">
        <RecordSection
          title="App & device"
          description="Latest reported environment"
          className="customer-record-app-device"
        >
          <RecordFacts
            items={[
              {
                label: "App version",
                value: reportedValue(summary.display_version ?? summary.app_version),
              },
              { label: "Platform", value: reportedValue(summary.platform) },
              { label: "Operating system", value: reportedValue(summary.os_version) },
              { label: "Device", value: reportedValue(summary.device_model) },
            ]}
          />
        </RecordSection>
        <RecordSection title="Location & activity" className="customer-record-location-activity">
          <RecordFacts
            items={[
              {
                label: "Country",
                value: reportedValue(resolveCountry(summary.country)?.label ?? summary.country),
              },
              {
                label: "City / region",
                value: reportedValue([summary.city, summary.region].filter(Boolean).join(", ")),
              },
              { label: "Timezone", value: reportedValue(summary.timezone) },
              {
                label: "First seen",
                value: reportedValue(summary.first_seen ? formatDate(summary.first_seen) : null),
              },
              {
                label: "Last seen",
                value: summary.last_seen ? (
                  <span title={formatDate(summary.last_seen)}>{timeAgo(summary.last_seen)}</span>
                ) : (
                  reportedValue(null)
                ),
              },
            ]}
          />
        </RecordSection>
      </div>
      {showActivity ? <RecentActivity customer={customer} onOpenHistory={onOpenHistory} /> : null}
    </div>
  );
}

function RecentActivity({
  customer,
  onOpenHistory,
}: {
  customer: Customer360Customer;
  onOpenHistory: () => void;
}) {
  const activity = customer.activity;
  const reported = (activity && !activity.legacyOnly ? activity.days : [])
    .filter(
      (day) =>
        /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
        Number.isFinite(Date.parse(`${day.date}T00:00:00Z`)) &&
        Number.isFinite(day.seconds) &&
        day.seconds >= 0,
    )
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date));
  const lastDay = reported[reported.length - 1];
  const byDate = new Map(reported.map((day) => [day.date, day]));
  const days = lastDay
    ? Array.from({ length: 14 }, (_, index) => {
        const date = new Date(Date.parse(`${lastDay.date}T00:00:00Z`) - (13 - index) * 86_400_000)
          .toISOString()
          .slice(0, 10);
        return { date, report: byDate.get(date) ?? null };
      })
    : [];
  const maxSeconds = Math.max(0, ...days.map((day) => day.report?.seconds ?? 0));
  const reportedDays = days.filter((day) => day.report !== null);
  const seconds = reportedDays.reduce((total, day) => total + day.report!.seconds, 0);
  const sessions = reportedDays.reduce((total, day) => total + day.report!.sessions, 0);

  return (
    <RecordSection
      title="Recorded activity"
      description={
        lastDay ? "Daily use across 14 calendar days" : "Daily use from recorded sessions"
      }
      className="customer-record-activity"
      action={
        <Button size="sm" permission="support.read" onClick={onOpenHistory}>
          Full history
        </Button>
      }
    >
      <SectionErrors customer={customer} names={["activity"]} />
      {lastDay && activity ? (
        <>
          <RecordFacts
            className="customer-record-activity-facts"
            items={[
              { label: "Recorded use in this window", value: formatDuration(seconds) },
              { label: "Sessions", value: formatNumber(sessions) },
              { label: "Days reported", value: `${reportedDays.length} of ${days.length}` },
            ]}
          />
          <figure className="customer-record-activity-chart">
            <div className="customer-record-activity-scale" aria-hidden="true">
              <span>Daily recorded use</span>
              <span>{formatDuration(maxSeconds)}</span>
            </div>
            <ol
              className="customer-record-activity-bars"
              aria-label="Recorded use by calendar date"
            >
              {days.map(({ date, report }) => {
                const label = report
                  ? `${date}: ${formatDuration(report.seconds)} recorded, ${formatNumber(report.sessions)} sessions`
                  : `${date}: Not reported`;
                return (
                  <li key={date} title={label} aria-label={label}>
                    <div
                      className={`customer-record-activity-track${report ? "" : " is-missing"}`}
                      aria-hidden="true"
                    >
                      {report ? (
                        <span
                          className="customer-record-activity-bar"
                          style={{
                            height: `${maxSeconds > 0 ? (report.seconds / maxSeconds) * 100 : 0}%`,
                          }}
                        />
                      ) : (
                        <span className="customer-record-activity-missing">-</span>
                      )}
                    </div>
                    <span className="customer-record-activity-day" aria-hidden="true">
                      {date.slice(8)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <figcaption className="customer-record-activity-caption">
              <span>
                {days[0].date} to {lastDay.date}
              </span>
              <span>{activity.timezone}</span>
            </figcaption>
          </figure>
          {reportedDays.length < days.length ||
          !activity.intervalsComplete ||
          activity.legacyOnly ? (
            <p className="customer-record-activity-note">
              {reportedDays.length < days.length
                ? "Days marked with a dash were not reported; they are not counted as zero use. "
                : ""}
              {!activity.intervalsComplete || activity.legacyOnly
                ? "Some session history is incomplete. Totals reflect the daily records available."
                : ""}
            </p>
          ) : null}
        </>
      ) : (
        <p className="customer360-empty">
          {activity?.legacyOnly
            ? "Daily activity is unavailable for these older sessions."
            : "No daily activity has been reported for this customer."}
        </p>
      )}
    </RecordSection>
  );
}

function AppAccessSummary({
  customer,
  onManageAccess,
}: {
  customer: Customer360Customer;
  onManageAccess: () => void;
}) {
  const canReadAccess = usePanelPermission("access.read");
  if (!canReadAccess) return null;
  const incomplete = Boolean(customer.section_errors.access);
  const currentRules = customer.access.filter(
    (row) =>
      Number(row.is_active) === 1 &&
      (!row.banned_until || Date.parse(String(row.banned_until)) > Date.now()),
  );
  // Match enforcement: a permanent restriction wins, otherwise the latest expiry.
  const rule = currentRules.sort((left, right) => {
    if (!left.banned_until && right.banned_until) return -1;
    if (left.banned_until && !right.banned_until) return 1;
    if (!left.banned_until && !right.banned_until) return 0;
    return String(left.banned_until) > String(right.banned_until) ? -1 : 1;
  })[0];
  const label = incomplete
    ? "Status unavailable"
    : rule
      ? rule.mode === "ban"
        ? "Banned"
        : "Suspended"
      : "No active restriction";
  const tone: BadgeProps["tone"] = incomplete
    ? "muted"
    : rule
      ? rule.mode === "ban"
        ? "danger"
        : "warning"
      : "success";
  return (
    <RecordSection
      title="App access"
      className="customer-record-access"
      action={
        <Button size="sm" permission="access.read" onClick={onManageAccess}>
          Manage
        </Button>
      }
    >
      <div
        className="customer-record-access-state"
        data-state={incomplete ? "unknown" : rule ? "restricted" : "clear"}
      >
        <Badge tone={tone}>{label}</Badge>
      </div>
      <SectionErrors customer={customer} names={["access"]} />
      {!incomplete && rule?.reason ? (
        <p className="customer-record-access-reason">{displayValue(rule.reason)}</p>
      ) : null}
      {!incomplete && rule ? (
        <p className="customer360-caption">
          {rule.banned_until ? `Until ${formatDate(String(rule.banned_until))}` : "No expiry"}
        </p>
      ) : null}
    </RecordSection>
  );
}

/** Compact context for the customer, visible across every tab. */
function KeyFigures({ customer }: { customer: Customer360Customer }) {
  const { summary } = customer;
  return (
    <RecordSection title="Usage snapshot" className="customer-record-usage">
      <dl className="customer360-figures">
        <div>
          <dt>License</dt>
          <dd>{summary.license_tier || "Unknown"}</dd>
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
    </RecordSection>
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
  const { profile, summary, anchor } = customer;
  const facts = [
    { label: "Customer", value: profile.customer_name },
    { label: "App label", value: profile.user_label },
    { label: "Email", value: profile.email },
    { label: "Discord", value: profile.discord },
    { label: "Linked account", value: linkedAccount },
    { label: "Verified Discord", value: profile.verified_discord },
    { label: "Contact", value: profile.contact },
  ].filter((fact) => fact.value !== null && fact.value !== undefined && fact.value !== "");
  const requestedBy = String(anchor.requested_by ?? "");
  return (
    <section className="customer360-card customer-record-identity">
      <div className="customer360-card-head">
        <SectionHeading icon={<UserRound />} title="Identity" />
        <Button size="sm" icon={<Braces />} onClick={onRawData}>
          Raw data
        </Button>
      </div>
      <div className="customer360-badges">
        <Badge tone={summary.is_active ? "success" : "muted"}>
          {summary.is_active ? "Online" : "Offline"}
        </Badge>
        <Badge tone={confidenceTone(anchor.confidence)}>{confidenceLabel(anchor.confidence)}</Badge>
      </div>
      {facts.length > 0 ? (
        <dl className="customer360-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{displayValue(fact.value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
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
      <section className="customer360-card">
        <SectionHeading icon={<AlertTriangle />} title="Errors" count={customer.errors.length} />
        <RecordList
          rows={customer.errors}
          empty="No errors are linked to this customer."
          label={(row, index) => displayValue(row.message ?? row.type ?? `Error ${index + 1}`)}
          meta={(row) =>
            `${displayValue(row.type ?? row.kind)} · ${row.timestamp ? formatDate(String(row.timestamp)) : "time unknown"}`
          }
          badge={(row) => String(row.kind ?? "error")}
        />
      </section>
    </div>
  );
}

function CommerceTab({ customer }: { customer: Customer360Customer }) {
  return (
    <div className="customer360-stack">
      <SectionErrors
        customer={customer}
        names={["licenses", "orders", "access", "discord_links", "usage"]}
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
      </div>
    </div>
  );
}

function FeedbackTab({ customer }: { customer: Customer360Customer }) {
  return (
    <div className="customer360-stack">
      <SectionErrors customer={customer} names={["feedback"]} />
      <section className="customer360-card">
        <SectionHeading
          icon={<MessageSquareText />}
          title="In-app reports"
          count={customer.feedback.length}
        />
        {customer.feedback.length === 0 ? (
          <p className="customer360-empty">This customer has not sent in-app feedback.</p>
        ) : (
          <div className="customer360-feedback-list">
            {customer.feedback.map((item, index) => (
              <article
                className="customer360-feedback"
                key={String(item.report_id ?? item.id ?? index)}
              >
                <div className="customer360-card-title">
                  <div>
                    <strong>{item.report_id ?? `Feedback ${index + 1}`}</strong>
                    <small>{item.created_at ? formatDate(item.created_at) : "Time unknown"}</small>
                  </div>
                  <Badge tone={statusTone(item.status)}>
                    {item.status ?? item.category ?? "submitted"}
                  </Badge>
                </div>
                <p>{item.message ?? "No message body."}</p>
                <InfoGrid
                  items={[
                    { label: "Category", value: item.category },
                    { label: "Contact", value: item.contact },
                    { label: "Authentication", value: item.auth_mode },
                    { label: "Verified install", value: item.verified_install_id, mono: true },
                    { label: "Diagnostics", value: item.diagnostics?.report_id },
                  ]}
                />
                <details className="customer360-inline-details">
                  <summary>All feedback fields</summary>
                  <RecordDetails record={item} />
                </details>
              </article>
            ))}
          </div>
        )}
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

  // Two columns from 1100px (theme/css/components.css): who the customer is and
  // the key figures on the left, the tabbed record on the right. One column
  // below, left column first.
  const body = customer ? (
    <div className="customer360-layout">
      <aside className="customer360-side customer-record-summary" aria-label="Customer summary">
        <SectionErrors customer={customer} names={["profile", "summary"]} />
        <IdentityCard
          customer={customer}
          linkedAccount={accountProfile ? `@${accountProfile.discordUsername}` : null}
          onRawData={() => setRawOpen(true)}
        />
        <AppAccessSummary customer={customer} onManageAccess={() => setAccessOpen(true)} />
        <KeyFigures customer={customer} />
      </aside>
      <div className="customer360-main customer-record-content">
        <div className="customer360-tabs" role="tablist" aria-label="Customer information sections">
          {visibleTabs.map((tab, index) => (
            <button
              key={tab.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`customer360-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`customer360-panel-${tab.key}`}
              tabIndex={activeTab === tab.key ? 0 : -1}
              className={activeTab === tab.key ? "active" : undefined}
              onClick={() => setActiveTab(tab.key)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div
          className="customer360-content"
          role="tabpanel"
          id={`customer360-panel-${activeTab}`}
          aria-labelledby={`customer360-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === "summary" ? (
            <SummaryTab
              customer={customer}
              showActivity={canReadSupport}
              onOpenHistory={() => setActiveTab("activity")}
            />
          ) : null}
          {activeTab === "activity" ? (
            <>
              <FeedbackTab customer={customer} />
              <ActivityTab customer={customer} />
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
      className={`customer-workspace customer-record-workspace${handoff === "fade" ? " is-leaving" : ""}`}
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
            {accountProfile && (
              <CustomerAvatar profile={accountProfile} label={accountProfile.displayName} />
            )}
            <div>
              <h1 tabIndex={-1}>
                {accountProfile?.displayName ?? titleFor(customer, session, anchor)}
              </h1>
              <p>Customer workspace · 360</p>
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
              onClick={() => setActiveTab("activity")}
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
