/**
 * One generation in the history grid.
 *
 * The card this replaces rendered Download, Share and Delete buttons with no
 * `onClick` on any of them, and forced every result into a square thumbnail —
 * which cropped 16:9 output and left audio results showing a black box. Aspect
 * ratio now follows the generation's own, and audio renders as a player.
 */
import { useState } from 'react';
import { AlertTriangle, Download, Loader2, Maximize2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Generation } from '../../api/imagine';
import { DEFAULT_EXTENSION, downloadFile } from '../../lib/downloadFile';
import { cn } from '../../lib/utils';

interface Props {
  generation: Generation;
  /** `url` is the frame the user actually clicked — a batch has several. */
  onOpen: (generation: Generation, url: string) => void;
  onDelete: (id: number) => void;
}

/** Maps an aspect-ratio string to a CSS aspect-ratio value. */
function aspectStyle(ratio: string | null): string {
  if (!ratio || !ratio.includes(':')) return '1 / 1';
  const [w, h] = ratio.split(':');
  return Number(w) > 0 && Number(h) > 0 ? `${w} / ${h}` : '1 / 1';
}

export function ResultCard({ generation, onOpen, onDelete }: Props) {
  const [isDownloading, setIsDownloading] = useState(false);
  // Which image of a batch is showing. `n` may return up to ten, and one card
  // that displayed `output_url` alone would show a tenth of what was billed.
  const [frame, setFrame] = useState(0);
  const { status, type, output_url, prompt, error_message, model } = generation;
  // `output_urls` is authoritative; the fallback covers rows written before it
  // existed, which have only the single url.
  const urls = generation.output_urls?.length
    ? generation.output_urls
    : output_url
      ? [output_url]
      : [];
  const shown = urls[Math.min(frame, urls.length - 1)] ?? output_url;
  const isDone = status === 'completed' && !!shown;

  const handleDownload = async () => {
    if (!shown) return;
    setIsDownloading(true);
    try {
      await downloadFile(shown, prompt, DEFAULT_EXTENSION[type]);
    } catch (err) {
      // Remote video URLs are signed and can expire — say so rather than
      // failing silently on a button the user just pressed.
      toast.error('Could not download that file. It may have expired.');
      console.error('Imagine download failed', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="group relative bg-card border border-border/50 rounded-2xl overflow-hidden hover:border-border transition-colors">
      <div
        className={cn(
          'relative bg-muted/20 overflow-hidden',
          isDone && type !== 'audio' && 'cursor-zoom-in',
        )}
        style={{ aspectRatio: type === 'audio' ? '16 / 6' : aspectStyle(generation.aspect_ratio) }}
        onClick={() => isDone && type !== 'audio' && shown && onOpen(generation, shown)}
      >
        {status === 'failed' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center bg-destructive/5">
            <AlertTriangle size={28} className="text-destructive" />
            <p className="text-xs font-semibold text-destructive">Generation failed</p>
            <p className="text-[11px] text-muted-foreground line-clamp-3">
              {error_message || 'Unknown error'}
            </p>
          </div>
        ) : !isDone ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-[11px] font-medium text-muted-foreground">
              {type === 'video' ? 'Rendering video…' : 'Generating…'}
            </p>
          </div>
        ) : type === 'image' ? (
          <img
            src={shown!}
            alt={prompt}
            loading="lazy"
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : type === 'video' ? (
          <video src={shown!} controls playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-5">
            <audio src={shown!} controls className="w-full" />
          </div>
        )}

        {isDone && (
          <div className="absolute top-3 right-3 flex gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {type !== 'audio' && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (shown) onOpen(generation, shown);
                }}
                title="Open full size"
                className="p-2 rounded-lg bg-background/90 backdrop-blur border border-border/50 text-foreground hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <Maximize2 size={14} />
              </button>
            )}
            <button
              onClick={e => {
                e.stopPropagation();
                void handleDownload();
              }}
              disabled={isDownloading}
              title="Download"
              className="p-2 rounded-lg bg-background/90 backdrop-blur border border-border/50 text-foreground hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
            >
              {isDownloading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-2.5">
        {urls.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {urls.map((url, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setFrame(i)}
                title={`Image ${i + 1} of ${urls.length}`}
                className={cn(
                  'h-10 w-10 rounded-lg overflow-hidden border transition-colors',
                  i === frame ? 'border-primary' : 'border-border/50 hover:border-border',
                )}
              >
                <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <p className="text-sm leading-relaxed line-clamp-2 text-foreground/85">{prompt}</p>
        <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-border/40">
          <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-muted-foreground">
            <span className="px-1.5 py-0.5 rounded bg-muted font-medium capitalize shrink-0">
              {type}
            </span>
            <span className="truncate" title={model}>
              {model.split('/').pop()}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] text-muted-foreground/70">
              {new Date(generation.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <button
              onClick={() => onDelete(generation.id)}
              title="Delete"
              className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
