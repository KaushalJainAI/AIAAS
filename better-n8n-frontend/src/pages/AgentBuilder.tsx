/**
 * Agent builder — the knob board, plus the agent that edits it for you.
 *
 * Two panes on purpose. The right side is the whole configuration, always
 * visible, always editable by hand. The left side proposes edits: you describe
 * the change, it adjusts the settings and explains why, and every change
 * it makes lights up on the right so nothing happens behind your back.
 * Creation lives in the wizard at /agents/new; this pane never creates.
 *
 * Proposing a config you cannot see or override would be the wrong trade —
 * the point of the board is that the agent's choices stay inspectable.
 */
import { useMemo, useRef, useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot, Brain, Cpu, Timer, FolderLock, Wrench, Plug,
  ShieldCheck, Clock, Layers, Save, RotateCcw, Check, Globe, Loader2, Trash2,
  FileOutput,
  History,
  Play,
  Archive,
  Copy,
  Activity,
  FlaskConical,
} from 'lucide-react';
import { toast } from 'sonner';
import nodeService from '../api/nodeService';
import skillsService from '../api/skills';
import toolsService from '../api/tools';
import { mcpService } from '../api/mcp';
import agentsService, { type Agent } from '../api/agents';
import { useRestoreRevision } from '../hooks/useRestoreRevision';
import { logsService } from '../api';
import { cn } from '../lib/utils';
import MultiSelect from '../components/ui/MultiSelect';
import Select from '../components/ui/Select';
import {
  DEFAULT_AGENT, AUTONOMY_COPY, FILE_ACCESS_COPY,
  STATUS_COPY, CONTRACT_COPY, CONNECTOR_MODE_COPY,
  type AgentConfig, type Autonomy, type FileAccess, type AgentStatus,
  type OutputContract, type ConnectorChoice, type ConnectorMode,
  type ToolPermissionMode,
} from '../types/agentConfig';
import RevisionEntry from '../components/agents/RevisionEntry';
import RunAgentDialog from '../components/agents/RunAgentDialog';
import ConnectorToolPicker from '../components/agents/ConnectorToolPicker';
import AgentScorecard from '../components/agents/AgentScorecard';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { propose, applyChanges, type Change } from '../lib/agentProposals';
import {
  TOOL_PERMISSION_COPY, countToolPermissions, pruneToolPermissions,
  toggleToolPermission,
} from '../lib/toolPermissions';
import { SendButton } from '../components/ui/SendButton';
import { Switch } from '../components/ui/Switch';
import TriggerModal from '../components/schedules/TriggerModal';
import triggersService, { type Trigger } from '../api/triggers';
import { statusTone } from '../lib/triggerStatus';
import { EFFORT_LABELS } from '../hooks/useEffortSelection';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '../hooks/useChatModelSelection';
import { useAuth } from '../contexts/authState';
import SidebarMenuButton from '../components/layout/SidebarMenuButton';

type Msg = { role: 'user' | 'agent'; text: string; changes?: Change[] };

/* ---------- small building blocks ---------- */

function Section({ icon: Icon, title, hint, notEnforced, children }: {
  icon: typeof Cpu; title: string; hint?: string;
  /** Why this section's settings are saved but do not yet change a run. */
  notEnforced?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border rounded bg-card mb-4 break-inside-avoid">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {notEnforced && (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-warning border border-warning/40 rounded px-1.5 py-0.5">
            Coming soon
          </span>
        )}
        {hint && <span className="text-[12px] text-muted-foreground ml-auto">{hint}</span>}
      </header>
      {notEnforced && (
        <p className="px-4 pt-3 text-[12px] text-muted-foreground">{notEnforced}</p>
      )}
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

/** The newest few configuration changes to this agent.
 *
 *  The point is correlation, not nostalgia: a run records the revision it
 *  executed under, so "it got worse on Tuesday" becomes "it got worse at rev 4,
 *  which changed the model and the autonomy". `run_count` says whether a
 *  revision has been exercised enough to judge at all.
 *
 *  Only `INLINE_REVISIONS` of them show. This section used to render the whole
 *  timeline, which grows for the life of the agent — so on an agent anyone
 *  actually tunes it pushed the rest of the board off the screen, and there was
 *  no way to reach a revision past the server's cap at all. The full history is
 *  its own page now; this is the "what did I just change?" view, and the link
 *  is here rather than at the end of a list nobody scrolls to.
 */
const INLINE_REVISIONS = 3;

/**
 * This agent's schedules, managed here through the same modal as the
 * Schedules page — one editor, not two. The builder used to carry its own
 * cron field, but one field cannot own a list: every save reconciled (and
 * could delete) rows the Schedules page owns, so adding a second schedule
 * anywhere but here silently broke.
 */
function AgentSchedules({ agentId, allowUnattended, hasPrompt }: {
  agentId: number;
  allowUnattended: boolean;
  hasPrompt: boolean;
}) {
  const [modal, setModal] = useState<{ trigger: Trigger | null } | null>(null);
  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ['triggers', agentId],
    queryFn: () => triggersService.list(agentId),
  });
  const schedules = triggers.filter((t) => t.mode === 'schedule');

  return (
    <div>
      {isLoading ? (
        <p className="px-2 text-[12px] text-muted-foreground">Loading schedules…</p>
      ) : schedules.length === 0 ? (
        <p className="px-2 text-[12px] text-muted-foreground">
          No schedules yet. One modal, no trip to another page — including
          granting “may run unattended”.
        </p>
      ) : (
        <div className="space-y-1.5">
          {schedules.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setModal({ trigger: s })}
              className="flex w-full items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-left hover:bg-secondary"
            >
              <span className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                s.status === 'ok'
                  ? 'bg-success'
                  : statusTone(s.status) === 'warn' ? 'bg-warning' : 'bg-destructive',
              )} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {s.description || 'Schedule'}
                </span>
                {s.name && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {s.name}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setModal({ trigger: null })}
        className="mt-2 flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[13px] hover:bg-secondary"
      >
        <Clock className="w-3.5 h-3.5" />
        Add schedule
      </button>
      {modal && (
        <TriggerModal
          trigger={modal.trigger}
          mode="schedule"
          agentId={agentId}
          agentAllowsUnattended={allowUnattended}
          agentHasPrompt={hasPrompt}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
function RevisionHistory({ agentId, onRestored }: {
  agentId: number;
  /** The board shows the saved config; after a restore it must show the new one. */
  onRestored: (agent: Agent) => void;
}) {
  const { restore, pending } = useRestoreRevision(agentId, onRestored);
  const { data, isLoading } = useQuery({
    queryKey: ['agent-revisions', agentId, INLINE_REVISIONS],
    queryFn: () => logsService.listRevisions(agentId, { limit: INLINE_REVISIONS }),
  });

  if (isLoading) {
    return <p className="text-[12px] text-muted-foreground">Loading history…</p>;
  }

  const revisions = data?.results ?? [];
  if (revisions.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        No changes yet. Future saves will be tracked here.
      </p>
    );
  }

  const total = data?.count ?? revisions.length;
  const rest = total - revisions.length;

  return (
    <>
      <ol className="space-y-2">
        {revisions.map((rev, i) => (
          <RevisionEntry key={rev.id} revision={rev}
            onRestore={i === 0 ? undefined : () => restore(rev.number)}
            restoring={pending === rev.number} />
        ))}
      </ol>
      <Link
        to={`/agents/${agentId}/history`}
        className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
      >
        <History className="w-3.5 h-3.5" />
        {rest > 0
          ? `View all ${total} changes`
          : 'View full history'}
      </Link>
    </>
  );
}


/** Wraps a control so a knob the agent just moved is visibly flagged. */
function Knob({ path, touched, label, hint, children }: {
  path: string; touched: Set<string>; label: string; hint?: string; children: React.ReactNode;
}) {
  const isNew = touched.has(path);
  return (
    <div className={cn('rounded -mx-2 px-2 py-1.5 transition-colors', isNew && 'bg-agent-subtle')}>
      <div className="flex items-center gap-2 mb-1">
        <label className="text-[13px] font-medium text-foreground">{label}</label>
        {isNew && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-agent">
            <Bot className="w-3 h-3" />set by agent
          </span>
        )}
        {hint && <span className="ml-auto text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Choice<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { id: T; label: string; hint?: string }[];
}) {
  return (
    <div className="space-y-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'w-full text-left px-3 py-2 rounded border transition-colors',
            value === o.id ? 'border-primary bg-primary-subtle' : 'border-border hover:bg-secondary'
          )}
        >
          <div className="flex items-center gap-2">
            <span className={cn('w-3.5 h-3.5 rounded-full border flex items-center justify-center',
              value === o.id ? 'border-primary bg-primary' : 'border-border-strong')}>
              {value === o.id && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </span>
            <span className="text-[13px] font-medium">{o.label}</span>
          </div>
          {o.hint && <p className="text-[12px] text-muted-foreground mt-0.5 ml-5.5 pl-0.5">{o.hint}</p>}
        </button>
      ))}
    </div>
  );
}

