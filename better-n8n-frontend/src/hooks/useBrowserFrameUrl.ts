/**
 * A `blob:` URL for one browser picture (`/api/browser/frames/<id>/`),
 * fetched with the auth header and revoked when the id changes or the caller
 * unmounts. Same pattern as `useBlobUrl`, which is keyed by document id.
 *
 * `expired` is the 404 the server gives for a picture that has aged out of
 * its cache, or belongs to someone else (the same answer for both, by design).
 */
import { useEffect, useState } from 'react';

import { browserService } from '@/api/browser';

export type FrameStatus = 'none' | 'loading' | 'ready' | 'expired' | 'error';

interface Loaded {
  id: string | null;
  url: string | null;
  status: Exclude<FrameStatus, 'none' | 'loading'>;
}

function isNotFound(err: unknown): boolean {
  return (err as { response?: { status?: number } } | null)?.response?.status === 404;
}

export function useBrowserFrameUrl(frameId: string | null): { url: string | null; status: FrameStatus } {
  const [loaded, setLoaded] = useState<Loaded>({ id: null, url: null, status: 'error' });

  useEffect(() => {
    if (!frameId) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    browserService
      .frameBlob(frameId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ id: frameId, url: objectUrl, status: 'ready' });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({ id: frameId, url: null, status: isNotFound(err) ? 'expired' : 'error' });
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [frameId]);

  if (!frameId) return { url: null, status: 'none' };
  // A result for a previous id is not an answer for this one.
  if (loaded.id !== frameId) return { url: null, status: 'loading' };
  return { url: loaded.url, status: loaded.status };
}
