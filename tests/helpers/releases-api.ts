/**
 * The plumbing the `functions/api/admin/releases/*` route tests share.
 *
 * A route builds its own `GithubReleaseClient`, so the seam is the global `fetch`: `releasesFetch`
 * serves the Access JWKS from the shared test signer and hands every `api.github.com` call to a
 * `FakeGitHub`. Anything else throws — a typo in a URL must never become a real request.
 */
import type { PanelMember } from "../../functions/_lib/panel-access";
import type { PanelRole, PermissionOverrides } from "../../shared/panel-policy";
import type { FakeGitHub } from "./fake-github";
import { TEST_ACCESS_TEAM_DOMAIN, getTestAccessSigner } from "./request";

export const GITHUB_ORIGIN = "https://api.github.com";

/** SQL `requireDashboardAccess` runs before any handler code — the seat it is about to check. */
export const PANEL_MEMBER_SQL = /FROM panel_members WHERE email/;

export function releasesFetch(
  github: FakeGitHub,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === `https://${TEST_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      const signer = await getTestAccessSigner();
      return new Response(JSON.stringify(signer.jwks), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.startsWith(GITHUB_ORIGIN)) return github.fetch(url, init);
    throw new Error(`Unexpected network request in test: ${url}`);
  };
}

/** A live `panel_members` row, which is what makes `effectivePermissions` decide the request. */
export function panelMemberRow(
  email: string,
  role: PanelRole,
  overrides: PermissionOverrides = {},
): PanelMember {
  return {
    email,
    display_name: email,
    role,
    enabled: 1,
    expires_at: null,
    overrides_json: JSON.stringify(overrides),
    revoked_before: 0,
    removed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}
