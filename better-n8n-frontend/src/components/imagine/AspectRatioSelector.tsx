/**
 * Aspect ratio picker that draws the ratio instead of naming it.
 *
 * The catalog advertises up to 17 ratios per model, including `9:19.5` and
 * `21:9`. As a row of text chips those are unreadable — you cannot tell at a
 * glance which one is the tall phone shape. Each option is rendered as a box
 * with that exact proportion, so the control shows what it does.
 */
import { cn } from '../../lib/utils';

interface Props {
  options: string[];
  value: string | undefined;
  onChange: (ratio: string) => void;
}

/** Longest side of a preview box, in px. */
const BOX = 30;

function parseRatio(ratio: string): { w: number; h: number } | null {
  const [rawW, rawH] = ratio.split(':');
  const w = Number(rawW);
  const h = Number(rawH);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

/** Scales a ratio so its longest side is `BOX`, keeping the proportion exact. */
function previewSize(ratio: string): { width: number; height: number } {
  const parsed = parseRatio(ratio);
  if (!parsed) return { width: BOX, height: BOX };
  const scale = BOX / Math.max(parsed.w, parsed.h);
  return {
    // Floor at 8px: 1:8 would otherwise render as an invisible hairline.
    width: Math.max(8, Math.round(parsed.w * scale)),
    height: Math.max(8, Math.round(parsed.h * scale)),
  };
}

export function AspectRatioSelector({ options, value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(ratio => {
        const { width, height } = previewSize(ratio);
        const isActive = ratio === value;
        return (
          <button
            key={ratio}
            type="button"
            onClick={() => onChange(ratio)}
            title={ratio === 'auto' ? 'Let the model choose' : `Aspect ratio ${ratio}`}
            className={cn(
              'flex flex-col items-center justify-end gap-1.5 w-[52px] py-2 rounded-lg border transition-colors',
              isActive
                ? 'bg-primary/10 border-primary/50'
                : 'border-border/50 hover:bg-muted/60 hover:border-border',
            )}
          >
            <div className="h-[30px] flex items-center justify-center">
              {ratio === 'auto' ? (
                <span
                  className={cn(
                    'text-[10px] font-bold tracking-wide',
                    isActive ? 'text-primary' : 'text-muted-foreground/60',
                  )}
                >
                  Auto
                </span>
              ) : (
                <div
                  style={{ width, height }}
                  className={cn(
                    'rounded-[3px] border-2 transition-colors',
                    isActive
                      ? 'border-primary bg-primary/20'
                      : 'border-muted-foreground/40 bg-muted-foreground/5',
                  )}
                />
              )}
            </div>
            <span
              className={cn(
                'text-[10px] font-semibold leading-none',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {ratio}
            </span>
          </button>
        );
      })}
    </div>
  );
}
