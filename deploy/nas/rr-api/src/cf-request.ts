// Behind a Cloudflare Tunnel the `request.cf` object does not exist, but Cloudflare still sends
// the geo signals as headers (`cf-ipcountry` always; city/region/lat/lon/timezone/continent once
// the "Add visitor location headers" managed transform is on). The shared telemetry contract reads
// `request.cf`, so rebuild that object from the headers. `cf-connecting-ip` stays a header — the
// code already reads it from there.

export interface CloudflareRequestProperties {
  country?: string;
  city?: string;
  region?: string;
  regionCode?: string;
  postalCode?: string;
  latitude?: string;
  longitude?: string;
  timezone?: string;
  continent?: string;
  colo?: string;
  ray?: string;
  asn?: string;
  asOrganization?: string;
}

const HEADER_MAP: ReadonlyArray<readonly [string, keyof CloudflareRequestProperties]> = [
  ["cf-ipcountry", "country"],
  ["cf-ipcity", "city"],
  ["cf-region", "region"],
  ["cf-region-code", "regionCode"],
  ["cf-postal-code", "postalCode"],
  ["cf-iplatitude", "latitude"],
  ["cf-iplongitude", "longitude"],
  ["cf-timezone", "timezone"],
  ["cf-ipcontinent", "continent"],
  ["cf-ray", "ray"],
];

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Builds the `cf`-shaped object from whatever Cloudflare headers are present (all optional). */
export function readCloudflareProperties(headers: Headers): CloudflareRequestProperties {
  const cf: CloudflareRequestProperties = {};
  for (const [header, key] of HEADER_MAP) {
    const value = readHeader(headers, header);
    if (value !== undefined) {
      cf[key] = value;
    }
  }
  const ray = cf.ray;
  if (ray && ray.includes("-")) {
    cf.colo = ray.slice(ray.lastIndexOf("-") + 1);
  }
  return cf;
}

/**
 * Returns a Request whose non-enumerable `cf` property mirrors the Cloudflare headers, overlaid
 * by `overrides` (the client geo a trusted proxy forwarded — see trusted-forwarding.ts). The same
 * object is returned when it can be extended (keeps the body stream untouched); a frozen request
 * is wrapped instead. Never throws when the headers are absent — `cf` is then just `{}`.
 */
export function attachCloudflareContext(
  request: Request,
  overrides: CloudflareRequestProperties = {},
): Request {
  const cf: CloudflareRequestProperties = {
    ...readCloudflareProperties(request.headers),
    ...overrides,
  };
  const existing = Object.getOwnPropertyDescriptor(request, "cf");
  if (existing && !existing.configurable) {
    return request;
  }
  try {
    Object.defineProperty(request, "cf", {
      value: cf,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    return request;
  } catch {
    const wrapped = new Request(request);
    Object.defineProperty(wrapped, "cf", {
      value: cf,
      enumerable: false,
      configurable: true,
      writable: false,
    });
    return wrapped;
  }
}
