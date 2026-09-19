import { loadUserActivity, type UserActivityPayload } from "../../_lib/activity";
import { requireAdminRole, requireDashboardAccess } from "../../_lib/admin";
import {
  asString,
  earliest,
  HWID_PATTERN,
  isActiveLicense,
  latestDate,
  loadAccess,
  loadDiscordLinks,
  loadErrors,
  loadFeedback,
  loadInstalls,
  loadLicenses,
  loadSessions,
  loadUsage,
  mapInstall,
  mapSession,
  parseObject,
  resolveAnchor,
  section,
  SIMPLE_ID_PATTERN,
  toBoolean,
  uniqueText,
  BACKGROUND_KIND,
  type CustomerSelector,
  type LicenseRow,
} from "../../_lib/customer-anchor";
import { listDiscordTickets, type DiscordTicketSummary } from "../../_lib/discord-tickets";
import { error, json } from "../../_lib/http";
import { ORDER_FIELD_LIMITS } from "../../_lib/licenses";
import { internalError } from "../../_lib/responses";
import { ensureTelemetrySchema } from "../../_lib/storage";
import type { RuntimeEnv } from "../../_lib/types";
import { INSTALL_ID_PATTERN } from "../../../shared/install-auth";

type HandlerContext = { request: Request; env: RuntimeEnv };

/** The selectors the panel offers; `discord_id` exists for the bot endpoints, not for this page. */
const SELECTORS: readonly CustomerSelector[] = [
  "session_id",
  "install_id",
  "hwid",
  "license_key",
  "order_id",
  "feedback_id",
];

