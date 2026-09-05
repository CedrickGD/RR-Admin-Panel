import { createContext, useContext } from "react";
import type { AuthUser } from "../types/telemetry";
import type { Permission } from "../../shared/panel-policy";
export const PanelIdentity = createContext<AuthUser | null>(null);
export function usePanelPermission(permission?: Permission) {
  const user = useContext(PanelIdentity);
  if (!permission) return true;
  return user?.permissions ? user.permissions.includes(permission) : user?.role === "admin";
}
