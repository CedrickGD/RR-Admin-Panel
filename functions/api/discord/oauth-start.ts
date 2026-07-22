import { resolveLicenseForVerification, signState, verifyHtmlPage, verifyReasonMessage } from "../../_lib/discord";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

/**
 * Stage-2 OAuth entry point. The customer opens `…/api/discord/oauth-start?key=THEIR-LICENSE`.
 * We validate the license up front (so an invalid key never even reaches Discord), sign it into a
 * short-lived state token, and redirect to Discord's consent screen with the `guilds.join` scope.
 * Public (Access-bypassed) path.
 */
export async function onRequestGet(context: HandlerContext): Promise<Response> {
  const env = context.env;
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_REDIRECT_URI || !env.VERIFY_SHARED_SECRET) {
    return verifyHtmlPage(false, "Not configured", "Discord verification is not set up on the server yet.");
  }

  const url = new URL(context.request.url);
  const licenseKey = (url.searchParams.get("key") ?? "").trim();
  if (!licenseKey) {
    return verifyHtmlPage(false, "Missing license key", "Open this link with your license key, e.g. ?key=XXXX-XXXX-XXXX-XXXX.");
  }

  const result = await resolveLicenseForVerification(env, licenseKey);
  if (!result.ok || !result.license) {
    return verifyHtmlPage(false, "License not valid", verifyReasonMessage(result.reason));
  }

  const state = await signState(env.VERIFY_SHARED_SECRET, result.license.license_key);
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", env.DISCORD_REDIRECT_URI);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify guilds.join");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("prompt", "consent");

  return Response.redirect(authorize.toString(), 302);
}
