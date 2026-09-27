/**
 * Schedules — what is set to run without you, and whether it actually is.
 *
 * This page used to be read-only: it listed triggers, toggled them, and deleted
 * them, but the only way to *make* a schedule was a bare cron textbox in the
 * agent builder, one per agent, evaluated in UTC. So the page that exists to
 * answer "what runs without me" could not answer "and make it run at seven"
 * without sending the user somewhere else to type five numbers in an order they
 * had to remember.
 *
 * It is now the place schedules are made. An agent may have several — a weekday
 * briefing and a Friday wrap-up are two schedules, not one cron expression
 * nobody can read — and each one carries the three things that make it
 * checkable: what it says in words, when it fires next, and what happened last
 * time it fired.
 *
 * The run-once button goes through the sweep's own gates
 * (`sweep.prepare(manual=True)` — same paused-agent, overlap and no-goal
 * rules, but an extra firing that never moves `next_due_at`), and answers
 * 202 with the run id as soon as the run starts. A test button that took a
 * shortcut past the overlap policy and the unattended gate would prove the
 * button works and nothing else.
 *
 * It is also where **webhooks** are made. That half of the trigger model has
 * been complete on the server since triggers shipped — a secret-in-path
 * receiver, refusals that are indistinguishable from outside, a capped body
 * added as context and never as the instruction — and no screen could create
 * one, so the whole feature was reachable only from curl. This page's creation
 * path hardcoded `mode: 'schedule'` while its cards already rendered a *Copy
 * webhook URL* button for a row nothing could produce.
 *
 * A webhook is offered fewer controls than a schedule, deliberately: the
 * receiver calls `start_agent_run` directly, so it never reads `overlap`,
 * `timezone` or the live window, and offering those would be four more
 * switches that move nothing. What it gets instead is the one thing a schedule
 * does not need — a URL that is the only credential, and therefore a way to
 * replace it when it leaks. See `Backend/docs/WEBHOOK_TRIGGERS.md`.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react';
import {
  triggersService,
  type FireOutcome,
  type Trigger,
  type TriggerMode,
} from '../api';
import { statusTone } from '../lib/triggerStatus';
// `api/index.ts` does not re-export the agents service; the agent picker is the
// only thing on this page that needs it.
import agentsService from '../api/agents';
import { cn } from '../lib/utils';
import PageHeader from '../components/layout/PageHeader';
import Select from '../components/ui/Select';
import { Switch } from '../components/ui/Switch';
import TriggerModal from '../components/schedules/TriggerModal';
import { absoluteHookUrl, curlFor } from '../lib/webhooks';

/**
 * What each sweep outcome means in words the user can act on. `fired` is the
 * only unambiguously good one; the rest each have a different fix, which is
 * exactly why the backend returns a word rather than a boolean.
 */
const OUTCOME_COPY: Record<FireOutcome, { label: string; hint: string; tone: string }> = {
  fired: {
    label: 'Started',
    hint: 'The run has started.',
    tone: 'text-success',
  },
  queued: {
    label: 'Waiting its turn',
    hint: "Another run is in progress. This one will start when it's done.",
    tone: 'text-muted-foreground',
  },
  dropped: {
    label: 'Dropped — waited too long',
    hint: 'Queued for over 6 hours without the agent freeing up, so it was abandoned rather than delivered late.',
    tone: 'text-warning',
  },
  busy: {
    label: 'Skipped — already running',
    hint: 'It was skipped because another run was in progress and a previous run is still going.',
    tone: 'text-muted-foreground',
  },
  late: {
    label: 'Skipped — too late',
    hint: 'More than an hour past due, so it was re-armed for the next slot instead.',
    tone: 'text-muted-foreground',
  },
  waiting: {
    label: 'Not started yet',
    hint: 'Its start date is in the future. Nothing is wrong; it is simply not live.',
    tone: 'text-muted-foreground',
  },
  paused: {
    label: 'Skipped — agent paused',
    hint: 'The agent is paused, so this slot was skipped. Set the agent back to active to resume; the schedule itself is untouched.',
    tone: 'text-muted-foreground',
  },
  expired: {
    label: 'Ended',
    hint: 'Past its end date, so it switched itself off rather than staying armed for a run that will never come.',
    tone: 'text-muted-foreground',
  },
  stopped: {
    label: 'Stopped — no next run',
    hint: 'This schedule has no future dates. Check the days and months.',
    tone: 'text-destructive',
  },
  skipped: {
    label: 'Nothing to ask',
    hint: 'No instructions — add a goal to this schedule or a description to the agent.',
    tone: 'text-warning',
  },
  refused: {
    label: 'Blocked',
    hint: "Usually the spend cap, or automatic runs aren't allowed.",
    tone: 'text-destructive',
  },
  failed: {
    label: 'Failed to start',
    hint: 'something went wrong before it could begin.',
    tone: 'text-destructive',
  },
};

