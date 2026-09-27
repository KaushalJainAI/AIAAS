/**
 * Model selection, on the page.
 *
 * Every mainstream generator keeps the model one click away and always
 * visible — Leonardo puts a model card top-left of the canvas, Krea a row of
 * model tiles above the prompt. Ours was behind a dialog, which meant you had
 * to know a picker existed before you could discover which models existed.
 *
 * This is that row: the recommended models as tiles you can select directly,
 * plus a final tile that opens the searchable dialog for the full catalog
 * (43 image / 23 video models — too many to line up, few enough that the six
 * best belong on screen).
 */
import { useMemo } from 'react';
import { Check, Layers, Loader2, RefreshCw } from 'lucide-react';
import type { Capabilities, MediaKind, ModelCapability } from '../../api/imagine';
import { cn } from '../../lib/utils';

interface Props {
  kind: MediaKind;
  capabilities: Capabilities | null;
  value: string;
  onChange: (modelId: string) => void;
  onBrowseAll: () => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  isLoading?: boolean;
}

/** Tagline for the tile meta line. */

/** Trims the provider prefix most catalog names carry, e.g. "Google: Veo". */
function shortName(model: ModelCapability): string {
  const colon = model.name.indexOf(':');
  return colon > -1 ? model.name.slice(colon + 1).trim() : model.name;
}

function tagline(model: ModelCapability, kind: MediaKind): string {
  if (kind === 'audio') {
    return model.voices?.length ? `${model.voices.length} voices` : 'Custom voice';
  }
  if (kind === 'video' && model.durations?.length) {
    return `up to ${Math.max(...model.durations)}s`;
  }
  return model.resolutions?.length ? model.resolutions.join(' · ') : '';
}

export function ModelRail({
  kind,
  capabilities,
  value,
  onChange,
  onBrowseAll,
  onRefresh,
  isRefreshing,
  isLoading,
}: Props) {
  const models = useMemo(() => capabilities?.[kind] ?? [], [capabilities, kind]);

  // The rail shows the recommended set, plus the active model when the user
  // has picked something outside it — the selection must always be visible
  // here, otherwise the rail looks like nothing is selected.
  const tiles = useMemo(() => {
    const recommended = capabilities?.recommended?.[kind] ?? [];
    const shown = recommended
      .map(id => models.find(m => m.id === id))
      .filter((m): m is ModelCapability => !!m);
    if (value && !shown.some(m => m.id === value)) {
      const active = models.find(m => m.id === value);
      if (active) shown.unshift(active);
    }
    return shown.slice(0, 8);
  }, [capabilities, kind, models, value]);

  if (isLoading) {
    return (
      <div className="flex gap-2.5">
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className="h-[68px] w-[132px] shrink-0 rounded-lg border border-border/50 bg-muted/30 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/60 px-4 py-3">
        <p className="text-xs text-muted-foreground flex-1">
          No {kind} models available. Check your OpenRouter credential, then refresh.
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline disabled:opacity-50"
          >
            {isRefreshing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            Refresh
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 custom-scrollbar snap-x">
      {tiles.map(model => {
        const isActive = model.id === value;
        const meta = tagline(model, kind);
        return (
          <button
            key={model.id}
            onClick={() => onChange(model.id)}
            title={model.id}
            className={cn(
              'group relative shrink-0 snap-start w-[142px] rounded-lg border p-2.5 text-left transition-all',
              isActive
                ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                : 'border-border/60 hover:border-border hover:bg-muted/40',
            )}
          >
            <div className="flex items-start gap-2">
              <div
                className="h-7 w-7 shrink-0 rounded-md bg-muted border border-border flex items-center justify-center text-[11px] font-bold text-muted-foreground"
              >
                {shortName(model).slice(0, 1).toUpperCase()}
              </div>
              {isActive && (
                <span className="ml-auto h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
            </div>
            <div
              className={cn(
                'mt-2 text-xs font-semibold leading-tight truncate',
                isActive ? 'text-primary' : 'text-foreground',
              )}
            >
              {shortName(model)}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {meta || model.provider}
            </div>
          </button>
        );
      })}

      <button
        onClick={onBrowseAll}
        className="shrink-0 snap-start w-[142px] rounded-lg border border-dashed border-border/60 p-2.5 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors group"
      >
        <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center group-hover:bg-primary/10 transition-colors">
          <Layers size={14} className="text-muted-foreground group-hover:text-primary" />
        </div>
        <div className="mt-2 text-xs font-semibold leading-tight">Browse all</div>
        <div className="text-[10px] text-muted-foreground">{models.length} models</div>
      </button>
    </div>
  );
}
