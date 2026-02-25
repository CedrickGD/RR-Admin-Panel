import { createAppSessionToken, createSessionCookie, isValidEmail, normalizeEmail, verifyPassword } from "../../_lib/auth";
import { error, json, readJsonBody } from "../../_lib/http";
import type { RuntimeEnv } from "../../_lib/types";
import { countUsers, ensureAuthSchema, findUserByEmail, touchUserLastLogin } from "../../_lib/users";

type HandlerContext = {
  request: Request;
  env: RuntimeEnv;
};

type LoginRequest = {
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

  let payload: LoginRequest;
  try {
    payload = await readJsonBody<LoginRequest>(context.request, 8 * 1024);
  } catch (bodyError) {
    return error(400, bodyError instanceof Error ? bodyError.message : "Invalid request.");
  }

  const email = normalizeEmail(payload?.email ?? "");
  const password = payload?.password ?? "";

  if (!isValidEmail(email) || typeof password !== "string" || password.length === 0) {
    return error(400, "Email and password are required.");
  }

  try {
    await ensureAuthSchema(context.env);
    const hasUsers = (await countUsers(context.env)) > 0;
    if (!hasUsers) {
      return error(409, "No user exists yet. Complete bootstrap first.");
    }

    const user = await findUserByEmail(context.env, email);
    const isValid = user ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !isValid) {
      return error(401, "Invalid email or password.");
    }

    await touchUserLastLogin(context.env, user.id);
    const { token, expiresAt } = await createAppSessionToken(context.env.JWT_SECRET, user.email, user.role);

    return json(
      {
        ok: true,
        user: {
          email: user.email,
          role: user.role
        },
        expiresAt
      },
      200,
      {
        "set-cookie": createSessionCookie(token, context.request, context.env.AUTH_SESSION_COOKIE)
      }
    );
  } catch (loginError) {
    return error(500, "Failed to authenticate user.", loginError instanceof Error ? loginError.message : null);
  }
}
