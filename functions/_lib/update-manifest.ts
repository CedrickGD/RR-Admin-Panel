/**
 * `update.xml` — the manifest on master that decides which release an install is offered. Design:
 * docs/release-management-design.md §6 and §8.
 *
 * The file is flat (five elements and a bullet list), so reading it is a handful of anchored
 * regexes rather than a parser — the same shape `backend-worker/index.js` already reads for its
 * two serve-time rewrites — and writing it is a template rather than a serialiser.
 *
 * **Nothing here commits.** `renderUpdateXml` produces the bytes; publish (§6 step 4) and
 * make-current are the only two callers allowed to hand them to `commitFiles`, because they are
 * the two that validate the tag, check the installer asset and mint an effect list first. That is
 * exactly why `update.xml` is on the Files-tab denylist: a free-text editor over this file would
 * be the ungoverned rollback path the design removes.
 */
import { nowIso } from "./http";
import type { GithubBlob } from "./github-release";
import {
  MANIFEST_REPO,
  manifestUrlsForTag,
  manifestVersion,
  tagForVersion,
  tagFromManifestUrl,
  type UpdateXmlModel,
  type UpdateXmlState,
} from "../../shared/releases-contract";

export const UPDATE_XML_PATH = "update.xml";

/** Text of the first `<name>…</name>`, trimmed. Null when the element is absent or empty. */
function elementText(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  const text = match?.[1]?.trim();
  return text ? text : null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

/** The five entities publish escapes on the way in, undone on the way out. */
export function decodeXmlText(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#39);/g, (whole, name: string) => {
    return ENTITIES[name] ?? whole;
  });
}

/**
 * `<notes>` carries one customer bullet per line, `- ` prefixed and XML-escaped (§6 step 4).
 * `ReleaseDraft.notesCustomer` stores them without that prefix, so this strips it back off —
 * `notesLines` in the contract is the same normalisation for the editor's textarea.
 */
export function manifestNotes(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => decodeXmlText(line.replace(/^\s*[-*]\s+/, "").trim()))
    .filter((line) => line.length > 0);
}

/**
 * The manifest as a model. Null when the file carries no `<version>` — a manifest without one
 * tells the panel nothing, and guessing a version here would be guessing what customers are
 * offered.
 */
export function parseUpdateXml(xml: string): UpdateXmlModel | null {
  const version = elementText(xml, "version");
  if (!version) return null;
  return {
    version,
    url: decodeXmlText(elementText(xml, "url") ?? ""),
    changelog: decodeXmlText(elementText(xml, "changelog") ?? ""),
    mandatory: (elementText(xml, "mandatory") ?? "").toLowerCase() === "true",
    args: decodeXmlText(elementText(xml, "args") ?? ""),
    notes: manifestNotes(elementText(xml, "notes")),
  };
}

/**
 * What the overview shows about the live manifest. `pinnedTag` is deliberately the tag the
 * committed `<url>` resolves to and nothing else: the contract says null when that URL points
 * somewhere unrecognised, and a tag inferred from `<version>` would claim a pin the download
 * route does not actually follow.
 */
export function updateXmlState(
  blob: GithubBlob | null,
  latestPublishedTag: string | null,
  fetchedAt: string = nowIso(),
): UpdateXmlState | null {
  if (!blob?.content) return null;
  const model = parseUpdateXml(blob.content);
  if (!model) return null;
  const pinnedTag = tagFromManifestUrl(model.url);
  return {
    ...model,
    sha: blob.sha,
    pinnedTag,
    pinnedTagIsLatest: pinnedTag !== null && pinnedTag === latestPublishedTag,
    fetchedAt,
  };
}

/* ─────────────────────────── Writing the manifest (publish, make-current) ─────────────────────────── */

/** Inno Setup's silent-install switches — what the live file carries and what a rewrite keeps. */
export const DEFAULT_INSTALL_ARGS = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART";

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** The five entities `decodeXmlText` undoes, applied on the way in. */
export function escapeXmlText(text: string): string {
  return text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}

export interface ManifestModelInput {
  /** The tag the manifest pins. `<url>` and `<changelog>` are derived from it, never passed in. */
  tag: string;
  /** 3-part; `<version>` carries its 4-part form. */
  version: string;
  mandatory: boolean;
  /** Customer bullets without their "- " prefix, exactly as `ReleaseDraft.notesCustomer` holds. */
  notes: string[];
  /** Kept from the manifest being replaced; the default is what the file carries today. */
  args?: string | null;
  /** `GithubReleaseClient.repo`, so a configured repo is honoured instead of the default. */
  repo?: string;
}

/**
 * The model publish step 4 and make-current commit. The URLs come from `manifestUrlsForTag` and
 * nowhere else: they are **github.com** URLs on purpose (§6 step 4), the exact two substrings
 * `ReleaseReadinessTests` asserts against the committed file, and rr-api rewrites both to NAS URLs
 * at serving time (§8) so a customer never sees a github.com link.
 */
export function manifestModelForTag(input: ManifestModelInput): UpdateXmlModel {
  const tag = tagForVersion(input.tag);
  const { url, changelog } = manifestUrlsForTag(tag, input.repo?.trim() || MANIFEST_REPO);
  return {
    version: manifestVersion(input.version),
    url,
    changelog,
    mandatory: input.mandatory,
    args: input.args?.trim() || DEFAULT_INSTALL_ARGS,
    notes: input.notes.map((note) => note.trim()).filter((note) => note.length > 0),
  };
}

/**
 * The manifest as bytes, in the shape the file on master already has: four-space indentation, one
 * `- ` prefixed bullet per line inside `<notes>`, and a trailing newline. Keeping the shape means a
 * publish diff is the five values that changed and nothing else.
 */
export function renderUpdateXml(model: UpdateXmlModel): string {
  const notes =
    model.notes.length === 0
      ? "<notes></notes>"
      : ["<notes>", ...model.notes.map((note) => `- ${escapeXmlText(note)}`), "    </notes>"].join(
          "\n",
        );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<item>",
    `    <version>${escapeXmlText(model.version)}</version>`,
    `    <url>${escapeXmlText(model.url)}</url>`,
    `    <changelog>${escapeXmlText(model.changelog)}</changelog>`,
    `    <mandatory>${model.mandatory ? "true" : "false"}</mandatory>`,
    `    <args>${escapeXmlText(model.args)}</args>`,
    `    ${notes}`,
    "</item>",
    "",
  ].join("\n");
}
