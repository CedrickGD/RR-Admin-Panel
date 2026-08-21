import {
  createAppSessionToken,
  createSessionCookie,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  validatePasswordComplexity,
} from "../../_lib/auth";
import { error, json, readJsonBody } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";
import { countUsers, createUser, ensureAuthSchema } from "../../_lib/users";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

type BootstrapRequest = {
  email: string;
  password: string;
};

export async function onRequest(context: HandlerContext): Promise<Response> {
  if (context.request.method !== "POST") {
    return error(405, "Method not allowed. Use POST.");
  }

  if (!context.env.JWT_SECRET) {
    return error(500, "Server is missing JWT_SECRET.");
  }

  let payload: BootstrapRequest;
  try {
    payload = await readJsonBody<BootstrapRequest>(context.request, 8 * 1024);
  } catch (bodyError) {
    return error(400, bodyError instanceof Error ? bodyError.message : "Invalid request.");
  }

  const email = normalizeEmail(payload?.email ?? "");
  const password = payload?.password ?? "";

  if (!isValidEmail(email)) {
    return error(400, "A valid email is required.");
  }

  const passwordError = validatePasswordComplexity(password);
  if (passwordError) {
    return error(400, passwordError);
  }

  try {
    await ensureAuthSchema(context.env);
    const existingUsers = await countUsers(context.env);

    if (existingUsers > 0) {
      return error(409, "Bootstrap is disabled because at least one user already exists.");
    }

    const passwordHash = await hashPassword(password);
    const user = await createUser(context.env, email, "admin", passwordHash);
    const { token, expiresAt } = await createAppSessionToken(
      context.env.JWT_SECRET,
      user.email,
      user.role,
    );

    return json(
      {
        ok: true,
        user: {
          email: user.email,
          role: user.role,
        },
        expiresAt,
      },
      200,
      {
        "set-cookie": createSessionCookie(token, context.request, context.env.AUTH_SESSION_COOKIE),
      },
    );
  } catch (bootstrapError) {
    return error(
      500,
      "Failed to bootstrap admin user.",
      bootstrapError instanceof Error ? bootstrapError.message : null,
    );
  }
}
