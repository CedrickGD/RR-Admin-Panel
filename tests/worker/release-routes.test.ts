// The update manifest rewrite, the pinned installer download and the public release-notes page
// (backend-worker/index.js, design §8). Everything goes through the worker's own fetch, with
// GitHub faked exactly the way tests/worker/proxy-mode.test.ts fakes an origin.
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../../backend-worker/index.js";
import { createWorkerHarness, dispatch, workerRequest, type WorkerHarness } from "./helpers";

const CONTENTS_URL =
  "https://api.github.com/repos/CedrickGD/RazorReaper/contents/update.xml?ref=master";
const LATEST_URL = "https://api.github.com/repos/CedrickGD/RazorReaper/releases/latest";
const TAGS_URL = "https://api.github.com/repos/CedrickGD/RazorReaper/releases/tags/";
const ASSET_URL = "https://api.github.com/repos/CedrickGD/RazorReaper/releases/assets/";

/** The manifest as it is committed to the repo: github.com URLs, never NAS ones. */
function committedManifest(
  overrides: { version?: string; url?: string; changelog?: string } = {},
): string {
  const version = overrides.version ?? "1.5.3.0";
  const url =
    overrides.url ??
    "https://github.com/CedrickGD/RazorReaper/releases/download/v1.5.3/RazorReaper-Setup.exe";
  const changelog =
    overrides.changelog ?? "https://github.com/CedrickGD/RazorReaper/releases/tag/v1.5.3";
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<update>",
    `  <version>${version}</version>`,
    `  <url>${url}</url>`,
    `  <changelog>${changelog}</changelog>`,
    "  <mandatory>false</mandatory>",
    "  <args>/VERYSILENT /NORESTART</args>",
    "  <notes>- One calm bullet</notes>",
    "</update>",
    "",
  ].join("\n");
}

function releaseJson(
  overrides: {
    tag?: string;
    assetId?: number;
    assetName?: string | null;
    name?: string;
    body?: string;
    publishedAt?: string | null;
    draft?: boolean;
  } = {},
): Record<string, unknown> {
  const tag = overrides.tag ?? "v1.5.3";
  const assetName =
    overrides.assetName === undefined ? "RazorReaper-Setup.exe" : overrides.assetName;
  return {
    tag_name: tag,
    name: overrides.name ?? `RazorReaper ${tag.replace(/^v/, "")}`,
    body: overrides.body ?? "",
    draft: overrides.draft ?? false,
    published_at:
      overrides.publishedAt === undefined ? "2026-09-12T10:30:00Z" : overrides.publishedAt,
    assets:
      assetName === null
        ? []
        : [{ name: assetName, url: `${ASSET_URL}${overrides.assetId ?? 42}` }],
  };
}

interface GithubFixture {
  /** Raw update.xml, or null for a Contents call that fails. */
  manifest?: string | null;
  /** tag -> release payload. A tag that is absent answers 404. */
  tags?: Record<string, Record<string, unknown>>;
  /** releases/latest payload, or null for a lookup that fails. */
  latest?: Record<string, unknown> | null;
}

function stubGitHub(fixture: GithubFixture): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      urls.push(request.url);

      if (request.url === CONTENTS_URL) {
        if (fixture.manifest == null) return new Response("nope", { status: 404 });
        return new Response(fixture.manifest, { status: 200 });
      }

      if (request.url.startsWith(TAGS_URL)) {
        const tag = decodeURIComponent(request.url.slice(TAGS_URL.length));
        const release = fixture.tags?.[tag];
        if (!release) return new Response("nope", { status: 404 });
        return new Response(JSON.stringify(release), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (request.url === LATEST_URL) {
        if (fixture.latest == null) return new Response("nope", { status: 404 });
        return new Response(JSON.stringify(fixture.latest), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (request.url.startsWith(ASSET_URL)) {
        return new Response(null, {
          status: 302,
          headers: {
            location: `https://release-assets.githubusercontent.com/${request.url.slice(ASSET_URL.length)}.exe`,
          },
        });
      }

      throw new Error(`Unexpected network request in test: ${request.url}`);
    }),
  );
  return { urls };
}

