/**
 * The repository-file denylist the Files tab is built around. Design:
 * docs/release-management-design.md §11.
 *
 * It lives beside the routes rather than inside one because both directions need the same answer:
 * `GET …/files` fills `RepoFile.editable` / `RepoTreeEntry.editable` from it so the browser greys
 * a path out, and `PUT …/files` refuses on it so a client that ignores the flag gets a
 * `403 { code: "denied-path" }` anyway. A flag the server does not also enforce is decoration.
 *
 * `.github/workflows/**` is **not** on the list: it is editable, but only with `workflowsConfirm`
 * and its own modal (§11), which is the write route's business — `isWorkflowPath` is here so both
 * sides spell that prefix once.
 */
import { isGovernedFilePath } from "../../shared/releases-contract";

/** Over this, a blob comes back unreadable and is never editable (§11). */
export const MAX_EDITABLE_FILE_BYTES = 512 * 1024;

export const WORKFLOWS_PREFIX = ".github/workflows/";

/**
 * Repo-relative, no leading slash, no `..` segment. Null when the path escapes the root or is
 * empty — the caller turns that into a `400`, never into a read.
 *
 * A `.` segment is dropped rather than refused, the same leniency `isGovernedFilePath` in the
 * contract applies: `./update.xml` is `update.xml`, and it has to be refused *as* `update.xml`,
 * with the reason that names the actions which own it, not as an unreadable path. A `..` cannot be
 * resolved the same way — it is the traversal itself, so it is the one that ends the walk.
 */
export function normaliseRepoPath(path: string): string | null {
  const trimmed = path.trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.startsWith("/")) return null;
  const segments = trimmed.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) return null;
  if (segments.includes("..")) return null;
  return segments.join("/");
}

export function isWorkflowPath(path: string): boolean {
  return path.toLowerCase().startsWith(WORKFLOWS_PREFIX);
}

interface DeniedPattern {
  test: (path: string) => boolean;
  reason: string;
}

/** Matched against the lower-cased, normalised path, in order; the first match wins. */
const DENIED: DeniedPattern[] = [
  {
    test: (path) => path === ".git" || path.startsWith(".git/"),
    reason: "Git's own directory is not editable from the panel.",
  },
  {
    test: (path) => path.endsWith(".pfx") || path.endsWith(".snk"),
    reason: "Signing material is never read or written by the panel.",
  },
  {
    test: (path) => /(^|\/)[^/]*\.env[^/]*$/.test(path),
    reason: "Environment files are never read or written by the panel.",
  },
  {
    test: (path) => /(^|\/)appsettings[^/]*\.json$/.test(path),
    reason: "Application settings are never read or written by the panel.",
  },
];

const GOVERNED_REASON =
  "update.xml is written only by Publish and Make current, which validate the tag, check the " +
  "installer asset and print an effect list first.";

/**
 * The sentence `RepoFile.editRefusal` carries, or null when the path may be edited. Everything the
 * denylist covers is refused in both directions — reading a pfx or an env file out of the repo
 * through the panel is the same leak as writing one.
 */
export function fileEditRefusal(path: string): string | null {
  const normalised = normaliseRepoPath(path);
  if (!normalised) return "Only a path inside the repository can be opened.";
  if (isGovernedFilePath(normalised)) return GOVERNED_REASON;
  const lower = normalised.toLowerCase();
  return DENIED.find((pattern) => pattern.test(lower))?.reason ?? null;
}

/** True when the path may be read at all: the denylist is a read guard as much as a write guard. */
export function isReadableRepoPath(path: string): boolean {
  const normalised = normaliseRepoPath(path);
  if (!normalised) return false;
  const lower = normalised.toLowerCase();
  // `update.xml` is governed, not secret: the overview already shows every element it carries, so
  // the Files tab may open it read-only. The rest of the denylist is refused outright.
  return isGovernedFilePath(normalised) || !DENIED.some((pattern) => pattern.test(lower));
}
