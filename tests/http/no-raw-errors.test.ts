import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Source scan: no Pages Function may hand a caught error's text to the client. Public 500 bodies
 * go through `internalError(request, message, cause)` (stable message + request id, cause only
 * in the log); everything else stays a fixed string. Flags `err.message`, `dataError.message`,
 * `bodyError.stack`, … inside any `return error(...)` call; result objects such as
 * `validation.error.message` or `identity.message` are not caught exceptions and pass.
 */

const API_ROOT = fileURLToPath(new URL("../../functions/api/", import.meta.url));
const RETURN_ERROR_CALL = /\breturn\s+error\s*\(/gu;
const CAUGHT_ERROR_TEXT = /(?<![\w$.])[\w$]*(?:err|error)\.(?:message|stack)\b/iu;

interface Violation {
  file: string;
  line: number;
  call: string;
}

function listApiSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listApiSources(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files.sort();
}

interface CallText {
  /** The call as written. */
  text: string;
  /** The call with string-literal contents blanked, so quoted prose cannot trip the scan. */
  code: string;
}

/** The `error(...)` call starting at `openParen` (balanced parens, string-literal aware). */
function readCall(source: string, openParen: number): CallText {
  let depth = 0;
  let quote: string | null = null;
  let code = "";
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
        code += char;
      }
      continue;
    }
    code += char;
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return { text: source.slice(openParen, index + 1), code };
      }
    }
  }
  return { text: source.slice(openParen), code };
}

function findViolations(source: string, file: string): Violation[] {
  const violations: Violation[] = [];
  for (const match of source.matchAll(RETURN_ERROR_CALL)) {
    const openParen = match.index + match[0].length - 1;
    const call = readCall(source, openParen);
    if (CAUGHT_ERROR_TEXT.test(call.code)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push({ file, line, call: call.text.replace(/\s+/gu, " ") });
    }
  }
  return violations;
}

describe("functions/api never returns raw error text", () => {
  const files = listApiSources(API_ROOT);

  it("scans the whole Pages API tree", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it("the scanner recognises the forbidden patterns", () => {
    const samples = [
      'return error(500, "Failed.", err instanceof Error ? err.message : null);',
      'return error(\n  500,\n  "Failed.",\n  dataError instanceof Error ? dataError.message : null,\n);',
      'return error(400, bodyError instanceof Error ? bodyError.message : "Invalid request.");',
      'return error(500, "Failed.", String(err.stack));',
    ];
    for (const sample of samples) {
      expect(findViolations(sample, "sample.ts")).toHaveLength(1);
    }

    const allowed = [
      "return error(400, validation.error.message);",
      "return error(500, identity.message);",
      'return error(400, "A (fixed) message with err.message inside a string.");',
      'return internalError(context.request, "Unable to complete the request.", err);',
    ];
    for (const sample of allowed) {
      expect(findViolations(sample, "sample.ts")).toHaveLength(0);
    }
  });

  it("no `return error(...)` call carries a caught error's message or stack", () => {
    const violations = files.flatMap((file) =>
      findViolations(readFileSync(file, "utf8"), relative(API_ROOT, file).split(sep).join("/")),
    );

    expect(
      violations.map((violation) => `${violation.file}:${violation.line} ${violation.call}`),
    ).toEqual([]);
  });

  it("the Discord bot endpoints accept the shared secret only as a Bearer token", () => {
    for (const name of ["verify.ts", "status.ts"]) {
      const source = readFileSync(join(API_ROOT, "discord", name), "utf8");
      expect(source).not.toMatch(/searchParams\.get\(\s*["']secret["']\s*\)/u);
    }
  });
});