/* ---------- the connector union ----------
 *
 * A stored connection is either a bare id (every agent saved before the mode
 * existed) or `{id, mode, tools}`. These four keep that difference in one
 * place instead of at every call site — and keep the bare form when nothing
 * narrower was chosen, so two agents that picked the same thing store the same
 * thing.
 */
const connectorId = (choice: ConnectorChoice): number =>
  typeof choice === 'number' ? choice : choice.id;

const connectorMode = (choice: ConnectorChoice): ConnectorMode =>
  typeof choice === 'number' ? 'all' : choice.mode;

function setConnectorMode(
  choices: ConnectorChoice[], id: number, mode: ConnectorMode,
): ConnectorChoice[] {
  return choices.map((choice) => {
    if (connectorId(choice) !== id) return choice;
    // `all` with no named tools is the bare form: one spelling per meaning.
    if (mode === 'all') return id;
    const tools = typeof choice === 'number' ? [] : choice.tools;
    return { id, mode, tools };
  });
}

/** Set the named tools of one `selected` connection. */
function setConnectorTools(
  choices: ConnectorChoice[], id: number, tools: string[],
): ConnectorChoice[] {
  return choices.map((choice) =>
    connectorId(choice) === id ? { id, mode: 'selected' as const, tools } : choice);
}

/** Apply a MultiSelect's id list, keeping the mode already chosen for each. */
function reconcileConnectors(
  current: ConnectorChoice[], selectedIds: string[],
): ConnectorChoice[] {
  const byId = new Map(current.map((c) => [connectorId(c), c]));
  return selectedIds
    .map(Number)
    .filter((id) => !Number.isNaN(id))
    .map((id) => byId.get(id) ?? id);
}

function TagInput({ value, onChange }: {
  value: string[]; onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const tag = draft.trim().replace(/\s+/g, ' ');
    // Case-insensitive de-duplication, matching what the serializer does on
    // save — otherwise a tag looks accepted and comes back missing.
    if (tag && !value.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      onChange([...value, tag]);
    }
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((tag) => (
        <span key={tag}
          className="inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded border border-border bg-card text-[12px]">
          {tag}
          <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))}
            title={`Remove ${tag}`}
            className="w-4 h-4 rounded-sm text-muted-foreground hover:text-foreground">
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          if (e.key === 'Backspace' && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={value.length ? 'Add another…' : 'finance, weekly'}
        className="flex-1 min-w-[8rem] h-7 px-2 rounded border border-input bg-background text-[12px]"
      />
    </div>
  );
}

function Toggle({ on, onChange, label, hint }: {
  on: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="w-full flex items-start gap-2.5 text-left py-1 group"
    >
      <Switch checked={on} onChange={onChange} label={label} />
      <span className="min-w-0">
        <span className="block text-[13px] text-foreground">{label}</span>
        {hint && <span className="block text-[12px] text-muted-foreground">{hint}</span>}
      </span>
    </button>
  );
}

/** Grants the runtime does not serve (`runtime.UNSERVED_GRANTS`). Empty since
 *  P6 served `shell` — kept so the next unserved grant has a named place. */
const UNSERVED_TOOLS = new Set<string>([]);

/** Why another agent cannot run this one, or null if it can. */
function delegationBlocker(a: { status?: string; allowUnattended?: boolean }): string | null {
  if (a.status === 'paused') return 'Paused — delegation to it is refused.';
  if (!a.allowUnattended) return 'Not cleared to run automatically — delegation to it is refused.';
  return null;
}

/* ---------- page ---------- */

