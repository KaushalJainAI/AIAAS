/**
 * Whether this server has a browser for the agent, asked once per session.
 *
 * The answer is cached in module state, so every link and tab in the app
 * shares one request. Only a yes or no from the server is kept: a failed check
 * is retried the next time something asks, so a blip on the network does not
 * hide the feature for the rest of the session. Until the answer arrives, the
 * feature is off.
 *
 * A guest is never asked. The endpoint needs a signed-in user, and an
 * unauthorised answer makes the client send the person to the login page.
 */
import { useEffect, useState } from 'react';

import { browserService } from '@/api/browser';
import { tokenManager } from '@/api/client';

/**
 * The cache behind `useBrowserAvailable`. Exported as a factory so tests get
 * their own. `canAsk` says whether a request may be made now; while it is
 * false the answer is "no" and nothing is remembered.
 */
export function createAvailabilityCache(fetcher: () => Promise<boolean>, canAsk: () => boolean = () => true) {
  let known: boolean | null = null;
  let inflight: Promise<boolean> | null = null;
  return {
    /** The answer if it is already known, else null. */
    peek: (): boolean | null => known,
    /** Asks once; concurrent callers share the request. */
    load(): Promise<boolean> {
      if (known !== null) return Promise.resolve(known);
      if (!canAsk()) return Promise.resolve(false);
      if (!inflight) {
        inflight = fetcher()
          .then((available) => {
            known = available;
            return available;
          })
          .catch(() => false)
          .finally(() => {
            inflight = null;
          });
      }
      return inflight;
    },
    reset(): void {
      known = null;
      inflight = null;
    },
  };
}

const cache = createAvailabilityCache(
  () => browserService.status(),
  () => tokenManager.isAuthenticated(),
);

export function useBrowserAvailable(): boolean {
  const [available, setAvailable] = useState(() => cache.peek() ?? false);
  useEffect(() => {
    let alive = true;
    cache.load().then((value) => {
      if (alive) setAvailable(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

/** Tests only: forget the answer so the next mount asks again. */
export function resetBrowserAvailabilityForTests(): void {
  cache.reset();
}
