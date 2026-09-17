import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { composeService } from "./helpers/nas-compose";

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
    expect(caddyfile).toContain("@assets path /assets/*");
    // The immutable header belongs to the hashed-asset handle, never to the shell's.
    expect(caddyfile).toMatch(
      /handle @assets \{[^}]*header Cache-Control "public, max-age=31536000, immutable"[^}]*file_server/,
    );
    expect(caddyfile).toContain("try_files {path} /index.html");
    expect(caddyfile).toContain('header Cache-Control "no-store"');
  });

  it("sends the security headers on every admin response", () => {
    const caddyfile = repoFile("deploy/nas/admin/Caddyfile");

    expect(caddyfile).toContain("header -Server");
    expect(caddyfile).toContain('header X-Content-Type-Options "nosniff"');
    expect(caddyfile).toContain('header X-Frame-Options "DENY"');
    expect(caddyfile).toContain(`header Content-Security-Policy "frame-ancestors 'none'"`);
    expect(caddyfile).toContain('header Referrer-Policy "strict-origin-when-cross-origin"');
    expect(caddyfile).toContain(
      'header Permissions-Policy "camera=(), microphone=(), geolocation=()"',
    );
  });

  it("gives the Pages shell the same security headers as the admin host", () => {
    const caddyfile = repoFile("deploy/nas/admin/Caddyfile");
    const viteConfig = repoFile("vite.config.ts");
    const pagesHeaders = viteConfig.slice(
      viteConfig.indexOf('"/*",'),
      viteConfig.indexOf('"/api/*",'),
    );

    // Every `header Name "value"` the Caddyfile sets (not the -Server removal, not
    // the per-handle Cache-Control) must be in the _headers "/*" block verbatim.
    const caddyHeaders = [...caddyfile.matchAll(/^\theader ([A-Z][\w-]+) "([^"]+)"$/gm)]
      .map(([, name, value]) => ({ name, value }))
      .filter(({ name }) => name !== "Cache-Control");
    expect(caddyHeaders.map(({ name }) => name)).toEqual([
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Content-Security-Policy",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
    for (const { name, value } of caddyHeaders) {
      expect(pagesHeaders, name).toContain(`"  ${name}: ${value}"`);
    }
    // No Cache-Control on "/*": it would merge into the immutable /assets/* rule.
    expect(pagesHeaders).not.toContain("Cache-Control");
  });

  it("health-checks the admin container on its Caddy port in both the image and compose", () => {
    const dockerfile = repoFile("deploy/nas/admin/Dockerfile");

    expect(dockerfile).toMatch(/HEALTHCHECK[^\n]*\n\s+CMD wget -qO- http:\/\/127\.0\.0\.1:8080\//);
    expect(composeService("admin")).toMatch(
      /healthcheck:\n\s+test: \["CMD", "wget", "-qO-", "http:\/\/127\.0\.0\.1:8080\/"\]/,
    );
    expect(composeService("admin")).toMatch(
      /depends_on:\n\s+rr-api:\n\s+condition: service_healthy/,
    );
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

  it("opens /update/* and /release-notes/* on the download host before the 404 catch-all", () => {
    const caddyfile = repoFile("deploy/nas/caddy/Caddyfile");

    for (const [matcher, path] of [
      ["@updateProxy", "/update/*"],
      ["@releaseNotes", "/release-notes/*"],
    ]) {
      expect(caddyfile).toMatch(
        new RegExp(
          `${matcher} \\{[\\s\\S]*?host dl\\.razorreaper\\.app[\\s\\S]*?method GET HEAD[\\s\\S]*?path ${path.replace(/[/*]/g, "\\$&")}[\\s\\S]*?\\}`,
        ),
      );
      expect(caddyfile).toMatch(
        new RegExp(`handle ${matcher} \\{\\s*reverse_proxy rr-api:8787\\s*\\}`),
      );
    }

    // handle blocks are evaluated in written order: both must precede the host-wide 404, and
    // neither may set Cache-Control — rr-api sends the right one per route (design §8).
    const updateAt = caddyfile.indexOf("handle @updateProxy");
    const notesAt = caddyfile.indexOf("handle @releaseNotes");
    const downloadAt = caddyfile.indexOf("handle @download {");
    const notFoundAt = caddyfile.indexOf("@downloadNotFound");
    expect(downloadAt).toBeLessThan(updateAt);
    expect(updateAt).toBeLessThan(notesAt);
    expect(notesAt).toBeLessThan(notFoundAt);
    expect(caddyfile.slice(updateAt, notFoundAt)).not.toContain("header Cache-Control");
  });
});
