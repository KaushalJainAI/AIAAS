import { Loader2, AlertTriangle, Download, Maximize2 } from 'lucide-react';
import type { ImagineGeneration } from '../../api/imagineAgent';

interface Props {
  generation: ImagineGeneration;
  onOpen?: () => void;
}

export function GenerationBubble({ generation, onOpen }: Props) {
  const { type, status, output_url, error_message, prompt } = generation;

  if (status === 'pending' || status === 'processing') {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 p-4 my-2 flex items-center gap-3">
        <Loader2 className="animate-spin text-primary" size={18} />
        <div>
          <div className="text-sm font-medium">Generating {type}…</div>
          <div className="text-xs text-muted-foreground truncate max-w-[260px]">{prompt}</div>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 my-2 flex items-start gap-3">
        <AlertTriangle className="text-destructive shrink-0" size={18} />
        <div className="text-sm">
          <div className="font-medium text-destructive">Generation failed</div>
          <div className="text-xs text-muted-foreground mt-0.5">{error_message || 'Unknown error'}</div>
        </div>
      </div>
    );
  }

  if (!output_url) return null;

  return (
    <div className="rounded-lg overflow-hidden border border-border/50 bg-card/60 my-2 group">
      <div className="relative bg-black/5">
        {type === 'image' && (
          <img src={output_url} alt={prompt} className="w-full max-h-[420px] object-contain" />
        )}
        {type === 'video' && (
          <video src={output_url} controls className="w-full max-h-[420px] object-contain" />
        )}
        {type === 'audio' && (
          <div className="p-4">
            <audio src={output_url} controls className="w-full" />
          </div>
        )}
        {type !== 'audio' && onOpen && (
          <button
            onClick={onOpen}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 backdrop-blur opacity-0 group-hover:opacity-100 transition-opacity"
            title="Open"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <p className="text-xs text-muted-foreground truncate flex-1">{prompt}</p>
        <a
          href={output_url}
          download
          className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground"
          title="Download"
        >
          <Download size={14} />
        </a>
      </div>
    </div>
  );
}
