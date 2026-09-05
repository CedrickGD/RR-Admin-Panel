export interface Appearance {
  theme: "dark" | "light";
  background: "plain" | "aurora" | "image" | "network";
  hue: number;
  speed: number;
  density: number;
  distance: number;
  intensity: number;
  offsetX: number;
  offsetY: number;
  blur: number;
  dim: number;
  motion: boolean;
  image: string;
  chartPreset: string;
  donutPreset: string;
}
export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  background: "plain",
  hue: 262,
  speed: 30,
  density: 55,
  distance: 150,
  intensity: 55,
  offsetX: 0,
  offsetY: 0,
  blur: 0,
  dim: 35,
  motion: true,
  image: "",
  chartPreset: "Default",
  donutPreset: "Default",
};
const ranges = {
  hue: [0, 360],
  speed: [0, 100],
  density: [10, 150],
  distance: [40, 300],
  intensity: [0, 100],
  offsetX: [-100, 100],
  offsetY: [-100, 100],
  blur: [0, 30],
  dim: [0, 90],
} as const;
export function validateAppearance(input: unknown): Appearance {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid appearance.");
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw))
    if (!(key in DEFAULT_APPEARANCE)) throw new Error("Unknown appearance setting.");
  const value = { ...DEFAULT_APPEARANCE, ...raw } as Appearance;
  if (
    !["dark", "light"].includes(value.theme) ||
    !["plain", "aurora", "image", "network"].includes(value.background)
  )
    throw new Error("Invalid theme or background.");
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const n = value[key as keyof Appearance];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw new Error("Appearance value is out of range.");
  }
  if (typeof value.motion !== "boolean") throw new Error("Invalid motion setting.");
  if (
    !["Default", "Emerald", "Amber", "Rose", "Cyan", "Violet"].includes(value.chartPreset) ||
    !["Default", "Neon", "Ocean", "Sunset", "Forest", "Candy"].includes(value.donutPreset)
  )
    throw new Error("Invalid chart palette.");
  if (typeof value.image !== "string" || value.image.length > 1800000)
    throw new Error("Background image is too large.");
  if (value.image) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.image);
    if (!match) throw new Error("Choose a PNG, JPG or WebP background.");
    let decoded: string;
    try {
      decoded = atob(match[2].slice(0, 64));
    } catch {
      throw new Error("Invalid image encoding.");
    }
    const valid =
      match[1] === "png"
        ? decoded.startsWith("\x89PNG\r\n\x1a\n")
        : match[1] === "jpeg"
          ? decoded.startsWith("\xff\xd8\xff")
          : decoded.startsWith("RIFF") && decoded.slice(8, 12) === "WEBP";
    if (!valid) throw new Error("The background file does not match its image type.");
  }
  return value;
}
