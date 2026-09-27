/**
 * Agents — a named agent with a brief, a toolset and an autonomy level.
 *
 * The prototype treats agents, not workflows, as the thing you delegate to: you
 * hire "Finance agent" and it decides which steps to run. Workflows stay as the
 * deterministic layer underneath.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Wrench, ShieldCheck, Zap, Clock, Sliders, LayoutGrid, Share2, Play, Archive, ArchiveRestore, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import PageHeader from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Spinner } from '../components/ui/Loading';
import agentsService, { type Agent } from '../api/agents';
import {
  AUTONOMY_COPY, STATUS_COPY, TRIGGER_COPY, type AgentStatus,
} from '../types/agentConfig';
import { mcpService } from '../api/mcp';
import ShareAgentDialog from '../components/agents/ShareAgentDialog';
import RunAgentDialog from '../components/agents/RunAgentDialog';

/* Autonomy is the whole safety story, so it is the most prominent field on the
   card: how much this agent may do before it has to stop and ask. */
const autonomyStyle = {
  full: 'bg-agent-subtle text-agent border-agent-line',
  auto: 'bg-agent-subtle text-agent border-agent-line',
  ask: 'bg-primary-subtle text-primary border-primary-line',
  review: 'bg-secondary text-muted-foreground border-border',
  plan: 'bg-secondary text-muted-foreground border-border',
} as const;

const TOOL_NAMES: Record<string, string> = {
  codeExecution: 'Python',
  shell: 'Shell',
  webSearch: 'Web search',
  scrape: 'Read pages',
  fileOps: 'Files',
  office: 'Office files',
  media: 'Images',
  publish: 'Publishing',
  browser: 'Browser',
  rag: 'Knowledge base',
  mcp: 'Connectors',
  voice: 'Voice',
  esign: 'E-sign',
  talk: 'Messaging',
  data: 'Databases',
  api: 'APIs',
  subAgents: 'Other agents',
};

/** Chips shown before the rest fold into "+N". A card is for recognising an
 *  agent at a glance; the full list is one click away in the builder. */
const MAX_CHIPS = 3;

/** What the card says the agent is for.
 *
 * `brief` is the agent's whole instruction set — often a page of prose written
 * for a model, not a person — so it is never shown here in full. `description`
 * is the one line meant for this; without one, the brief's first sentence
 * stands in, and the card clamps whatever it gets to two lines. */
function summary(agent: Agent): string {
  const line = agent.description?.trim();
  if (line) return line;
  const brief = (agent.brief ?? '').trim();
  if (!brief) return 'No description yet.';
  const first = brief.split(/(?<=[.!?])\s|\n/)[0].trim();
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first;
}

/** "Finance agent" -> "FA". One letter per word beats slicing the first two
 *  characters, which turns every agent into "AG"-shaped mush. */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? words[0][1] ?? '')).toUpperCase();
}

/** What this agent was granted, as readable chips.
 *
 * `names` maps a connection id to its label. It is passed in rather than looked
 * up from a table in this file because connector presentation is served from
 * the database — adding a connector is a fixture row, not an edit here. A id
 * with no name is one the user can no longer see (deleted, or another
 * account's), and it is rendered as such rather than as a bare number: the
 * runtime drops it too, so a chip reading "Gmail" for a connection that no
 * longer resolves would be the one misleading thing this list could say. */
function grants(agent: Agent, names: Map<number, string>) {
  // The generic `mcp` grant is dropped when named connections follow it:
  // "Connectors" beside "Gmail" and "Google Drive" says the same thing twice.
  const named = (agent.connectors ?? []).length > 0;
  const tools = Object.entries(agent.tools ?? {})
    .filter(([k, on]) => on && !(k === 'mcp' && named))
    .map(([k]) => TOOL_NAMES[k] ?? k);
  // A stored connection is either a bare id or `{id, mode, tools}`; a
  // read-only one says so here, because "Gmail" and "Gmail (read only)" are
  // different amounts of trust and this list is where they are compared.
  const conns = (agent.connectors ?? []).map((choice) => {
    const id = typeof choice === 'number' ? choice : choice.id;
    const label = names.get(id) ?? 'Unavailable connection';
    const mode = typeof choice === 'number' ? 'all' : choice.mode;
    return mode === 'all' ? label : `${label} (${mode === 'read' ? 'read only' : 'limited'})`;
  });
  return [...conns, ...tools];
}

/** One category section on the list: the agents sharing a first tag, split by
 *  how they run. `AgentSerializer.validate_tags` keeps the user's order, and
 *  the first tag is the one they think of the agent as — so it is the
 *  grouping, while the remaining tags stay searchable. */