export default function AgentBuilder() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // /agents/new -> blank board. /agents/:id -> the same board, prefilled.
  // Editing and creating are the same act, so they are the same screen.
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const agentId = isNew ? null : Number(id);

  const [cfg, setCfg] = useState<AgentConfig>(DEFAULT_AGENT);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  /* Which pane is on screen below `lg`, where the chat and the knob board
     cannot both fit. Ignored at `lg` and above, where both are rendered. */
  const [mobilePane, setMobilePane] = useState<'chat' | 'settings'>('chat');
  /** A turn is in flight. One at a time: the proposal is against a snapshot of
   *  the board, so a second send while the first is out would propose against a
   *  config that is about to change under it. */
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth();

  // The account default from Settings (UserProfile). A new agent starts here,
  // and a stored agent with a blank model runs here too — see `displayProvider`
  // / `effectiveModel` below and the matching backend fallback in
  // `agents/agent/runtime.py`. `??` for effort because `''` is a real choice
  // (the model's own default), not an absent one.
  const userDefaultProvider = user?.llm_provider || DEFAULT_PROVIDER;
  const userDefaultModel = user?.llm_model || DEFAULT_MODEL;
  // (No `userDefaultEffort` twin: unlike provider and model, effort is never
  // *derived* for display — the seeding effect below reads `user.llm_effort`
  // directly, so a third constant here was dead and failed the build.)
  // Seed a blank board once from the account default. Guarded so it never
  // stomps an edit, a builder-chat proposal, or the loaded agent.
  // State rather than a ref, and applied during render rather than in an
  // effect: the board is seeded before it first paints instead of flashing the
  // platform default and then re-rendering.
  const [userDefaultsApplied, setUserDefaultsApplied] = useState(false);
  /** What a new agent starts from: the account's own choices in Settings.
   *  Temperature and timezone were stored there and never reached a new agent;
   *  the zone falls back to the browser's when Settings still holds the
   *  untouched `UTC`, which is what this board did before. */
  const accountDefaults = (): Partial<AgentConfig> => ({
    provider: user?.llm_provider || DEFAULT_AGENT.provider,
    model: user?.llm_model || DEFAULT_AGENT.model,
    effort: user?.llm_effort ?? DEFAULT_AGENT.effort,
    temperature: user?.default_temperature ?? DEFAULT_AGENT.temperature,
    scheduleTimezone: user?.timezone && user.timezone !== 'UTC'
      ? user.timezone : DEFAULT_AGENT.scheduleTimezone,
  });
  if (isNew && !userDefaultsApplied && user) {
    setUserDefaultsApplied(true);
    if (touched.size === 0) setCfg((c) => {
      if (c.provider !== DEFAULT_AGENT.provider || c.model !== '' || c.effort !== DEFAULT_AGENT.effort) return c;
      return { ...c, ...accountDefaults() };
    });
  }

  const { data: existing, isLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => agentsService.get(id!),
    enabled: !isNew,
  });

  // Real model catalogue — the picker should show what is actually callable.
  // The full response is kept (not just `.providers`) for `meta.fallback`,
  // which the retired-model banner names.
  const { data: catalogueResponse } = useQuery({
    queryKey: ['agent-builder', 'models'],
    queryFn: () => nodeService.getAIModels(),
    staleTime: 5 * 60 * 1000,
  });
  const providers = useMemo(
    () => catalogueResponse?.providers ?? [],
    [catalogueResponse],
  );
  const fallbackModel = catalogueResponse?.meta?.fallback?.model;
  /* The delegation candidates: the user's other agents. Fetched rather than
     derived from anything on this page — an id only exists on the server, and
     the picker has to show what `search_agents` will actually see. */
  const { data: allAgents = [] } = useQuery({
    queryKey: ['agent-builder', 'agents'],
    queryFn: () => agentsService.list(),
    staleTime: 60 * 1000,
  });
  const otherAgents = useMemo(
    () => allAgents.filter((a) => String(a.id) !== String(id)),
    [allAgents, id],
  );

  /* The tool catalogue, so the visibility picker lists what this agent's
     grants actually unlock rather than a copy of the runtime's table that
     would drift the first time a tool is added. */
  const { data: catalogue } = useQuery({
    queryKey: ['agent-builder', 'tool-catalogue'],
    queryFn: () => toolsService.catalogue(),
    staleTime: 5 * 60 * 1000,
  });
  const grants = cfg.tools;
  const grantedTools = useMemo(() => {
    const categories = (catalogue?.categories ?? []).filter(
      (c) => c.grantBacked && grants[c.key as keyof typeof grants],
    );
    return categories.flatMap((c) =>
      c.tools.filter((t) => !t.alwaysAvailable && !t.unserved).map((t) => ({
        id: t.name,
        label: t.displayName,
        hint: `${c.label} · ${t.description.split('. ')[0]}`,
      })),
    );
  }, [catalogue, grants]);

  const { data: skills = [] } = useQuery({
    queryKey: ['agent-builder', 'skills'],
    queryFn: () => skillsService.list(),
    staleTime: 5 * 60 * 1000,
  });
  /* The connector picker's options are the account's real connections, not a
     list in this file. The old hardcoded six had drifted from the catalogue in
     both directions — it offered "Photos", which no connector has ever been,
     and could not name Notion at all — and nothing enforced it anyway. Now that
     the runtime honours the selection, offering a connection the user does not
     have would put an id in the config that the backend rejects on save.

     `effective_enabled` rather than `enabled`: a connection the user has
     switched off on Connections is not one to offer here, because the runtime
     drops it when it resolves the toolbox. */
  const { data: connectorOptions = [] } = useQuery({
    queryKey: ['agent-builder', 'connections'],
    queryFn: async () =>
      (await mcpService.list()).servers
        // Built-ins (`utilities`) are not offered: they are retired rows the
        // Connections page no longer shows, and scoping an agent to one would
        // narrow it onto tools that resolve to nothing.
        .filter((srv) => srv.effective_enabled && srv.category !== 'utilities')
        .map((srv) => ({ id: srv.id, label: srv.label, iconSlug: srv.icon_slug }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    staleTime: 5 * 60 * 1000,
  });

  // Fill the board once the agent arrives. The server's shape is AgentConfig,
  // so there is nothing to translate — which is the point of the contract.
  //
  // Adjusted during render rather than in an effect (the pattern React documents
  // for deriving state from changing props). An effect would paint the empty
  // board first and then overwrite it, and any edit made in that gap would be
  // silently discarded.
  const [loadedId, setLoadedId] = useState<number | null>(null);
  // The conversation that configured this agent, kept server-side so a reload
  // does not throw away the reason behind every knob it moved. Seeded once,
  // and only into an empty pane — never over a conversation in progress.
  const { data: savedChat } = useQuery({
    queryKey: ['agent-builder-chat', agentId],
    queryFn: () => agentsService.builderChat(agentId!),
    enabled: agentId != null,
    staleTime: Infinity,
  });
  // The newest revision, so the scorecard can say a score is from an older
  // configuration. Shares the inline history's query key, so no extra request.
  const { data: newestRevisions } = useQuery({
    queryKey: ['agent-revisions', agentId, 3],
    queryFn: () => logsService.listRevisions(agentId!, { limit: 3 }),
    enabled: agentId != null,
  });
  const latestRevision = newestRevisions?.results?.[0]?.number ?? null;
  const [chatSeeded, setChatSeeded] = useState(false);
  // React Router keeps this component mounted across `/agents/:id` changes
  // (Duplicate navigates to the copy), so the pane has to be reset by hand or
  // one agent's conversation would carry on under another's name.
  const [chatFor, setChatFor] = useState(agentId);
  if (chatFor !== agentId) {
    setChatFor(agentId);
    setMessages([]);
    setChatSeeded(false);
    setTouched(new Set());
  }
  if (!chatSeeded && savedChat) {
    setChatSeeded(true);
    if (messages.length === 0 && savedChat.messages.length > 0) {
      setMessages(savedChat.messages.map((m) => ({
        role: m.role, text: m.text,
        changes: m.changes.length ? (m.changes as Change[]) : undefined,
      })));
    }
  }
  const [running, setRunning] = useState(false);
  if (existing && loadedId !== existing.id) {
    setLoadedId(existing.id);
    setCfg({ ...DEFAULT_AGENT, ...existing });
  }

  // Whether the board differs from what is saved. A run uses the saved
  // configuration, and leaving the page used to drop edits without a word.
  const dirty = !isNew && !!existing
    && JSON.stringify({ ...DEFAULT_AGENT, ...existing }) !== JSON.stringify(cfg);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (config: AgentConfig) =>
      isNew ? agentsService.create(config) : agentsService.update(id!, config),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', id] });
      toast.success(isNew ? `${agent.name} created` : 'Saved');
      setTouched(new Set());
      // Adopt what the server stored, not what was sent: it normalises (tag
      // order, connector shape), and a board that differs from the saved copy
      // by normalisation alone would read as unsaved forever.
      if (!isNew) setCfg({ ...DEFAULT_AGENT, ...agent });
      if (isNew) navigate(`/agents/${agent.id}`, { replace: true });
    },
    // The server validates the same rules the board shows, so its message is
    // more specific than anything generic we could write here.
    onError: (err: { response?: { data?: Record<string, unknown> } }) => {
      const data = err.response?.data;
      const first = data && Object.entries(data)[0];
      toast.error(
        first ? `${first[0]}: ${String(Array.isArray(first[1]) ? first[1][0] : first[1])}`
              : 'Could not save this agent.'
      );
    },
  });

  const remove = useMutation({
    mutationFn: () => agentsService.remove(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent deleted');
      navigate('/agents');
    },
    onError: () => toast.error('Could not delete this agent.'),
  });
  // Archive is the first answer to "get this out of my list": it keeps the
  // agent restorable, where delete keeps only its runs.
  const archive = useMutation({
    mutationFn: () => agentsService.update(id!, { status: 'archived' }),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(`${agent.name} archived — restore it from Agents → Archived`);
      navigate('/agents');
    },
    onError: () => toast.error('Could not archive this agent.'),
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A starting point for a similar agent. The copy has no schedule and starts
  // as a draft: two agents firing the same job on the same clock is never what
  // "duplicate" meant.
  const duplicate = useMutation({
    mutationFn: () => {
      const source = { ...DEFAULT_AGENT, ...(existing ?? cfg) } as Record<string, unknown>;
      for (const key of ['id', 'runs', 'unattended', 'spend', 'created_at',
        'updated_at', 'extraSchedules', 'trigger', 'schedule',
        'scheduleTimezone']) delete source[key];
      return agentsService.create({
        ...(source as unknown as AgentConfig),
        name: `${cfg.name} (copy)`,
        status: 'draft',
      });
    },
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(`Created ${agent.name}`);
      navigate(`/agents/${agent.id}`);
    },
    onError: () => toast.error('Could not duplicate this agent.'),
  });

  // What the pickers show. A blank model means "the account default" — the
  // stored `provider` alongside it is just the serializer's `openrouter`
  // default, not a choice, so both resolve from the profile together. An
  // explicit model keeps its stored provider even if the profile moved on.
  const displayProvider = cfg.model
    ? (cfg.provider || userDefaultProvider)
    : userDefaultProvider;
  const activeProvider = useMemo(
    () => providers.find((p) => p.slug === displayProvider)
      ?? providers.find((p) => p.slug === userDefaultProvider)
      ?? providers[0],
    [providers, displayProvider, userDefaultProvider]
  );

  // The model actually in force: what was chosen, else the account default,
  // else the provider's first once the catalogue arrives. Derived rather than
  // written back into state by an effect — an effect would race the agent's
  // own load and could overwrite a saved model with the catalogue's default.
  const effectiveModel = cfg.model
    || userDefaultModel
    || activeProvider?.models?.[0]?.value
    || '';

  // Which effort rungs the model in force offers, or `[]` for none — which is
  // what hides the control entirely. Derived for the same reason as
  // `effectiveModel`: writing it back through an effect would race the agent's
  // own load and could clear a saved level before it was ever rendered.
  const effortLevels = useMemo(
    () =>
      activeProvider?.models?.find((mo) => mo.value === effectiveModel)?.effort_levels
      ?? [],
    [activeProvider, effectiveModel]
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  const set = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K]) =>
    setCfg((c) => ({ ...c, [k]: v }));
  const setTool = (k: keyof AgentConfig['tools'], v: boolean) =>
    setCfg((c) => ({ ...c, tools: { ...c.tools, [k]: v } }));
  /* One tool's allow/ask/deny. Picking the active mode clears it back to
     inherit (unset) — see `toggleToolPermission` — so an untouched tool
     keeps meaning "grants, toolScope and autonomy decide". */
  const setToolPermission = (tool: string, mode: ToolPermissionMode) =>
    setCfg((c) => ({ ...c, toolPermissions: toggleToolPermission(c.toolPermissions, tool, mode) }));

  /* The chat pane is a *model* configuring the agent, with the local rule table
     as its fallback.

     The rules stay because they are the only thing that works when no model can
     be reached — but they are the fallback and not the feature: they moved a
     knob only when the description happened to contain a word in their table,
     so a brief that named its source, its job and its cadence could still be
     answered with "I couldn't tell which knobs that should move". The server
     sees the account's real connections, knowledge bases and skills, so it can
     name ids the browser has no way to guess, and it validates every value it
     proposes against the same serializer that will validate the save. */
  const send = async (text: string) => {
    if (!text.trim() || pending) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    setPending(true);
    // Captured before the await: `cfg` in this closure is the board the user
    // was looking at when they pressed send, which is what the proposal is
    // against — and what `applyChanges` must be applied to below.
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    // Propose against what the board shows: a blank model runs as the account
    // default (see `displayProvider`/`effectiveModel`), so the proposal must
    // be too, or the builder re-proposes the default as a change every turn.
    const visibleCfg = { ...cfg, provider: displayProvider, model: effectiveModel };
    try {
      const proposal = await agentsService.configure(text, visibleCfg, history, agentId);
      apply(proposal.reply, proposal.changes as Change[]);
    } catch {
      const { reply, changes } = propose(text, visibleCfg, connectorOptions);
      apply(
        changes.length
          ? `${reply}

(The configuring model was unreachable, so this is the local rule set — check each change.)`
          : "I couldn't reach the model that configures agents, and the local rules didn't recognise that. Try naming what it reads, what it does with it, and whether it may act without you.",
        changes,
      );
    } finally {
      setPending(false);
    }
  };

  const apply = (reply: string, changes: Change[]) => {
    setCfg((c) => applyChanges(c, changes));
    setTouched(new Set(changes.map((c) => c.path)));
    setMessages((m) => [...m, { role: 'agent', text: reply, changes }]);
  };

  const reset = () => {
    if (existing) {
      setCfg({ ...DEFAULT_AGENT, ...existing });
    } else {
      // A new board starts at the account default, matching the seeding effect
      // above — resetting to the shipped constants would unpick the user's
      // own default from under them.
      setCfg({ ...DEFAULT_AGENT, ...accountDefaults() });
    }
    setTouched(new Set());
    setMessages([]);
  };

  const submit = () => {
    if (!cfg.name.trim()) {
      toast.error('Give the agent a name first.');
      return;
    }
    // Persist the pair actually shown in the pickers, not the empty string
    // that was there before the catalogue loaded. Per-tool rules for tools
    // the switches no longer unlock are pruned for the same reason: the
    // backend would ignore them (grant off wins), and storing dead rules is
    // a screen that overpromises. `schedule` / `scheduleTimezone` are not
    // sent at all — schedules live on Trigger rows the Schedules page owns,
    // and the serializer reconciles only keys it receives, so omitting them
    // leaves every schedule alone. The cast keeps `AgentConfig` (which still
    // declares the fields for templates and the chat authoring tool) while
    // the wire omits them.
    const { schedule: _schedule, scheduleTimezone: _tz, ...rest } = cfg;
    void _schedule;
    void _tz;
    save.mutate({
      ...rest,
      provider: displayProvider,
      model: effectiveModel,
      toolPermissions: pruneToolPermissions(
        cfg.toolPermissions, grantedTools.map((t) => t.id)),
    } as AgentConfig);
  };

  // What actually happened, once there is something to report. Before the first
  // run there is no honest number, so the line says what to do instead.
  const subtitle = () => {
    if (isNew) return 'Describe what you want, or adjust the settings yourself';
    if (!existing) return 'Loading…';
    if (!existing.runs) return 'Not run yet';
    const pct = Math.round((existing.unattended / existing.runs) * 100);
    return `${existing.runs} runs · ${pct}% handled without you · ₹${existing.spend}`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* Menu button is in-flow (same 40px slot as every title bar) so it
          wraps with the actions instead of floating over the corner. */}
      <header className="px-4 md:px-6 py-3 md:py-4 border-b border-border flex flex-wrap items-center gap-3">
        <SidebarMenuButton />
        <div className="p-2 bg-agent-subtle border border-agent-line rounded shrink-0">
          <Bot className="w-5 h-5 text-agent" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg md:text-xl font-semibold tracking-tight truncate">
            {isNew ? 'New agent' : cfg.name || 'Agent'}
          </h1>
          <p className="text-[13px] text-muted-foreground truncate">{subtitle()}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {!isNew && (
            <button
              onClick={() => duplicate.mutate()}
              disabled={duplicate.isPending}
              title="Make a copy of the saved configuration, without its schedule"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary">
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
          )}
          {!isNew && existing?.status !== 'archived' && (
            <button
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
              title="Hide it and stop it running automatically. Restorable."
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary">
              <Archive className="w-4 h-4" />
              Archive
            </button>
          )}
          {!isNew && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border text-destructive hover:bg-destructive-subtle">
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
          {!isNew && agentId != null && (
            <Link to={`/runs?agent=${agentId}`}
              title="This agent's runs"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary">
              <Activity className="w-4 h-4" />
              Runs
            </Link>
          )}
          {!isNew && agentId != null && (
            <button onClick={() => setRunning(true)}
              title="Start a run of the saved configuration"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary">
              <Play className="w-4 h-4" />
              Run
            </button>
          )}
          <button onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary">
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>
          <button
            onClick={submit}
            disabled={save.isPending || isLoading}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isNew ? 'Create agent' : 'Save changes'}
          </button>
        </div>
      </header>

      {/* Below `lg` the two panes cannot share the width, so they take turns.
          Before this the knob board was flatly `hidden lg:block`: on a phone or
          a portrait tablet the builder was a chat box with no way to see or set
          a single field — not even the agent's name. */}
      <div className="lg:hidden flex border-b border-border shrink-0">
        {(['chat', 'settings'] as const).map((pane) => (
          <button
            key={pane}
            onClick={() => setMobilePane(pane)}
            className={cn(
              'flex-1 py-2.5 text-[13px] font-semibold capitalize border-b-2 -mb-px transition-colors',
              mobilePane === pane
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground',
            )}
          >
            {pane === 'chat' ? 'Assistant' : 'Settings'}
          </button>
        ))}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ---- builder edit assistant (creation lives in /agents/new wizard) ---- */}
        <div className={cn(
          'w-full lg:w-[420px] xl:w-[460px] border-r border-border flex-col min-h-0',
          mobilePane === 'chat' ? 'flex' : 'hidden lg:flex',
        )}>
          <div className="px-4 pt-3">
            <p className="text-xs text-muted-foreground border border-border rounded p-2 bg-muted">
              New agents are created in the <Link to="/agents/new" className="underline font-semibold">creation wizard</Link> —
              questions, proposal, approval, then a starter eval. This pane is edit-only history.
            </p>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="pt-4">
                <div className="w-10 h-10 rounded bg-agent-subtle border border-agent-line flex items-center justify-center mb-3">
                  <Bot className="w-5 h-5 text-agent" />
                </div>
                <h2 className="font-semibold mb-1">What should change?</h2>
                <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
                  Say it in plain language. I'll propose settings changes on the right and explain why
                  I picked each one — nothing is saved until you press Save, and you can override all of it.
                </p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' && 'justify-end')}>
                  <div className={cn('max-w-[92%] rounded px-3 py-2',
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border')}>
                    <p className="text-[13px] leading-relaxed">{msg.text}</p>
                    {msg.changes && msg.changes.length > 0 && (
                      <ul className="mt-2 pt-2 border-t border-border space-y-1.5">
                        {msg.changes.map((c) => (
                          <li key={c.path} className="text-[12px]">
                            <span className="font-semibold text-agent">{c.label}</span>
                            <span className="text-muted-foreground"> — {c.why}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))
            )}
            {pending && (
              <div className="flex">
                <div className="max-w-[92%] rounded px-3 py-2 bg-card border border-border
                                flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Working out the settings…
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send(input)}
                disabled={pending}
                placeholder={pending ? 'Working…' : 'Describe a change…'}
                className="flex-1 h-10 px-3 rounded border border-input bg-background text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
              />
              <SendButton onClick={() => send(input)} disabled={!input.trim() || pending} />
            </div>
          </div>
        </div>

        {/* ---- knob board ---- */}
        <div className={cn(
          'flex-1 overflow-y-auto p-4 md:p-6 bg-bg-1',
          mobilePane === 'settings' ? 'block' : 'hidden lg:block',
        )}>
          <div className="max-w-[1600px]">
            <div className="2xl:columns-2 2xl:gap-4">

            <Section icon={Bot} title="Identity">
              <Knob path="name" touched={touched} label="Name">
                <input value={cfg.name} onChange={(e) => set('name', e.target.value)}
                  placeholder="Finance agent"
                  className="w-full h-9 px-3 rounded border border-input bg-background text-sm" />
              </Knob>
              <Knob path="brief" touched={touched} label="Brief" hint="What it is for, in one or two sentences">
                <textarea value={cfg.brief} onChange={(e) => set('brief', e.target.value)}
                  rows={3} placeholder="Reads invoices from Gmail and chases anything overdue…"
                  className="w-full px-3 py-2 rounded border border-input bg-background text-sm resize-none" />
              </Knob>
              {/* Not the same field as the brief, and the difference matters:
                  the brief is what the agent is *told*, this is what another
                  agent reads when choosing which one to hand a job to. It has
                  been on the model since the start and reachable only through
                  Django admin, so every agent built here was blank to the
                  parent trying to pick one. */}
              <Knob path="description" touched={touched} label="One-line summary"
                    hint="how other agents recognise it">
                <input value={cfg.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Chases overdue invoices and reports what is stuck."
                  className="w-full h-9 px-3 rounded border border-input bg-background text-sm" />
              </Knob>
              <Knob path="tags" touched={touched} label="Tags" hint="for grouping and search">
                <TagInput value={cfg.tags} onChange={(v) => set('tags', v)} />
              </Knob>
              <Knob path="status" touched={touched} label="Status">
                <Choice<AgentStatus>
                  value={cfg.status} onChange={(v) => set('status', v)}
                  options={(Object.keys(STATUS_COPY) as AgentStatus[]).map((id) => ({
                    id, label: STATUS_COPY[id].label, hint: STATUS_COPY[id].hint,
                  }))} />
              </Knob>
            </Section>

            <Section icon={Brain} title="Model">
              <div className="grid sm:grid-cols-2 gap-3">
                <Knob path="provider" touched={touched} label="Provider">
                  <Select
                    value={displayProvider}
                    onChange={(slug) => {
                      const p = providers.find((x) => x.slug === slug);
                      setCfg((c) => ({ ...c, provider: slug, model: p?.models?.[0]?.value ?? '' }));
                    }}
                    placeholder="Choose a provider"
                    icon={<Layers className="w-4 h-4" />}
                    options={providers.map((p) => ({ value: p.slug, label: p.name }))}
                  />
                </Knob>
                <Knob path="model" touched={touched} label="Model">
                  <Select
                    value={effectiveModel}
                    onChange={(v) => set('model', v)}
                    placeholder="Choose a model"
                    icon={<Brain className="w-4 h-4" />}
                    showSearch={(activeProvider?.models?.length ?? 0) > 8}
                    options={(activeProvider?.models ?? []).map((mo) => ({
                      value: mo.value,
                      label: mo.is_free ? `${mo.name} · free` : mo.name,
                      is_free: mo.is_free,
                    }))}
                  />
                </Knob>
              </div>
              {existing?.model_status === 'retired' && existing.model === effectiveModel && (
                <p role="alert" className="text-[12px] text-destructive">
                  This model has been retired, so runs use the platform fallback
                  {fallbackModel ? ` (${fallbackModel})` : ''} until you pick another.
                  Pick another model and save.
                </p>
              )}
              {/* Always rendered, including for a model with no effort
                  control — see `EffortPicker`. Hiding it meant an existing
                  agent on a non-reasoning model showed no sign the setting
                  exists, which reads as a missing feature rather than as an
                  unsupported model. */}
              <Knob path="effort" touched={touched} label="Reasoning effort"
                    hint={effortLevels.length ? (cfg.effort || 'model default') : 'not supported'}>
                {effortLevels.length > 0 ? (
                  <>
                    <Select
                      value={cfg.effort}
                      onChange={(v) => set('effort', v)}
                      placeholder="Model default"
                      icon={<Brain className="w-4 h-4" />}
                      options={[
                        { value: '', label: 'Model default' },
                        ...effortLevels.map((level) => ({
                          value: level,
                          label: EFFORT_LABELS[level] ?? level,
                        })),
                      ]}
                    />
                    <p className="text-[12px] text-muted-foreground mt-1">
                      Raise it for multi-step analysis. Extraction, routing and
                      formatting do not get better for the extra thinking, and it
                      is billed either way.
                    </p>
                  </>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    {effectiveModel
                      ? 'This model has no reasoning-effort setting. Pick a reasoning model to control how hard it thinks.'
                      : 'Choose a model to see whether it supports reasoning effort.'}
                  </p>
                )}
              </Knob>
              <Knob path="temperature" touched={touched} label="Temperature"
                    hint={cfg.temperature <= 0.2 ? 'deterministic' : cfg.temperature >= 0.7 ? 'varied' : 'balanced'}>
                <div className="flex items-center gap-3">
                  <input type="range" min={0} max={2} step={0.1} value={cfg.temperature}
                    onChange={(e) => set('temperature', Number(e.target.value))}
                    className="flex-1 accent-primary" />
                  <span className="w-8 text-right text-[13px] tabular-nums">{cfg.temperature.toFixed(1)}</span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-1">
                  Extraction and classification want 0. Drafting reads better nearer 0.7.
                </p>
              </Knob>
            </Section>

            {/* File access is enforced; the resource knobs below are not. They
                used to share one section under a single "not yet applied"
                banner, which became a lie the moment the virtual filesystem
                landed — a banner covering a setting that *is* enforced teaches
                people to ignore it on the ones that are not. */}
            <Section icon={FolderLock} title="Files"
              hint="Which of your files it can reach">
              <Knob path="fileAccess" touched={touched} label="File access">
                <Choice<FileAccess>
                  value={cfg.fileAccess} onChange={(v) => set('fileAccess', v)}
                  options={(Object.keys(FILE_ACCESS_COPY) as FileAccess[]).map((id) => ({
                    id, label: FILE_ACCESS_COPY[id].label, hint: FILE_ACCESS_COPY[id].hint,
                  }))} />
              </Knob>
              <p className="text-[12px] text-muted-foreground">
                Needs the “Read and write files” tool below. Anything it writes appears
                in your own files, and anything it deletes goes to your recycle bin.
              </p>
            </Section>

            {/* CPUs and Memory used to live here behind a "COMING SOON" badge.
                They were never read and never could be — the backend runs agent
                code on a thread inside its own process, with no cgroup to hold a
                quota. What a run actually holds is time: an event-loop slot, a
                checkpoint, a database connection, for as long as it waits on a
                model. So the knob is time, and unlike the two it replaced it is
                enforced. */}
            <Section icon={Timer} title="Run limit"
              hint="How long one run may take">
              <Knob path="maxRunSeconds" touched={touched} label="Time limit" hint="per run">
                <div className="flex items-center gap-2">
                  <Timer className="w-4 h-4 text-muted-foreground" />
                  <input type="number" min={1} max={120} step={1}
                    value={Math.round(cfg.maxRunSeconds / 60)}
                    onChange={(e) => set('maxRunSeconds',
                      Math.max(1, Math.min(120, Number(e.target.value))) * 60)}
                    className="w-full h-9 px-2 rounded border border-input bg-background text-sm" />
                  <span className="text-sm text-muted-foreground shrink-0">minutes</span>
                </div>
              </Knob>
              <div className="flex flex-wrap gap-1.5">
                {[5, 15, 30, 60].map((m) => (
                  <button key={m} type="button"
                    onClick={() => set('maxRunSeconds', m * 60)}
                    className={`h-7 px-2.5 rounded border text-[12px] transition-colors ${
                      Math.round(cfg.maxRunSeconds / 60) === m
                        ? 'border-primary text-primary bg-primary/10'
                        : 'border-input text-muted-foreground hover:text-foreground'
                    }`}>
                    {m} min
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-muted-foreground">
                Near the limit the agent stops calling tools and answers with what it
                has, so a run that runs long still returns something. Work it delegates
                shares this budget — a sub-agent cannot outlive the run that called it.
              </p>
            </Section>

            <Section icon={FileOutput} title="What it returns">
              {/* Both of these have been read by the runtime since the agent
                  model landed — `contracts.resolve` at the top and tail of
                  every run, `run_fanout` when a parent delegates a list — and
                  until now only the seeded stock agents could set either. */}
              <Knob path="outputContract" touched={touched} label="Result shape">
                <Choice<OutputContract>
                  value={cfg.outputContract} onChange={(v) => set('outputContract', v)}
                  options={(Object.keys(CONTRACT_COPY) as OutputContract[]).map((id) => ({
                    id, label: CONTRACT_COPY[id].label, hint: CONTRACT_COPY[id].hint,
                  }))} />
                <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
                  A shape other than prose is checked on the way out: an answer
                  that does not fit is reported as a failure rather than quietly
                  reshaped.
                </p>
              </Knob>
              <Knob path="fanoutParallel" touched={touched} label="Fan-out width"
                    hint="when another agent hands it a list">
                <div className="flex items-center gap-1.5">
                  {[null, 2, 4, 8].map((n) => (
                    <button key={String(n)} type="button"
                      onClick={() => set('fanoutParallel', n)}
                      className={`h-7 px-2.5 rounded border text-[12px] transition-colors ${
                        cfg.fanoutParallel === n
                          ? 'border-primary text-primary bg-primary/10'
                          : 'border-input text-muted-foreground hover:text-foreground'
                      }`}>
                      {n === null ? 'One at a time' : `${n} at once`}
                    </button>
                  ))}
                </div>
              </Knob>
            </Section>

            <Section icon={Wrench} title="Tools">
              <p className="px-2 text-[12px] text-muted-foreground -mt-2 mb-1">
                Built-in tools are included with your workspace. See the{' '}
                <Link to="/tools" className="underline text-primary">Tools library</Link> for details — same groups as below. Add-on tools appear after you connect them on{' '}
                <Link to="/connections" className="underline text-primary">Connections</Link>.
              </p>
              {([
                ['codeExecution', 'Run Python', 'Sandboxed interpreter for calculation and parsing.'],
                ['webSearch', 'Web search', 'Look things up it was not given.'],
                ['scrape', 'Read web pages', 'Fetch and extract from a URL.'],
                ['fileOps', 'Read and write files', 'Your own files, within the access level set above.'],
                ['office', 'Make decks, sheets and docs', 'PowerPoint, Excel and Word files, saved where file access allows.'],
                ['media', 'Generate images', 'Billed to your OpenRouter account; saved where file access allows.'],
                ['publish', 'Publish pages', 'Share a report, page or file by link. Pauses before anything goes public.'],
                ['browser', 'Use a browser', 'Read JavaScript pages; click and type only on the sites listed below.'],
                ['rag', 'Knowledge base search', 'Retrieve from your indexed documents.'],
                ['mcp', 'MCP servers (Plugins)', 'The tools from your connected plugins (MCP servers), using your connectors.'],
                ['voice', 'Transcribe and speak', 'Transcripts from recordings; audio files from text. Needs file access.'],
                ['esign', 'E-signatures', 'Send documents out for signature. Pauses before anything goes out.'],
                ['talk', 'Messaging', 'Read, draft and send on Slack, WhatsApp, Teams, SMS and Telegram.'],
                ['data', 'Databases', 'Query SQL databases; write only where allowed.'],
                ['api', 'API calls', 'Call HTTP APIs through one generic caller.'],
                ['compute', 'Compute', 'Run commands and long jobs on your workspace machine.'],
                ['shell', 'Code in projects', 'Read, test, commit, open a PR — in its projects below.'],
                ['subAgents', 'Delegate to other agents', 'Hand whole tasks to agents you have built. Narrow which ones below.'],
              ] as const).map(([k, label, hint]) => (
                <Knob key={k} path={`tools.${k}`} touched={touched} label="">
                  {UNSERVED_TOOLS.has(k) ? (
                    // Nothing serves this grant yet (`runtime.UNSERVED_GRANTS`),
                    // so a working switch would promise a tool no run is handed.
                    // Shown, not hidden, so an agent that already has it on can
                    // see it and turn it off.
                    <div className="flex items-start gap-2.5 py-1 opacity-60">
                      <Switch checked={cfg.tools[k]} onChange={(v) => { if (!v) setTool(k, false); }} label={label} />
                      <span>
                        <span className="block text-[13px]">{label}</span>
                        <span className="block text-[12px] text-muted-foreground">Not available yet — runs are never given this tool.</span>
                      </span>
                    </div>
                  ) : (
                    <Toggle on={cfg.tools[k]} onChange={(v) => setTool(k, v)} label={label} hint={hint} />
                  )}
                </Knob>
              ))}
              <p className="px-2 text-[11px] text-muted-foreground">
                Need the full list? <Link to="/tools" className="underline">Browse tools</Link> to see what each tool does and when it needs approval.
              </p>
            </Section>

            <Section icon={Plug} title="Context it is given">
              <Knob path="connectors" touched={touched} label="Connections"
                    hint={cfg.connectors.length ? `${cfg.connectors.length} selected` : undefined}>
                <MultiSelect
                  options={connectorOptions.map((c) => ({ id: String(c.id), label: c.label }))}
                  value={cfg.connectors.map((c) => String(connectorId(c)))}
                  onChange={(v) => set('connectors', reconcileConnectors(cfg.connectors, v))}
                  placeholder="Every connection — narrow it to what this agent needs"
                  searchPlaceholder="Search connections…"
                  emptyText="None yet — add one on Connections first."
                />
                {/* The second half of the choice, and the one that was missing:
                    picking a mailbox used to hand over sending and deleting
                    along with reading, because the connection was the finest
                    thing there was to pick. */}
                {cfg.connectors.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {cfg.connectors.map((choice) => {
                      const id = connectorId(choice);
                      const label = connectorOptions.find((c) => c.id === id)?.label
                        ?? `Connection ${id}`;
                      return (
                        <div key={id}
                          className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded border border-border bg-card">
                          <span className="text-[12px] font-medium mr-auto">{label}</span>
                          {(['all', 'read', 'selected'] as ConnectorMode[]).map((mode) => (
                            <button key={mode} type="button"
                              onClick={() => set('connectors', setConnectorMode(cfg.connectors, id, mode))}
                              title={CONNECTOR_MODE_COPY[mode].hint}
                              className={`h-6 px-2 rounded border text-[11px] transition-colors ${
                                connectorMode(choice) === mode
                                  ? 'border-primary text-primary bg-primary/10'
                                  : 'border-input text-muted-foreground hover:text-foreground'
                              }`}>
                              {CONNECTOR_MODE_COPY[mode].label}
                            </button>
                          ))}
                          {connectorMode(choice) === 'selected' && (
                            <div className="basis-full">
                              <ConnectorToolPicker
                                serverId={id}
                                value={typeof choice === 'number' ? [] : choice.tools}
                                onChange={(tools) => set('connectors', setConnectorTools(cfg.connectors, id, tools))}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <p className="px-2 text-[11px] text-muted-foreground">
                      {CONNECTOR_MODE_COPY.read.hint} {CONNECTOR_MODE_COPY.selected.hint}
                    </p>
                  </div>
                )}
              </Knob>
              {grantedTools.length > 0 && (
                <Knob path="toolScope" touched={touched} label="Which tools"
                      hint={cfg.toolScope.length ? `${cfg.toolScope.length} of ${grantedTools.length}` : 'all of them'}>
                  <MultiSelect
                    options={grantedTools}
                    value={cfg.toolScope}
                    onChange={(v) => set('toolScope', v)}
                    placeholder="Every tool the switches above unlock"
                    searchPlaceholder="Search tools…"
                    emptyText="Turn a tool group on first."
                  />
                  <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
                    Leave empty for everything the switches above unlock. Naming a few keeps
                    the agent&rsquo;s toolbox small, which is what keeps it on task.
                  </p>
                </Knob>
              )}
              {grantedTools.length > 0 && (
                <Knob path="toolPermissions" touched={touched} label="Per-tool rules"
                      hint={(() => {
                        const n = countToolPermissions(
                          cfg.toolPermissions, grantedTools.map((t) => t.id));
                        return n ? `${n} custom` : 'grant + autonomy decides';
                      })()}>
                  <div className="space-y-1">
                    {grantedTools.map((t) => {
                      const mode = (cfg.toolPermissions ?? {})[t.id];
                      return (
                        <div key={t.id}
                          className="flex flex-wrap items-center gap-2 px-2 py-1.5 rounded border border-border bg-card">
                          <span className="mr-auto min-w-0">
                            <span className="block text-[12px] font-medium truncate">{t.label}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">{t.hint}</span>
                          </span>
                          {(['allow', 'ask', 'deny'] as ToolPermissionMode[]).map((m) => (
                            <button key={m} type="button"
                              onClick={() => setToolPermission(t.id, m)}
                              title={mode === m
                                ? `Back to inherit — ${TOOL_PERMISSION_COPY[m].hint} (click again to clear)`
                                : TOOL_PERMISSION_COPY[m].hint}
                              className={`h-6 px-2 rounded border text-[11px] transition-colors ${
                                mode === m
                                  ? 'border-primary text-primary bg-primary/10'
                                  : 'border-input text-muted-foreground hover:text-foreground'
                              }`}>
                              {TOOL_PERMISSION_COPY[m].label}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
                    Untouched tools follow the switches and the Safety level below.
                    Allow skips asking, Ask pauses even where it would not, Deny
                    removes the tool. Click an active rule again to clear it.
                  </p>
                </Knob>
              )}
              {cfg.tools.browser && (
                <Knob path="browserDomains" touched={touched} label="Sites it may act on"
                      hint={cfg.browserDomains.length ? `${cfg.browserDomains.length} site${cfg.browserDomains.length === 1 ? '' : 's'}` : 'read only'}>
                  <input
                    value={cfg.browserDomains.join(', ')}
                    onChange={(e) => set('browserDomains', e.target.value.split(',').map((d) => d.trim()).filter(Boolean))}
                    placeholder="e.g. portal.supplier.com, forms.example.org"
                    className="w-full h-9 px-3 rounded border border-input bg-background text-sm" />
                  <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
                    Empty means it can read any page but never click or type. Subdomains are included.
                  </p>
                </Knob>
              )}
              {cfg.tools.subAgents && (
                <Knob path="delegatesTo" touched={touched} label="Delegates to"
                      hint={cfg.delegatesTo.length ? `${cfg.delegatesTo.length} selected` : undefined}>
                  <MultiSelect
                    options={otherAgents.map((a) => ({
                      id: String(a.id), label: a.name,
                      // A delegated run is unattended, so the runtime refuses a
                      // target that is paused or not cleared to run on its own.
                      // Said here, where the choice is made, not in a run log.
                      hint: delegationBlocker(a) ?? a.description,
                    }))}
                    value={cfg.delegatesTo.map(String)}
                    onChange={(v) => set('delegatesTo', v.map(Number))}
                    placeholder="Any of your agents — narrow it to the ones it needs"
                    searchPlaceholder="Search agents…"
                    emptyText="No other agents yet."
                  />
                  <p className="mt-1.5 px-2 text-[11px] text-muted-foreground">
                    An agent that can delegate to an agent with wider tools has
                    those tools by proxy. Naming a few is the narrower statement.
                  </p>
                </Knob>
              )}
              <Knob path="skills" touched={touched} label="Skills"
                    hint={cfg.skills.length ? `${cfg.skills.length} selected` : undefined}>
                <MultiSelect
                  options={skills.map((s) => ({
                    id: String(s.id),
                    label: s.title,
                    hint: s.description || s.category,
                  }))}
                  value={cfg.skills.map(String)}
                  onChange={(v) => set('skills', v.map(Number))}
                  placeholder="No skills"
                  searchPlaceholder="Search skills…"
                  emptyText="None yet — write one in Skills first."
                />
              </Knob>
              <Knob path="useEnvironment" touched={touched} label="">
                <Toggle on={cfg.useEnvironment} onChange={(v) => set('useEnvironment', v)}
                  label="Environment" hint="Current time and place, for anything schedule- or locale-aware." />
              </Knob>
            </Section>

            <Section icon={Clock} title="When it runs">
              {/* Schedules live on rows the Schedules page owns, listed here
                  through the same modal — not a second editor writing back a
                  single cron field, which is what used to delete rows added
                  anywhere else on every save. */}
              {isNew || agentId == null ? (
                <p className="px-2 text-[12px] text-muted-foreground">
                  Save the agent first to add a schedule.
                </p>
              ) : (
                <AgentSchedules
                  agentId={agentId}
                  allowUnattended={cfg.allowUnattended}
                  hasPrompt={Boolean((cfg.brief || '').trim())}
                />
              )}
              <Knob path="allowUnattended" touched={touched} label="">
                <Toggle on={cfg.allowUnattended} onChange={(v) => set('allowUnattended', v)}
                  label="Can run automatically"
                  hint="Needed for schedules and when another agent calls it." />
              </Knob>
            </Section>

            <Section icon={ShieldCheck} title="Safety">
              <Knob path="autonomy" touched={touched} label="Autonomy">
                <Choice<Autonomy>
                  value={cfg.autonomy} onChange={(v) => set('autonomy', v)}
                  options={(Object.keys(AUTONOMY_COPY) as Autonomy[]).map((id) => ({
                    id, label: AUTONOMY_COPY[id].label, hint: AUTONOMY_COPY[id].hint,
                  }))} />
              </Knob>
              {/* A fact, not a setting. This was a three-way choice whose two
                  wider values the sandbox could never have honoured — it runs
                  as a sidecar container on an internal-only network — so the
                  control offered a promise nothing could keep. */}
              <div className="flex items-start gap-2 px-2 py-1 text-[12px] text-muted-foreground">
                <Globe className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Sandboxed code has no network access. Web search and page reading
                  go through us and are logged; the sandbox itself cannot dial out.
                </span>
              </div>
              {/* The hint says what "off" leaves behind on purpose. The switch
                  silences the pings, never the queue — a paused run always waits
                  in the Inbox, or turning notifications off would quietly mean
                  abandoning it. Saying so is what stops someone reading the
                  toggle as "let it run without me". */}
              <Knob path="notifyOnHitl" touched={touched} label="">
                <Toggle on={cfg.notifyOnHitl} onChange={(v) => set('notifyOnHitl', v)}
                  label="Notify me when it stops to ask"
                  hint={cfg.notifyOnHitl
                    ? 'Pings you when it pauses, then again after an hour and a day.'
                    : "No pings for this agent — it still waits in your Inbox and in the daily summary."} />
              </Knob>
              <Knob path="spendCapRupees" touched={touched} label="Spend cap" hint="per month">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">₹</span>
                  <input type="number" min={0} step={50} value={cfg.spendCapRupees}
                    onChange={(e) => set('spendCapRupees', Number(e.target.value))}
                    className="w-full h-9 px-2 rounded border border-input bg-background text-sm" />
                </div>
              </Knob>
            </Section>

            {!isNew && agentId != null && (
              <Section icon={FlaskConical} title="Evaluation"
                       hint="How it scores on your test suites">
                <AgentScorecard agentId={agentId} currentRevision={latestRevision} />
              </Section>
            )}

            {!isNew && agentId != null && (
              <Section icon={History} title="Change history"
                       hint="Which configuration produced which runs">
                <RevisionHistory agentId={agentId}
                  onRestored={(agent) => { setCfg({ ...DEFAULT_AGENT, ...agent }); setTouched(new Set()); }} />
              </Section>
            )}

            <Section icon={Layers} title="Context lifecycle" hint="For long runs">
              <p className="text-[12px] text-muted-foreground -mt-1">
                A long run carries its whole transcript into every step, so eventually it
                outgrows the model’s context window. These decide what gets cut and
                whether it can be read back. Nothing happens until a run actually
                approaches its limit.
              </p>
              <Toggle on={cfg.compaction} onChange={(v) => set('compaction', v)}
                label="Auto-compact history"
                hint="Replace older tool results with a short record. Costs nothing, and what each step did stays visible." />
              <Toggle on={cfg.recursiveContext} onChange={(v) => set('recursiveContext', v)}
                label="Smart summarization"
                hint="When compaction is not enough, fold the oldest steps into one running summary. Costs a small model call each time." />
              {cfg.recursiveContext && (
                <Knob path="summaryModel" touched={touched} label="Summarizing model"
                      hint="Left as default, a small NVIDIA model runs on the platform key — nothing to connect.">
                  <Select
                    value={cfg.summaryModel}
                    onChange={(v) => {
                      // Both or neither: a model with no provider cannot be
                      // routed, and the empty value has to clear both or the
                      // agent would keep overriding the platform default with
                      // half a choice.
                      const owner = providers.find((p) => p.models?.some((m) => m.value === v));
                      setCfg((c) => ({
                        ...c,
                        summaryModel: v,
                        summaryProvider: v ? (owner?.slug ?? '') : '',
                      }));
                    }}
                    placeholder="Platform default (recommended)"
                    icon={<Layers className="w-4 h-4" />}
                    showSearch
                    options={[
                      { value: '', label: 'Platform default (recommended)' },
                      // Only models this account can run. The fold runs in the
                      // middle of a long run, so a model that fails preflight
                      // there is a run that dies half-way. The saved choice is
                      // kept visible even if it has since become unrunnable,
                      // so the picker never silently shows something else.
                      ...providers.flatMap((p) =>
                        (p.models ?? [])
                          .filter((mo) => mo.available !== false || mo.value === cfg.summaryModel)
                          .map((mo) => ({
                            value: mo.value,
                            label: `${p.name} · ${mo.name}${mo.is_free ? ' · free' : ''}`
                              + (mo.available === false ? ' · no key' : ''),
                            is_free: mo.is_free,
                          }))
                      ),
                    ]}
                  />
                </Knob>
              )}
              <Toggle on={cfg.indexing} onChange={(v) => set('indexing', v)}
                label="Save and recall"
                hint="Store whatever is cut, so the agent can search it back mid-run. Off means removed text is gone for good." />
            </Section>

            </div>

            <div className="flex items-center gap-2 pb-8">
              <button
                onClick={submit}
                disabled={save.isPending}
                className="px-4 py-2 text-sm font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {isNew ? 'Create agent' : 'Save changes'}
              </button>
              <button onClick={() => navigate('/agents')}
                className="px-4 py-2 text-sm rounded border border-border hover:bg-secondary">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${cfg.name}?`}
          body="The agent, its schedules and its settings are removed for good. Its past runs stay on Runs, marked as deleted. To keep the agent, archive it instead."
          busy={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate()}
        />
      )}
      {running && agentId != null && (
        <RunAgentDialog
          agentId={agentId}
          agentName={cfg.name}
          brief={existing?.brief ?? cfg.brief}
          dirty={dirty}
          onClose={() => setRunning(false)}
        />
      )}
    </div>
  );
}
