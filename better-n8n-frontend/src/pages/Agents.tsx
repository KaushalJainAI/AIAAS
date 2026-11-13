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
import { Plus, ShieldCheck, Clock, LayoutGrid, Share2, Play, Archive, ArchiveRestore, Search, X, Workflow } from 'lucide-react';
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
  decisions: 'Decisions',
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
/** Dot colour by status: an active agent is live; a paused, draft or archived
 *  one is filed away, so its dot stays quiet. */
const STATUS_DOT: Record<string, string> = {
  active: 'bg-success',
  draft: 'bg-muted-foreground',
  paused: 'bg-muted-foreground',
  archived: 'bg-muted-foreground',
};

/** The card's track record in one line. Before the first run there is nothing
 *  honest to show, so it says so rather than drawing three dashes. */
function trackRecord(agent: Agent): string {
  const runs = agent.runs ?? 0;
  if (!runs) return 'Not run yet';
  const parts = [`${runs} run${runs === 1 ? '' : 's'}`];
  parts.push(`${Math.round((agent.unattended / runs) * 100)}% on its own`);
  if (agent.spend) parts.push(`₹${agent.spend}`);
  return parts.join(' · ');
}

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
  const chips = grants(agent, connectorNames);
  const scheduled = Boolean(agent.schedule || (agent.extraSchedules ?? 0) > 0);
  const statusLabel = STATUS_COPY[agent.status as AgentStatus]?.label ?? agent.status;
  return (
    <article
      key={agent.id}
      className="bg-card border border-border rounded-md flex flex-col hover:border-border-strong transition-colors"
    >
      <Link to={`/agents/${agent.id}`} className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-md bg-agent-subtle text-agent font-mono font-semibold text-[13px] flex items-center justify-center shrink-0">
            {initials(agent.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="font-semibold text-foreground truncate">{agent.name}</h3>
              <span
                className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[agent.status] ?? 'bg-muted-foreground')}
                aria-hidden="true"
              />
              {/* Status is written out beside the dot, so the dot is never
                  the only signal. */}
              <span className="text-[12px] text-muted-foreground shrink-0">{statusLabel}</span>
            </div>
            <p
              className="text-[13px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2"
              title={agent.description || undefined}
            >
              {summary(agent)}
            </p>
          </div>
        </div>

        {/* Approval rule first, then what it may reach. Tags are small and
            square: they name things, they do not decorate. */}
        {/* One line, never wrapping: chips shrink and truncate, and whatever
            does not fit is counted in "+N" (the full list is in its title). */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              'inline-flex items-center gap-1 h-[22px] px-2 rounded border text-[12px] font-medium min-w-0 shrink-0 max-w-[60%]',
              autonomyStyle[agent.autonomy]
            )}
            title={AUTONOMY_COPY[agent.autonomy].hint}
          >
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span className="truncate">{AUTONOMY_COPY[agent.autonomy].label}</span>
          </span>
          {chips.slice(0, MAX_CHIPS).map((t) => (
            <span
              key={t}
              title={t}
              className="inline-flex items-center h-[22px] px-2 rounded bg-secondary text-[12px] text-muted-foreground min-w-0 shrink"
            >
              <span className="truncate">{t}</span>
            </span>
          ))}
          {chips.length > MAX_CHIPS && (
            <span
              className="inline-flex items-center h-[22px] px-1.5 rounded text-[12px] text-muted-foreground shrink-0"
              title={chips.slice(MAX_CHIPS).join(', ')}
            >
              +{chips.length - MAX_CHIPS}
            </span>
          )}
        </div>
      </Link>

      {/* Footer: when it runs and how it has done on the left, the two actions
          on the right. The whole card opens the builder, so there is no
          separate Edit button; a run is read on the Activity page. */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        {/* Any schedule counts, not only the builder's own field: one made on
            the Schedules page left the card reading "On request". */}
        <div className="flex min-w-0 flex-1 flex-col text-[12px] leading-tight">
          <span className="flex items-center gap-1.5 text-foreground min-w-0">
            <Clock className="w-3 h-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{TRIGGER_COPY[scheduled ? 'maintenance' : 'goal'].label}</span>
          </span>
          <span
            className="mt-0.5 truncate font-mono text-[11.5px] tabular-nums text-muted-foreground"
            title="Runs, the share that needed nobody, and what it spent"
          >
            {trackRecord(agent)}
          </span>
        </div>
        {/* Sharing sits on the agent rather than on Explore: what you publish
            is something you own, and the dialog shows the payload first. */}
        <button
          type="button"
          onClick={() => onShare(agent)}
          aria-label={`Share ${agent.name}`}
          title="Share"
          className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
        >
          <Share2 className="w-4 h-4" />
        </button>
        {/* Run by hand. The execute endpoint had no caller in the app, so an
            agent could only be run by asking chat to. */}
        {agent.status === 'archived' ? (
          <button
            type="button"
            onClick={() => onRestore(agent.id)}
            disabled={restorePending}
            className="h-9 shrink-0 inline-flex items-center justify-center gap-1.5 px-3 rounded-md border border-border text-[13px] font-medium hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onRun(agent)}
            className="h-9 shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 rounded-md bg-agent text-agent-foreground text-[13px] font-medium hover:bg-agent/90 transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Run
          </button>
        )}
      </div>
    </article>
  );
}

function EmptyStateView() {  return (
    <EmptyState
      align="left"
      icon={Workflow}
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
        icon={Workflow}
        title="Agents"
        subtitle={subtitle}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
                className="w-full pl-8 pr-8 h-9 bg-background border border-border rounded-md text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-secondary text-muted-foreground"
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
                    <h2 className="text-[13px] font-semibold text-muted-foreground">
                      {c.label} · {total}
                    </h2>
                    <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
                      {c.key === 'uncategorized'
                        ? 'No category tag yet — set the first tag in the builder to file these.'
                        : `Agents filed under “${c.label}” — the first tag in the builder.`}
                    </p>
                  </div>
                  {split && (
                    <h3 className="label-mono mt-4 mb-2">
                      Scheduled · {c.scheduled.length}
                    </h3>
                  )}
                  {c.scheduled.length > 0 && renderGrid(c.scheduled)}
                  {split && (
                    <h3 className="label-mono mt-4 mb-2">
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
          brief={sharing.brief}
          description={sharing.description}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
