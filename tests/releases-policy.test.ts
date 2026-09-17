import { describe, expect, it } from "vitest";
import {
  canVisit,
  effectivePermissions,
  PAGE_PERMISSION,
  PERMISSIONS,
  rolePermissions,
  routePermissions,
  type PanelRole,
  type Permission,
} from "../shared/panel-policy";
import type { ReleasesPermission } from "../shared/releases-contract";

const RELEASES_KEYS = ["releases.read", "releases.write", "releases.files"] as const;
/** The contract's union and the policy's keys are the same three, checked both ways. */
const CONTRACT_KEYS: ReleasesPermission[] = [...RELEASES_KEYS];

function granted(role: PanelRole): Set<Permission> {
  return new Set(rolePermissions(role));
}

describe("releases permission keys", () => {
  it("adds exactly the three keys the contract names, in one group", () => {
    const entries = PERMISSIONS.filter((p) => p.key.startsWith("releases."));
    expect(entries.map((p) => p.key)).toEqual(RELEASES_KEYS);
    expect(entries.map((p) => p.group)).toEqual(["Releases", "Releases", "Releases"]);
    expect(entries.map((p) => p.label)).toEqual([
      "View releases & drafts",
      "Draft, build, publish & roll back",
      "Edit repository files & workflows",
    ]);
    for (const key of CONTRACT_KEYS) expect(PERMISSIONS.some((p) => p.key === key)).toBe(true);
  });

  it("keeps releases.files out of the write-implies-read filter, which is why the file routes ask for both", () => {
    // The filter pairs a ".write" key with its ".read"; this key ends in neither, so a seat can
    // hold it with releases.read denied — and then the route, not the filter, is what refuses.
    expect("releases.files".endsWith(".read")).toBe(false);
    expect("releases.files".endsWith(".write")).toBe(false);
    const filesOnly = effectivePermissions("support", {
      "releases.read": { effect: "deny", expiresAt: null },
      "releases.files": { effect: "allow", expiresAt: null },
    });
    expect(filesOnly).toContain("releases.files");
    expect(filesOnly).not.toContain("releases.read");
    expect(routePermissions("/api/admin/releases/files", "GET")).toContain("releases.read");
  });
});

describe("releases permissions per role", () => {
  it("gives the owner all three and the admin everything but the files key", () => {
    const owner = granted("owner");
    const admin = granted("admin");
    for (const key of RELEASES_KEYS) expect(owner.has(key)).toBe(true);
    expect(admin.has("releases.read")).toBe(true);
    expect(admin.has("releases.write")).toBe(true);
    expect(admin.has("releases.files")).toBe(false);
    // Owner and admin stop being the same list: that difference is the whole of decision 2.
    expect(rolePermissions("owner")).not.toEqual(rolePermissions("admin"));
    expect(rolePermissions("owner").filter((k) => k !== "releases.files")).toEqual(
      rolePermissions("admin"),
    );
  });

  it("gives support and viewer the read key only", () => {
    for (const role of ["support", "viewer"] as const) {
      const keys = granted(role);
      expect(keys.has("releases.read")).toBe(true);
      expect(keys.has("releases.write")).toBe(false);
      expect(keys.has("releases.files")).toBe(false);
    }
  });

  it("never hands releases.files to a seat through an ordinary grant", () => {
    // Only an explicit override reaches it, and only the owner role carries it by default.
    const roles: PanelRole[] = ["owner", "admin", "support", "viewer"];
    expect(roles.filter((role) => granted(role).has("releases.files"))).toEqual(["owner"]);
  });
});

describe("the releases page is gated on releases.read", () => {
  it("is reachable with the read key and refused without it", () => {
    expect(PAGE_PERMISSION.releases).toBe("releases.read");
    expect(canVisit("releases", { role: "viewer", permissions: ["releases.read"] })).toBe(true);
    expect(canVisit("releases", { role: "viewer", permissions: ["monitoring.read"] })).toBe(false);
    expect(canVisit("releases", { role: "admin", permissions: [] })).toBe(false);
    for (const role of ["owner", "admin", "support", "viewer"] as const)
      expect(canVisit("releases", { role: "viewer", permissions: rolePermissions(role) })).toBe(
        true,
      );
  });
});

