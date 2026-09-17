/**
 * The version bump the **panel** makes, not CI. Design: docs/release-management-design.md §7 —
 * "one commit touching `RazorReaper.csproj` (`ApplicationDisplayVersion`, `Version`,
 * `AssemblyVersion`, `FileVersion`, `ApplicationVersion` + 1) and `installer/RazorReaper.iss`
 * (`MyAppVersion`)".
 *
 * Pure string work, deliberately: `build-installer.yml` only *verifies* that the two files agree
 * with the version it was handed (§7), and `ReleaseReadinessTests` asserts the same pair plus
 * `update.xml`'s version never exceeding the built one. Both stay true because the bump happens
 * before the build and the manifest is written after the asset exists.
 *
 * Every rewrite is anchored on the element it names and every one of the six must match: a
 * half-bumped `csproj` is exactly what `commitFiles`' single ref move exists to prevent, so a file
 * missing a field is refused here rather than committed with four fields out of five.
 */
import { manifestVersion, versionForTag } from "../../shared/releases-contract";

/** The two files the bump commit touches. Both are read and written together or not at all. */
export const CSPROJ_PATH = "RazorReaper/RazorReaper.csproj";
export const ISS_PATH = "installer/RazorReaper.iss";

/** The workflow §7 adds to the client repo; the draft's build dispatches it by file name. */
export const BUILD_WORKFLOW_FILE = "build-installer.yml";

/**
 * `<name>…</name>`, first occurrence, value replaced. `<Version>` cannot collide with
 * `<AssemblyVersion>` or `<ApplicationVersion>`: the pattern anchors on the `<` immediately before
 * the element name, which those two do not carry.
 */
function replaceElement(source: string, name: string, value: string): string | null {
  const pattern = new RegExp(`(<${name}>)([^<]*)(</${name}>)`);
  if (!pattern.test(source)) return null;
  // A function replacer, so a `$` in a value could never be read as a capture reference.
  return source.replace(pattern, (_whole, open: string, _old: string, close: string) => {
    return `${open}${value}${close}`;
  });
}

function elementValue(source: string, name: string): string | null {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(source);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/** What `ApplicationDisplayVersion` carries today, or null when the project has no such element. */
export function csprojDisplayVersion(source: string): string | null {
  return elementValue(source, "ApplicationDisplayVersion");
}

/** True when master already carries this version — the case §6 skips the bump commit for. */
export function csprojCarriesVersion(source: string, version: string): boolean {
  const current = csprojDisplayVersion(source);
  return current !== null && current === versionForTag(version);
}

export interface CsprojBump {
  content: string;
  /** The new `<ApplicationVersion>`: the MAUI build counter, always the old one plus one. */
  applicationVersion: number;
}

/**
 * The five `csproj` fields. `ApplicationDisplayVersion` and `Version` carry the 3-part number,
 * `AssemblyVersion` and `FileVersion` the 4-part one `ReleaseReadinessTests` compares against the
 * compiled assembly, and `ApplicationVersion` is a counter rather than a version — it goes up by
 * one and is never derived from the release number.
 *
 * Null when any of the five is absent: the panel refuses to guess at a project file's shape.
 */
export function bumpCsproj(source: string, version: string): CsprojBump | null {
  const three = versionForTag(version);
  const four = manifestVersion(version);

  let content = source;
  for (const [name, value] of [
    ["ApplicationDisplayVersion", three],
    ["Version", three],
    ["AssemblyVersion", four],
    ["FileVersion", four],
  ] as const) {
    const next = replaceElement(content, name, value);
    if (next === null) return null;
    content = next;
  }

  const current = elementValue(content, "ApplicationVersion");
  const parsed = Number.parseInt(current ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  const applicationVersion = parsed + 1;
  const bumped = replaceElement(content, "ApplicationVersion", String(applicationVersion));
  if (bumped === null) return null;
  return { content: bumped, applicationVersion };
}

const MY_APP_VERSION = /(#define\s+MyAppVersion\s+")([^"]*)(")/;

/**
 * `#define MyAppVersion "1.5.4"` in the Inno Setup script — the one line §7's guard step compares
 * against the version it was dispatched with. Null when the define is absent.
 */
export function bumpIss(source: string, version: string): string | null {
  if (!MY_APP_VERSION.test(source)) return null;
  return source.replace(MY_APP_VERSION, (_whole, open: string, _old: string, close: string) => {
    return `${open}${versionForTag(version)}${close}`;
  });
}

/** True when the installer script already declares this version. */
export function issCarriesVersion(source: string, version: string): boolean {
  const current = MY_APP_VERSION.exec(source)?.[2]?.trim();
  return current !== undefined && current === versionForTag(version);
}
