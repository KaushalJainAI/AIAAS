import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';

import { authService } from '../api/auth';
import { ThemeContext, type ColorTheme, type Theme } from './themeState';

/**
 * Accent themes. `teal` is the default and lives on the base tokens in
 * index.css; the others override only the human colour. The same list is in
 * components/layout/ThemeSync.tsx (a component file cannot export a constant
 * without tripping fast refresh), so change both together.
 */
const ACCENTS: readonly ColorTheme[] = ['teal', 'ink', 'blue', 'magenta'];
const DEFAULT_ACCENT: ColorTheme = 'teal';

function isAccent(value: unknown): value is ColorTheme {
  return typeof value === 'string' && (ACCENTS as readonly string[]).includes(value);
}

/**
 * Writes the accent to the account. A failure (offline, signed out, a server
 * that does not know the field yet) keeps the local choice: the page is not
 * undone because the save did not reach the server.
 */
async function saveAccent(accent: ColorTheme): Promise<void> {
  try {
    await authService.updateProfile({ accent_color: accent });
  } catch {
    // Kept on this device only.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme') as Theme;
      if (saved && ['light', 'dark', 'system'].includes(saved)) {
        return saved;
      }
    }
    return 'system';
  });

  // localStorage only paints the first frame. ThemeSync applies the account's
  // saved accent as soon as the profile loads.
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('colorTheme');
        if (isAccent(saved)) return saved;
      } catch {
        // Storage blocked: the default still paints.
      }
    }
    return DEFAULT_ACCENT;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

  const getSystemTheme = useCallback((): 'light' | 'dark' => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  }, []);

  useEffect(() => {
    const updateResolvedTheme = () => {
      if (theme === 'system') {
        setResolvedTheme(getSystemTheme());
      } else {
        setResolvedTheme(theme as 'light' | 'dark');
      }
    };

    updateResolvedTheme();

    if (theme === 'system' && typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => updateResolvedTheme();
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme, getSystemTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
  }, [resolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-color-theme', colorTheme);
  }, [colorTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
  }, []);

  const setColorTheme = useCallback((newColorTheme: ColorTheme) => {
    setColorThemeState(newColorTheme);
    try {
      localStorage.setItem('colorTheme', newColorTheme);
    } catch {
      // Not remembered on this device; the account write still happens.
    }
    void saveAccent(newColorTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
  }, [resolvedTheme, setTheme]);

  // A fresh object here meant every consumer of the theme re-rendered whenever
  // this provider rendered for any reason at all — and the theme provider wraps
  // the entire app.
  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      colorTheme,
      setTheme,
      setColorTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme, colorTheme, setTheme, setColorTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