interface CategoryGroup {
  key: string;
  label: string;
  scheduled: Agent[];
  onDemand: Agent[];
}

function groupByCategory(agents: Agent[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();
  for (const a of agents) {
    // Group key is case-folded so "Research" and "research" do not split;
    // the label keeps whichever casing was seen first.
    const raw = (a.tags ?? [])[0]?.trim() ?? '';
    const key = raw.toLowerCase() || 'uncategorized';
    let g = map.get(key);
    if (!g) {
      g = { key, label: raw || 'Uncategorized', scheduled: [], onDemand: [] };
      map.set(key, g);
    }
    (a.schedule ? g.scheduled : g.onDemand).push(a);
  }
  // Alphabetical, Uncategorized last — a stable order that does not reshuffle
  // as counts change, the way sorting by size would.
  return [...map.values()].sort((x, y) =>
    x.key === 'uncategorized' ? 1 : y.key === 'uncategorized' ? -1 : x.label.localeCompare(y.label),
  );
}

/**
 * One agent card, shared by every section on this page. The whole card opens
 * the builder, prefilled — a list you cannot click into is a dead end, and
 * editing an agent is the same act as creating one, so it is the same board.
 */
function AgentCard({
  agent,
  connectorNames,
  onRun,
  onShare,
  onRestore,
  restorePending,
}: {
  agent: Agent;
  connectorNames: Map<number, string>;
  onRun: (a: Agent) => void;
  onShare: (a: Agent) => void;
  onRestore: (id: number) => void;
  restorePending: boolean;
}) {
  // Before the first run there is no honest percentage to show.
  const pct = agent.runs ? Math.round((agent.unattended / agent.runs) * 100) : null;
  const chips = grants(agent, connectorNames);
  return (
    <div
      key={agent.id}
      className="bg-card border border-border rounded hover:border-border-strong transition-colors"
    >
      <Link
        to={`/agents/${agent.id}`}
        className="block p-4 hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-start gap-3 mb-3">
          <span className="w-9 h-9 rounded bg-agent-subtle border border-agent-line text-agent flex items-center justify-center text-[13px] font-semibold shrink-0">
            {initials(agent.name)}
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground truncate">{agent.name}</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold',
                autonomyStyle[agent.autonomy]
              )}
            >
              <ShieldCheck className="w-3 h-3" />
              {AUTONOMY_COPY[agent.autonomy].label}
            </span>
            {/* Only the statuses that change behaviour: a
                paused agent's schedules are not firing. */}
            {(agent.status === 'paused' || agent.status === 'archived') && (
              <span className="inline-flex items-center mt-1 ml-1.5 px-1.5 py-0.5 rounded border border-border text-[11px] font-semibold text-muted-foreground"
                title={STATUS_COPY[agent.status as AgentStatus]?.hint}>
                {STATUS_COPY[agent.status as AgentStatus]?.label ?? agent.status}
              </span>
            )}
          </div>
        </div>

        <p
          className="text-[13px] text-muted-foreground leading-relaxed mb-3 line-clamp-2 min-h-[2.6em]"
          title={agent.description || undefined}
        >
          {summary(agent)}
        </p>

        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {chips.slice(0, MAX_CHIPS).map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary border border-border text-[11px] text-muted-foreground"
              >
                <Wrench className="w-3 h-3" />
                {t}
              </span>
            ))}
            {chips.length > MAX_CHIPS && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded border border-dashed border-border text-[11px] text-muted-foreground"
                title={chips.slice(MAX_CHIPS).join(', ')}
              >
                +{chips.length - MAX_CHIPS} more
              </span>
            )}
          </div>
        )}

        {/* One footer line: when it runs and what it has done. The
            bar is how much of its work needed nobody — the number
            that says whether delegating to it is paying off — and it
            only appears once there is a run to measure. */}
        <div className="pt-3 border-t border-border">
          <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1 min-w-0 truncate">
              <Clock className="w-3 h-3 shrink-0" />
              {TRIGGER_COPY[agent.schedule ? 'maintenance' : 'goal'].label}
            </span>
            <span className="tabular-nums shrink-0">
              {agent.runs ? `${agent.runs} ${agent.runs === 1 ? 'run' : 'runs'}` : 'Not run yet'}
              {agent.spend ? ` · ₹${agent.spend}` : ''}
            </span>
          </div>
          {pct !== null && (
            <div className="mt-2 flex items-center gap-2" title="Share of runs that finished without needing you">
              <div className="h-1 flex-1 bg-secondary rounded overflow-hidden">
                <span className="block h-full bg-agent rounded" style={{ width: `${pct}%` }} />
              </div>
              <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums">
                <Zap className="w-3 h-3" />
                {pct}% on its own
              </span>
            </div>
          )}
        </div>
      </Link>

      {/* One surface now: the builder. The canvas that used to sit
          beside it was retired 2026-08-24 — a run is read on the
          Activity page (/runs), not projected onto a graph. */}
      <div className="flex border-t border-border">
        <Link
          to={`/agents/${agent.id}`}
          className="flex-1 px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary inline-flex items-center justify-center gap-1.5"
        >
          <Sliders className="w-3 h-3" />
          Configure
        </Link>
        {/* Sharing sits on the agent rather than on Explore, because
            what you publish is something you own — and the dialog
            shows the whole payload before anything leaves. */}
        {/* Run by hand. The execute endpoint had no caller in the
            app, so an agent could only be run by asking chat to. */}
        {agent.status === 'archived' ? (
          <button
            type="button"
            onClick={() => onRestore(agent.id)}
            disabled={restorePending}
            className="flex-1 border-l border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary inline-flex items-center justify-center gap-1.5"
          >
            <ArchiveRestore className="w-3 h-3" />
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRun(agent)}
            className="flex-1 border-l border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary inline-flex items-center justify-center gap-1.5"
          >
            <Play className="w-3 h-3" />
            Run
          </button>
        )}
        <button
          type="button"
          onClick={() => onShare(agent)}
          className="flex-1 border-l border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-secondary inline-flex items-center justify-center gap-1.5"
        >
          <Share2 className="w-3 h-3" />
          Share
        </button>
      </div>
    </div>
  );
}

