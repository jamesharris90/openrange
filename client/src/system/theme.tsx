import { useEffect } from "react";
import type { ReactNode } from "react";
import { useAppStore } from "../store/useAppStore";

const THEME_STORAGE_KEY = "openrange-theme";

export type CockpitTheme = "dark" | "light";

export function applyTheme(theme: CockpitTheme) {
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.chartTheme = isDark ? "dark" : "light";
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent("openrange:theme-changed", { detail: { theme } }));
}

export function getInitialTheme(): CockpitTheme {
  const persisted = localStorage.getItem(THEME_STORAGE_KEY);
  if (persisted === "dark" || persisted === "light") {
    return persisted;
  }
  return "dark";
}

export function SystemThemeProvider({ children }: { children: ReactNode }) {
  const theme = useAppStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <>{children}</>;
}
