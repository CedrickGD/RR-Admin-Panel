import { accountAuthorize } from "../../../_lib/customer-accounts";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";
export async function onRequest(context: { request: Request; env: RuntimeEnv }): Promise<Response> {
  try {
    return await accountAuthorize(context);
  } catch (cause) {
    return internalError(
      context.request,
      "Account sign-in is unavailable. Please start again.",
      cause,
    );
  }
}
