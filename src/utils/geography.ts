import { COUNTRY_METADATA } from "../data/countryMeta";

export interface CountryGeo {
  code: string;
  code3: string;
  label: string;
  officialLabel: string;
  region: string;
  subregion: string;
  latitude: number;
  longitude: number;
  flag: string;
}

const REGION_DISPLAY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRY_LOOKUP = new Map<string, CountryGeo>();
const COUNTRY_ALIASES = new Map<string, string>([
  ["uk", "GB"],
  ["u.k", "GB"],
  ["usa", "US"],
  ["u.s", "US"],
  ["unitedstates", "US"],
  ["unitedstatesofamerica", "US"],
  ["uae", "AE"],
  ["southkorea", "KR"],
  ["northkorea", "KP"],
  ["ivorycoast", "CI"],
  ["czechrepublic", "CZ"],
  ["vaticancity", "VA"],
  ["russia", "RU"],
  ["laos", "LA"],
  ["syria", "SY"],
  ["tanzania", "TZ"],
  ["moldova", "MD"],
  ["venezuela", "VE"],
]);

function normalizeLookupValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function toCountryGeo(country: (typeof COUNTRY_METADATA)[number]): CountryGeo {
  return {
    code: country.code,
    code3: country.code3,
    label: country.label,
    officialLabel: country.officialLabel,
    region: country.region,
    subregion: country.subregion,
    latitude: country.latitude,
    longitude: country.longitude,
    flag: country.flag,
  };
}

function registerLookupValue(key: string, country: CountryGeo) {
  const normalized = normalizeLookupValue(key);

  if (!normalized || COUNTRY_LOOKUP.has(normalized)) {
    return;
  }

  COUNTRY_LOOKUP.set(normalized, country);
}

for (const entry of COUNTRY_METADATA) {
  const country = toCountryGeo(entry);
  const names = new Set<string>([
    entry.code,
    entry.code3,
    entry.label,
    entry.officialLabel,
    ...entry.altSpellings,
    ...entry.nativeNames,
    ...entry.translations,
  ]);

  for (const name of names) {
    registerLookupValue(name, country);
  }
}

for (const [alias, target] of COUNTRY_ALIASES.entries()) {
  const country = COUNTRY_LOOKUP.get(normalizeLookupValue(target));
  if (country) {
    COUNTRY_LOOKUP.set(normalizeLookupValue(alias), country);
  }
}

export function resolveCountry(value: string | null | undefined): CountryGeo | null {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  return COUNTRY_LOOKUP.get(normalizeLookupValue(trimmed)) ?? null;
}

export function formatCountryLabel(value: string | null | undefined): string {
  const country = resolveCountry(value);

  if (country) {
    return country.label;
  }

  const trimmed = value?.trim();

  if (!trimmed) {
    return "Unknown";
  }

  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    return REGION_DISPLAY_NAMES.of(trimmed.toUpperCase()) ?? trimmed.toUpperCase();
  }

  return trimmed;
}

export function getMacroRegion(value: CountryGeo | string | null | undefined): string {
  const country = typeof value === "string" || value == null ? resolveCountry(value) : value;

  if (!country) {
    return "Unknown";
  }

  if (country.region === "Americas") {
    return country.subregion === "South America" ? "South America" : "North America";
  }

  if (country.region === "Oceania") {
    return "Oceania";
  }

  if (country.region === "Africa") {
    return "Africa";
  }

  if (country.region === "Asia") {
    return "Asia";
  }

  if (country.region === "Europe") {
    return "Europe";
  }

  if (country.region === "Antarctic") {
    return "Antarctica";
  }

  return "Other";
}

export function getRegionColor(region: string): string {
  switch (region) {
    case "North America":
      return "#38bdf8";
    case "South America":
      return "#22c55e";
    case "Europe":
      return "#a78bfa";
    case "Asia":
      return "#f59e0b";
    case "Africa":
      return "#f97316";
    case "Oceania":
      return "#f43f5e";
    case "Antarctica":
      return "#2dd4bf";
    default:
      return "#94a3b8";
  }
}
