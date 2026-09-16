import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** A file of this repository as text, CRLF normalised so line-anchored regexes match on Windows. */
export function repoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const compose = repoFile("deploy/nas/compose.yml");

/**
 * The block of `deploy/nas/compose.yml` belonging to one service, up to the next top-level
 * `  <name>:` (comment lines in between stay with the block before them).
 */
export function composeService(name: string): string {
  const match = new RegExp(
    `\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z0-9-]*:\\n|\\nnetworks:)`,
  ).exec(compose);
  if (!match) throw new Error(`service ${name} not found in compose.yml`);
  return match[1];
}