/** Like `dispatch`, but awaits the handler's background work (the free-download counter). */
async function dispatchAndDrain(harness: WorkerHarness, request: Request): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch(request, harness.env, {
    waitUntil: (promise) => {
      pending.push(promise);
    },
  });
  await Promise.allSettled(pending);
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /update/update.xml", () => {
  it("rewrites <url> and <changelog> to this origin, taking the tag from the committed <url>", async () => {
    stubGitHub({ manifest: committedManifest() });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/update/update.xml" }),
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=120");
    expect(xml).toContain("<url>https://backend.test/update/download</url>");
    expect(xml).toContain("<changelog>https://backend.test/release-notes/v1.5.3</changelog>");
    // No github.com URL may survive the rewrite — that is the whole point of serving it here.
    expect(xml).not.toContain("github.com");
    // Everything else is served exactly as committed.
    expect(xml).toContain("<version>1.5.3.0</version>");
    expect(xml).toContain("<notes>- One calm bullet</notes>");
  });

  it("derives the tag from the 3-part <version> when <url> is not a download URL", async () => {
    stubGitHub({
      manifest: committedManifest({ url: "https://example.invalid/RazorReaper-Setup.exe" }),
    });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/update/update.xml" }),
    );

    expect(await response.text()).toContain(
      "<changelog>https://backend.test/release-notes/v1.5.3</changelog>",
    );
  });

  it("leaves <changelog> alone when neither the url nor the version yields a tag", async () => {
    stubGitHub({
      manifest: committedManifest({
        url: "https://example.invalid/RazorReaper-Setup.exe",
        version: "nightly",
      }),
    });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/update/update.xml" }),
    );
    const xml = await response.text();

    expect(xml).toContain(
      "<changelog>https://github.com/CedrickGD/RazorReaper/releases/tag/v1.5.3</changelog>",
    );
    expect(xml).toContain("<url>https://backend.test/update/download</url>");
  });

  it("honours a proxy-requested https upgrade in both rewritten elements", async () => {
    stubGitHub({ manifest: committedManifest() });

    const request = new Request("http://dl.razorreaper.app/update/update.xml", {
      headers: { "x-forwarded-proto": "https" },
    });
    const response = await dispatch(createWorkerHarness(), request);
    const xml = await response.text();

    expect(xml).toContain("<url>https://dl.razorreaper.app/update/download</url>");
    expect(xml).toContain("<changelog>https://dl.razorreaper.app/release-notes/v1.5.3</changelog>");
  });
});

describe("GET /update/download", () => {
  it("serves the asset of the tag update.xml pins, not the newest release", async () => {
    const fake = stubGitHub({
      manifest: committedManifest(),
      tags: { "v1.5.3": releaseJson({ tag: "v1.5.3", assetId: 53 }) },
      latest: releaseJson({ tag: "v1.5.4", assetId: 54 }),
    });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/update/download" }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://release-assets.githubusercontent.com/53.exe",
    );
    expect(fake.urls).toContain(CONTENTS_URL);
    expect(fake.urls).toContain(`${TAGS_URL}v1.5.3`);
    expect(fake.urls).not.toContain(LATEST_URL);
  });

  it("falls back to the latest release when the pinned tag carries no installer", async () => {
    const fake = stubGitHub({
      manifest: committedManifest(),
      tags: { "v1.5.3": releaseJson({ tag: "v1.5.3", assetName: null }) },
      latest: releaseJson({ tag: "v1.5.4", assetId: 54 }),
    });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/update/download" }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://release-assets.githubusercontent.com/54.exe",
    );
    expect(fake.urls).toContain(LATEST_URL);
  });

  it("falls back to the latest release when the manifest itself cannot be read", async () => {
    const fake = stubGitHub({
      manifest: null,
      latest: releaseJson({ tag: "v1.5.4", assetId: 54 }),
    });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/update/download" }),
    );

    expect(response.status).toBe(302);
    expect(fake.urls).not.toContain(`${TAGS_URL}v1.5.3`);
    expect(fake.urls).toContain(LATEST_URL);
  });

  it("/update/download/latest stays latest-wins and never reads the manifest", async () => {
    const fake = stubGitHub({
      manifest: committedManifest(),
      tags: { "v1.5.3": releaseJson({ tag: "v1.5.3", assetId: 53 }) },
      latest: releaseJson({ tag: "v1.5.4", assetId: 54 }),
    });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/update/download/latest" }),
    );

    expect(response.headers.get("location")).toBe(
      "https://release-assets.githubusercontent.com/54.exe",
    );
    expect(fake.urls).not.toContain(CONTENTS_URL);
  });

  it("/update/download/free is pinned too and still counts the handoff", async () => {
    const fake = stubGitHub({
      manifest: committedManifest(),
      tags: { "v1.5.3": releaseJson({ tag: "v1.5.3", assetId: 53 }) },
      latest: releaseJson({ tag: "v1.5.4", assetId: 54 }),
    });
    const harness = createWorkerHarness();

    const response = await dispatchAndDrain(
      harness,
      workerRequest({ path: "/update/download/free" }),
    );

    expect(response.headers.get("location")).toBe(
      "https://release-assets.githubusercontent.com/53.exe",
    );
    expect(fake.urls).toContain(CONTENTS_URL);
    const counterWrites = harness.mock.operations.filter((operation) =>
      operation.values.includes("downloads:free"),
    );
    expect(counterWrites.length).toBeGreaterThan(0);
  });
});

