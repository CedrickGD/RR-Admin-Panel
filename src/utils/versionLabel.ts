/**
 * The one display rule for an app version.
 *
 * Telemetry buckets every build before 1.4 under the token "legacy". That
 * token used to be spelled out independently on five screens — "Legacy
 * (pre-1.4)" on most, bare "Legacy" on the installs panel, the raw token
 * "legacy" on the heatmap — so the same customer read differently depending
 * on where you looked. Every screen goes through this helper instead.
 */
export const LEGACY_VERSION_TOKEN = "legacy";
export const LEGACY_VERSION_LABEL = "Legacy (pre-1.4)";

/** True for the telemetry "legacy" bucket, whatever its casing or padding. */
export function isLegacyVersion(version: string | null | undefined): boolean {
  return version?.trim().toLowerCase() === LEGACY_VERSION_TOKEN;
}

/**
 * "Legacy (pre-1.4)" for the legacy token, the trimmed version otherwise, and
 * `fallback` when there is no version at all.
 */
export function versionLabel(version: string | null | undefined, fallback = "—"): string {
  const trimmed = version?.trim();
  if (!trimmed) return fallback;
  return isLegacyVersion(trimmed) ? LEGACY_VERSION_LABEL : trimmed;
}
