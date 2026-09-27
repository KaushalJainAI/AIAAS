/**
 * Apply the account's saved theme on a browser that has none of its own.
 *
 * Settings → Save writes `theme_preference` and `accent_color` to the profile,
 * and nothing ever read them back: the theme lived in `localStorage` only, so a
 * new device, a new browser or cleared storage came up in the default theme
 * whatever the account said. The browser's own choice still wins — someone who
 * picks dark on their laptop and light on their phone keeps both — so this
 * fills a gap and never overrides.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/authState';
import { useTheme } from '../../hooks/useTheme';

const THEMES = ['light', 'dark', 'system'] as const;
const ACCENTS = ['blue', 'magenta'] as const;

function hasLocal(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true; // storage unreadable: do not fight whatever is in effect
  }
}

export default function ThemeSync() {
  const { user } = useAuth();
  const { setTheme, setColorTheme } = useTheme();
  const applied = useRef(false);

  useEffect(() => {
    if (!user || applied.current) return;
    applied.current = true;
    const theme = user.theme_preference;
    if (theme && !hasLocal('theme') && (THEMES as readonly string[]).includes(theme)) {
      setTheme(theme);
    }
    const accent = user.accent_color;
    if (accent && !hasLocal('colorTheme') && (ACCENTS as readonly string[]).includes(accent)) {
      setColorTheme(accent as (typeof ACCENTS)[number]);
    }
  }, [user, setTheme, setColorTheme]);

  return null;
}
