import type { NativeTheme } from "electron";

/** The appearance setting: follow the OS, or force one mode. */
export type ThemeMode = "system" | "light" | "dark";

/** Maps a settings mode to the value Electron's nativeTheme expects. */
export const applyThemeSource = (nativeTheme: NativeTheme, mode: ThemeMode): void => {
  nativeTheme.themeSource = mode;
};

/**
 * The hex background color the window should paint before the renderer
 * mounts, so there is no white flash while the page loads.
 */
export const windowBackground = (
  nativeTheme: NativeTheme,
  mode: ThemeMode
): string => {
  const dark = mode === "dark" || (mode === "system" && nativeTheme.shouldUseDarkColors);
  return dark ? "#101214" : "#f4f3ee";
};
