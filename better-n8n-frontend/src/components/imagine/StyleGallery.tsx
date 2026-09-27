/**
 * Style gallery — a vocabulary for looks you can picture but cannot phrase.
 *
 * Unlike the five dead cards this replaces, selecting one actually changes the
 * request: the preset's modifier is appended to the prompt at generate time.
 * The active preset shows exactly what gets added, because a style control
 * that silently rewrites your prompt is worse than one that does nothing.
 */
import { stylesFor, type StylePreset } from '../../lib/imagineStyles';
import type { MediaKind } from '../../api/imagine';
import { cn } from '../../lib/utils';

interface Props {
  kind: MediaKind;
  value: string;
  onChange: (styleId: string) => void;
}

export function StyleGallery({ kind, value, onChange }: Props) {
  const presets = stylesFor(kind);
  if (presets.length === 0) return null;

  const active: StylePreset | undefined = presets.find(p => p.id === value);

  return (
    <div className="space-y-2">
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 custom-scrollbar snap-x">
        {presets.map(preset => {
          const isActive = preset.id === value;
          return (
            <button
              key={preset.id}
              onClick={() => onChange(preset.id)}
              title={preset.modifier || 'No style modifier'}
              className="shrink-0 snap-start w-[62px] group"
            >
              <div
                className={cn(
                  'h-[46px] w-full rounded-lg bg-gradient-to-br transition-all',
                  preset.swatch,
                  isActive
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'opacity-75 group-hover:opacity-100',
                )}
              />
              <div
                className={cn(
                  'mt-1 text-[10px] font-semibold truncate text-center transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground',
                )}
              >
                {preset.name}
              </div>
            </button>
          );
        })}
      </div>

      {active?.modifier && (
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed px-1">
          <span className="font-semibold">Appends:</span> {active.modifier}
        </p>
      )}
    </div>
  );
}
