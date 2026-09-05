import { requireDashboardAccess } from "../../_lib/admin";
import {
  accountProfile,
  ensureCustomerAccounts,
  type CustomerAccount,
} from "../../_lib/customer-accounts";
import { error, json } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";
export async function onRequestGet(context: {
  request: Request;
  env: RuntimeEnv;
}): Promise<Response> {
  const access = await requireDashboardAccess(context.request, context.env);
  if (!access.ok) return access.response;
  const db = context.env.DB;
  if (!db) return error(503, "Profiles are unavailable.");
  await ensureCustomerAccounts(db);
  const rows = await db
    .prepare(
      `SELECT a.*,d.install_id,i.hwid FROM customer_accounts a
    JOIN customer_account_devices d ON d.account_id=a.id JOIN installs i ON i.install_id=d.install_id
    ORDER BY d.linked_at DESC`,
    )
    .all<CustomerAccount & { install_id: string; hwid: string | null }>();
  return json(
    {
      ok: true,
      profiles: rows.results.map((row) => ({
        ...accountProfile(row, true),
        installId: row.install_id,
        hwid: row.hwid,
      })),
    },
    200,
    { "Cache-Control": "no-store" },
  );
}
