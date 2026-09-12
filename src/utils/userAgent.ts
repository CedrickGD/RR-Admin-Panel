/**
 * Turns a raw user-agent string into something an owner can recognise in the session
 * list ("Chrome 128 · Windows"). Pure string work: no feature detection, no network,
 * and never throws — an unparsable agent falls back to "Unknown browser".
 */
const BROWSERS: ReadonlyArray<[RegExp, string]> = [
  // Order matters: Chromium forks all carry "Chrome/" in their agent, so the fork
  // markers have to be tested before Chrome, and "Version/… Safari" last of all.
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/\bOPR\/(\d+)/, "Opera"],
  [/\bVivaldi\/(\d+)/, "Vivaldi"],
  [/\bSamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/\bFirefox\/(\d+)/, "Firefox"],
  [/\bFxiOS\/(\d+)/, "Firefox"],
  [/\bCriOS\/(\d+)/, "Chrome"],
  [/\bChrome\/(\d+)/, "Chrome"],
  [/\bVersion\/(\d+)[.\d]*\s+(?:Mobile\/\S+\s+)?Safari\b/, "Safari"],
];

const PLATFORMS: ReadonlyArray<[RegExp, string]> = [
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows NT\b|\bWindows Phone\b|\bWindows\b/, "Windows"],
  [/\bAndroid\b/, "Android"],
  [/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b|\bX11\b/, "Linux"],
];

export function describeUserAgent(ua: string | null | undefined): string {
  const value = (ua ?? "").trim();
  if (!value) return "Unknown browser";
  let browser = "";
  for (const [pattern, name] of BROWSERS) {
    const match = pattern.exec(value);
    if (match) {
      // The major version is enough; "128.0.6613.120" tells an owner nothing extra.
      browser = match[1] ? `${name} ${match[1]}` : name;
      break;
    }
  }
  let platform = "";
  for (const [pattern, name] of PLATFORMS) {
    if (pattern.test(value)) {
      platform = name;
      break;
    }
  }
  if (browser && platform) return `${browser} · ${platform}`;
  if (browser || platform) return browser || platform;
  // Non-browser clients (curl, the "Unknown browser" placeholder the API stores when the
  // header is missing) keep their own short label rather than being invented away.
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}
