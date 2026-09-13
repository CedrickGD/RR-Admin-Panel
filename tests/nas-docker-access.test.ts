import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function repoFile(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const compose = repoFile("deploy/nas/compose.yml");
const gateway = repoFile("deploy/nas/docker-gateway/Caddyfile");

/** The block of `compose.yml` belonging to one service, up to the next top-level `  <name>:`. */
function service(name: string): string {
  const match = new RegExp(
    `\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z0-9-]*:\\n|\\nnetworks:)`,
  ).exec(compose);
  if (!match) throw new Error(`service ${name} not found in compose.yml`);
  return match[1];
}

/** Every `path_regexp [name] <re>` in the gateway config, as written. */
function allowlistPatterns(): string[] {
  return [...gateway.matchAll(/^\s*path_regexp\s+\w+\s+(\S+)$/gm)].map((match) => match[1]);
}

/** What the gateway does with a GET path: the matching handle, or "403". */
function verdict(path: string): "list" | "inspect" | "stats" | "403" {
  if (path === "/containers/json") return "list";
  const names = [...gateway.matchAll(/^\s*path_regexp\s+(\w+)\s+(\S+)$/gm)];
  for (const [, name, source] of names)
    if (new RegExp(source).test(path)) return name as "inspect" | "stats";
  return "403";
}

describe("NAS Docker access (F8)", () => {
  it("routes rr-api to the gateway and keeps it off the socket-proxy network", () => {
    const rrApi = service("rr-api");

    expect(rrApi).toContain("DOCKER_PROXY_URL=http://docker-gateway:2375");
    expect(rrApi).toMatch(/networks:\n\s+- default\n\s+- docker-gateway\n/);
    // The whole point: no network path from rr-api to docker-proxy that skips the allowlist.
    expect(rrApi).not.toContain("- docker-proxy");
  });

  it("puts the gateway, and only the gateway, between rr-api and the socket proxy", () => {
    const gatewayService = service("docker-gateway");
    const proxyService = service("docker-proxy");

    expect(gatewayService).toContain("image: caddy:2-alpine");
    expect(gatewayService).toContain("./docker-gateway/Caddyfile:/etc/caddy/Caddyfile:ro");
    expect(gatewayService).toMatch(/networks:\n\s+- docker-gateway\n\s+- docker-proxy\n/);
    expect(gatewayService).not.toContain("ports:");

    expect(proxyService).toContain("CONTAINERS=1");
    expect(proxyService).toContain("POST=0");
    expect(proxyService).toContain("/var/run/docker.sock:/var/run/docker.sock:ro");
    expect(proxyService).toMatch(/networks:\n\s+- docker-proxy\n/);
    expect(proxyService).not.toContain("ports:");

    // docker-gateway is the only service besides docker-proxy on the docker-proxy network.
    const onProxyNet = [
      ...compose.matchAll(
        /\n {2}([a-z][a-z0-9-]*):\n([\s\S]*?)(?=\n {2}[a-z][a-z0-9-]*:\n|\nnetworks:)/g,
      ),
    ]
      .filter(([, , body]) => /networks:\n(?:\s+- \S+\n)*\s+- docker-proxy\n/.test(body))
      .map(([, name]) => name);
    expect(onProxyNet.sort()).toEqual(["docker-gateway", "docker-proxy"]);

    expect(compose).toMatch(/\n {2}docker-gateway:\n {4}internal: true\n/);
    expect(compose).toMatch(/\n {2}docker-proxy:\n {4}internal: true\n/);
  });

  it("allows exactly the three requests the System health page makes", () => {
    expect(verdict("/containers/json")).toBe("list");
    expect(verdict("/containers/razorreaper-rr-api-1/json")).toBe("inspect");
    expect(verdict("/containers/razorreaper-admin-1/json")).toBe("inspect");
    expect(verdict("/containers/razorreaper-bot-1/stats")).toBe("stats");
    expect(verdict("/containers/razorreaper-docker-gateway-1/stats")).toBe("stats");

    expect(gateway).toContain(
      "rewrite * /containers/json?all=1&filters=%7B%22label%22%3A%5B%22com.docker.compose.project%3Drazorreaper%22%5D%7D",
    );
    expect(gateway).toContain("rewrite * {http.request.uri.path}?stream=false");
    // Anything not matched by a handle falls through to the catch-all.
    expect(gateway).toMatch(/handle \{\n\s+respond "[^"]*" 403\n\s+\}/);
    expect([...gateway.matchAll(/reverse_proxy \S+/g)].map((m) => m[0])).toEqual([
      "reverse_proxy docker-proxy:2375",
      "reverse_proxy docker-proxy:2375",
      "reverse_proxy docker-proxy:2375",
    ]);
  });

  it("rejects every escalation the socket proxy would otherwise permit", () => {
    for (const path of [
      // Config.Env of the bot: Discord TOKEN, NOTIFIER_*, VERIFY_*.
      "/containers/razorreaper-bot-1/json",
      // Arbitrary files out of any container, e.g. the tunnel credentials.
      "/containers/razorreaper-cloudflared-1/archive",
      "/containers/razorreaper-rr-api-1/archive",
      "/containers/razorreaper-bot-1/logs",
      "/containers/razorreaper-bot-1/top",
      "/containers/razorreaper-bot-1/changes",
      "/containers/razorreaper-bot-1/export",
      // Containers outside this compose project.
      "/containers/homeassistant-app-1/json",
      "/containers/homeassistant-app-1/stats",
      "/containers/firefox-app-1/json",
      // Other Docker API sections.
      "/images/json",
      "/info",
      "/version",
      "/_ping",
      "/networks",
      "/volumes",
      "/containers/razorreaper-rr-api-1/json/../../../images/json",
    ])
      expect([path, verdict(path)]).toEqual([path, "403"]);
  });

  it("never widens the allowlist past this compose project", () => {
    const patterns = allowlistPatterns();

    expect(patterns).toHaveLength(2);
    for (const pattern of patterns) {
      // Anchored at both ends and scoped to this project's containers: no prefix match, no
      // suffix smuggling (".../json/../archive"), no other host's containers.
      expect([pattern, pattern.startsWith("^/containers/razorreaper-")]).toEqual([pattern, true]);
      expect([pattern, pattern.endsWith("$")]).toEqual([pattern, true]);
    }
  });

  it("names only real compose services in the inspect allowlist, and never the bot", () => {
    const allowed = /razorreaper-\(([a-z0-9|-]+)\)-\[0-9\]\+\/json/.exec(gateway)?.[1].split("|");
    expect(allowed).toBeDefined();
    const services = [
      ...compose.matchAll(/\n {2}([a-z][a-z0-9-]*):\n {4}(?:image|build|restart):/g),
    ].map((match) => match[1]);
    expect(services).toContain("bot");
    // Inspect is a positive list: no typos, no stale names, and the bot is left out on purpose
    // because its Config.Env holds secrets rr-api does not already have.
    for (const name of allowed!) expect(services).toContain(name);
    expect(allowed).not.toContain("bot");
  });
});
