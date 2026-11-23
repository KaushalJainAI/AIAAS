/**
 * True from the `md` breakpoint up (768px), the width at which the side pane
 * sits beside the page instead of covering it. Follows resizes.
 *
 * Without `matchMedia` (old browsers, some test environments) it falls back to
 * the window width, read once.
 */
import { useEffect, useState } from 'react';

export const DESKTOP_QUERY = '(min-width: 768px)';

function currentlyDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia(DESKTOP_QUERY).matches;
  return window.innerWidth >= 768;
}

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(currentlyDesktop);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
