/**
 * Reading `update.xml` — the manifest on master that decides which release an install is offered.
 * Design: docs/release-management-design.md §6 and §8.
 *
 * The file is flat (five elements and a bullet list), so this is a handful of anchored regexes
 * rather than a parser — the same shape `backend-worker/index.js` already reads for its two
 * serve-time rewrites. Nothing here writes: publish (§6 step 4) and make-current own the committed
 * file, which is exactly why `update.xml` is on the Files-tab denylist.
 */
import { nowIso } from "./http";
import type { GithubBlob } from "./github-release";
import {
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
