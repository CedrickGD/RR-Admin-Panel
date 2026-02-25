import { createAdminSessionToken, verifyAdminKey } from "../../_lib/auth";
import { error, getAccessIdentity, isAllowedAccessIdentity, json, readJsonBody } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

type VerifyRequest = {
  key: string;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }

  if (!context.env.ADMIN_KEY_HASH) {
    return error(500, "Server is missing ADMIN_KEY_HASH.");
  }

  if (!context.env.JWT_SECRET) {
    return error(500, "Server is missing JWT_SECRET.");
  }

  const accessIdentity = getAccessIdentity(context.request, context.env);
  if (!accessIdentity) {
    return error(401, "Cloudflare Access identity is required.");
  }
  if (!isAllowedAccessIdentity(accessIdentity, context.env)) {
    return error(403, "Access identity is not allowed.");
  }

  let payload: VerifyRequest;
  try {
    payload = await readJsonBody<VerifyRequest>(context.request, 4 * 1024);
  } catch (bodyError) {
    return error(400, bodyError instanceof Error ? bodyError.message : "Invalid request.");
  }

  if (!payload?.key || typeof payload.key !== "string" || payload.key.length > 256) {
    return error(400, "A valid admin key is required.");
  }

  const isValid = await verifyAdminKey(payload.key, context.env.ADMIN_KEY_HASH);
  if (!isValid) {
    return error(401, "Invalid admin key.");
  }

  try {
    const { token, expiresAt } = await createAdminSessionToken(context.env.JWT_SECRET, accessIdentity);
    return json({
      ok: true,
      token,
      expiresAt,
      expiresInSeconds: 8 * 60 * 60
    });
  } catch (tokenError) {
    return error(500, "Failed to create admin session token.", tokenError instanceof Error ? tokenError.message : null);
  }
}
