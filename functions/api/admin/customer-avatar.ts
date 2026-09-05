import { requireDashboardAccess } from "../../_lib/admin";
import { ensureCustomerAccounts, type CustomerAccount } from "../../_lib/customer-accounts";
import { error } from "../../_lib/http";
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
  const id = new URL(context.request.url).searchParams.get("id");
  if (!id || !/^[a-f0-9-]{36}$/.test(id)) return error(400, "Invalid account.");
  const account = await db
    .prepare("SELECT * FROM customer_accounts WHERE id=?")
    .bind(id)
    .first<CustomerAccount>();
  if (!account) return error(404, "Image not found.");
  const image = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    account.avatar_data ?? "",
  );
  if (image) {
    return new Response(
      Uint8Array.from(atob(image[2]), (char) => char.charCodeAt(0)),
      {
        headers: {
          "Content-Type": image[1],
          "Cache-Control": "private, no-cache",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
          "Content-Disposition": "inline",
        },
      },
    );
  }
  if (
    account.discord_avatar &&
    /^https:\/\/cdn\.discordapp\.com\/avatars\/\d+\/(a_)?[a-f0-9]{32}\.png\?size=256$/.test(
      account.discord_avatar,
    )
  )
    return new Response(null, {
      status: 302,
      headers: {
        Location: account.discord_avatar,
        "Cache-Control": "private, no-cache",
        "Referrer-Policy": "no-referrer",
      },
    });
  return error(404, "Image not found.");
}
