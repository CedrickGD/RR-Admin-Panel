export const LEGACY_PAGES_HOST = "rr-admin-panel.pages.dev";
export const ADMIN_HOST = "admin.razorreaper.app";

export interface BrowserLocation {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
  replace(url: string): void;
}

/**
 * Moves the legacy Pages UI to the NAS-hosted admin origin without losing the
 * dashboard route (#/...) or query string. Other hosts, including local dev
 * and the new admin origin, are deliberately untouched.
 */
export function redirectLegacyPagesHost(location: BrowserLocation): boolean {
  if (location.hostname.toLowerCase() !== LEGACY_PAGES_HOST) {
    return false;
  }

  const target = `https://${ADMIN_HOST}${location.pathname}${location.search}${location.hash}`;
  location.replace(target);
  return true;
}
