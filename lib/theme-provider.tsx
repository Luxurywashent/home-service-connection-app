import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, View, useColorScheme as useSystemColorScheme } from "react-native";
import { colorScheme as nativewindColorScheme, vars } from "nativewind";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { SchemeColors, type ColorScheme } from "@/constants/theme";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";

type ThemeContextValue = {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  setProfileScope: (profileKey: string | null) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_STORAGE_PREFIX = "hsc_mobile_appearance_v2";
const GUEST_THEME_STORAGE_KEY = `${THEME_STORAGE_PREFIX}_guest`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>("light");
  const [profileScope, setProfileScopeState] = useState<string | null>(null);

  const applyScheme = useCallback((scheme: ColorScheme) => {
    nativewindColorScheme.set(scheme);
    Appearance.setColorScheme?.(scheme);
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      root.dataset.theme = scheme;
      root.classList.toggle("dark", scheme === "dark");
      const palette = SchemeColors[scheme];
      Object.entries(palette).forEach(([token, value]) => {
        root.style.setProperty(`--color-${token}`, value);
      });
    }
  }, []);

  const setColorScheme = useCallback((scheme: ColorScheme) => {
    setColorSchemeState(scheme);
    applyScheme(scheme);
    const storageKey = profileScope
      ? `${THEME_STORAGE_PREFIX}_${profileScope}`
      : GUEST_THEME_STORAGE_KEY;
    AsyncStorage.setItem(storageKey, scheme).catch(() => {});
  }, [applyScheme, profileScope]);

  const setProfileScope = useCallback(async (profileKey: string | null) => {
    const normalized = profileKey?.trim() || null;
    setProfileScopeState(normalized);
    const storageKey = normalized
      ? `${THEME_STORAGE_PREFIX}_${normalized}`
      : GUEST_THEME_STORAGE_KEY;
    const stored = await AsyncStorage.getItem(storageKey).catch(() => null);
    const nextScheme: ColorScheme = stored === "dark" || stored === "light"
      ? stored
      : normalized
        ? "dark"
        : "light";
    setColorSchemeState(nextScheme);
    applyScheme(nextScheme);
  }, [applyScheme]);

  useEffect(() => {
    let active = true;
    applyScheme("light");
    AsyncStorage.getItem(GUEST_THEME_STORAGE_KEY).then((stored) => {
      if (!active || (stored !== "light" && stored !== "dark")) return;
      setColorSchemeState(stored);
      applyScheme(stored);
    }).catch(() => {});
    return () => { active = false; };
  }, [applyScheme]);

  const themeVariables = useMemo(
    () =>
      vars({
        "color-primary": SchemeColors[colorScheme].primary,
        "color-background": SchemeColors[colorScheme].background,
        "color-surface": SchemeColors[colorScheme].surface,
        "color-foreground": SchemeColors[colorScheme].foreground,
        "color-muted": SchemeColors[colorScheme].muted,
        "color-border": SchemeColors[colorScheme].border,
        "color-success": SchemeColors[colorScheme].success,
        "color-warning": SchemeColors[colorScheme].warning,
        "color-error": SchemeColors[colorScheme].error,
      }),
    [colorScheme],
  );

  const value = useMemo(
    () => ({
      colorScheme,
      setColorScheme,
      setProfileScope,
    }),
    [colorScheme, setColorScheme, setProfileScope],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ThemeProfileScope />
      <View style={[{ flex: 1 }, themeVariables]}>{children}</View>
    </ThemeContext.Provider>
  );
}

function ThemeProfileScope() {
  const { session } = useJobSyncAuth();
  const { setProfileScope } = useThemeContext();

  useEffect(() => {
    const profileKey = session
      ? `company_${session.company?.id ?? "unknown"}_member_${session.user.memberId ?? session.user.email ?? session.user.id}`
      : null;
    void setProfileScope(profileKey);
  }, [session, setProfileScope]);

  return null;
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeContext must be used within ThemeProvider");
  }
  return ctx;
}
