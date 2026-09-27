/**
 * A `blob:` URL for one document, fetched with the auth header, revoked when
 * the id changes or the caller unmounts.
 *
 * An `<img>`, `<video>` or `<iframe>` pointed at the API cannot send a token
 * and would 401 (`AuthenticatedMediaPreview` explains the history). A blob URL
 * is also same-origin, which is what lets Whiteboard draw an image into a
 * canvas and still export it.
 */
import { useEffect, useState } from 'react';

import { documentsService } from '../api/documents';
import { apiErrorMessage } from '../lib/apiError';

interface Loaded {
  id: number | null;
  url: string | null;
  error: string | null;
}

/**
 * `asType` re-types the blob before a URL is made for it. A `blob:` URL runs
 * with this app's origin, so a frame showing one must never be handed HTML: a
 * viewer that expects a PDF passes `application/pdf`, and whatever the bytes
 * are, the browser treats them as a PDF (S8, SECURITY_REVIEW_FIX_PLAN.md).
 */
export function useBlobUrl(
  docId: number | null,
  asType?: string,
): { url: string | null; error: string | null } {
  const [loaded, setLoaded] = useState<Loaded>({ id: null, url: null, error: null });
  useEffect(() => {
    if (docId == null) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    documentsService
      .download(docId, { inline: true })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(asType ? new Blob([blob], { type: asType }) : blob);
        setLoaded({ id: docId, url: objectUrl, error: null });
      })
      .catch((err) => {
        if (!cancelled) setLoaded({ id: docId, url: null, error: apiErrorMessage(err, 'This file could not be loaded.') });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId, asType]);
  // A result for a previous id is not an answer for this one.
  return loaded.id === docId ? { url: loaded.url, error: loaded.error } : { url: null, error: null };
}

/**
 * A `blob:` URL for a TIFF/BMP/HEIC image through the server-side PNG
 * conversion (`preview-image/`), revoked when the id changes or unmounts.
 * The download stays the original; this is only what is shown.
 */
export function usePreviewImageUrl(
  docId: number | null,
): { url: string | null; error: string | null } {
  const [loaded, setLoaded] = useState<Loaded>({ id: null, url: null, error: null });
  useEffect(() => {
    if (docId == null) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    documentsService
      .previewImageBlob(docId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setLoaded({ id: docId, url: objectUrl, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoaded({
            id: docId,
            url: null,
            error: apiErrorMessage(err, 'This image cannot be shown in the browser.'),
          });
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [docId]);
  return loaded.id === docId ? { url: loaded.url, error: loaded.error } : { url: null, error: null };
}