describe("GET /release-notes/:tag", () => {
  it("renders a calm, script-free page and escapes everything in the release body", async () => {
    stubGitHub({
      tags: {
        "v1.5.3": releaseJson({
          tag: "v1.5.3",
          name: 'RazorReaper 1.5.3 <img src=x onerror="alert(1)">',
          body: [
            "## What changed",
            "",
            "- Fixed `<Clip>` handling & trimming",
            "- **Faster** startup",
            "",
            '<script>alert("xss")</script>',
          ].join("\n"),
        }),
      },
    });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/release-notes/v1.5.3" }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=600");

    // Nothing executable survives, in the body or in the release title.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="alert');
    expect(html).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    // The tiny markdown subset still renders.
    expect(html).toContain("<h3>What changed</h3>");
    expect(html).toContain("<li>Fixed <code>&lt;Clip&gt;</code> handling &amp; trimming</li>");
    expect(html).toContain("<li><strong>Faster</strong> startup</li>");
    // Version and date, no customer data.
    expect(html).toContain("Version 1.5.3 · released 2026-09-12");
  });

  it("says so calmly when a published release carries no notes", async () => {
    stubGitHub({ tags: { "v1.5.3": releaseJson({ tag: "v1.5.3", body: "   " }) } });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/release-notes/v1.5.3" }),
    );

    expect(await response.text()).toContain("No notes were published for this release.");
  });

  it("answers HEAD with the headers and no body", async () => {
    stubGitHub({ tags: { "v1.5.3": releaseJson({ tag: "v1.5.3" }) } });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ method: "HEAD", path: "/release-notes/v1.5.3" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=600");
    expect(await response.text()).toBe("");
  });

  it("404s an unknown tag, and never caches that answer", async () => {
    stubGitHub({ tags: {} });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/release-notes/v9.9.9" }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("These release notes are not available.");
  });

  it("404s a draft release — unannounced notes are not public content", async () => {
    stubGitHub({ tags: { "v1.5.4": releaseJson({ tag: "v1.5.4", draft: true }) } });

    const response = await dispatch(
      createWorkerHarness(),
      workerRequest({ path: "/release-notes/v1.5.4" }),
    );

    expect(response.status).toBe(404);
  });

  it("refuses a tag that is not tag-shaped without calling GitHub at all", async () => {
    const fake = stubGitHub({ tags: {} });

    for (const path of ["/release-notes/..%2F..%2Fetc", "/release-notes/%3Cscript%3E"]) {
      const response = await dispatch(createWorkerHarness(), workerRequest({ path }));
      expect(response.status).toBe(404);
    }

    expect(fake.urls).toHaveLength(0);
  });
});
