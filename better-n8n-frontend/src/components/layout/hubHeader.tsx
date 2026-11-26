import { useMemo, useState, type ReactNode } from 'react';
import { HubHeaderContext } from '../../lib/hubHeader';

/* Holds the claim on a hub's tabs; the rules and hooks are in `lib/hubHeader.ts`. */
export function HubHeaderProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const value = useMemo(() => ({ claimed: count > 0, setCount }), [count]);
  return <HubHeaderContext.Provider value={value}>{children}</HubHeaderContext.Provider>;
}
