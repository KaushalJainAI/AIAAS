/**
 * How hard the selected model is asked to think.
 *
 * Its own component rather than more JSX inside the model dropdown, for the
 * reason `ThinkingTimer` is its own component: `StandaloneChat` is already the
 * largest file on the route, and this control re-renders on a state that
 * nothing else in that tree reads.
 *
 * **It always renders.** The first version hid itself when the selected model
 * had no effort rungs, on the reasoning that a knob which cannot move is worse
 * than no knob. That was wrong, and the way it was wrong is worth keeping
 * written down: a returning user's model is whatever their localStorage says,
 * which is often one chosen before this control existed — and 19 of the 64
 * catalogue models have no effort control at all. So the common case for an
 * existing user was the control silently not being there, which reads as "the
 * feature was never built", not as "this model does not support it". Absence
 * cannot explain itself. A visible row saying *why* it is unavailable is
 * strictly more informative, and it also tells the user the fix — pick a
 * different model — which the empty space did not.
 */

import { cn } from '../../lib/utils';
import { EFFORT_HINTS, EFFORT_LABELS } from '../../hooks/useEffortSelection';

interface Props {
  /** Rungs the selected model offers. Empty renders the unsupported state. */
  available: string[];
  /** The chosen rung, or `''` for the model's own default. */
  value: string;
  onChange: (next: string) => void;
}

export function EffortPicker({ available, value, onChange }: Props) {
  const supported = available.length > 0;

  // `''` always leads: it is the only option every model has, and it is what
  // "I have not chosen" looks like. Offering it explicitly is also the only way
  // back off the knob once a level has been picked.
  const options = supported ? ['', ...available] : [];

  return (
    <div className="p-3 border-t border-border/30">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <label className="text-[11px] font-semibold text-muted-foreground">
          Reasoning effort
        </label>
        <span className="text-[10px] text-muted-foreground/50">
          {supported ? (EFFORT_LABELS[value] ?? value) : 'Not supported'}
        </span>
      </div>

      {supported ? (
        <>
          <div className="flex gap-1">
            {options.map((level) => (
              <button
                key={level || 'default'}
                type="button"
                onClick={() => onChange(level)}
                title={EFFORT_HINTS[level] ?? level}
                className={cn(
                  'flex-1 h-7 rounded-lg text-[10px] font-bold transition-all border',
                  value === level
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40',
                )}
              >
                {EFFORT_LABELS[level] ?? level}
              </button>
            ))}
          </div>
          <p className="mt-2 px-1 text-[10px] leading-relaxed text-muted-foreground/40">
            {EFFORT_HINTS[value] ?? ''}
          </p>
        </>
      ) : (
        <p className="px-1 text-[10px] leading-relaxed text-muted-foreground/40">
          This model has no reasoning-effort setting. Pick a reasoning model —
          Claude, GPT-5.6, DeepSeek, Qwen, Nemotron — to control how hard it
          thinks.
        </p>
      )}
    </div>
  );
}
