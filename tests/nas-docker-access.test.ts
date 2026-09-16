import { describe, expect, it } from "vitest";

import { composeService as service, repoFile } from "./helpers/nas-compose";

const compose = repoFile("deploy/nas/compose.yml");
const gateway = repoFile("deploy/nas/docker-gateway/Caddyfile");

interface Matcher {
  name: string;
  methods: string[];
  /** Exact `path` values (Caddy matches these case-insensitively, without regex). */
  paths: string[];
  /** `path_regexp` sources. */
  patterns: string[];
}

/**
 * Every named matcher in the Caddyfile, as written. This is an intent pin: it says which shapes
 * the config is *meant* to let through, so a later edit that widens it fails here. It is not a
 * proof that Caddy behaves this way — that was run against caddy:2-alpine itself, in an isolated
 * throwaway compose project on the NAS with a stub upstream (see the branch report); every
 * inspect path answered 403 there, list and stats 200.
 */
function matchers(): Matcher[] {
  // Anchored at the start of a line so `handle @list {` is not read as a second definition.
  return [...gateway.matchAll(/^[ \t]*@(\w+)\s*\{([^}]*)\}/gm)].map(([, name, body]) => ({
    name,
    methods: [...body.matchAll(/^\s*method\s+(.+)$/gm)].flatMap(([, value]) => value.split(/\s+/)),
    paths: [...body.matchAll(/^\s*path\s+(\S+)\s*$/gm)].map(([, value]) => value),
    patterns: [...body.matchAll(/^\s*path_regexp\s+\w+\s+(\S+)\s*$/gm)].map(([, value]) => value),
  }));
}

/** What the config says it does with a request: the matcher that claims it, or "403". */
function verdict(method: string, path: string): string {
  for (const matcher of matchers()) {
    if (!matcher.methods.includes(method)) continue;
    if (matcher.paths.some((value) => value.toLowerCase() === path.toLowerCase()))
      return matcher.name;
    if (matcher.patterns.some((source) => new RegExp(source).test(path))) return matcher.name;
  }
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

  it("allows exactly the two requests the System health page makes", () => {
    expect(verdict("GET", "/containers/json")).toBe("list");
    expect(verdict("GET", "/containers/razorreaper-bot-1/stats")).toBe("stats");
    expect(verdict("GET", "/containers/razorreaper-docker-gateway-1/stats")).toBe("stats");

    expect(gateway).toContain(
      "rewrite * /containers/json?all=1&filters=%7B%22label%22%3A%5B%22com.docker.compose.project%3Drazorreaper%22%5D%7D",
    );
    expect(gateway).toContain("rewrite * {http.request.uri.path}?stream=false");
    // Anything not matched by a handle falls through to the catch-all.
    expect(gateway).toMatch(/handle \{\n\s+respond "[^"]*" 403\n\s+\}/);
    expect([...gateway.matchAll(/reverse_proxy \S+/g)].map((match) => match[0])).toEqual([
      "reverse_proxy docker-proxy:2375",
      "reverse_proxy docker-proxy:2375",
    ]);
  });

  it("refuses inspect for every container, this project's own included", () => {
    // The escalation: /containers/<name>/json returns Config.Env, and admin.env holds ORIGIN_KEY
    // while rr-api.env holds the ingest tokens, the app keys and JWT_SECRET — so there is no
    // "safe" container to inspect, not even the caller's own. Caddy cannot filter fields out of a
    // proxied JSON body, so the path is blocked rather than trimmed.
    for (const name of [
      "admin",
      "backup",
      "bot",
      "caddy",
      "cloudflared",
      "docker-gateway",
      "docker-proxy",
      "rr-api",
    ])
      expect([name, verdict("GET", `/containers/razorreaper-${name}-1/json`)]).toEqual([
        name,
        "403",
      ]);

    // No allowlist of service names survives anywhere in the config.
    expect(gateway).not.toMatch(/path(?:_regexp)?[^\n]*\([a-z0-9|-]*\|[a-z0-9|-]*\)/);
    // The only `/json` the config names is the project-wide container list.
    const jsonPaths = [...gateway.matchAll(/^\s*path(?:_regexp \w+)? (\S*json\S*)$/gm)].map(
      (match) => match[1],
    );
    expect(jsonPaths).toEqual(["/containers/json"]);
  });

  it("rejects every other escalation the socket proxy would otherwise permit", () => {
    for (const path of [
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
      // Suffix smuggling onto an allowed prefix.
      "/containers/razorreaper-rr-api-1/stats/../json",
      "/containers/json/../razorreaper-bot-1/json",
    ])
      expect([path, verdict("GET", path)]).toEqual([path, "403"]);

    // Every matcher is GET-only, so no method that could change the host gets through even on an
    // allowed path; docker-proxy's POST=0 is the second lock, not the first.
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) {
      expect([method, verdict(method, "/containers/json")]).toEqual([method, "403"]);
      expect([method, verdict(method, "/containers/razorreaper-bot-1/stats")]).toEqual([
        method,
        "403",
      ]);
    }
    for (const matcher of matchers())
      expect([matcher.name, matcher.methods]).toEqual([matcher.name, ["GET"]]);
  });

  it("never widens the allowlist past this compose project", () => {
    const patterns = matchers().flatMap((matcher) => matcher.patterns);

    expect(patterns).toHaveLength(1);
    for (const pattern of patterns) {
      // Anchored at both ends and scoped to this project's containers: no prefix match, no
      // suffix smuggling (".../stats/../json"), no other host's containers.
      expect([pattern, pattern.startsWith("^/containers/razorreaper-")]).toEqual([pattern, true]);
      expect([pattern, pattern.endsWith("$")]).toEqual([pattern, true]);
    }
  });

  it("documents the real reason inspect is closed, not the old bot-only story", () => {
    const readme = repoFile("deploy/nas/README.md");
    // admin.env holds ORIGIN_KEY and rr-api.env holds the ingest tokens and JWT_SECRET, so the
    // comment that used to call the bot the only container with secrets was simply wrong.
    for (const text of [gateway, readme]) {
      expect(text).not.toMatch(/secrets rr-api does not already have/i);
      expect(text).toContain("ORIGIN_KEY");
      expect(text).toContain("JWT_SECRET");
    }
    expect(compose).not.toMatch(/secrets rr-api does not already have/i);
  });
});

