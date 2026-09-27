/**
 * Model selector for Imagine.
 *
 * The live catalog is ~43 image and ~23 video models, which is too many for
 * the flat sidebar list this replaces (that list was also `hidden xl:flex`, so
 * below 1280px there was no way to change model at all). The trigger is a
 * button showing the current model; the panel is a searchable dialog with the
 * recommended models pinned above the rest.
 *
 * Capability chips come from the model's own advertised values, so the panel
 * shows that Seedream 5.0 Lite is 2K/4K-only rather than implying every model
 * shares one option set.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw, Search, Award, X } from 'lucide-react';
import type { Capabilities, MediaKind, ModelCapability } from '../../api/imagine';
import { cn } from '../../lib/utils';

interface Props {
  kind: MediaKind;
  capabilities: Capabilities | null;
  value: string;
  onChange: (modelId: string) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  /** Renders a compact trigger for the chat composer. */
  compact?: boolean;
  disabled?: boolean;
  /** Opens the panel immediately — for callers whose trigger lives elsewhere. */
  openOnMount?: boolean;
  /** Suppresses the built-in trigger button; pair with `openOnMount`. */
  hideTrigger?: boolean;
  /** Fired whenever the panel closes, so a parent can drop the instance. */
  onClose?: () => void;
}

/** Short capability summary shown under each model name. */
function capabilitySummary(model: ModelCapability, kind: MediaKind): string {
  const parts: string[] = [];
  if (kind === 'audio') {
    if (model.voices?.length) parts.push(`${model.voices.length} voices`);
    if (model.supports_speed) parts.push('speed');
  } else {
    if (model.resolutions?.length) parts.push(model.resolutions.join('/'));
    if (kind === 'video' && model.durations?.length) {
      const min = Math.min(...model.durations);
      const max = Math.max(...model.durations);
      parts.push(min === max ? `${min}s` : `${min}–${max}s`);
    }
    if (kind === 'video' && model.supports_audio) parts.push('audio');
    if (kind === 'image' && model.supports_references) parts.push('img2img');
  }
  return parts.join(' · ');
}

export function ModelPicker({
  kind,
  capabilities,
  value,
  onChange,
  onRefresh,
  isRefreshing,
  compact,
  disabled,
  openOnMount = false,
  hideTrigger = false,
  onClose,
}: Props) {
  const [open, setOpen] = useState(openOnMount);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Held in a ref so the Escape listener does not need `onClose` as a dep,
  // which would tear down and rebuild the listener on every parent render.
  // Synced after commit, not during render — the same rule `lib/websocket.ts`
  // follows for its handler ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const models = useMemo(() => capabilities?.[kind] ?? [], [capabilities, kind]);
  const recommended = useMemo(
    () => new Set(capabilities?.recommended?.[kind] ?? []),
    [capabilities, kind],
  );
  const selected = models.find(m => m.id === value) ?? null;

  // Query is reset by the open/close handlers rather than an effect, so the
  // panel never renders once with a stale filter before clearing it.
  const openPanel = () => {
    setQuery('');
    setOpen(true);
  };
  const closePanel = () => {
    setQuery('');
    setOpen(false);
    onClose?.();
  };

  useEffect(() => {
    if (!open) return;
    // Focus after paint so the dialog is mounted and the caret lands in it.
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setQuery('');
      setOpen(false);
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const { pinned, rest } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? models.filter(
          m =>
            m.name.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q),
        )
      : models;
    return {
      pinned: matches.filter(m => recommended.has(m.id)),
      rest: matches.filter(m => !recommended.has(m.id)),
    };
  }, [models, query, recommended]);

  const renderRow = (model: ModelCapability) => {
    const summary = capabilitySummary(model, kind);
    const isSelected = model.id === value;
    return (
      <button
        key={model.id}
        onClick={() => {
          onChange(model.id);
          closePanel();
        }}
        className={cn(
          'w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-start gap-3',
          isSelected ? 'bg-primary/10' : 'hover:bg-muted/60',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'text-sm font-medium truncate',
                isSelected ? 'text-primary' : 'text-foreground',
              )}
            >
              {model.name}
            </span>
            {recommended.has(model.id) && (
              <Award size={12} className="text-primary/70 shrink-0" />
            )}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">
            {model.provider}
            {summary && <span className="opacity-60"> · {summary}</span>}
          </div>
        </div>
        {isSelected && <Check size={16} className="text-primary shrink-0 mt-0.5" />}
      </button>
    );
  };

  const triggerLabel = selected?.name ?? (models.length ? 'Select a model' : 'No models available');

  return (
    <>
      {!hideTrigger && (
      <button
        type="button"
        disabled={disabled || models.length === 0}
        onClick={openPanel}
        title={selected?.id}
        className={cn(
          'flex items-center gap-2 rounded-lg border border-border/60 bg-background/60',
          'hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors',
          compact ? 'px-2.5 py-1.5 max-w-[190px]' : 'w-full px-3 py-2.5',
        )}
      >
        <div className="min-w-0 flex-1 text-left">
          <div className={cn('truncate font-medium', compact ? 'text-xs' : 'text-sm')}>
            {triggerLabel}
          </div>
          {!compact && selected && (
            <div className="text-[11px] text-muted-foreground truncate">
              {selected.provider}
              {capabilitySummary(selected, kind) && (
                <span className="opacity-60"> · {capabilitySummary(selected, kind)}</span>
              )}
            </div>
          )}
        </div>
        <ChevronDown size={14} className="text-muted-foreground shrink-0" />
      </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh] bg-black/50"
          onClick={closePanel}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Select a ${kind} model`}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg max-h-[70vh] flex flex-col rounded-lg border border-border bg-card shadow-lg overflow-hidden"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60">
              <Search size={16} className="text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={`Search ${models.length} ${kind} models…`}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  title="Refresh the model catalog"
                  className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground disabled:opacity-50"
                >
                  <RefreshCw size={14} className={cn(isRefreshing && 'animate-spin')} />
                </button>
              )}
              <button
                onClick={closePanel}
                className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
              {pinned.length === 0 && rest.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-10">
                  {models.length === 0
                    ? 'No models available — check your OpenRouter credential.'
                    : `No model matches “${query}”.`}
                </p>
              )}

              {pinned.length > 0 && (
                <>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                    Recommended
                  </div>
                  {pinned.map(renderRow)}
                </>
              )}

              {rest.length > 0 && (
                <>
                  {pinned.length > 0 && (
                    <div className="px-3 py-1.5 mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                      All models
                    </div>
                  )}
                  {rest.map(renderRow)}
                </>
              )}
            </div>

            {selected?.description && (
              <div className="px-4 py-3 border-t border-border/60 bg-muted/20">
                <p className="text-[11px] text-muted-foreground line-clamp-2">
                  {selected.description}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
