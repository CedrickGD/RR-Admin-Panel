export const PERMISSIONS = [
  { key: "overview.read", label: "Overview", group: "Workspace" },
  { key: "customers.read", label: "Customer profiles & 360", group: "Customers" },
  { key: "licenses.read", label: "View licenses & orders", group: "Customers" },
  { key: "licenses.write", label: "Issue, edit & revoke licenses", group: "Customers" },
  { key: "access.read", label: "View customer suspensions", group: "Customers" },
  { key: "access.write", label: "Suspend & restore customers", group: "Customers" },
  { key: "monitoring.read", label: "Sessions, analytics & devices", group: "Monitoring" },
  { key: "monitoring.write", label: "Revoke device installations", group: "Monitoring" },
  { key: "support.read", label: "Feedback, errors & diagnostics", group: "Support" },
  { key: "support.write", label: "Update feedback", group: "Support" },
  { key: "announcements.read", label: "View announcements", group: "Communication" },
  { key: "announcements.write", label: "Publish & edit announcements", group: "Communication" },
  { key: "exports.read", label: "Export records", group: "Data" },
  { key: "releases.read", label: "View releases & drafts", group: "Releases" },
  { key: "releases.write", label: "Draft, build, publish & roll back", group: "Releases" },
  // Owner-only (docs/release-management-design.md decision 2): repository file writes and
  // free-form workflow dispatches are remote code execution on a runner that holds the release
  // token. The key deliberately ends in neither ".read" nor ".write" — see effectivePermissions.
  { key: "releases.files", label: "Edit repository files & workflows", group: "Releases" },
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
  if (role === "owner") return PERMISSIONS.map((p) => p.key);
  // Owner and admin stop sharing one list here: an admin keeps drafts, builds, publish and
  // rollback, but never edits repository files or dispatches an arbitrary workflow.
  if (role === "admin")
    return PERMISSIONS.map((p) => p.key).filter((key) => key !== "releases.files");
  if (role === "support")
    return [
      "overview.read",
      "customers.read",
      "licenses.read",
      "access.read",
      "monitoring.read",
      "support.read",
      "support.write",
      // A support seat sees the Releases page read-only (design decision 6); the viewer role
      // below picks the same key up through its ".read" filter.
      "releases.read",
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
  // "releases.files" ends in neither ".read" nor ".write", so this filter deliberately does not
  // pair it with "releases.read" — which is exactly why the file and workflow routes below ask
  // for both keys instead of trusting this to imply the read.
  return [...allowed].filter(
    (key) => !key.endsWith(".write") || allowed.has(key.replace(".write", ".read") as Permission),
  );
}
export const PAGE_PERMISSION: Record<string, Permission | "team.manage" | null> = {
  overview: "overview.read",
  customers: "customers.read",
  licenses: "licenses.read",
  // No "access" page: it was folded into the customer directory, so the key is
  // an alias for "customers" now and never reaches canVisit. The access.read /
  // access.write permissions above are untouched — the customer app-access
  // feature (the row action, the dialog, /api/admin/access) still uses them.
  live: "monitoring.read",
  workers: "monitoring.read",
  traffic: "monitoring.read",
  versions: "monitoring.read",
  heatmap: "monitoring.read",
  errors: "support.read",
  feedback: "support.read",
  announcements: "announcements.read",
  releases: "releases.read",
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
    : user.role === "admin" || !["customers", "licenses"].includes(page);
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
  // Releases, specific-first — the generic branch is last and would otherwise swallow all four.
  // The Versions page reads this route instead of api.github.com, so it keeps its own permission.
  if (path === "/api/admin/releases/versions") return ["monitoring.read"];
  // Reading a repository file is as owner-only as writing one: both keys, both directions.
  if (path.startsWith("/api/admin/releases/files")) return ["releases.read", "releases.files"];
  // Dispatching an arbitrary workflow is remote code execution on a runner holding the release
  // token, so it sits with files; the draft's own build dispatch falls through to releases.write.
  if (path.startsWith("/api/admin/releases/workflows"))
    return write ? ["releases.read", "releases.files"] : ["releases.read"];
  if (path.startsWith("/api/admin/releases")) return [write ? "releases.write" : "releases.read"];
  if (
    [
      "/api/admin/stats",
      "/api/admin/user-activity",
      "/api/admin/health",
      "/api/admin/system",
    ].includes(path)
  )
    return ["monitoring.read"];
  if (path === "/api/admin/users") return ["customers.read"];
  if (["/api/admin/customer-profiles", "/api/admin/customer-avatar"].includes(path) && !write)
    return ["customers.read"];
  return null;
}
