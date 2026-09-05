import { accountApi } from "../../../_lib/customer-accounts";
import { internalError } from "../../../_lib/responses";
import type { RuntimeEnv } from "../../../_lib/types";
export async function onRequest(context: {
  request: Request;
  env: RuntimeEnv;
  params: { action: string };
}): Promise<Response> {
  try {
    return await accountApi(context, context.params.action);
  } catch (cause) {
    return internalError(
      context.request,
      "Account service is unavailable. Please try again.",
      cause,
    );
  }
}
