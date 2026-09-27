import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Clapperboard, ImageIcon, Headphones, ChevronUp, ChevronDown } from 'lucide-react';
import { useImagineOptional } from '../../contexts/imagineState';

function kindIcon(kind: string) {
  if (kind === 'video') return Clapperboard;
  if (kind === 'audio') return Headphones;
  return ImageIcon;
}

export function ImagineGlobalTracker() {
  const ctx = useImagineOptional();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  if (!ctx || !ctx.isGenerating) return null;

  const { active, activeCount } = ctx;
  const primary = active[0];

  return (
    <div className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] right-4 z-40 md:bottom-4 max-w-sm w-[calc(100vw-2rem)] sm:w-80">
      <div className="rounded-lg border border-border bg-card shadow-md overflow-hidden">
        {/* Collapsed bar */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Loader2 size={18} className="animate-spin text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-none">
              Generating {activeCount} {activeCount === 1 ? 'item' : 'items'}…
            </p>
            <p className="text-xs text-muted-foreground truncate mt-1">
              {primary ? primary.prompt : 'Working…'} {activeCount > 1 ? `+${activeCount - 1} more` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse' : 'Expand'}
              className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground"
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
            <button
              onClick={() => navigate('/imagine')}
              className="px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              View
            </button>
          </div>
        </div>

        {expanded && (
          <div className="border-t border-border/40 max-h-64 overflow-y-auto divide-y divide-border/40">
            {active.map((g) => {
              const Icon = kindIcon(g.type);
              return (
                <div key={g.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="h-8 w-8 rounded-lg bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon size={14} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium capitalize flex items-center gap-1.5">
                      {g.type}
                      <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
                      <span className="font-normal text-muted-foreground truncate">{g.model.split('/').pop()}</span>
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed mt-1">{g.prompt}</p>
                  </div>
                  <Loader2 size={14} className="animate-spin text-primary shrink-0 mt-1" />
                </div>
              );
            })}
          </div>
        )}

        <div className="px-4 py-2.5 bg-muted/30 border-t border-border/40 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Runs in background — you can navigate away</span>
          <button
            onClick={() => navigate('/imagine')}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Open Studio
          </button>
        </div>
      </div>
    </div>
  );
}
