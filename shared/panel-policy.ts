export const PERMISSIONS = [
  { key: "overview.read", label: "Overview", group: "Workspace" },
  { key: "customers.read", label: "Customer profiles & 360", group: "Customers" },
  { key: "licenses.read", label: "View licenses & orders", group: "Customers" },
  { key: "licenses.write", label: "Issue, edit & revoke licenses", group: "Customers" },
  { key: "access.read", label: "View app suspensions", group: "Customers" },
  { key: "access.write", label: "Suspend & restore app users", group: "Customers" },
  { key: "monitoring.read", label: "Sessions, analytics & devices", group: "Monitoring" },
  { key: "monitoring.write", label: "Revoke device installations", group: "Monitoring" },
  { key: "support.read", label: "Feedback, errors & diagnostics", group: "Support" },
  { key: "support.write", label: "Update feedback", group: "Support" },
  { key: "announcements.read", label: "View announcements", group: "Communication" },
  { key: "announcements.write", label: "Publish & edit announcements", group: "Communication" },
  { key: "exports.read", label: "Export records", group: "Data" },
] as const;
export type Permission = (typeof PERMISSIONS)[number]["key"];
export type PanelRole = "owner" | "admin" | "support" | "viewer";
export type PermissionOverride = { effect: "allow" | "deny"; expiresAt: string | null };
export type PermissionOverrides = Partial<Record<Permission, PermissionOverride>>;
export const ROLE_LABELS: Record<PanelRole, string> = {
  owner: "Owner",
  admin: "Administrator",
  support: "Support",
  viewer: "Read only",
};
export function rolePermissions(role: PanelRole): Permission[] {
  if (role === "owner" || role === "admin") return PERMISSIONS.map((p) => p.key);
  if (role === "support")
    return [
      "overview.read",
      "customers.read",
      "licenses.read",
      "access.read",
      "monitoring.read",
      "support.read",
      "support.write",
    ];
  return PERMISSIONS.filter((p) => p.key.endsWith(".read") && p.key !== "exports.read").map(
    (p) => p.key,
  );
}
export function effectivePermissions(
  role: PanelRole,
  overrides: PermissionOverrides,
  now = Date.now(),
): Permission[] {
  const allowed = new Set(rolePermissions(role));
  for (const { key } of PERMISSIONS) {
    const entry = overrides[key];
    if (!entry || (entry.expiresAt && Date.parse(entry.expiresAt) <= now)) continue;
    if (entry.effect === "deny") allowed.delete(key);
    else allowed.add(key);
  }
  // A write grant never bypasses an explicit denial of its corresponding read permission.
  return [...allowed].filter(
    (key) => !key.endsWith(".write") || allowed.has(key.replace(".write", ".read") as Permission),
  );
}
export const PAGE_PERMISSION: Record<string, Permission | "team.manage" | null> = {
  overview: "overview.read",
  customers: "customers.read",
  licenses: "licenses.read",
  access: "access.read",
  live: "monitoring.read",
  workers: "monitoring.read",
  traffic: "monitoring.read",
  versions: "monitoring.read",
  heatmap: "monitoring.read",
  errors: "support.read",
  feedback: "support.read",
  announcements: "announcements.read",
  team: "team.manage",
  system: "monitoring.read",
  settings: null,
};
export function canVisit(
  page: string,
  user: { role: string; panelRole?: PanelRole; permissions?: Permission[] },
): boolean {
  const permission = PAGE_PERMISSION[page];
  if (permission === undefined) return false;
  if (permission === null) return true;
  if (permission === "team.manage")
    return user.panelRole ? user.panelRole === "owner" : user.role === "admin";
  return user.permissions
    ? user.permissions.includes(permission)
    : user.role === "admin" || !["customers", "licenses", "access"].includes(page);
}
export function routePermissions(
  path: string,
  method: string,
): Permission[] | "team.manage" | null {
  const write = !["GET", "HEAD"].includes(method);
  if (path.startsWith("/api/admin/team")) return "team.manage";
  if (path === "/api/admin/data" || path.startsWith("/api/auth/") || path === "/api/admin/verify")
    return [];
  if (path.includes("sessions-export")) return ["monitoring.read", "exports.read"];
  if (path.includes("customer-360")) return ["customers.read"];
  if (path.startsWith("/api/admin/licenses")) return [write ? "licenses.write" : "licenses.read"];
  if (path.startsWith("/api/admin/access")) return [write ? "access.write" : "access.read"];
  if (path.startsWith("/api/admin/installs"))
    return [write ? "monitoring.write" : "monitoring.read"];
  if (path.startsWith("/api/admin/feedback") || path === "/api/admin/errors")
    return [write ? "support.write" : "support.read"];
  if (path.startsWith("/api/admin/announcements"))
    return [write ? "announcements.write" : "announcements.read"];
  if (["/api/admin/stats", "/api/admin/user-activity"].includes(path)) return ["monitoring.read"];
  if (path === "/api/admin/users") return ["customers.read"];
  if (["/api/admin/customer-profiles", "/api/admin/customer-avatar"].includes(path) && !write)
    return ["customers.read"];
  return null;
}
