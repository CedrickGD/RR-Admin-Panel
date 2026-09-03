import { handleAdminLicenseBinding } from "../../../../_lib/admin-license-binding";
import type { RuntimeEnv } from "../../../../_lib/types";

export function onRequestPost(context: {
  request: Request;
  env: RuntimeEnv;
  params: { key: string };
}): Promise<Response> {
  return handleAdminLicenseBinding(context, "bind");
}
