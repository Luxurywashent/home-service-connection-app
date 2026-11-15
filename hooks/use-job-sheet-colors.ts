import { useColors } from "./use-colors";

/** Restore the established job-sheet palette without changing app-wide themes. */
export function useJobSheetColors(): ReturnType<typeof useColors> {
  const colors = useColors();
  // Light-mode Company preferences remain untouched.
  const hex = colors.background.replace("#", "");
  const rgb = hex.length === 6 ? [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) : [];
  const isDark = rgb.length === 3 && rgb.every(Number.isFinite) && (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) < 128;
  if (!isDark) return colors;
  return { ...colors, background: "#101319", surface: "#1c2028", border: "#2e333c", foreground: "#f8fafc", muted: "#a5a9b2", primary: "#0068ff" };
}
