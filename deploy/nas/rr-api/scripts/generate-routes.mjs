#!/usr/bin/env node
// Build-time route table for rr-api: walks functions/api/** and functions/v1/** and turns the
// Cloudflare Pages file-routing conventions into a static, esbuild-bundlable module
// (src/routes.generated.ts). Run via `npm run routes` (also part of `npm run build`).
//
//   index.ts            -> the directory path          (functions/api/feedback/index.ts -> /api/feedback)
//   name.ts             -> /name                       (functions/api/health.ts -> /api/health)
//   [name].ts           -> :name                       (functions/api/admin/licenses/[key]/revoke.ts)
//   [[name]].ts         -> :name* (catch-all)          (params.name is an array of segments)
//   onRequest           -> every method (method: null)
//   onRequestGet|Post|… -> that method only
//
// Routes are sorted like Pages (wrangler's compareRoutes): more segments first, then per segment
// static > param > wildcard, then method-specific before method-less, then path order.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RR_API_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(RR_API_ROOT, "../../..");
const FUNCTIONS_DIR = join(REPO_ROOT, "functions");
const OUTPUT_FILE = join(RR_API_ROOT, "src", "routes.generated.ts");
const ROUTE_ROOTS = ["api", "v1"];

const HANDLER_METHODS = {
  onRequest: null,
  onRequestGet: "GET",
  onRequestHead: "HEAD",
  onRequestPost: "POST",
  onRequestPut: "PUT",
  onRequestPatch: "PATCH",
  onRequestDelete: "DELETE",
  onRequestOptions: "OPTIONS",
};

function toPosix(path) {
  return path.split("\\").join("/");
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|js|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

/** Names of the exported `onRequest*` handlers in a module (declarations and re-exports). */
export function readHandlerExports(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let)\s+(onRequest[A-Za-z]*)\b/g,
  )) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const exported = /\sas\s/.test(trimmed) ? trimmed.split(/\s+as\s+/)[1] : trimmed;
      if (exported && exported.trim().startsWith("onRequest")) {
        names.add(exported.trim());
      }
    }
  }
  return [...names].filter((name) => name in HANDLER_METHODS);
}

/** Maps a path relative to functions/ (posix, no extension) onto a Pages route pattern. */
export function filePathToPattern(relativePath) {
  const segments = relativePath.split("/");
  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }
  const mapped = segments.map((segment) => {
    const catchAll = /^\[\[(.+)\]\]$/.exec(segment);
    if (catchAll) return `:${catchAll[1]}*`;
    const param = /^\[(.+)\]$/.exec(segment);
    if (param) return `:${param[1]}`;
    return segment;
  });
  return "/" + mapped.join("/");
}

function segmentRank(segment) {
  if (segment.startsWith(":") && segment.endsWith("*")) return 2;
  if (segment.startsWith(":")) return 1;
  return 0;
}

/** Pages precedence: more segments first, static before param before wildcard, method before any. */
export function compareRoutes(a, b) {
  const segmentsA = a.pattern.slice(1).split("/");
  const segmentsB = b.pattern.slice(1).split("/");
  if (segmentsA.length !== segmentsB.length) {
    return segmentsB.length - segmentsA.length;
  }
  for (let index = 0; index < segmentsA.length; index += 1) {
    const rankA = segmentRank(segmentsA[index]);
    const rankB = segmentRank(segmentsB[index]);
    if (rankA !== rankB) return rankA - rankB;
  }
  if (a.method && !b.method) return -1;
  if (!a.method && b.method) return 1;
  if (a.pattern !== b.pattern) return a.pattern < b.pattern ? -1 : 1;
  if (a.method === b.method) return 0;
  return String(a.method) < String(b.method) ? -1 : 1;
}

/**
 * Collects `{ method, pattern, file, exportName }` entries for every handler under the route
 * roots of `functionsDir`. `file` is posix-relative to `functionsDir` without extension.
 */
export function collectRoutes(functionsDir = FUNCTIONS_DIR) {
  const routes = [];
  for (const root of ROUTE_ROOTS) {
    const rootDir = join(functionsDir, root);
    let files;
    try {
      files = walk(rootDir);
    } catch {
      continue;
    }
    for (const file of files) {
      const relativeFile = toPosix(relative(functionsDir, file));
      const withoutExtension = relativeFile.replace(/\.(ts|js|mjs)$/, "");
      const pattern = filePathToPattern(withoutExtension);
      const source = readFileSync(file, "utf8");
      for (const exportName of readHandlerExports(source)) {
        routes.push({
          method: HANDLER_METHODS[exportName],
          pattern,
          file: withoutExtension,
          exportName,
        });
      }
    }
  }
  return routes.sort(compareRoutes);
}

/** Renders the TypeScript module; `importBase` is the posix path from the output dir to functions/. */
export function renderRoutesModule(routes, importBase) {
  const files = [...new Set(routes.map((route) => route.file))];
  const aliases = new Map(files.map((file, index) => [file, `m${index}`]));
  const lines = [
    "// AUTO-GENERATED by scripts/generate-routes.mjs — do not edit by hand.",
    "// Regenerate with `npm run routes` inside deploy/nas/rr-api.",
    'import type { GeneratedRoute } from "./router";',
    "",
  ];
  for (const file of files) {
    lines.push(`import * as ${aliases.get(file)} from "${posix.join(importBase, file)}";`);
  }
  lines.push("", "export const routes: GeneratedRoute[] = [");
  for (const route of routes) {
    const method = route.method === null ? "null" : JSON.stringify(route.method);
    const handler = `${aliases.get(route.file)}.${route.exportName}`;
    lines.push(
      `  { method: ${method}, pattern: ${JSON.stringify(route.pattern)}, handler: ${handler} },`,
    );
  }
  lines.push("];", "");
  return lines.join("\n");
}

export function generate({ functionsDir = FUNCTIONS_DIR, outputFile = OUTPUT_FILE } = {}) {
  const routes = collectRoutes(functionsDir);
  const importBase = toPosix(relative(dirname(outputFile), functionsDir));
  const source = renderRoutesModule(
    routes,
    importBase.startsWith(".") ? importBase : `./${importBase}`,
  );
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, source, "utf8");
  return routes;
}

export { FUNCTIONS_DIR, OUTPUT_FILE };

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const routes = generate();
  console.log(`routes: wrote ${routes.length} entries to ${relative(process.cwd(), OUTPUT_FILE)}`);
}