export async function onRequestGet(context: HandlerContext): Promise<Response> {
  try {
    const access = await requireDashboardAccess(context.request, context.env);
    if (!access.ok) return access.response;
    const roleDenied = requireAdminRole(access.access);
    if (roleDenied) return roleDenied;

    const db = context.env.DB;
    if (!db) return error(500, "Database not available");

    const selector = readSelector(new URL(context.request.url));
    if (!selector.ok) return error(400, selector.message);
    const permits = (key: import("../../../shared/panel-policy").Permission) =>
      !access.access.user.permissions || access.access.user.permissions.includes(key);
    if (
      (selector.name === "license_key" || selector.name === "order_id") &&
      !permits("licenses.read")
    )
      return error(403, "License access is required for this lookup.");
    if (selector.name === "feedback_id" && !permits("support.read"))
      return error(403, "Support access is required for this lookup.");

    await ensureTelemetrySchema(db);
    const anchor = await resolveAnchor(context.env, selector.name, selector.value);
    if (!anchor) return error(404, "Customer anchor not found.");

    const sectionErrors: Record<string, string> = {};
    const sessions = await section(sectionErrors, "sessions", [], () => loadSessions(db, anchor));
    const installs = await section(sectionErrors, "installs", [], () => loadInstalls(db, anchor));
    const licenses = await section(sectionErrors, "licenses", [], () =>
      loadLicenses(db, anchor, installs),
    );

    if (
      anchor.confidence === "device_only" &&
      licenses.some((license) => isActiveLicense(license))
    ) {
      anchor.confidence = "linked_license";
    }
    if (
      licenses.some(
        (license) =>
          Boolean(license.order_id) &&
          Boolean(license.customer_email || license.customer_name || license.customer_discord),
      )
    ) {
      anchor.confidence = "verified_customer";
    }

    const licenseKeys = licenses.map((license) => license.license_key);
    const installIds = uniqueText([
      anchor.installId,
      ...installs.map((install) => install.install_id),
      ...sessions.map((session) => session.installId),
    ]);
    const feedback = await section(sectionErrors, "feedback", [], () =>
      loadFeedback(context.env, anchor, installIds, licenseKeys, sectionErrors),
    );
    const diagnostics = newestDiagnostics(feedback);
    const orders = buildOrders(licenses);
    const accessRows = await section(sectionErrors, "access", [], () =>
      loadAccess(context.env, anchor, installIds),
    );
    const discordLinks = await section(sectionErrors, "discord_links", [], () =>
      loadDiscordLinks(context.env, anchor.hwid, licenseKeys),
    );
    // Same query the Discord tickets endpoint runs, anchored on this customer's verified accounts.
    // An anchor with neither a license nor a link has no tickets — never fall through to the
    // unfiltered "newest 100 overall" list.
    const discordTickets = await section(
      sectionErrors,
      "discord_tickets",
      { total: 0, tickets: [] as DiscordTicketSummary[] },
      async () =>
        licenseKeys.length === 0 && discordLinks.length === 0
          ? { total: 0, tickets: [] }
          : listDiscordTickets(context.env, {
              licenseKey: licenseKeys,
              discordId: discordLinks.map((row) => String(row.discord_id ?? "")).filter(Boolean),
            }),
    );
    const usage = await section(sectionErrors, "usage", [], () => loadUsage(db, anchor.hwid));
    const errors = await section(sectionErrors, "errors", [], () => loadErrors(db, anchor));
    const activity = await section<UserActivityPayload | null>(
      sectionErrors,
      "activity",
      null,
      () => loadUserActivity(context.env, anchor.identity, null),
    );

    const latest = sessions[0] ?? (anchor.session ? mapSession(anchor.session) : null);
    const primaryLicense = pickPrimaryLicense(licenses, anchor.license);
    const newestFeedback = feedback[0] ?? null;
    const verifiedDiscord =
      discordLinks.find((row) => toBoolean(row.is_active))?.discord_tag ?? null;
    const firstSeen = earliest([
      ...sessions.map((row) => row.startedAt),
      ...installs.map((row) => row.created_at),
      ...licenses.map((row) => row.created_at),
      ...feedback.map((row) => asString(row.created_at)),
    ]);
    const lastSeen = latestDate([
      ...sessions.map((row) => row.lastSeenAt),
      ...installs.map((row) => row.last_seen_at),
      ...feedback.map((row) => asString(row.created_at)),
    ]);

    return json({
      ok: true,
      customer: {
        anchor: {
          requested_by: anchor.selector,
          requested_value: anchor.value,
          requested_session_id: anchor.requestedSessionId,
          identity: anchor.identity,
          hwid: anchor.hwid,
          install_id: anchor.installId,
          confidence: anchor.confidence,
        },
        profile: {
          user_label: latest?.userLabel ?? null,
          customer_name: primaryLicense?.customer_name ?? null,
          email: primaryLicense?.customer_email ?? null,
          discord: primaryLicense?.customer_discord ?? latest?.discordUser ?? null,
          verified_discord: verifiedDiscord,
          contact: permits("support.read") ? asString(newestFeedback?.contact) : null,
        },
        summary: {
          is_active: sessions.some((row) => row.isActive),
          license_tier: licenses.some(isActiveLicense) ? "premium" : "free",
          app_version: latest?.appVersion ?? installs[0]?.app_version ?? null,
          display_version: latest?.displayVersion ?? null,
          platform: latest?.platform ?? null,
          os_version: latest?.osVersion ?? null,
          device_model: latest?.deviceModel ?? null,
          country: latest?.clientCountry ?? null,
          city: latest?.clientCity ?? null,
          region: latest?.clientRegion ?? null,
          timezone: latest?.clientTimezone ?? null,
          last_ip: latest?.clientIp?.trim() || null,
          ip_count: new Set(
            sessions.map((row) => row.clientIp?.trim() ?? "").filter((ip) => ip.length > 0),
          ).size,
          first_seen: firstSeen,
          last_seen: lastSeen,
          total_sessions: sessions.length,
          total_duration_seconds: sessions.reduce(
            (sum, row) => sum + Math.max(0, row.durationSeconds ?? 0),
            0,
          ),
          // Real errors only: background faults stay listed under Errors, never counted.
          error_count: Math.max(
            errors.filter((row) => row.kind !== BACKGROUND_KIND).length,
            sessions.reduce((sum, row) => sum + Math.max(0, row.errorCount), 0),
          ),
        },
        settings: {
          rpc_enabled: latest?.rpcEnabled ?? null,
          features: parseObject(latest?.featuresJson),
        },
        diagnostics: permits("support.read") ? diagnostics : null,
        activity: permits("monitoring.read") && permits("support.read") ? activity : null,
        usage,
        orders: permits("licenses.read") ? orders : [],
        licenses: permits("licenses.read") ? licenses : [],
        access: permits("access.read") ? accessRows : [],
        discord_links: permits("licenses.read") ? discordLinks : [],
        // Count and rows travel together: the card shows "Discord tickets (N)" even when empty.
        discord_tickets: permits("support.read") ? discordTickets.tickets : [],
        discord_tickets_total: permits("support.read") ? discordTickets.total : 0,
        feedback: permits("support.read") ? feedback : [],
        errors: permits("support.read") ? errors : [],
        installs: permits("monitoring.read") ? installs.map(mapInstall) : [],
        sessions: permits("monitoring.read") ? sessions : [],
        section_errors: sectionErrors,
      },
    });
  } catch (cause) {
    return internalError(context.request, "Unable to load Customer 360.", cause);
  }
}

