import {
  discordExchangeCode,
  discordGetUser,
  discordDisplayTag,
  discordJoinGuildWithRole,
  resolveLicenseForVerification,
  upsertDiscordLink,
  verifyHtmlPage,
  verifyReasonMessage,
  verifyState,
} from "../../_lib/discord";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Stage-2 OAuth callback. Discord redirects here with ?code&state. We verify the state (which
 * carries the pre-validated license key), exchange the code, re-validate the license, then add the
 * user to the guild already wearing the Verified role via guilds.join — no shareable invite. The
 * link is recorded so the bot's reconcile can later strip the role if the license lapses. Public
 * (Access-bypassed) path.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  const env = context.env;
  if (!env.VERIFY_SHARED_SECRET || !env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) {
    return verifyHtmlPage(false, "Not configured", "Discord verification is not fully set up on the server yet.");
  }

  const url = new URL(context.request.url);
  const denied = url.searchParams.get("error");
  if (denied) {
    return verifyHtmlPage(false, "Authorization cancelled", "You declined the Discord authorization. Nothing was changed.");
  }

  const code = (url.searchParams.get("code") ?? "").trim();
  const state = (url.searchParams.get("state") ?? "").trim();
  if (!code || !state) {
    return verifyHtmlPage(false, "Invalid request", "Missing authorization code. Start again from your verification link.");
  }

  const stateData = await verifyState(env.VERIFY_SHARED_SECRET, state);
  if (!stateData) {
    return verifyHtmlPage(false, "Link expired", "This verification link has expired. Please start again.");
  }

  const token = await discordExchangeCode(env, code);
  if (!token) {
    return verifyHtmlPage(false, "Discord error", "Could not complete Discord authorization. Please try again.");
  }

  const user = await discordGetUser(token.access_token);
  if (!user) {
    return verifyHtmlPage(false, "Discord error", "Could not read your Discord account. Please try again.");
  }

  // Re-validate WITH the resolved Discord id: catches a revoke/suspension that happened between
  // start and callback, and enforces the per-license seat limit against other Discord accounts.
  const licenseResult = await resolveLicenseForVerification(env, stateData.licenseKey, user.id);
  if (!licenseResult.ok || !licenseResult.license) {
    return verifyHtmlPage(false, "License not valid", verifyReasonMessage(licenseResult.reason));
  }

  const joined = await discordJoinGuildWithRole(env, user.id, token.access_token);

  await upsertDiscordLink(env, {
    discordId: user.id,
    discordTag: discordDisplayTag(user),
    licenseKey: licenseResult.license.license_key,
    hwid: licenseResult.license.hwid,
    source: "oauth",
  });

  if (!joined) {
    return verifyHtmlPage(
      true,
      "License verified",
      "Your license is verified and linked. If you weren't added automatically, join the server and you'll be granted access.",
    );
  }

  return verifyHtmlPage(true, "You're verified!", "Your Discord account is now verified and you've been granted access to the community.");
}
