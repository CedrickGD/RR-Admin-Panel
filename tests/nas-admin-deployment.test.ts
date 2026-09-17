import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function repoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");
}

describe("NAS admin deployment", () => {
  it("builds the frontend into a Caddy runtime image", () => {
    const dockerfile = repoFile("deploy/nas/admin/Dockerfile");

    expect(dockerfile).toContain("RUN npx vite build");
    expect(dockerfile).toContain("FROM caddy:2-alpine AS runtime");
    expect(dockerfile).toContain("COPY --from=build /repo/dist /srv/admin");
    expect(dockerfile).toContain("COPY shared ./shared");
    // PWA manifest + icons come from the Vite publicDir (top-level static/);
    // without this COPY the image would build a panel Chrome cannot install.
    expect(dockerfile).toContain("COPY static ./static");
    expect(dockerfile).toContain("COPY public ./public");
    expect(dockerfile).toContain("COPY src ./src");
    expect(repoFile("vite.config.ts")).toContain('publicDir: path.resolve(projectRoot, "static")');
    // BuildKit reads the ignore next to the Dockerfile; the legacy builder falls back to the
    // root one. Neither may exclude a directory the admin Dockerfile copies, and none of the
    // three may drag the local harness output into the build context.
    for (const ignore of ["deploy/nas/admin/Dockerfile.dockerignore", ".dockerignore"]) {
      expect(repoFile(ignore), ignore).not.toMatch(/^(public|src|static|shared)\/?$/m);
    }
    for (const ignore of [
      "deploy/nas/admin/Dockerfile.dockerignore",
      "deploy/nas/rr-api/Dockerfile.dockerignore",
      ".dockerignore",
    ]) {
      expect(repoFile(ignore), ignore).toMatch(/^\.local$/m);
      expect(repoFile(ignore), ignore).toMatch(/^\.superdesign$/m);
    }
  });

  it("keeps APIs same-origin and forwards Access and CSRF identity headers", () => {
    const caddyfile = repoFile("deploy/nas/admin/Caddyfile");

    expect(caddyfile).toContain("@backend path /api /api/* /v1 /v1/*");
    expect(caddyfile).toContain("reverse_proxy rr-api:8787");
    expect(caddyfile).toContain("header_up Host {http.request.host}");
    expect(caddyfile).toContain("header_up Origin {http.request.header.Origin}");
    expect(caddyfile).toContain(
      "header_up Cf-Access-Jwt-Assertion {http.request.header.Cf-Access-Jwt-Assertion}",
    );
    expect(caddyfile).toContain("header_up X-RR-Origin-Key {$ORIGIN_KEY}");
    expect(caddyfile).toContain("header_up -X-RR-Origin-Key");
    expect(caddyfile).toContain("header_up -X-RR-Client-IP");
    expect(caddyfile).toContain("header_up X-RR-Client-IP {http.request.header.Cf-Connecting-Ip}");
    expect(caddyfile).toContain("header_up X-RR-Forwarded-Host {http.request.host}");
    expect(caddyfile).toContain("header_up X-RR-Forwarded-Proto https");
  });

  it("serves immutable hashed assets but never caches the SPA shell", () => {
    const caddyfile = repoFile("deploy/nas/admin/Caddyfile");

    expect(caddyfile).toContain("encode zstd gzip");
    expect(caddyfile).toContain('header Cache-Control "public, max-age=31536000, immutable"');
    expect(caddyfile).toContain("try_files {path} /index.html");
    expect(caddyfile).toContain('header Cache-Control "no-store"');
  });

  it("caches the un-hashed PWA icons for a day, like the Pages _headers", () => {
    const caddyfile = repoFile("deploy/nas/admin/Caddyfile");
    const viteConfig = repoFile("vite.config.ts");

    expect(caddyfile).toContain("@pwaIcons path /icons/* /apple-touch-icon.png");
    expect(caddyfile).toMatch(
      /handle @pwaIcons \{[^}]*header Cache-Control "public, max-age=86400"[^}]*file_server/,
    );
    // The manifest names the icons and must not be pinned by a stale copy.
    expect(caddyfile).not.toMatch(/@pwaIcons path[^\n]*manifest/);
    expect(viteConfig).toMatch(/"\/icons\/\*",\s*"  Cache-Control: public, max-age=86400"/);
    expect(viteConfig).toMatch(
      /"\/apple-touch-icon\.png",\s*"  Cache-Control: public, max-age=86400"/,
    );
    expect(viteConfig).toMatch(/"\/manifest\.json",\s*"  Cache-Control: no-store"/);
  });

  it("deploys only what the remote head has, names its services and prunes old images", () => {
    const script = repoFile("tools/deploy-nas.ps1");

    // The guard must look at origin's real head, not a stale remote-tracking ref.
    expect(script.indexOf("git fetch -q origin $Ref")).toBeGreaterThan(-1);
    expect(script.indexOf("git fetch -q origin $Ref")).toBeLessThan(
      script.indexOf('git rev-parse --short "origin/$Ref"'),
    );
    expect(script).toContain("if ($localHead -ne $remoteHead)");
    // Never a bare `docker compose up`: the service list is explicit (section 0).
    expect(script).toContain("docker compose up -d --build $Services");
    expect(script).toContain("docker image prune -f");
    // An empty asset listing is a warning, not a failed deploy after the fact.
    expect(script).toContain("|| echo 'admin: no index-* assets found'");
    expect(script).not.toContain("restart cloudflared");
  });

  it("wires the service and tunnel hostname without publishing a NAS port", () => {
    const compose = repoFile("deploy/nas/compose.yml");
    const tunnel = repoFile("deploy/nas/cloudflared/config.yml");

    expect(compose).toMatch(/\n  admin:\n[\s\S]*dockerfile: deploy\/nas\/admin\/Dockerfile/);
    expect(compose).toContain("env_file: ${DATA_DIR}/env/admin.env");
    expect(compose).not.toMatch(/\n  admin:\n[\s\S]*?\n    ports:/);
    expect(tunnel).toContain("hostname: admin.razorreaper.app");
    expect(tunnel).toContain("service: http://admin:8080");
  });

  it("keeps the stable download hostname routed to the latest installer", () => {
    const caddyfile = repoFile("deploy/nas/caddy/Caddyfile");
    const tunnel = repoFile("deploy/nas/cloudflared/config.yml");

    expect(tunnel).toMatch(/hostname: dl\.razorreaper\.app\s+service: http:\/\/caddy:8080/);
    expect(caddyfile).toMatch(
      /@download \{[\s\S]*host dl\.razorreaper\.app[\s\S]*method GET[\s\S]*path \//,
    );
    expect(caddyfile).toMatch(
      /handle @download \{[\s\S]*header Cache-Control "no-store"[\s\S]*rewrite \* \/update\/download\/free[\s\S]*reverse_proxy rr-api:8787/,
    );
    expect(caddyfile).toContain("rewrite * /update/download/free");
    expect(caddyfile).toContain("reverse_proxy rr-api:8787");
  });
});
