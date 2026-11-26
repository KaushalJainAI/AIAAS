import { createContext, useContext, useLayoutEffect } from 'react';

/* Who draws a hub's tabs (Agents, Library, Connect).
 *
 * A hub page that renders a PageHeader puts its tabs *inside* that header, so
 * tabs and the page's own buttons share one row. A hub page without a
 * PageHeader (Files, Studio) still needs them, so the shell keeps a standalone
 * strip (`HubTabs`) and hides it only while a page header has claimed the job.
 * The claim is a counter set in a layout effect: it lands before paint, so the
 * standalone strip never flashes above a merged header. The provider is
 * `components/layout/hubHeader.tsx`. */
export type HubClaim = { claimed: boolean; setCount: (fn: (n: number) => number) => void };

export const HubHeaderContext = createContext<HubClaim | null>(null);

/** For the standalone strip: true while some page header draws the tabs. */
export function useHubTabsClaimed(): boolean {
  return useContext(HubHeaderContext)?.claimed ?? false;
}

/** For PageHeader: claim the hub tabs while `active` (and mounted). Outside a
 * provider (tests, isolated renders) it does nothing. */
export function useClaimHubTabs(active: boolean): void {
  const setCount = useContext(HubHeaderContext)?.setCount;
  useLayoutEffect(() => {
    if (!active || !setCount) return;
    setCount((n) => n + 1);
    return () => setCount((n) => n - 1);
  }, [active, setCount]);
}
