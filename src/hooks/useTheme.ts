import { useEffect } from "react";
import type { ThemeMode } from "../types/telemetry";

export function useTheme() {
  const theme: ThemeMode = "dark";

  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  }, [theme]);

  const toggle = () => {};

  return { theme, toggle } as const;
}
