import { describe, expect, it } from "vitest";

import { enforceSameOriginMutation } from "../../functions/_lib/csrf";

const ORIGIN = "https://admin.test";

function request(method: string, headers: Record<string, string> = {}, body?: BodyInit): Request {
  return new Request(`${ORIGIN}/api/admin/example`, { method, headers, body });
}

async function status(response: Response | null): Promise<number | null> {
  return response ? response.status : null;
}

describe("enforceSameOriginMutation", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("ignores %s requests entirely", (method) => {
    expect(
      enforceSameOriginMutation(
        request(method, { "sec-fetch-site": "cross-site", origin: "https://evil.test" }),
      ),
    ).toBeNull();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "allows a %s with sec-fetch-site: same-origin and no body",
    (method) => {
      expect(
        enforceSameOriginMutation(request(method, { "sec-fetch-site": "same-origin" })),
      ).toBeNull();
    },
  );

  it("allows sec-fetch-site: none (direct navigation / non-browser clients)", () => {
    expect(enforceSameOriginMutation(request("POST", { "sec-fetch-site": "none" }))).toBeNull();
  });

  it.each(["cross-site", "same-site", "CROSS-SITE", "weird"])(
    "rejects sec-fetch-site: %s with 403",
    async (value) => {
      const response = enforceSameOriginMutation(request("POST", { "sec-fetch-site": value }));

      await expect(status(response)).resolves.toBe(403);
      await expect(response!.json()).resolves.toMatchObject({ ok: false });
    },
  );

  it("rejects an Origin header whose host differs from the request host", async () => {
    await expect(
      status(enforceSameOriginMutation(request("POST", { origin: "https://evil.test" }))),
    ).resolves.toBe(403);
    await expect(
      status(enforceSameOriginMutation(request("POST", { origin: "https://admin.test:8443" }))),
    ).resolves.toBe(403);
    await expect(
      status(enforceSameOriginMutation(request("POST", { origin: "null" }))),
    ).resolves.toBe(403);
  });

  it("allows an Origin header that matches the request host", () => {
    expect(enforceSameOriginMutation(request("DELETE", { origin: ORIGIN }))).toBeNull();
    expect(enforceSameOriginMutation(request("POST", { origin: "https://ADMIN.test" }))).toBeNull();
  });

  it("rejects a body that is not JSON with 415", async () => {
    const textBody = enforceSameOriginMutation(
      request("POST", { "content-type": "text/plain", "content-length": "5" }, "hello"),
    );
    const formBody = enforceSameOriginMutation(
      request(
        "POST",
        { "content-type": "application/x-www-form-urlencoded", "content-length": "3" },
        "a=b",
      ),
    );
    const noType = enforceSameOriginMutation(request("PUT", { "content-length": "2" }, "{}"));
    const chunked = enforceSameOriginMutation(
      request("PATCH", { "transfer-encoding": "chunked", "content-type": "text/plain" }, "x"),
    );

    await expect(status(textBody)).resolves.toBe(415);
    await expect(status(formBody)).resolves.toBe(415);
    await expect(status(noType)).resolves.toBe(415);
    await expect(status(chunked)).resolves.toBe(415);
    await expect(textBody!.json()).resolves.toMatchObject({ ok: false });
  });

  it("detects a body even without a content-length header", async () => {
    // Node's Request does not synthesize content-length; the guard must still see the body.
    const response = enforceSameOriginMutation(
      request("POST", { "content-type": "text/plain" }, "x"),
    );

    await expect(status(response)).resolves.toBe(415);
  });

  it("allows a JSON body (with parameters and mixed case)", () => {
    expect(
      enforceSameOriginMutation(
        request("POST", { "content-type": "application/json", "content-length": "2" }, "{}"),
      ),
    ).toBeNull();
    expect(
      enforceSameOriginMutation(
        request("PUT", { "content-type": "Application/JSON; charset=utf-8" }, "{}"),
      ),
    ).toBeNull();
  });

  it("treats content-length: 0 as no body regardless of content-type", () => {
    expect(
      enforceSameOriginMutation(
        request("POST", { "content-type": "text/plain", "content-length": "0" }),
      ),
    ).toBeNull();
  });

  it("checks sec-fetch-site before origin and origin before the body type", async () => {
    const response = enforceSameOriginMutation(
      request(
        "POST",
        {
          "sec-fetch-site": "cross-site",
          origin: "https://evil.test",
          "content-type": "text/plain",
          "content-length": "1",
        },
        "x",
      ),
    );

    await expect(status(response)).resolves.toBe(403);
  });
});
