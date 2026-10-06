export type ThemeMode = "browser" | "day" | "night" | "eye-care";

export const THEME_STORAGE_KEY = "turnmap.interface.theme";
export const DEFAULT_THEME: ThemeMode = "browser";

export const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: "browser", label: "Follow browser", description: "Use the browser/system color setting" },
  { value: "day", label: "Day", description: "Bright minimal technology style" },
  { value: "night", label: "Night", description: "Low-glare dark workspace" },
  { value: "eye-care", label: "Eye-care", description: "Soft green reading surfaces" }
];

export function normalizeTheme(value: unknown): ThemeMode {
  return value === "browser" || value === "night" || value === "eye-care" || value === "day"
    ? value
    : DEFAULT_THEME;
}

export function resolveTheme(theme: ThemeMode): Exclude<ThemeMode, "browser"> {
  if (theme !== "browser") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.turnmapTheme = resolveTheme(theme);
  document.documentElement.dataset.turnmapThemeSetting = theme;
}

export async function loadTheme(): Promise<ThemeMode> {
  const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
  return normalizeTheme(stored[THEME_STORAGE_KEY]);
}
