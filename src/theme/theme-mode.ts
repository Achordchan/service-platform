export const THEME_MODE_STORAGE_KEY = "achord-theme-mode";

export const THEME_PREFERENCES = ["SYSTEM", "LIGHT", "DARK"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type AppThemeMode = "system" | "light" | "dark";

export function themePreferenceToMode(
  preference: ThemePreference,
): AppThemeMode {
  return preference.toLowerCase() as AppThemeMode;
}
