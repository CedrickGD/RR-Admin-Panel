import { useSyncExternalStore } from "react";
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
};
let account = "guest";
let state = read();
const listeners = new Set<() => void>();
function read(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(`rr:appearance:${account}`) ?? "{}");
    return {
      ...DEFAULT_APPEARANCE,
      ...raw,
      theme: raw.theme === "light" ? "light" : "dark",
      image:
        typeof raw.image === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(raw.image)
          ? raw.image
          : "",
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}
function apply() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.background = state.background;
  document.documentElement.style.setProperty("--ah", String(state.hue));
  document.documentElement.style.setProperty("--ah-secondary", String((state.hue + 65) % 360));
  document.documentElement.style.setProperty("--ah-tertiary", String((state.hue + 180) % 360));
}
export function setAppearanceAccount(email: string) {
  if (account === email) return;
  account = email;
  state = read();
  apply();
  listeners.forEach((fn) => fn());
}
export function updateAppearance(patch: Partial<Appearance>) {
  const next = { ...state, ...patch };
  // Write first so an image exceeding browser storage never appears as successfully saved.
  localStorage.setItem(`rr:appearance:${account}`, JSON.stringify(next));
  state = next;
  apply();
  listeners.forEach((fn) => fn());
}
apply();
export function useAppearance() {
  const appearance = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );
  return { appearance, updateAppearance };
}
