/**
 * Command cards: what an action answer or a confirm sheet renders as (§18).
 *
 * One card per command outcome, rendered live from the `command_card` SSE
 * frame and on reload from `metadata.command_card`. GUI-first: every card is
 * a tappable sheet on phones (full-width, 44px controls) and an inline card
 * on desktop — same component, no second implementation.
 *
 * Cards here never duplicate prose: the assistant's message carries the
 * words, the card carries the structured thing (mission progress, cost
 * breakdown, findings, confirm buttons). A confirm sheet (goal, schedule,
 * publish) shows the resolved arguments; pressing its primary button is the
 * approval.
 */
import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  Coins,
  MemoryStick,
  Play,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export type CommandCardData = { type: string } & Record<string, unknown>;

interface CommandCardProps {
  card: CommandCardData;
  onConfirm?: (confirm: Record<string, unknown>) => void;
  onCancel?: () => void;
  onNavigate?: (path: string) => void;
  busy?: boolean;
}

const str = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function Shell({
  title,
  children,
  tone = 'default',
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'default' | 'warn' | 'confirm';
}) {
  return (
    <div
      className={cn(
        'w-full rounded-xl border bg-card p-4 shadow-sm',
        tone === 'warn' && 'border-amber-500/40',
        tone === 'confirm' && 'border-primary/40',
        tone === 'default' && 'border-border',
      )}
    >
      <div className="mb-2 text-[13px] font-bold text-foreground">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <span className="shrink-0 font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-foreground">{value}</span>
    </div>
  );
}

function ConfirmButtons({
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  confirmLabel: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button
        onClick={onConfirm}
        disabled={busy}
        className="flex h-11 min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-bold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
      >
        <Check className="h-4 w-4" />
        {confirmLabel}
      </button>
      <button
        onClick={onCancel}
        disabled={busy}
        className="flex h-11 min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-muted px-4 text-[13px] font-semibold text-muted-foreground transition hover:bg-muted/80 disabled:opacity-50"
      >
        <X className="h-4 w-4" />
        Cancel
      </button>
    </div>
  );
}

export default function CommandCard({
  card,
  onConfirm,
  onCancel,
  onNavigate,
  busy,
}: CommandCardProps) {
  switch (card.type) {
    case 'help':
      return <HelpCard onNavigate={onNavigate} />;
    case 'goal_confirm':
      return <GoalConfirmCard card={card} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />;
    case 'mission':
    case 'mission_list':
      return <MissionCard card={card} onNavigate={onNavigate} />;
    case 'status':
      return <StatusCard card={card} onNavigate={onNavigate} />;
    case 'cost':
      return <CostCard card={card} />;
    case 'memory_list':
    case 'memory_saved':
    case 'memory_forget_pick':
      return <MemoryCard card={card} onConfirm={onConfirm} busy={busy} />;
    case 'schedule_confirm':
    case 'schedule_pick':
      return <ScheduleCard card={card} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />;
    case 'publish_confirm':
      return <PublishCard card={card} onConfirm={onConfirm} onCancel={onCancel} busy={busy} />;
    case 'findings':
      return <FindingsCard card={card} />;
    case 'agent_run':
      return <AgentRunCard card={card} onNavigate={onNavigate} />;
    case 'pause':
      return (
        <Shell title="Paused">
          <Row label="Until" value={str(card.paused_until) || 'resumed manually'} />
        </Shell>
      );
    case 'resume':
      return (
        <Shell title="Resumed">
          <p className="text-[12px] text-muted-foreground">Everything runs again.</p>
        </Shell>
      );
    default:
      return null;
  }
}

function HelpCard({ onNavigate }: { onNavigate?: (path: string) => void }) {
  // Backend-owned: the palette lists from `/api/chat/commands/`, this card is
  // the offline copy — keep the names in step when commands are added.
  const groups: { title: string; items: string[] }[] = [
    { title: 'Agents', items: ['/agent <name> [task]', '/skill <name> [text]', '/schedule <agent> <when>'] },
    { title: 'Goals', items: ['/goal <what you want done>', '/goal (lists missions)'] },
    { title: 'Memory', items: ['/memory', '/memory <fact>', '/memory forget <text>'] },
    { title: 'Code', items: ['/code-review [target]', '/code <project>', '/run <what>'] },
    { title: 'Documents', items: ['/deck <what>', '/doc <what>', '/sheet <what>', '/chart <what>', '/diagram <what>', '/pdf <what>', '/dashboard <what>', '/export md|docx|pdf', '/summarize', '/kb <question>', '/extract <what>'] },
    { title: 'Media & web', items: ['/image <what>', '/speak <text>', '/transcribe', '/search <question>', '/read <url>', '/download <url>'] },
    { title: 'Session', items: ['/new', '/mode ask|auto|plan', '/model <name>', '/effort <level>', '/research <question>', '/file <path>'] },
    { title: 'Account', items: ['/status', '/cost', '/pause [duration]', '/resume', '/eval', '/approvals', '/connect <service>', '/browse <url>', '/sql <connection> <question>', '/api <connection> <goal>', '/message <text>', '/sign <what>', '/publish'] },
  ];
  return (
    <Shell title="What you can type">
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              {group.title}
            </div>
            {group.items.map((item) => (
              <div key={item} className="font-mono text-[12px] text-foreground/90">
                {item}
              </div>
            ))}
          </div>
        ))}
      </div>
      <button
        onClick={() => onNavigate?.('/agents')}
        className="mt-1 min-h-[44px] w-full rounded-lg border border-border/50 px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted/50"
      >
        Open your agents
      </button>
    </Shell>
  );
}

