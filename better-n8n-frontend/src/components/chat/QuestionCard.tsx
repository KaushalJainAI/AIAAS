/**
 * A question an agent asked with `ask_user`: pick an option, enter a number,
 * or write a sentence, instead of typing a reply the model has to parse.
 *
 * Used in two places with one look: the chat transcript (the orchestrator, or
 * a worker whose question it passed up) and the Inbox (`bare`, inside the
 * detail pane, for runs nobody is chatting with). The server re-checks every
 * answer against the question the run asked; `answerProblem` only lets the
 * card say what is wrong before sending.
 */
import { useId, useMemo, useState } from 'react';
import { Check, HelpCircle, SkipForward } from 'lucide-react';

import { cn } from '../../lib/utils';
import { answerProblem, type QuestionAnswer, type QuestionSpec } from '../../lib/question';

interface QuestionCardProps {
  spec: QuestionSpec;
  onSubmit: (answer: QuestionAnswer) => void;
  onSkip: () => void;
  busy?: boolean;
  /** Inside another panel (the Inbox): no avatar, no outer card. */
  bare?: boolean;
}

const OTHER = '\u0000other';

export default function QuestionCard({ spec, onSubmit, onSkip, busy = false, bare = false }: QuestionCardProps) {
  const [choice, setChoice] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [number, setNumber] = useState('');
  const [text, setText] = useState('');
  const inputId = useId();
  const options = spec.options ?? [];
  const multi = spec.kind === 'multi_choice';

  const answer = useMemo<QuestionAnswer | null>(() => {
    switch (spec.kind) {
      case 'choice':
        return choice === OTHER ? other.trim() : choice;
      case 'multi_choice': {
        const chosen = picked.filter((p) => p !== OTHER);
        return picked.includes(OTHER) && other.trim() ? [...chosen, other.trim()] : chosen;
      }
      case 'number':
        return number.trim() === '' ? null : Number(number);
      default:
        return text;
    }
  }, [spec.kind, choice, picked, other, number, text]);

  const problem = answerProblem(spec, answer);
  const submit = () => {
    if (!problem && answer !== null && !busy) onSubmit(answer);
  };

  const toggle = (value: string) => {
    if (multi) {
      setPicked((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
    } else {
      setChoice(value);
    }
  };
  const isOn = (value: string) => (multi ? picked.includes(value) : choice === value);
  const otherOn = isOn(OTHER);

  const body = (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground leading-snug">{spec.question}</h3>
        {multi && <p className="text-xs text-muted-foreground">Pick all that apply.</p>}
      </div>

      {(spec.kind === 'choice' || multi) && (
        <div role={multi ? 'group' : 'radiogroup'} aria-label={spec.question} className="grid gap-2">
          {[...options, ...(spec.allow_other ? [OTHER] : [])].map((value) => {
            const on = isOn(value);
            return (
              <button
                key={value}
                type="button"
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={on}
                disabled={busy}
                onClick={() => toggle(value)}
                className={cn(
                  'min-h-11 w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors flex items-center gap-3 disabled:opacity-50',
                  on
                    ? 'border-primary bg-primary/10 text-foreground font-medium'
                    : 'border-border bg-card hover:bg-muted/50 text-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'w-4 h-4 shrink-0 border flex items-center justify-center',
                    multi ? 'rounded' : 'rounded-full',
                    on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
                  )}
                >
                  {on && <Check className="w-3 h-3" />}
                </span>
                {value === OTHER ? 'Other…' : value}
              </button>
            );
          })}
          {otherOn && (
            <input
              autoFocus
              value={other}
              disabled={busy}
              onChange={(e) => setOther(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="Your answer"
              aria-label="Other answer"
              className="min-h-11 w-full px-4 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          )}
        </div>
      )}

      {spec.kind === 'number' && (
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="sr-only">{spec.question}</label>
          <div className="flex items-center gap-2">
            <input
              id={inputId}
              type="number"
              inputMode="decimal"
              autoFocus
              value={number}
              disabled={busy}
              min={spec.min ?? undefined}
              max={spec.max ?? undefined}
              step={spec.step ?? 'any'}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              className="min-h-11 w-40 px-4 rounded-lg border border-border bg-background text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {spec.unit && <span className="text-sm text-muted-foreground">{spec.unit}</span>}
          </div>
          {(spec.min != null || spec.max != null) && (
            <p className="text-xs text-muted-foreground">
              {spec.min != null && spec.max != null
                ? `Between ${spec.min} and ${spec.max}.`
                : spec.min != null ? `At least ${spec.min}.` : `At most ${spec.max}.`}
            </p>
          )}
        </div>
      )}

      {spec.kind === 'text' && (
        <textarea
          autoFocus
          rows={3}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          aria-label={spec.question}
          placeholder="Your answer"
          className="w-full px-4 py-3 rounded-lg border border-border bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={Boolean(problem) || busy}
          className="min-h-11 px-5 bg-primary text-primary-foreground font-semibold rounded-lg text-sm transition-opacity disabled:opacity-40 flex items-center gap-2"
        >
          <Check className="w-4 h-4" />
          Send answer
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="min-h-11 px-4 text-sm text-muted-foreground rounded-lg border border-border/60 hover:bg-muted/50 hover:text-foreground transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <SkipForward className="w-4 h-4" />
          Skip
        </button>
      </div>
      {spec.assumption && (
        <p className="text-xs text-muted-foreground">
          If you skip, it will go ahead assuming: <span className="text-foreground/80">{spec.assumption}</span>
        </p>
      )}
    </div>
  );

  if (bare) return body;

  return (
    <div className="flex gap-3 md:gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shrink-0 border border-border shadow-sm">
        <HelpCircle className="w-6 h-6 text-primary-foreground" />
      </div>
      <div className="min-w-0 flex-1 max-w-[92%] md:max-w-[85%] bg-card/60 p-5 md:p-6 rounded-lg rounded-tl-none shadow-sm border border-border">
        {body}
      </div>
    </div>
  );
}
