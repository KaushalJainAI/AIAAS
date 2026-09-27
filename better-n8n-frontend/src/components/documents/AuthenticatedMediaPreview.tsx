import { useEffect, useState } from 'react';
import { documentsService, type Document } from '../../api/documents';
import { MediaPreview } from '../chat/MediaPreview';

interface Props {
  doc: Document;
  className?: string;
}

/**
 * Preview that **cannot** load without authorisation.
 *
 * `MediaPreview` previously used `<img src="/api/.../download/">` directly.
 * Browsers cannot set `Authorization` on an `<img>` request, so it always
 * 401'd and the server logged `GET /api/inference/documents/9/download/ 401`.
 *
 * This wrapper fetches via `apiClient` (which adds `Bearer` header) and
 * creates a `blob:` URL. No `?token=` is appended — the file is never
 * public. The backend `QueryParamJWTAuthentication` still accepts `?token=`
 * as a fallback for external consumers, but the UI never uses it.
 */
export function AuthenticatedMediaPreview({ doc, className }: Props) {
  const ft = doc.file_type;
  const isImage = ft.includes('image');
  const isPdf = ft.includes('pdf');
  const isVideo = ft.includes('video');
  const isAudio = ft.includes('audio');
  const isPreviewable = isImage || isPdf || isVideo || isAudio;
  const type = isImage ? 'image' : isPdf ? 'pdf' : isVideo ? 'video' : 'link';

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [unplayable, setUnplayable] = useState(false);

  useEffect(() => {
    if (!isPreviewable) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    documentsService
      .download(doc.id, { inline: true })
      .then((blob) => {
        if (cancelled) return;
        // The PDF branch frames this blob URL, which runs with our origin:
        // pin its type so an HTML body can never render there (S8).
        objectUrl = URL.createObjectURL(isPdf ? new Blob([blob], { type: 'application/pdf' }) : blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        // Keep placeholder on 401/404 — the download will have already 401'd
        // if the user is not authorised.
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc.id, isPreviewable, isPdf]);

  // A format the browser cannot play says so instead of sitting black or
  // silent — converting media server-side is too heavy for the box.
  if (unplayable) {
    return (
      <p className="mx-auto max-w-sm px-4 py-10 text-center text-[13px] text-muted-foreground">
        This format doesn&apos;t play in the browser. Download it to watch.
      </p>
    );
  }

  // Inline viewers: images, PDFs, video and audio all play in-browser from
  // the authenticated blob. Anything else falls back to the link card.
  if (isPdf && blobUrl) {
    return (
      <iframe src={blobUrl} title={doc.title} className={className ?? 'block h-[65vh] w-full rounded-md border border-border/60 bg-white'} />
    );
  }
  if (isVideo && blobUrl) {
    return (
      <video src={blobUrl} controls onError={() => setUnplayable(true)} className={className ?? 'block max-h-[65vh] w-full rounded-md bg-black'} />
    );
  }
  if (isAudio && blobUrl) {
    return (
      <audio src={blobUrl} controls onError={() => setUnplayable(true)} className={className ?? 'w-full'} />
    );
  }

  // For images we wait for the authenticated blob; for others we render icon.
  const url = isImage ? blobUrl ?? '' : '';

  // While the blob is loading show the same placeholder MediaPreview would,
  // but without trying an unauthenticated fetch.
  if (isImage && !blobUrl) {
    return (
      <MediaPreview
        url={url}
        type={type}
        title={doc.title}
        source={doc.filename}
        className={className}
      />
    );
  }

  return (
    <MediaPreview
      url={blobUrl ?? ''}
      type={type}
      title={doc.title}
      source={doc.filename}
      className={className}
    />
  );
}
