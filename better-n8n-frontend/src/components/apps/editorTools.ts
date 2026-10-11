/**
 * Small things several app editors share that are not components: the
 * remembered text size, the clipboard, full screen and the browser's share
 * sheet. Kept out of the component files so those export components only
 * (mixing the two breaks fast refresh).
 */
import { useCallback, useEffect, useState } from 'react';

import { stepFontSize } from '../../lib/textTools';
import { toast } from '../../lib/toastStore';

/** The editor text size, remembered per app. */
export function useFontSize(app: string, initial = 13): [number, (direction: 1 | -1) => void] {
  const key = `app-font:${app}`;
  const [size, setSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(key));
      return stored >= 10 && stored <= 24 ? stored : initial;
    } catch {
      return initial;
    }
  });
  const step = useCallback(
    (direction: 1 | -1) =>
      setSize((prev) => {
        const next = stepFontSize(prev, direction);
        try {
          localStorage.setItem(key, String(next));
        } catch {
          // The size still changes; it just is not remembered.
        }
        return next;
      }),
    [key],
  );
  return [size, step];
}

export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
    return true;
  } catch {
    toast.error('Could not copy', 'Your browser blocked the clipboard.');
    return false;
  }
}

/** Whether the page is in full screen, and a toggle for it. */
export function useFullscreen(): { active: boolean; supported: boolean; toggle: () => void } {
  const [active, setActive] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setActive(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = useCallback(() => {
    // Refused requests (an iframe without permission, iOS Safari) reject;
    // there is nothing useful to tell the user beyond the button not working.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  return {
    active,
    supported: typeof document !== 'undefined' && !!document.documentElement.requestFullscreen,
    toggle,
  };
}