function GoalConfirmCard({
  card,
  onConfirm,
  onCancel,
  busy,
}: {
  card: CommandCardData;
  onConfirm?: (confirm: Record<string, unknown>) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [budget, setBudget] = useState(String(num(card.budget_inr) || 500));
  const [deadline, setDeadline] = useState('7');
  const [maxRuns, setMaxRuns] = useState('20');
  return (
    <Shell title="Start this mission?" tone="confirm">
      <p className="text-[13px] leading-relaxed text-foreground">{str(card.goal)}</p>
      <Row label="Agent" value={str(card.agent_name) || `#${str(card.agent_id)}`} />
      <label className="block text-[12px] font-medium text-muted-foreground">
        Budget (₹, required)
        <input
          value={budget}
          onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ''))}
          inputMode="numeric"
          className="mt-1 h-11 min-h-[44px] w-full rounded-lg border border-border bg-background px-3 text-[14px] text-foreground outline-none focus:border-primary/50"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[12px] font-medium text-muted-foreground">
          Deadline (days)
          <input
            value={deadline}
            onChange={(e) => setDeadline(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            className="mt-1 h-11 min-h-[44px] w-full rounded-lg border border-border bg-background px-3 text-[14px] text-foreground outline-none focus:border-primary/50"
          />
        </label>
        <label className="block text-[12px] font-medium text-muted-foreground">
          Max runs
          <input
            value={maxRuns}
            onChange={(e) => setMaxRuns(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            className="mt-1 h-11 min-h-[44px] w-full rounded-lg border border-border bg-background px-3 text-[14px] text-foreground outline-none focus:border-primary/50"
          />
        </label>
      </div>
      <ConfirmButtons
        confirmLabel="Start mission"
        busy={busy}
        onConfirm={() => onConfirm?.({
          budget_inr: Math.max(1, parseInt(budget || '0', 10) || 0),
          deadline_days: Math.max(1, Math.min(90, parseInt(deadline || '7', 10) || 7)),
          max_runs: Math.max(1, Math.min(100, parseInt(maxRuns || '20', 10) || 20)),
        })}
        onCancel={onCancel}
      />
    </Shell>
  );
}

function MissionCard({
  card,
  onNavigate,
}: {
  card: CommandCardData;
  onNavigate?: (path: string) => void;
}) {
  const missions = Array.isArray(card.missions)
    ? (card.missions as Record<string, unknown>[])
    : card.mission_id != null
      ? [card as Record<string, unknown>]
      : [];
  if (missions.length === 0) {
    return (
      <Shell title="No missions">
        <p className="text-[12px] text-muted-foreground">
          Nothing running. Type /goal to start one.
        </p>
      </Shell>
    );
  }
  return (
    <div className="space-y-2">
      {missions.map((mission) => {
        const open = num(mission.open_todos);
        const total = num(mission.total_todos);
        const spent = num(mission.spent_inr);
        const budget = num(mission.budget_inr);
        return (
          <Shell key={String(mission.mission_id ?? mission.id)} title={`#${String(mission.mission_id ?? mission.id)} ${str(mission.goal).slice(0, 80)}`}>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide">
              <span className={cn(
                'rounded px-1.5 py-0.5',
                String(mission.status) === 'active' && 'bg-emerald-500/15 text-emerald-600',
                String(mission.status) === 'waiting' && 'bg-amber-500/15 text-amber-600',
                (String(mission.status) === 'paused' || String(mission.status) === 'cancelled') && 'bg-muted text-muted-foreground',
              )}>
                {str(mission.status) || 'active'}
              </span>
              {total > 0 && (
                <span className="text-muted-foreground">
                  {total - open}/{total} todos
                </span>
              )}
              {budget > 0 && (
                <span className="text-muted-foreground">
                  ₹{spent}/₹{budget}
                </span>
              )}
            </div>
            {total > 0 && (
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(((total - open) / total) * 100)}%` }}
                />
              </div>
            )}
            {str(mission.last_report) && (
              <p className="line-clamp-2 text-[12px] text-muted-foreground">
                {str(mission.last_report)}
              </p>
            )}
            <button
              onClick={() => onNavigate?.(`/runs?mission=${String(mission.mission_id ?? mission.id)}`)}
              className="min-h-[44px] w-full rounded-lg border border-border/50 px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted/50"
            >
              Open mission runs
            </button>
          </Shell>
        );
      })}
    </div>
  );
}

function StatusCard({
  card,
  onNavigate,
}: {
  card: CommandCardData;
  onNavigate?: (path: string) => void;
}) {
  const runs = Array.isArray(card.runs) ? card.runs as Record<string, unknown>[] : [];
  const missions = Array.isArray(card.missions) ? card.missions as Record<string, unknown>[] : [];
  const pending = Array.isArray(card.pending_approvals) ? card.pending_approvals as Record<string, unknown>[] : [];
  return (
    <Shell title="Status">
      <Row label="Running runs" value={String(runs.length)} />
      <Row label="Active missions" value={String(missions.length)} />
      <Row label="Waiting approvals" value={String(pending.length)} />
      {str(card.paused_until) && <Row label="Paused until" value={str(card.paused_until)} />}
      {pending.length > 0 && (
        <button
          onClick={() => onNavigate?.('/runs')}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-amber-500/15 px-3 text-[12px] font-bold text-amber-600"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Review {pending.length} approval{pending.length === 1 ? '' : 's'}
        </button>
      )}
    </Shell>
  );
}

function CostCard({ card }: { card: CommandCardData }) {
  const byKind = Array.isArray(card.by_kind)
    ? card.by_kind as { kind: string; total: number }[]
    : [];
  const session = (card.session ?? null) as {
    total_cost_usd?: string; cost_source?: string; total_tokens_used?: number;
  } | null;
  return (
    <Shell title="Spend">
      <div className="flex items-center gap-2 text-[13px] font-bold">
        <Coins className="h-4 w-4 text-muted-foreground" />
        {session ? `$${session.total_cost_usd ?? '0'} this conversation` : 'No conversation cost yet'}
      </div>
      {byKind.length > 0 && (
        <div className="space-y-1">
          {byKind.map((row) => (
            <Row key={row.kind} label={row.kind} value={`₹${row.total}`} />
          ))}
        </div>
      )}
    </Shell>
  );
}

function MemoryCard({
  card,
  onConfirm,
  busy,
}: {
  card: CommandCardData;
  onConfirm?: (confirm: Record<string, unknown>) => void;
  busy?: boolean;
}) {
  if (card.type === 'memory_saved') {
    return (
      <Shell title={card.created ? 'Remembered' : 'Already known'}>
        <p className="text-[13px] text-foreground">{str(card.text)}</p>
        <Row label="Category" value={str(card.category)} />
      </Shell>
    );
  }
  const memories = Array.isArray(card.memories)
    ? card.memories as { id: number; text: string; category: string }[]
    : [];
  return (
    <Shell title={card.query ? 'Forget which of these?' : 'What I remember'}>
      {card.query != null && String(card.query) !== '' && (
        <p className="text-[12px] text-muted-foreground">
          Matching “{str(card.query)}” — nothing is deleted until you pick one.
        </p>
      )}
      {memories.length === 0 && (
        <p className="text-[12px] text-muted-foreground">Nothing stored yet.</p>
      )}
      <div className="space-y-1.5">
        {memories.map((memory) => (
          <div
            key={memory.id}
            className="flex min-h-[44px] items-center gap-2 rounded-lg border border-border/50 px-3 py-2"
          >
            <MemoryStick className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-foreground">{memory.text}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                {memory.category}
              </div>
            </div>
            {(card.type === 'memory_forget_pick' || !card.query) && (
              <button
                onClick={() => onConfirm?.({ memory_id: memory.id, __forget: true })}
                disabled={busy}
                className="flex h-9 min-h-[44px] shrink-0 items-center rounded-md px-2.5 text-[11px] font-bold text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Forget
              </button>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function ScheduleCard({
  card,
  onConfirm,
  onCancel,
  busy,
}: {
  card: CommandCardData;
  onConfirm?: (confirm: Record<string, unknown>) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const preview = (card.preview ?? null) as {
    valid?: boolean; description?: string; upcoming?: string[]; error?: string;
  } | null;
  const [cron, setCron] = useState(str(card.cron));
  if (card.type === 'schedule_pick') {
    return (
      <Shell title={`Schedule ${str(card.agent_name)}`} tone="confirm">
        <label className="block text-[12px] font-medium text-muted-foreground">
          When — cron or plain words (“every weekday at 9”)
          <input
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            placeholder="0 9 * * 1-5"
            className="mt-1 h-11 min-h-[44px] w-full rounded-lg border border-border bg-background px-3 font-mono text-[13px] text-foreground outline-none focus:border-primary/50"
          />
        </label>
        {preview && (
          <p className="text-[12px] text-muted-foreground">
            {preview.valid ? preview.description : preview.error}
          </p>
        )}
        <ConfirmButtons
          confirmLabel="Preview schedule"
          busy={busy}
          onConfirm={() => onConfirm?.({ cron, __preview: true })}
          onCancel={onCancel}
        />
      </Shell>
    );
  }
  return (
    <Shell title="Arm this schedule?" tone="confirm">
      <div className="font-mono text-[13px] font-bold text-foreground">{str(card.cron)}</div>
      {preview && (
        <>
          <p className="text-[12px] text-muted-foreground">
            {preview.valid ? preview.description : preview.error}
          </p>
          {Array.isArray(preview.upcoming) && preview.upcoming.length > 0 && (
            <div className="space-y-0.5">
              {preview.upcoming.map((when) => (
                <div key={when} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {when}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      <ConfirmButtons
        confirmLabel="Arm schedule"
        busy={busy}
        onConfirm={() => onConfirm?.({ cron: str(card.cron) })}
        onCancel={onCancel}
      />
    </Shell>
  );
}

function PublishCard({
  card,
  onConfirm,
  onCancel,
  busy,
}: {
  card: CommandCardData;
  onConfirm?: (confirm: Record<string, unknown>) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [visibility, setVisibility] = useState(str(card.visibility) || 'link');
  return (
    <Shell title="Publish this?" tone="confirm">
      <p className="text-[12px] text-muted-foreground">
        Publishing leaves the platform. Link is narrowest; public is the open internet.
      </p>
      <div className="grid grid-cols-3 gap-1.5">
        {(['link', 'platform', 'public'] as const).map((level) => (
          <button
            key={level}
            onClick={() => setVisibility(level)}
            className={cn(
              'min-h-[44px] rounded-lg border px-2 py-2 text-[12px] font-bold',
              visibility === level
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border/50 text-muted-foreground hover:bg-muted/50',
            )}
          >
            {level}
          </button>
        ))}
      </div>
      <ConfirmButtons
        confirmLabel="Publish"
        busy={busy}
        onConfirm={() => onConfirm?.({ visibility })}
        onCancel={onCancel}
      />
    </Shell>
  );
}

function FindingsCard({ card }: { card: CommandCardData }) {
  const findings = Array.isArray(card.findings)
    ? card.findings as {
      file?: string; line?: number | null; severity?: string;
      category?: string; summary?: string; suggestion?: string;
    }[]
    : [];
  if (findings.length === 0) {
    return (
      <Shell title="Review: clean">
        <p className="text-[12px] text-muted-foreground">No issues found.</p>
      </Shell>
    );
  }
  const tone = (severity: string) =>
    severity === 'blocker' ? 'bg-destructive/15 text-destructive'
    : severity === 'major' ? 'bg-amber-500/15 text-amber-600'
    : 'bg-muted text-muted-foreground';
  return (
    <Shell title={`Review: ${findings.length} finding${findings.length === 1 ? '' : 's'}`}>
      <div className="space-y-2">
        {findings.map((finding, i) => (
          <div key={i} className="rounded-lg border border-border/50 p-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold uppercase', tone(str(finding.severity)))}>
                {str(finding.severity) || 'minor'}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {str(finding.category) || 'readability'}
              </span>
              {(finding.file != null && String(finding.file)) && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {String(finding.file)}{finding.line != null ? `:${String(finding.line)}` : ''}
                </span>
              )}
            </div>
            <p className="text-[12px] text-foreground">{str(finding.summary)}</p>
            {str(finding.suggestion) && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Fix: {str(finding.suggestion)}
              </p>
            )}
          </div>
        ))}
      </div>
    </Shell>
  );
}

function AgentRunCard({
  card,
  onNavigate,
}: {
  card: CommandCardData;
  onNavigate?: (path: string) => void;
}) {
  const executionId = str(card.execution_id);
  return (
    <Shell title={`${str(card.agent_name) || 'Agent'} is working`}>
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-semibold uppercase text-primary">
          {str(card.status) || 'running'}
        </span>
        {num(card.todos_open) > 0 && <span>{num(card.todos_open)} todos open</span>}
        {num(card.files) > 0 && <span>{num(card.files)} files</span>}
      </div>
      {executionId && (
        <button
          onClick={() => onNavigate?.(`/runs?run=${executionId}`)}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-border/50 px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted/50"
        >
          <Play className="h-3.5 w-3.5" />
          Watch the run
        </button>
      )}
    </Shell>
  );
}
