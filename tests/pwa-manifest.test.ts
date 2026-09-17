import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function repoPath(path: string): string {
  return fileURLToPath(new URL(`../${path}`, import.meta.url));
}

function repoFile(path: string): string {
  return readFileSync(repoPath(path), "utf8");
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface Manifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: ManifestIcon[];
  prefer_related_applications?: boolean;
}

/** Width/height from the PNG IHDR chunk (bytes 16..24 of any valid PNG). */
function pngDimensions(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.subarray(0, 8).equals(signature)).toBe(true);
  expect(bytes.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Resolves a root-relative manifest URL to its file inside the Vite publicDir. */
function staticFile(url: string): string {
  expect(url.startsWith("/")).toBe(true);
  return repoPath(`static${url}`);
}

const manifest = JSON.parse(repoFile("static/manifest.json")) as Manifest;

/** The dark ground token — the only colour the manifest may name. */
const groundToken = /^\s*--bg:\s*(#[0-9a-f]{6});/m.exec(repoFile("src/theme/tokens/colors.css"));

describe("PWA manifest", () => {
  it("has every member Chromium requires for the install prompt and WebAPK", () => {
    expect(manifest.name).toBe("RazorReaper Operations Console");
    expect(manifest.short_name).toBe("RazorReaper");
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("en");
    expect(manifest.description).toMatch(/^[A-Z][^.]+\.$/);
    expect(manifest.prefer_related_applications).toBeUndefined();
    expect(manifest).not.toHaveProperty("orientation");

    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    // One purpose per file: "any maskable" on a single icon pads the launcher icon.
    for (const icon of manifest.icons) {
      expect(["any", "maskable"]).toContain(icon.purpose);
      expect(icon.type).toBe("image/png");
    }
  });

  it("paints the splash and status bar with the app's existing dark ground", () => {
    expect(groundToken).not.toBeNull();
    const ground = groundToken![1];
    expect(manifest.theme_color).toBe(ground);
    expect(manifest.background_color).toBe(ground);
    expect(repoFile("public/index.html")).toContain(
      `<meta name="theme-color" content="${ground}" />`,
    );
  });

  it("ships every declared icon at exactly the declared pixel size", () => {
    for (const icon of manifest.icons) {
      const file = staticFile(icon.src);
      expect(existsSync(file), icon.src).toBe(true);
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngDimensions(file), icon.src).toEqual({ width, height });
    }
    expect(pngDimensions(repoPath("static/apple-touch-icon.png"))).toEqual({
      width: 180,
      height: 180,
    });
  });

  it("is linked from the shell with credentials so Cloudflare Access lets it through", () => {
    const html = repoFile("public/index.html");
    expect(html).toContain(
      '<link rel="manifest" href="/manifest.json" crossorigin="use-credentials" />',
    );
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(existsSync(repoPath("static/manifest.json"))).toBe(true);
  });

  it("is served un-hashed from the dist root by both hosts", () => {
    const viteConfig = repoFile("vite.config.ts");
    expect(viteConfig).toContain('publicDir: path.resolve(projectRoot, "static")');
    expect(viteConfig).toMatch(/"\/manifest\.json",\s*"  Cache-Control: no-store"/);
    expect(viteConfig).toMatch(/"\/icons\/\*",\s*"  Cache-Control: public, max-age=86400"/);
    // The worker build shares outDir; it must never copy (or clear) the static files.
    expect(repoFile("vite.pages-worker.config.ts")).toContain("publicDir: false");
    expect(repoFile("vite.pages-worker.config.ts")).toContain("emptyOutDir: false");
  });

  it("does not register a service worker", () => {
    // Chromium needs none for the prompt or the WebAPK, and one that answers
    // navigations would swallow the Cloudflare Access login redirect.
    expect(repoFile("src/main.tsx")).not.toContain("serviceWorker");
    expect(repoFile("public/index.html")).not.toContain("serviceWorker");
    expect(existsSync(repoPath("static/sw.js"))).toBe(false);
  });
});
