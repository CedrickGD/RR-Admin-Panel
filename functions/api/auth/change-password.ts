import {
  getSessionTokenFromCookie,
  hashPassword,
  validatePasswordComplexity,
  verifyAppSessionToken,
  verifyPassword,
} from "../../_lib/auth";
import { error, json, readJsonBody } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";
import { ensureAuthSchema, findUserByEmail, updateUserPassword } from "../../_lib/users";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

type ChangePasswordRequest = {
  oldPassword: string;
  newPassword: string;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }

  if (!context.env.JWT_SECRET) {
    return error(500, "Server is missing JWT_SECRET.");
  }

  const token = getSessionTokenFromCookie(context.request, context.env.AUTH_SESSION_COOKIE);
  const claims = await verifyAppSessionToken(token, context.env);
  if (!claims) {
    return error(401, "Not authenticated.");
  }

  let payload: ChangePasswordRequest;
  try {
    payload = await readJsonBody<ChangePasswordRequest>(context.request, 8 * 1024);
  } catch (bodyError) {
    return error(400, bodyError instanceof Error ? bodyError.message : "Invalid request.");
  }

  const oldPassword = payload?.oldPassword ?? "";
  const newPassword = payload?.newPassword ?? "";
  if (typeof oldPassword !== "string" || oldPassword.length === 0) {
    return error(400, "Current password is required.");
  }

  const passwordError = validatePasswordComplexity(newPassword);
  if (passwordError) {
    return error(400, passwordError);
  }

  try {
    await ensureAuthSchema(context.env);
    const user = await findUserByEmail(context.env, claims.email);
    if (!user) {
      return error(401, "Not authenticated.");
    }

    const oldPasswordMatches = await verifyPassword(oldPassword, user.passwordHash);
    if (!oldPasswordMatches) {
      return error(401, "Current password is incorrect.");
    }

    const nextHash = await hashPassword(newPassword);
    await updateUserPassword(context.env, user.id, nextHash);

    return json({
      ok: true,
      updated: true,
    });
  } catch (updateError) {
    return error(
      500,
      "Failed to update password.",
      updateError instanceof Error ? updateError.message : null,
    );
  }
}