function EmptyStateView() {  return (
    <EmptyState
      align="left"
      icon={Bot}
      title="No agents yet"
      body="An agent combines instructions and tools. Describe the job in plain language and the builder handles setup — you can change anything."
      action={
        <>
          <Link to="/agents/new">
            <Button size="md">
              <Plus className="w-4 h-4" />
              New agent
            </Button>
          </Link>
          {/* The likelier first move of the two: starting from a template means
              approving a permission envelope somebody already thought about,
              rather than choosing every dial from scratch. */}
          <Link to="/templates">
            <Button variant="secondary" size="md">
              <LayoutGrid className="w-4 h-4" />
              Start from a template
            </Button>
          </Link>
        </>
      }
    />
  );
}

export default function Agents() {
  /* Which agent's share dialog is open, if any. The dialog previews before it
     publishes, so opening it is safe and commits nothing. */
  const [sharing, setSharing] = useState<Agent | null>(null);
  const [runningAgent, setRunningAgent] = useState<Agent | null>(null);
  const { data: allAgents = [], isLoading, isError } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsService.list(),
  });
  // Archived agents are filed away, not gone: behind a toggle, restorable.
  // Before archive was settable the only way to clear an agent out of this
  // list was to delete it, which also took its run history.
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const archivedCount = allAgents.filter((a) => a.status === 'archived').length;
  const agents = allAgents.filter((a) =>
    showArchived ? a.status === 'archived' : a.status !== 'archived');

  /* Search across what a card actually shows — the name, the one line written
     for a person, the brief's content, and the tags — the same shape as
     Explore's search, so the two lists answer a query the same way. */
  const q = query.trim().toLowerCase();
  const visible = q
    ? agents.filter((a) =>
        `${a.name} ${a.description ?? ''} ${a.brief ?? ''} ${(a.tags ?? []).join(' ')}`.toLowerCase().includes(q))
    : agents;

  /* The automation split, inside each category: what runs on its own schedule
     versus what runs when asked. A paused agent stays in its section with its
     paused mark rather than moving — pausing changes whether it fires, not
     what it is. */
  const categories = groupByCategory(visible);
  const queryClient = useQueryClient();
  const restore = useMutation({
    mutationFn: (id: number) => agentsService.update(id, { status: 'active' }),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(`${agent.name} restored`);
    },
    onError: () => toast.error('Could not restore that agent.'),
  });
  /* Connection names for the capability chips. An agent stores ids; the label
     belongs to the connector row, so it is fetched rather than mapped here. */
  const { data: connectorNames = new Map<number, string>() } = useQuery({
    queryKey: ['agents', 'connection-names'],
    queryFn: async () =>
      new Map((await mcpService.list()).servers.map((s) => [s.id, s.label])),
    staleTime: 5 * 60 * 1000,
  });

  const totalRuns = allAgents.reduce((n, a) => n + (a.runs ?? 0), 0);
  const activeCount = allAgents.length - archivedCount;
  const categoryCount = groupByCategory(agents).length;
  const subtitle = isLoading
    ? 'Loading…'
    : q
      ? `${visible.length} of ${agents.length} · "${query.trim()}"`
      : `${activeCount} ${activeCount === 1 ? 'agent' : 'agents'} · ${categoryCount} ${categoryCount === 1 ? 'category' : 'categories'} · ${totalRuns} runs`;

  /* One grid everywhere — category sections, their Scheduled / On demand
     sub-groups, and the archive bin all render through it, so a card looks
     the same wherever it sits. */
  const renderGrid = (list: Agent[]) => (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {list.map((a) => (
        <AgentCard
          key={a.id}
          agent={a}
          connectorNames={connectorNames}
          onRun={setRunningAgent}
          onShare={setSharing}
          onRestore={(id) => restore.mutate(id)}
          restorePending={restore.isPending}
        />
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        icon={Bot}
        title="Agents"
        subtitle={subtitle}
        actions={
          <div className="flex items-center gap-2">
          {(archivedCount > 0 || showArchived) && (
            <Button variant="secondary" size="md"
              onClick={() => setShowArchived((v) => !v)}>
              <Archive className="w-4 h-4" />
              {showArchived ? 'Back to agents' : `Archived (${archivedCount})`}
            </Button>
          )}
          <Link to="/templates">
            <Button variant="secondary" size="md">
              <LayoutGrid className="w-4 h-4" />
              Explore
            </Button>
          </Link>
          <Link to="/agents/new">
            <Button size="md">
              <Plus className="w-4 h-4" />
              New agent
            </Button>
          </Link>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {agents.length > 0 && (
          <div className="flex items-center gap-2 mb-4 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents by name, description, category or tag…"
                className="w-full pl-8 pr-8 py-2 bg-background border border-border rounded text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-secondary text-muted-foreground"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {q && (
              <span className="text-[12px] text-muted-foreground whitespace-nowrap">
                {visible.length} {visible.length === 1 ? 'result' : 'results'}
              </span>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-12">
            <Spinner size="md" />
            Loading agents…
          </div>
        ) : isError ? (
          <p className="text-[13px] text-destructive py-12">
            Could not load your agents. Reload the page to try again.
          </p>
        ) : agents.length === 0 && showArchived ? (
          <p className="text-[13px] text-muted-foreground py-12">Nothing is archived.</p>
        ) : agents.length === 0 ? (
          <EmptyStateView />
        ) : visible.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-12 max-w-md leading-relaxed">
            {`No agents match "${query.trim()}". Try a different name, description or tag.`}
          </p>
        ) : showArchived ? (
          /* The archive is a bin, not a structure: one flat grid, still searchable. */
          renderGrid(visible)
        ) : (
          <>
            {categories.map((c) => {
              const total = c.scheduled.length + c.onDemand.length;
              // A category holding both kinds gets its Scheduled / On demand
              // subheads; a single-kind one renders bare cards, since a lone
              // subhead restating the obvious is noise, not structure.
              const split = c.scheduled.length > 0 && c.onDemand.length > 0;
              return (
                <section key={c.key} className="mb-8">
                  <div className="mb-3">
                    <h2 className="font-semibold text-foreground text-[14px]">
                      {c.label} · {total}
                    </h2>
                    <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
                      {c.key === 'uncategorized'
                        ? 'No category tag yet — set the first tag in the builder to file these.'
                        : `Agents filed under “${c.label}” — the first tag in the builder.`}
                    </p>
                  </div>
                  {split && (
                    <h3 className="text-[12px] font-semibold text-muted-foreground mt-4 mb-2">
                      Scheduled · {c.scheduled.length}
                    </h3>
                  )}
                  {c.scheduled.length > 0 && renderGrid(c.scheduled)}
                  {split && (
                    <h3 className="text-[12px] font-semibold text-muted-foreground mt-4 mb-2">
                      On demand · {c.onDemand.length}
                    </h3>
                  )}
                  {c.onDemand.length > 0 && renderGrid(c.onDemand)}
                </section>
              );
            })}
          </>
        )}
      </div>

      {runningAgent && (
        <RunAgentDialog
          agentId={runningAgent.id}
          agentName={runningAgent.name}
          brief={runningAgent.brief}
          onClose={() => setRunningAgent(null)}
        />
      )}

      {sharing && (
        <ShareAgentDialog
          agentId={sharing.id}
          agentName={sharing.name}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
