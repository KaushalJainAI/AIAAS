import { useState, type ReactNode } from 'react';
import { Footprints, Timer, IndianRupee, FileText, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { authService } from '../../api/auth';
import { useAuth } from '../../contexts/authState';
import { apiErrorMessage } from '../../lib/apiError';
import { cn } from '../../lib/utils';
import { Switch } from '../ui/Switch';
import {
  DEFAULT_LIMITS, PRESETS, RANGES, clamp, describeDuration, isDefault,
  limitsFromProfile, presetFor, toPayload, tokensForRupees,
  type OrchestratorLimits,
} from '../../lib/orchestratorLimits';

/**
 * Settings → Orchestrator: the limits on one chat turn.
 *
 * Each agent carries its own step, time and spend limits in the agent
 * builder. The assistant in chat — the orchestrator that plans, reads and
 * hands work to those agents — had none of them: a fixed 36 steps, no clock
 * and no spend cap. These are its equivalents, per account. Every field opens
 * filled with the value in force (the default until changed), and each one
 * says what it does, what reaching it looks like and what it costs.
 */
export default function OrchestratorTab() {
  const { user, refreshUser } = useAuth();
  const saved = limitsFromProfile(user);
  const [draft, setDraft] = useState<OrchestratorLimits>(saved);
  const [seen, setSeen] = useState(user);
  const [saving, setSaving] = useState(false);

  // Re-sync when the account reloads (during render, so it never paints blank).
  if (user !== seen) {
    setSeen(user);
    setDraft(limitsFromProfile(user));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const preset = presetFor(draft);
  const minutes = Math.round(draft.timeLimitSeconds / 60);
  const set = (patch: Partial<OrchestratorLimits>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await authService.updateProfile(toPayload(draft));
      await refreshUser();
      toast.success('Orchestrator settings saved. They apply from your next message.');
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Could not save these settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Orchestrator</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          The orchestrator is the assistant you talk to in chat. It reads, plans,
          and hands work to your agents. These limits apply to <strong>each
          message you send it</strong>: how far one reply may go before it stops
          and answers. Each agent has its own limits, set in the{' '}
          <Link to="/agents" className="text-primary hover:underline">agent builder</Link>{' '}
          under Behavior → Run limits.
        </p>
      </div>

      {/* Presets: the three limits move together. */}
      <section aria-labelledby="orch-presets">
        <h4 id="orch-presets" className="text-sm font-medium mb-2">Start from a preset</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => set({ maxSteps: p.steps, timeLimitSeconds: p.minutes * 60, spendCapRupees: p.rupees })}
              className={cn(
                'text-left rounded-md border p-3 transition-colors',
                preset === p.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-secondary',
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-[12px] text-muted-foreground">
                  {p.steps} steps · {describeDuration(p.minutes * 60)} · ₹{p.rupees.toLocaleString('en-IN')}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground mt-1">{p.fits}</p>
            </button>
          ))}
        </div>
        {!preset && (
          <p className="text-[12px] text-muted-foreground mt-2">Custom values.</p>
        )}
      </section>

      <LimitRow
        icon={Footprints}
        title="Step limit"
        value={draft.maxSteps}
        unit="steps"
        min={RANGES.steps.min}
        max={RANGES.steps.max}
        onChange={(v) => set({ maxSteps: clamp(v, RANGES.steps.min, RANGES.steps.max, DEFAULT_LIMITS.maxSteps) })}
        defaultLabel={`${DEFAULT_LIMITS.maxSteps} steps`}
      >
        <p>
          A step is one turn of thinking: the orchestrator reads what it has,
          decides, and calls tools (a search, a file read, starting an agent).
          A simple question takes 1–3 steps; a report that gathers several
          sources takes 10–30; coordinating a team of agents through a large
          job can take 100 or more.
        </p>
        <p>
          Short questions still finish in a few steps whatever this says: the
          orchestrator starts every reply at a light pace and only moves up to
          this limit when it makes a plan or delegates. So a high limit costs
          nothing on small requests. It only matters if a long job needs the
          room, or if a reply goes round in circles.
        </p>
      </LimitRow>

      <LimitRow
        icon={Timer}
        title="Time limit"
        value={minutes}
        unit="minutes"
        min={RANGES.minutes.min}
        max={RANGES.minutes.max}
        onChange={(v) => set({ timeLimitSeconds: clamp(v, RANGES.minutes.min, RANGES.minutes.max, 30) * 60 })}
        defaultLabel={describeDuration(DEFAULT_LIMITS.timeLimitSeconds)}
        note={describeDuration(draft.timeLimitSeconds)}
      >
        <p>
          How long one reply may keep working. About 45 seconds before the end it
          stops calling tools and writes up what it has, so you always get an
          answer rather than a reply cut off mid-step.
        </p>
        <p>
          Agents it starts share this clock: a worker gets at most 80% of the
          time that is left, so the orchestrator always keeps time to read its
          workers' results. Raise this when you hand it long, multi-agent jobs.
        </p>
      </LimitRow>

      <LimitRow
        icon={IndianRupee}
        title="Spend cap"
        value={draft.spendCapRupees}
        unit="₹ per reply"
        min={RANGES.rupees.min}
        max={RANGES.rupees.max}
        onChange={(v) => set({ spendCapRupees: clamp(v, RANGES.rupees.min, RANGES.rupees.max, DEFAULT_LIMITS.spendCapRupees) })}
        defaultLabel={`₹${DEFAULT_LIMITS.spendCapRupees}`}
        note={draft.spendCapRupees === 0 ? 'No cap' : tokensForRupees(draft.spendCapRupees)}
      >
        <p>
          What the orchestrator's own model calls may cost in one reply. It is
          counted at the same blended rate as agent spend caps (₹85 per million
          tokens), so ₹500 is about 5.9 million tokens. When it is reached, the
          orchestrator stops calling tools and answers with what it has.
        </p>
        <p>
          Agents it starts are <strong>not</strong> counted here: each one is
          held to its own spend cap in the agent builder. Set 0 for no cap. With
          a large-context model (hundreds of thousands of tokens per step), a
          long reply can reach this quickly, so raise it along with the step limit.
        </p>
      </LimitRow>

      <section className="rounded-md border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <FileText className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <h4 className="text-sm font-medium">Summarise long replies</h4>
              <div className="text-[13px] text-muted-foreground mt-1 space-y-2 max-w-xl">
                <p>
                  When a long reply fills about 70% of the model's context window,
                  older tool results are always shrunk to a short record, and the
                  full text is kept so the orchestrator can look it up again. That
                  is free.
                </p>
                <p>
                  With this on, the oldest steps are also folded into one running
                  summary written by a small, cheap model. It keeps very long
                  replies coherent, but each summary is an extra paid model call
                  (counted against the spend cap above). Leave it off unless you
                  run long multi-step jobs in chat.
                </p>
              </div>
            </div>
          </div>
          <Switch
            checked={draft.summariseLongTurns}
            onChange={(v) => set({ summariseLongTurns: v })}
            label="Summarise long replies"
          />
        </div>
      </section>

      <section className="rounded-md bg-secondary/50 p-4 text-[13px] text-muted-foreground flex gap-3">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Whichever limit is reached first ends the reply.</p>
          <p>
            The orchestrator always gets one last step to answer with what it found.
            For work that should outlast one reply, such as watching for something,
            or a job over several days, ask it to start a <em>mission</em>: a chain
            of runs that survives restarts and picks up where the last one stopped.
          </p>
        </div>
      </section>

      <div className="pt-4 border-t border-border flex flex-wrap items-center justify-end gap-2">
        {!isDefault(draft) && (
          <button
            type="button"
            onClick={() => setDraft({ ...DEFAULT_LIMITS })}
            className="mr-auto text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Reset to defaults
          </button>
        )}
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => setDraft(saved)}
          className="px-4 py-2 border border-border rounded-md hover:bg-secondary transition-colors disabled:opacity-50"
        >
          Discard changes
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={save}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function LimitRow({
  icon: Icon, title, value, unit, min, max, onChange, defaultLabel, note, children,
}: {
  icon: typeof Timer;
  title: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
  defaultLabel: string;
  note?: string;
  children: ReactNode;
}) {
  const id = `orch-${title.toLowerCase().replace(/\s+/g, '-')}`;
  // What is typed is kept as typed and committed (clamped) on blur or Enter:
  // clamping per keystroke would turn the "1" of "120" into the minimum.
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const parsed = Number(text);
    onChange(text.trim() === '' || !Number.isFinite(parsed) ? value : parsed);
    setText(String(value));
  };
  return (
    <section className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <label htmlFor={id} className="text-sm font-medium">{title}</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
            className="w-28 h-9 px-2 rounded-md border border-input bg-background text-sm text-right"
          />
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-[12px] text-muted-foreground mt-1">
        <span>Allowed {min.toLocaleString('en-IN')}–{max.toLocaleString('en-IN')} · default {defaultLabel}</span>
        {note && <span className="text-foreground/80">{note}</span>}
      </div>
      <div className="text-[13px] text-muted-foreground mt-3 space-y-2 max-w-2xl">
        {children}
      </div>
    </section>
  );
}
