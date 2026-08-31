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
      /handle @download \{[\s\S]*header Cache-Control "no-store"[\s\S]*rewrite \* \/update\/download[\s\S]*reverse_proxy rr-api:8787/,
    );
    expect(caddyfile).toContain("rewrite * /update/download");
    expect(caddyfile).toContain("reverse_proxy rr-api:8787");
  });
});