describe("routePermissions branch order", () => {
  it("resolves the specific releases routes before the generic one", () => {
    // Versions is the Monitoring page's data, not a release operation.
    expect(routePermissions("/api/admin/releases/versions", "GET")).toEqual(["monitoring.read"]);
    // Files: both keys, and reading is as owner-only as writing.
    expect(routePermissions("/api/admin/releases/files", "GET")).toEqual([
      "releases.read",
      "releases.files",
    ]);
    expect(routePermissions("/api/admin/releases/files", "PUT")).toEqual([
      "releases.read",
      "releases.files",
    ]);
    // Workflows: listing needs the read key, dispatching needs the files key too.
    expect(routePermissions("/api/admin/releases/workflows", "GET")).toEqual(["releases.read"]);
    expect(routePermissions("/api/admin/releases/workflows/runs", "GET")).toEqual([
      "releases.read",
    ]);
    expect(routePermissions("/api/admin/releases/workflows/12/dispatch", "POST")).toEqual([
      "releases.read",
      "releases.files",
    ]);
  });

  it("falls through to read on GET and write on everything else", () => {
    expect(routePermissions("/api/admin/releases", "GET")).toEqual(["releases.read"]);
    expect(routePermissions("/api/admin/releases", "HEAD")).toEqual(["releases.read"]);
    expect(routePermissions("/api/admin/releases/commits", "GET")).toEqual(["releases.read"]);
    expect(routePermissions("/api/admin/releases/drafts/4/events", "GET")).toEqual([
      "releases.read",
    ]);
    for (const [path, method] of [
      ["/api/admin/releases/drafts", "POST"],
      ["/api/admin/releases/drafts/4", "PUT"],
      ["/api/admin/releases/drafts/4", "DELETE"],
      // The draft's own dispatch takes the draft as its input, not free text, so it stays here.
      ["/api/admin/releases/drafts/4/build", "POST"],
      ["/api/admin/releases/drafts/4/publish", "POST"],
      ["/api/admin/releases/821/make-current", "POST"],
      ["/api/admin/releases/821/unpublish-to-draft", "POST"],
      ["/api/admin/releases/confirm", "POST"],
    ] as const)
      expect([path, routePermissions(path, method)]).toEqual([path, ["releases.write"]]);
  });

  it("leaves every route outside /api/admin/releases as it was", () => {
    expect(routePermissions("/api/admin/announcements", "GET")).toEqual(["announcements.read"]);
    expect(routePermissions("/api/admin/health", "GET")).toEqual(["monitoring.read"]);
    expect(routePermissions("/api/admin/team", "GET")).toBe("team.manage");
    expect(routePermissions("/api/admin/release-notes", "GET")).toBeNull();
  });
});

describe("what each role may actually call", () => {
  const calls = [
    ["/api/admin/releases", "GET"],
    ["/api/admin/releases/drafts", "POST"],
    ["/api/admin/releases/files", "GET"],
    ["/api/admin/releases/workflows/12/dispatch", "POST"],
  ] as const;

  function allows(role: PanelRole, path: string, method: string): boolean {
    const required = routePermissions(path, method);
    if (required === null || required === "team.manage") return false;
    const held = granted(role);
    return required.every((key) => held.has(key));
  }

  it.each([
    ["owner", [true, true, true, true]],
    ["admin", [true, true, false, false]],
    ["support", [true, false, false, false]],
    ["viewer", [true, false, false, false]],
  ] as const)("%s", (role, expected) => {
    expect(calls.map(([path, method]) => allows(role, path, method))).toEqual([...expected]);
  });
});
