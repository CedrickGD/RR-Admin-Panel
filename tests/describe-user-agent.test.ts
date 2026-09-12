import { describe, expect, it } from "vitest";
import { describeUserAgent } from "../src/utils/userAgent";

describe("describeUserAgent", () => {
  it("names the browser and the platform of a desktop agent", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.120 Safari/537.36",
      ),
    ).toBe("Chrome 128 · Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      ),
    ).toBe("Safari 17 · macOS");
    expect(
      describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0"),
    ).toBe("Firefox 129 · Linux");
  });
  it("prefers the Chromium fork over the Chrome token both forks carry", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.2651.98",
      ),
    ).toBe("Edge 127 · Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0",
      ),
    ).toBe("Opera 112 · macOS");
  });
  it("recognises mobile agents", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 17 · iOS");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome 128 · Android");
  });
  it("falls back instead of inventing a browser", () => {
    expect(describeUserAgent("")).toBe("Unknown browser");
    expect(describeUserAgent(null)).toBe("Unknown browser");
    // The API stores this literal when the request carried no user-agent header.
    expect(describeUserAgent("Unknown browser")).toBe("Unknown browser");
    expect(describeUserAgent("curl/8.7.1")).toBe("curl/8.7.1");
    expect(describeUserAgent("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
  });
});
