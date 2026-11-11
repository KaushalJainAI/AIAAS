/**
 * Keep the account's theme and accent in step with this browser.
 *
 * The profile carries `theme_preference` and `accent_color`. ThemeContext writes
 * the accent through to the profile on every change, so the account is the
 * source of truth: when a user loads, their saved accent is applied even if
 * this browser remembers another. localStorage only paints the first frame
 * before the profile arrives.
 *
 * The theme keeps its earlier rule: it is applied only to a browser with no
 * choice of its own, so one device's pick is not overwritten.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/authState';
import type { ColorTheme } from '../../contexts/themeState';
import { useTheme } from '../../hooks/useTheme';

const THEMES = ['light', 'dark', 'system'] as const;
// Same list as ACCENTS in contexts/ThemeContext.tsx.
const ACCENTS: readonly ColorTheme[] = ['teal', 'ink', 'blue', 'magenta'];

function hasLocal(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true; // storage unreadable: do not fight whatever is in effect
  }
}

function isAccent(value: string | undefined): value is ColorTheme {
  return !!value && (ACCENTS as readonly string[]).includes(value);
}

export default function ThemeSync() {
  const { user } = useAuth();
  const { colorTheme, setTheme, setColorTheme } = useTheme();
  // Applied once per signed-in account, not on every render.
  const appliedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!user || appliedFor.current === user.id) return;
    appliedFor.current = user.id;
    const theme = user.theme_preference;
    if (theme && !hasLocal('theme') && (THEMES as readonly string[]).includes(theme)) {
      setTheme(theme);
    }
    // An older server omits accent_color; then nothing changes.
    const accent = user.accent_color;
    if (isAccent(accent) && accent !== colorTheme) {
      setColorTheme(accent);
    }
  }, [user, colorTheme, setTheme, setColorTheme]);

  return null;
}