const MODE_COPY = {
  schedule: { icon: CalendarClock, label: 'Schedule' },
  webhook: { icon: Webhook, label: 'Webhook' },
  event: { icon: Zap, label: 'Event' },
} as const;

/** Relative time, past or future, in the coarsest unit that is still useful. */
function relative(iso: string | null): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const future = ms > 0;
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60_000);
  if (mins < 1) return future ? 'in under a minute' : 'just now';
  if (mins < 60) return future ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return future ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

function absolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function OutcomeBanner({ outcome }: { outcome: FireOutcome }) {
  const copy = OUTCOME_COPY[outcome];
  if (!copy) return null;
  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
      <p className={cn('text-[13px] font-semibold', copy.tone)}>{copy.label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{copy.hint}</p>
    </div>
  );
}

function TriggerCard({ trigger, onEdit }: {
  trigger: Trigger; onEdit: () => void;
}) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<FireOutcome | null>(null);
  // The run a 202 started, so the card links to it instead of describing it.
  const [runId, setRunId] = useState<string | null>(null);
  // Two copy buttons, so one flag would flash the wrong tick.
  const [copied, setCopied] = useState<'url' | 'curl' | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmAllow, setConfirmAllow] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['triggers'] });

  const runNow = useMutation({
    mutationFn: () => triggersService.runNow(trigger.id),
    onMutate: () => {
      setOutcome(null);
      setRunId(null);
    },
    onSuccess: (res) => {
      setOutcome(res.outcome);
      setRunId(res.execution_id ?? null);
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => triggersService.update(trigger.id, { enabled }),
    onSuccess: invalidate,
  });

  // The two fixes that live on the agent, not the schedule: letting it run
  // unwatched, and resuming it. Both PATCH the agent, then re-read the
  // triggers — the card's status comes from the server, so it clears itself.
  const allowUnattended = useMutation({
    mutationFn: () => agentsService.update(trigger.subagent, { allowUnattended: true }),
    onSuccess: () => { setConfirmAllow(false); invalidate(); },
  });

  const resumeAgent = useMutation({
    mutationFn: () => agentsService.update(trigger.subagent, { status: 'active' }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => triggersService.remove(trigger.id),
    onSuccess: invalidate,
  });

  // Rotation is instant and there is no grace period: a leaked credential that
  // keeps working for an hour is a leaked credential. So it is confirmed
  // first — every caller pointed at the old URL breaks the moment it lands.
  const rotate = useMutation({
    mutationFn: () => triggersService.rotateSecret(trigger.id),
    onSuccess: () => { setConfirmRotate(false); invalidate(); },
  });

  const mode = MODE_COPY[trigger.mode];
  const ModeIcon = mode.icon;
  const isSchedule = trigger.mode === 'schedule';
  const isWebhook = trigger.mode === 'webhook';
  const hookUrl = absoluteHookUrl(trigger.webhook_url, window.location.origin);

  const lastCopy = trigger.last_outcome ? OUTCOME_COPY[trigger.last_outcome] : null;

  const copy = async (what: 'url' | 'curl') => {
    if (!hookUrl) return;
    await navigator.clipboard.writeText(what === 'url' ? hookUrl : curlFor(hookUrl));
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className={cn(
      'rounded-lg border border-border/60 bg-card p-4',
      !trigger.enabled && 'opacity-70',
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ModeIcon className="w-4 h-4 text-primary shrink-0" />
            <Link
              to={`/agents/${trigger.subagent}`}
              className="text-[14px] font-semibold truncate hover:underline"
            >
              {trigger.name || trigger.agent_name}
            </Link>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {mode.label}
            </span>
          </div>
          {trigger.name && (
            <p className="text-[12px] text-muted-foreground">{trigger.agent_name}</p>
          )}

          {/* The reading, not the syntax. The description already names the
              zone ("Every weekday at 08:00 (Asia/Kolkata)"), so the cron
              string and the separate timezone line added nothing — they now
              live only inside the editor's Custom tab. */}
          {trigger.description && (
            <p className="mt-1 text-[13px]">{trigger.description}</p>
          )}
          {trigger.goal && (
            <p className="mt-1 text-[12px] text-muted-foreground line-clamp-2">
              {trigger.goal}
            </p>
          )}
        </div>

        <Switch
          checked={trigger.enabled}
          onChange={(next) => toggle.mutate(next)}
          label={`${trigger.enabled ? 'Pause' : 'Enable'} schedule`}
          disabled={toggle.isPending}
        />
      </div>

      {isSchedule && (
        <div className="mt-3 grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <p className="text-muted-foreground">Next run</p>
            <p className="font-medium flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {trigger.enabled ? relative(trigger.next_due_at) : 'paused'}
            </p>
            {/* Relative and absolute from the same stored `next_due_at`.
                The old date line recalculated from *now* and could disagree
                with the relative text sitting above it. */}
            {trigger.enabled && trigger.next_due_at && (
              <p className="text-muted-foreground">{absolute(trigger.next_due_at)}</p>
            )}
          </div>
          <div>
            <p className="text-muted-foreground">Last run</p>
            <p className="font-medium">{relative(trigger.last_fired_at)}</p>
            {lastCopy && (
              trigger.last_run_id ? (
                <Link
                  to={`/runs?run=${trigger.last_run_id}`}
                  className={cn('block truncate hover:underline', lastCopy.tone)}
                >
                  {lastCopy.label}
                </Link>
              ) : (
                <p className={cn('truncate', lastCopy.tone)}>{lastCopy.label}</p>
              )
            )}
          </div>
        </div>
      )}

      {trigger.queued_for && (
        <p className="mt-2 text-[12px] text-muted-foreground">
          A scheduled run from {absolute(trigger.queued_for)} is waiting for the current
          run to finish.
        </p>
      )}

      {isWebhook && hookUrl && (
        <div className="mt-3 rounded-lg border border-border/60 bg-secondary/40 p-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            POST to this URL
          </p>
          {/* `break-all` because the secret is 48 hex characters with nowhere
              to wrap, and a card that grows a horizontal scrollbar hides it. */}
          <p className="mt-1 break-all font-mono text-[11px]">{hookUrl}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              onClick={() => copy('url')}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              {copied === 'url'
                ? <Check className="w-3 h-3 text-success" />
                : <Copy className="w-3 h-3" />}
              {copied === 'url' ? 'Copied' : 'Copy URL'}
            </button>
            {/* Offered instead of a Run now button: `trigger_run_now` refuses
                non-schedules, because a test that skipped the public path
                would prove the button works and nothing else. */}
            <button
              onClick={() => copy('curl')}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
            >
              {copied === 'curl'
                ? <Check className="w-3 h-3 text-success" />
                : <Copy className="w-3 h-3" />}
              {copied === 'curl' ? 'Copied' : 'Copy test request'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            This URL is the only credential. Anyone who has it can start a run
            and spend your credits.
          </p>
        </div>
      )}

      {confirmRotate && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">
            A new URL is issued immediately and this one stops working. Anything
            already pointed at it will start getting 404s until you update it.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => rotate.mutate()}
              disabled={rotate.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1 text-[12px] font-medium text-destructive-foreground disabled:opacity-50"
            >
              {rotate.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Issue a new URL
            </button>
            <button
              onClick={() => setConfirmRotate(false)}
              className="rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Keep this one
            </button>
          </div>
        </div>
      )}

      {/* `last_outcome` is the sweep's vocabulary and the sweep never sees a
          webhook, so a hook reports only when it was last called. */}
      {isWebhook && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Last request: {trigger.last_fired_at ? relative(trigger.last_fired_at) : 'never'}
        </p>
      )}

      {/* One status row, computed on the server — one sentence plus the one
          fix where a fix exists. This replaces the five separate warning
          blocks (unattended, self-disabled, failure count, last error, and
          the error-coloured outcome label), which made the user read a whole
          card to learn "is this working?". `ok` shows nothing at all. */}
      {isSchedule && trigger.status !== 'ok' && (
        <div className={cn(
          'mt-3 flex items-start gap-2 rounded-lg border px-3 py-2',
          statusTone(trigger.status) === 'warn'
            ? 'border-warning/40 bg-warning/5'
            : 'border-destructive/40 bg-destructive/5',
        )}>
          <span className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            statusTone(trigger.status) === 'warn' ? 'bg-warning' : 'bg-destructive',
          )} />
          <div className="min-w-0 flex-1">
            <p className={cn(
              'text-[12px] leading-snug',
              statusTone(trigger.status) === 'warn' ? 'text-warning' : 'text-destructive',
            )}>
              {trigger.status_message}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {trigger.status === 'needs_permission' && (
                <button
                  onClick={() => setConfirmAllow(true)}
                  className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground"
                >
                  Allow it
                </button>
              )}
              {trigger.status === 'agent_paused' && (
                <button
                  onClick={() => resumeAgent.mutate()}
                  disabled={resumeAgent.isPending}
                  className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  {resumeAgent.isPending ? 'Resuming…' : 'Resume agent'}
                </button>
              )}
              {(trigger.status === 'self_disabled' || trigger.status === 'paused') && (
                <button
                  onClick={() => toggle.mutate(true)}
                  disabled={toggle.isPending}
                  className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  Turn back on
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmAllow && (
        <div className="mt-3 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
          <p className="text-[12px]">
            Let {trigger.agent_name} run when nobody is watching? It will
            still stop and ask before anything it&rsquo;s set to ask about.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => allowUnattended.mutate()}
              disabled={allowUnattended.isPending}
              className="rounded-lg bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
            >
              {allowUnattended.isPending ? 'Allowing…' : 'Allow it'}
            </button>
            <button
              onClick={() => setConfirmAllow(false)}
              className="rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {outcome === 'fired' && runId ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
          <p className="text-[13px] font-semibold text-success">
            Started ·{' '}
            <Link to={`/runs?run=${runId}`} className="underline">
              Open run →
            </Link>
          </p>
        </div>
      ) : (
        outcome && <OutcomeBanner outcome={outcome} />
      )}

      {confirmDelete && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">
            Delete this {isWebhook ? 'webhook' : 'schedule'}? This can&rsquo;t be undone.
            {isWebhook && ' Anything pointed at its URL will start getting 404s.'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1 text-[12px] font-medium text-destructive-foreground disabled:opacity-50"
            >
              {remove.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
              Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Keep it
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3">
        {isSchedule && (
          <button
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending || !trigger.enabled}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
          >
            {runNow.isPending
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Play className="w-3 h-3" />}
            Run once now
          </button>
        )}
        {trigger.mode !== 'event' && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] hover:bg-secondary"
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
        )}
        {isWebhook && (
          <button
            onClick={() => setConfirmRotate(true)}
            disabled={rotate.isPending || confirmRotate}
            className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] hover:bg-secondary disabled:opacity-50"
            title="Issue a new URL and revoke this one"
          >
            <KeyRound className="w-3 h-3" />
            New URL
          </button>
        )}
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={remove.isPending || confirmDelete}
          className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-muted-foreground hover:text-destructive disabled:opacity-50"
        >
          <Trash2 className="w-3 h-3" />
          Delete
        </button>
      </div>
    </div>
  );
}

/** What a new trigger needs before there is a form to fill in: which agent.
 *  The mode is decided by which button opened this — one modal answering one
 *  question, not a wizard asking two. */
function NewTriggerPicker({ mode, onPick, onCancel }: {
  mode: TriggerMode;
  onPick: (choice: {
    mode: TriggerMode; agentId: number;
    allowsUnattended: boolean; hasPrompt: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsService.list(),
  });
  const [selected, setSelected] = useState('');

  const chosen = agents.find((a) => String(a.id) === selected);
  const isWebhook = mode === 'webhook';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border/60 bg-card p-4 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold">
          {isWebhook
            ? 'Which agent should the URL start?'
            : 'Which agent should run on a schedule?'}
        </h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          An agent can have as many {isWebhook ? 'webhooks' : 'schedules'} as you need.
        </p>

        <div className="mt-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading agents…
            </div>
          ) : agents.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              You have no agents yet. <Link to="/agents" className="underline">
                Make one first
              </Link>.
            </p>
          ) : (
            <Select
              value={selected}
              onChange={setSelected}
              options={agents.map((a) => ({
                value: String(a.id),
                label: a.name,
              }))}
              placeholder="Pick an agent…"
              showSearch
            />
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            disabled={!chosen}
            onClick={() => chosen && onPick({
              mode,
              agentId: chosen.id,
              allowsUnattended: chosen.allowUnattended,
              // `brief` is the agent's own instruction — `SubAgent.prompt`.
              // A webhook with no goal falls back to it, so whether it is
              // blank decides whether the goal field is optional.
              hasPrompt: Boolean((chosen.brief || '').trim()),
            })}
            className="rounded-lg bg-primary px-4 py-1.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Schedules() {
  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ['triggers'],
    queryFn: () => triggersService.list(),
    // The sweep runs every minute; anything much slower than this would show a
    // "next due" that has already passed.
    refetchInterval: 30_000,
  });
  // Whether anything is running the sweep. Polled slowly: the lease renews
  // every 30s, so a minute is plenty to notice it stopped — and this is the
  // message that would have caught "nothing ever fires" on day one.
  const { data: health } = useQuery({
    queryKey: ['trigger-health'],
    queryFn: () => triggersService.health(),
    refetchInterval: 60_000,
  });
  const schedulerDown =
    health && !health.running && triggers.some((t) => t.enabled);

  // Three states rather than a boolean: picking an agent (for a known mode),
  // editing a draft, or closed. Creating needs an agent chosen first,
  // editing already has one.
  const [picking, setPicking] = useState<TriggerMode | null>(null);
  const [editing, setEditing] = useState<{
    trigger: Trigger | null;
    mode: TriggerMode;
    agentId: number;
    unattended: boolean;
    hasPrompt: boolean;
  } | null>(null);

  return (
    <div className="min-h-full bg-background">
      <PageHeader
        title="Schedules"
        subtitle="Run agents automatically, on a timetable or when another app calls a link"
        icon={CalendarClock}
      />

      <div className="px-4 py-6 md:px-8">
        {schedulerDown && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-[13px] text-destructive">
              Schedules are not running right now. The scheduler last checked
              in {health?.last_tick_at ? relative(health.last_tick_at) : 'never'}.
            </p>
          </div>
        )}
        <div className="mb-4 flex items-center justify-end gap-3">
          <button
            onClick={() => setPicking('webhook')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <Webhook className="w-4 h-4" />
            New webhook
          </button>
          <button
            onClick={() => setPicking('schedule')}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground"
          >
            <Plus className="w-4 h-4" />
            New schedule
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : triggers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
            <CalendarClock className="w-8 h-8 mx-auto text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Nothing runs on its own yet</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Pick an agent and choose what starts it: a schedule, checked
              against the next few dates before you save, or a webhook URL
              another system can call. Either way the agent needs &ldquo;may run
              with nobody watching&rdquo; turned on — without it every run is
              refused.
            </p>
            <button
              onClick={() => setPicking('schedule')}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground"
            >
              <Plus className="w-4 h-4" />
              New schedule
            </button>
          </div>
        ) : (
          <>
            <section aria-label="Schedules">
              <h2 className="mb-2 text-[13px] font-semibold text-muted-foreground">
                Schedules
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {triggers.filter((t) => t.mode !== 'webhook').map((t) => (
                  <TriggerCard
                    key={t.id}
                    trigger={t}
                    onEdit={() => setEditing({
                      trigger: t,
                      mode: t.mode,
                      agentId: t.subagent,
                      unattended: t.agent_allows_unattended,
                      hasPrompt: t.agent_has_prompt,
                    })}
                  />
                ))}
              </div>
            </section>
            {triggers.some((t) => t.mode === 'webhook') && (
              <section aria-label="Webhooks" className="mt-6">
                <h2 className="mb-2 text-[13px] font-semibold text-muted-foreground">
                  Webhooks
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {triggers.filter((t) => t.mode === 'webhook').map((t) => (
                    <TriggerCard
                      key={t.id}
                      trigger={t}
                      onEdit={() => setEditing({
                        trigger: t,
                        mode: t.mode,
                        agentId: t.subagent,
                        unattended: t.agent_allows_unattended,
                        hasPrompt: t.agent_has_prompt,
                      })}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {picking && (
        <NewTriggerPicker
          mode={picking}
          onCancel={() => setPicking(null)}
          onPick={({ mode, agentId, allowsUnattended, hasPrompt }) => {
            setPicking(null);
            setEditing({
              trigger: null, mode, agentId,
              unattended: allowsUnattended, hasPrompt,
            });
          }}
        />
      )}

      {editing && (
        <TriggerModal
          trigger={editing.trigger}
          mode={editing.mode}
          agentId={editing.agentId}
          agentAllowsUnattended={editing.unattended}
          agentHasPrompt={editing.hasPrompt}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
