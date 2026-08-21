// Type surface of generate-routes.mjs for the vitest suite (tests/rr-api/routes.test.ts).
export interface CollectedRoute {
  method: string | null;
  pattern: string;
  /** posix path relative to functions/, without extension */
  file: string;
  exportName: string;
}

export const FUNCTIONS_DIR: string;
export const OUTPUT_FILE: string;

export function isRouteFile(basename: string): boolean;
export function readHandlerExports(source: string): string[];
export function filePathToPattern(relativePath: string): string;
export function compareRoutes(
  a: { method: string | null; pattern: string },
  b: { method: string | null; pattern: string },
): number;
export function collectRoutes(functionsDir?: string): CollectedRoute[];
export function renderRoutesModule(routes: readonly CollectedRoute[], importBase: string): string;
export function generate(options?: {
  functionsDir?: string;
  outputFile?: string;
}): CollectedRoute[];