describe("rr-api build stamp (F11)", () => {
  it("carries BUILD_SHA in the image only, never as an env override", () => {
    const rrApi = service("rr-api");

    expect(rrApi).toContain("BUILD_SHA: ${BUILD_SHA:-}");
    // `environment:` beats `env_file:` beats the image ENV, so a compose-level BUILD_SHA would
    // pin the value to whatever the *deploying shell* had, not to what the image was built from.
    expect(rrApi).not.toMatch(/^\s+- BUILD_SHA=/m);
    expect(repoFile("deploy/nas/rr-api/Dockerfile")).toContain("ENV BUILD_SHA=${BUILD_SHA}");
  });

  it("keeps an empty BUILD_SHA out of the env file template", () => {
    // An empty key here wins over the image ENV and blanks the commit on System health.
    expect(repoFile("deploy/nas/rr-api/.env.example")).not.toMatch(/^BUILD_SHA=/m);
  });

  it("documents a build command that stamps the commit", () => {
    const readme = repoFile("deploy/nas/README.md");
    // Every documented build that rebuilds rr-api (whole stack, or `--build rr-api`) must carry
    // the stamp; `--build admin` alone does not touch the rr-api image.
    const builds = [...readme.matchAll(/^.*docker compose up -d --build(?: \S+)?.*$/gm)]
      .map((match) => match[0])
      .filter((line) => !/--build (?!rr-api)\S/.test(line));

    expect(builds.length).toBeGreaterThan(2);
    for (const line of builds)
      expect([line, /BUILD_SHA=\$\(git rev-parse --short HEAD\)/.test(line)]).toEqual([line, true]);
  });
});
