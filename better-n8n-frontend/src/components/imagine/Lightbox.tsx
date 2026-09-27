/**
 * Full-size viewer for one generation.
 *
 * Previously carried Download / Share / Delete buttons with no handlers, and
 * rendered anything that was not an image through a `<video>` tag — so audio
 * results opened as a black rectangle. Download now works, delete is wired to
 * the caller, and Share is gone: there is no share surface in this product,
 * and a button that cannot do its job is worse than an absent one.
 */
import { useEffect, useState } from 'react';
import { Download, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { DEFAULT_EXTENSION, downloadFile } from '../../lib/downloadFile';

export interface LightboxItem {
  url: string;
  prompt: string;
  type: 'image' | 'video' | 'audio';
  timestamp: Date;
  model?: string;
  /** Present for history items; omit to hide the delete action. */
  id?: number;
}

interface LightboxProps {
  isOpen: boolean;
  onClose: () => void;
  result: LightboxItem | null;
  onDelete?: (id: number) => void;
}

export function Lightbox({ isOpen, onClose, result, onDelete }: LightboxProps) {
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !result) return null;

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await downloadFile(result.url, result.prompt, DEFAULT_EXTENSION[result.type]);
    } catch (err) {
      toast.error('Could not download that file. It may have expired.');
      console.error('Imagine download failed', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-background"
      onClick={onClose}
      role="presentation"
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-6 right-6 p-2 rounded-full bg-muted/50 hover:bg-muted text-foreground transition-colors z-[60]"
      >
        <X size={22} />
      </button>

      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        className="relative flex flex-col md:flex-row w-full max-w-6xl max-h-[90vh] bg-card border border-border/50 rounded-lg overflow-hidden shadow-lg"
      >
        <div className="flex-1 bg-black/5 flex items-center justify-center overflow-hidden min-h-[40vh] p-4">
          {result.type === 'image' && (
            <img
              src={result.url}
              alt={result.prompt}
              className="max-w-full max-h-[80vh] object-contain"
            />
          )}
          {result.type === 'video' && (
            <video
              src={result.url}
              autoPlay
              controls
              playsInline
              className="max-w-full max-h-[80vh] object-contain"
            />
          )}
          {result.type === 'audio' && (
            <audio src={result.url} controls autoPlay className="w-full max-w-md" />
          )}
        </div>

        <div className="w-full md:w-80 p-6 border-t md:border-t-0 md:border-l border-border/40 flex flex-col justify-between gap-6 overflow-y-auto">
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Prompt
              </label>
              <p className="text-sm leading-relaxed text-foreground/85">{result.prompt}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  Type
                </label>
                <div className="text-xs font-semibold capitalize">{result.type}</div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  Created
                </label>
                <div className="text-xs font-semibold">
                  {result.timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            </div>

            {result.model && (
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                  Model
                </label>
                <div className="text-xs font-medium break-all">{result.model}</div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleDownload()}
              disabled={isDownloading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isDownloading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Download size={15} />
              )}
              Download
            </button>
            {onDelete && result.id !== undefined && (
              <button
                onClick={() => {
                  onDelete(result.id!);
                  onClose();
                }}
                title="Delete"
                className="p-2.5 rounded-lg bg-muted/50 hover:bg-destructive hover:text-white border border-border/50 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
