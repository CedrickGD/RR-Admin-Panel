import { useMemo } from "react";
import { useAppearance } from "./useAppearance";
/** A single hue with ordered brightness keeps categories distinct without a rainbow. */
export function useDonutColors() {
  const { appearance } = useAppearance();
  const colors = useMemo(
    () =>
      (appearance.theme === "dark" ? [70, 52, 84, 40, 61, 93] : [40, 62, 26, 75, 51, 17]).map(
        (lightness) => `hsl(${appearance.hue} 55% ${lightness}%)`,
      ),
    [appearance.hue, appearance.theme],
  );
  return { colors } as const;
}
