/**
 * The theme context object, its vocabulary, and the hook that reads it.
 *
 * Split from `ThemeContext.tsx` so that file exports the provider and nothing
 * else. A module that exports both a component and a plain function opts out
 * of fast refresh entirely, so editing the provider would remount the tree and
 * drop the theme — the same reason BrowserOS keeps `OSProvider` alone in its
 * file and its hooks in `osState.ts`.
 */
import { createContext, useContext } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export type ColorTheme = 'blue' | 'magenta';

export interface ThemeContextType {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  colorTheme: ColorTheme;
  setTheme: (theme: Theme) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}
