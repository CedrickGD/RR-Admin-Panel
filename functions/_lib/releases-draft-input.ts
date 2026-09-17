/**
 * Reading a draft off the wire — shared by `POST …/drafts` and `PUT …/drafts/:id`, which take the
 * same fields (`ReleaseDraftInput`, and the patch that is all of them optional plus
 * `expectedUpdatedAt`). Design: docs/release-management-design.md §6.
 *
 * Validation here is deliberately narrow: shapes, lengths, the two formats that have to hold (a
 * 3-part version and a tag that is a git ref), and the one relationship between them — `tag` is
 * `v{version}`, so a body carrying one derives the other and a body carrying both must agree.
 * Whether the version is *newer* than the latest published one is the route's question, because
 * only GitHub can answer it, and whether the row moved under the editor is the store's, because
 * only the row can.
 */
import { isObject } from "./http";
import {
  tagForVersion,
  versionForTag,
  type ReleaseDraftPatch,
} from "../../shared/releases-contract";

/** 3-part and numeric. "1.5.4" — not "1.5", not "1.5.4.0", not "v1.5.4-rc1". */
const VERSION_PATTERN = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

/** A git ref, not a path: the punctuation a tag name may carry and nothing else. */
const TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+/-]{0,127}$/;

const LIMITS = {
  title: 200,
  commitMessage: 500,
  notesCustomer: 8_000,
  notesFullMd: 60_000,
} as const;

export type DraftInputResult =
  | { ok: true; input: ReleaseDraftPatch }
  | { ok: false; error: string };

interface ReadOptions {
  /** True for `POST`, where the version is the one field the row cannot be created without. */
  versionRequired: boolean;
}

function readText(
  body: Record<string, unknown>,
  key: string,
  max: number,
): { ok: true; value?: string } | { ok: false; error: string } {
  const raw = body[key];
  if (raw === undefined) return { ok: true };
  if (typeof raw !== "string") return { ok: false, error: `${key} must be text.` };
  if (raw.length > max) return { ok: false, error: `${key} is longer than ${max} characters.` };
  return { ok: true, value: raw };
}

function readFlag(
  body: Record<string, unknown>,
  key: string,
): { ok: true; value?: boolean } | { ok: false; error: string } {
  const raw = body[key];
  if (raw === undefined) return { ok: true };
  if (typeof raw !== "boolean") return { ok: false, error: `${key} must be true or false.` };
  return { ok: true, value: raw };
}

export function readDraftInput(body: unknown, options: ReadOptions): DraftInputResult {
  if (!isObject(body)) return { ok: false, error: "A draft is required." };
  const input: ReleaseDraftPatch = {};

  const rawVersion = body.version;
  if (rawVersion !== undefined) {
    if (typeof rawVersion !== "string") return { ok: false, error: "version must be text." };
    const version = versionForTag(rawVersion);
    if (!VERSION_PATTERN.test(version)) {
      return { ok: false, error: "version must be a 3-part number such as 1.5.4." };
    }
    input.version = version;
  } else if (options.versionRequired) {
    return { ok: false, error: "version is required." };
  }

  const rawTag = body.tag;
  if (rawTag !== undefined) {
    if (typeof rawTag !== "string") return { ok: false, error: "tag must be text." };
    const tag = tagForVersion(rawTag);
    if (!TAG_PATTERN.test(tag)) return { ok: false, error: "tag is not a tag name." };
    input.tag = tag;
  }

  /**
   * `version` and `tag` are one value with two spellings, and everything downstream reads them
   * separately: publish step 1 finds-or-creates the GitHub release for `tag` and step 2 writes the
   * draft's title and body into it, while step 4's `manifestModelForTag` builds `<version>` from
   * `version` and `<url>` from `tag`. A row where they name different releases therefore publishes
   * a manifest pointing at one release with the version number of another, and rewrites the title
   * and body of a release nobody meant to touch. So a body that carries one derives the other, and
   * a body that carries both is refused unless they agree — here, where POST and PUT share it.
   */
  if (input.version !== undefined && input.tag === undefined) {
    input.tag = tagForVersion(input.version);
  } else if (input.tag !== undefined && input.version === undefined) {
    const derived = versionForTag(input.tag);
    if (!VERSION_PATTERN.test(derived)) {
      return {
        ok: false,
        error: `tag ${input.tag} does not name a 3-part version such as v1.5.4.`,
      };
    }
    input.version = derived;
  } else if (input.version !== undefined && input.tag !== undefined) {
    if (versionForTag(input.tag) !== input.version) {
      return {
        ok: false,
        error: `tag ${input.tag} and version ${input.version} name different releases; the tag for ${input.version} is ${tagForVersion(input.version)}.`,
      };
    }
  }

  for (const [key, max] of [
    ["title", LIMITS.title],
    ["notesCustomer", LIMITS.notesCustomer],
    ["notesFullMd", LIMITS.notesFullMd],
    ["commitMessage", LIMITS.commitMessage],
  ] as const) {
    const text = readText(body, key, max);
    if (!text.ok) return text;
    if (text.value !== undefined) input[key] = text.value;
  }

  for (const key of ["mandatory", "prerelease"] as const) {
    const flag = readFlag(body, key);
    if (!flag.ok) return flag;
    if (flag.value !== undefined) input[key] = flag.value;
  }

  const expected = body.expectedUpdatedAt;
  if (expected !== undefined) {
    if (typeof expected !== "string") {
      return { ok: false, error: "expectedUpdatedAt must be the timestamp the editor loaded." };
    }
    input.expectedUpdatedAt = expected;
  }

  return { ok: true, input };
}
