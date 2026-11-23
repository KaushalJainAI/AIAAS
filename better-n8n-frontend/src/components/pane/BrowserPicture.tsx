/**
 * One browser picture, loaded with the auth header, with a plain word for each
 * way it can be missing. Used by the Browser tab (one per call) and the link
 * preview (one per page). It is fitted to width; with `onToggleZoom` the
 * picture is a button that zooms it, for phones.
 */
import { Loader2 } from 'lucide-react';

import { useBrowserFrameUrl } from '@/hooks/useBrowserFrameUrl';
import { cn } from '@/lib/utils';

interface Props {
  /** Empty or null: no picture was kept. */
  frameId: string | null;
  alt: string;
  /** What to say when no picture was kept. */
  missingText?: string;
  zoomed?: boolean;
  /** Present: the picture zooms on tap. Absent: a plain picture. */
  onToggleZoom?: () => void;
}

export default function BrowserPicture({
  frameId,
  alt,
  missingText = 'No picture was kept for this call.',
  zoomed = false,
  onToggleZoom,
}: Props) {
  const frame = useBrowserFrameUrl(frameId || null);

  switch (frame.status) {
    case 'none':
      return <p className="text-[13px] text-muted-foreground">{missingText}</p>;
    case 'loading':
      return (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading picture…
        </div>
      );
    case 'expired':
      return <p className="text-[13px] text-muted-foreground">This picture has expired.</p>;
    case 'error':
      return <p className="text-[13px] text-destructive">The picture could not be loaded.</p>;
    case 'ready': {
      const img = (
        <img
          src={frame.url ?? undefined}
          alt={alt}
          className={cn('block h-auto', zoomed ? 'w-[200%] max-w-none' : 'w-full')}
        />
      );
      return (
        <div className="overflow-x-auto rounded-md border border-border/60 bg-muted/30">
          {onToggleZoom ? (
            <button
              type="button"
              onClick={onToggleZoom}
              aria-label={zoomed ? 'Fit picture to width' : 'Zoom picture'}
              aria-pressed={zoomed}
              className="block w-full"
            >
              {img}
            </button>
          ) : (
            img
          )}
        </div>
      );
    }
  }
}