function readSelector(
  url: URL,
): { ok: true; name: CustomerSelector; value: string } | { ok: false; message: string } {
  const supplied = SELECTORS.flatMap((name) =>
    url.searchParams
      .getAll(name)
      .map((value) => ({ name, value: value.trim() }))
      .filter(({ value }) => value.length > 0),
  );
  if (supplied.length !== 1) {
    return { ok: false, message: `Exactly one selector is required: ${SELECTORS.join(", ")}.` };
  }
  const [{ name, value }] = supplied;
  if (!isValidSelectorValue(name, value)) {
    return { ok: false, message: `Invalid ${name} selector.` };
  }
  return { ok: true, name, value };
}

function isValidSelectorValue(name: CustomerSelector, value: string): boolean {
  if (name === "feedback_id") return /^\d{1,12}$/.test(value) && Number(value) > 0;
  if (name === "install_id") return INSTALL_ID_PATTERN.test(value);
  if (name === "hwid") return HWID_PATTERN.test(value);
  if (name === "order_id") {
    return value.length <= ORDER_FIELD_LIMITS.order_id && SIMPLE_ID_PATTERN.test(value);
  }
  return SIMPLE_ID_PATTERN.test(value);
}

function buildOrders(licenses: LicenseRow[]): Array<Record<string, unknown>> {
  const grouped = new Map<string, LicenseRow[]>();
  for (const license of licenses) {
    const orderId = license.order_id?.trim();
    if (!orderId) continue;
    const rows = grouped.get(orderId) ?? [];
    rows.push(license);
    grouped.set(orderId, rows);
  }
  return [...grouped.entries()].map(([orderId, rows]) => {
    const newest = rows[0];
    return {
      order_id: orderId,
      order_source: newest.order_source ?? null,
      purchased_at: newest.purchased_at ?? null,
      customer_name: newest.customer_name ?? null,
      customer_email: newest.customer_email ?? null,
      customer_discord: newest.customer_discord ?? null,
      order_note: newest.order_note ?? null,
      license_ids: rows.map((row) => Number(row.id)),
      license_count: rows.length,
    };
  });
}

function newestDiagnostics(
  feedback: Array<Record<string, unknown>>,
): Record<string, unknown> | null {
  for (const row of feedback) {
    const diagnostics = row.diagnostics;
    if (diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics)) {
      return diagnostics as Record<string, unknown>;
    }
  }
  return null;
}

function pickPrimaryLicense(
  licenses: LicenseRow[],
  requested: LicenseRow | null,
): LicenseRow | null {
  if (requested) {
    return licenses.find((row) => Number(row.id) === Number(requested.id)) ?? requested;
  }
  return licenses.find(isActiveLicense) ?? licenses[0] ?? null;
}
