/**
 * Explore — agent configurations you can install and then change.
 *
 * Two sources sit side by side: templates we curate, and agents other users
 * have published. They are presented identically on purpose. From the
 * installer's side the provenance changes how much you trust it, not what the
 * thing is or how it arrives — so the card carries a byline and the install
 * flow is the same code either way.
 *
 * The install dialog is the part worth caring about. Installing someone else's
 * agent means letting a recipe you cannot read touch your files and act on
 * your behalf, and unlike a workflow there is no graph to inspect: the
 * permission envelope *is* the safety mechanism (`docs/AGENT_TEMPLATES.md`
 * §5). So the dialog is an app-store permission prompt, and every line of it
 * is rendered from `template.config` — the same keys the backend stores and
 * the runtime enforces. There is no second vocabulary here that could drift
 * from the first, which is the one failure this screen cannot tolerate.
 *
 * The requirement dropdowns are the other half. A template names *what kind*
 * of connection or corpus it needs, never an id, and the installer satisfies
 * each one from their own rows — so a template can be shared without carrying
 * anything private, and credentials never travel.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  CalendarClock,
  Check,
  Clock,
  Coins,
  Download,
  Globe,
  ImageIcon,
  Inbox,
  LayoutGrid,
  Loader2,
  PenLine,
  Presentation,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  Table2,
  Target,
  Trash2,
  User,
  Wrench,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import PageHeader from '../components/layout/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import agentsService, { type Agent } from '../api/agents';
import templatesService, {
  type AgentTemplate,
  type RequirementChoices,
  type TemplateSource,
} from '../api/templates';
import {
  AUTONOMY_COPY,
  FILE_ACCESS_COPY,
  type Autonomy,
  type FileAccess,
} from '../types/agentConfig';
import { isUnavailable, packAvailability } from '../lib/packs';

/* Icons are keyed off the template's stable `icon` slug, never its name — the
   same rule the connector catalogue follows, and for the same reason: copy
   changes, identifiers do not. An unknown slug falls back rather than
   rendering an empty tile. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  search: Search,
  inbox: Inbox,
  'book-open': BookOpen,
  'calendar-clock': CalendarClock,
  table: Table2,
  radar: Radar,
  presentation: Presentation,
  pen: PenLine,
  sparkles: Sparkles,
  image: ImageIcon,
  globe: Globe,
  swords: Swords,
  target: Target,
};

/* One-click packs, keyed by the backend's `gallery.PACKS` slugs. Display
   metadata only — which template belongs to which pack comes from each
   entry's `pack` field, computed server-side from that same dict, so the
   grouping cannot disagree with what a pack actually installs. */
const PACKS: { slug: string; title: string; blurb: string; icon: LucideIcon }[] = [
  { slug: 'office', title: 'Office pack — Analyst, Slides, Writer', icon: Presentation,
    blurb: 'Three specialists that turn files into files: clean a spreadsheet, build a deck, write a report. One click, no setup.' },
  { slug: 'research', title: 'Research pack — Deep research, Competitors, Publisher', icon: Search,
    blurb: 'Sourced research three ways: a report, a comparison workbook, or a page you can share by link.' },
  { slug: 'data', title: 'Data pack — Extractor, SQL analyst, Dashboards', icon: Table2,
    blurb: 'Numbers into files: pull rows out of files, query databases, save dashboards. One click, no setup.' },
  { slug: 'web', title: 'Web pack — Browser scout, API runner', icon: Globe,
    blurb: 'The live web: pages a scraper cannot render, and your own APIs. The browser scout needs a browser engine on the server.' },
  { slug: 'team', title: 'Team pack — Standup digest, Support drafts', icon: User,
    blurb: 'The team loop: a scheduled morning digest plus drafts that never send themselves. One click, no setup.' },
  { slug: 'paperwork', title: 'Paperwork pack — Signatures, Minutes', icon: PenLine,
    blurb: 'Paperwork: signatures tracked home, recordings turned into minutes. Needs an e-signature provider and a speech engine on the server.' },
  { slug: 'code', title: 'Code pack — Repo assistant, Reviewer, Team + Lead', icon: Radar,
    blurb: 'The coding team: a single assistant, a reviewer that never edits, six specialists, and the lead that orchestrates them. Needs a workspace engine on the server.' },
  { slug: 'money', title: 'Money pack — Reconciler, Invoice chaser', icon: Coins,
    blurb: 'Money: reconcile the month, then chase what is still unpaid. One click, no setup.' },
  { slug: 'marketing', title: 'Marketing pack — SEO brief, Ad copy, Outreach', icon: Target,
    blurb: 'A brief writers can rank with, testable ad variants, and outreach drafts that never send themselves. One click, no setup.' },
  { slug: 'hiring', title: 'Hiring pack — JD writer, Screener, Interview kit', icon: BookOpen,
    blurb: 'Hiring: a posting about the work, a quoted resume scorecard, and the interview kit. One click, no setup.' },
  { slug: 'support', title: 'Support pack — FAQ, Ticket triage, Changelog', icon: Inbox,
    blurb: 'Support: answers quoting your material, triaged tickets with drafts, and the changelog from the diff. One click, no setup.' },
  { slug: 'data-science', title: 'Data science pack — Scientist, Engineer, ML', icon: Table2,
    blurb: 'Explore and model, move and validate, train and ship. Three file-returning specialists. One click, no setup.' },
];

/* What each grant lets the agent do, in the second person, because that is the
   question the installer is actually answering: not "what tools does it have"
   but "what are you handing over". */
const GRANT_COPY: Record<string, string> = {
  webSearch: 'Search the web',
  scrape: 'Open and read web pages',
  codeExecution: 'Run Python in a sandbox',
  shell: 'Run shell commands',
  fileOps: 'Read and write your files',
  office: 'Create PowerPoint, Excel and Word files',
  media: 'Generate images on your OpenRouter account',
  publish: 'Publish pages shareable by link',
  browser: 'Use a web browser on allowed sites',
  rag: 'Search a knowledge base',
  mcp: 'Use your connections',
  voice: 'Transcribe audio and speak text',
  esign: 'Send documents for e-signature',
  talk: 'Message on Slack, WhatsApp, Teams, SMS and Telegram',
  data: 'Query databases',
  api: 'Call HTTP APIs',
  subAgents: 'Delegate to your other agents',
};

const REQUIREMENT_NOUN: Record<string, string> = {
  connector: 'Connection',
  knowledge_base: 'Knowledge base',
  skill: 'Skill',
  api_tool: 'API tool',
  data_tool: 'Database tool',
};

/** Custom-tool requirement: reuse your own or take the author's frozen copy. */
function isToolRequirement(type: string): boolean {
  return type === 'api_tool' || type === 'data_tool';
}

const autonomyStyle: Record<Autonomy, string> = {
  full: 'bg-agent-subtle text-agent border-agent-line',
  auto: 'bg-agent-subtle text-agent border-agent-line',
  ask: 'bg-primary-subtle text-primary border-primary-line',
  review: 'bg-secondary text-muted-foreground border-border',
  plan: 'bg-secondary text-muted-foreground border-border',
};

/** The capability lines, in grant order. Only what is on — an install screen
 *  listing everything the agent *cannot* do buries the four lines that matter. */
function granted(template: AgentTemplate): string[] {
  return Object.entries(template.config.tools ?? {})
    .filter(([, on]) => on)
    .map(([key]) => GRANT_COPY[key] ?? key);
}

function TemplateCard({
  template,
  installed,
  onInstall,
  onUninstall,
}: {
  template: AgentTemplate;
  /** The caller's own agents installed from this entry — empty when it isn't. */
  installed: Agent[];
  onInstall: () => void;
  onUninstall: (agents: Agent[]) => void;
}) {
  const Icon = TEMPLATE_ICONS[template.icon] ?? Bot;
  const autonomy = (template.config.autonomy ?? 'ask') as Autonomy;
  const chips = granted(template);
  const isInstalled = installed.length > 0;
  /* Server-computed: the entry holds a grant whose engine is `none` here.
     Installing it would write an agent that can only talk, so the card says
     so and stops offering itself. Absent on older servers: available. */
  const unavailable = isUnavailable(template);
  const unavailableReason =
    template.unavailable_reason ?? 'This template cannot run on this server.';

  return (
    <div
      className={cn(
        'bg-card border rounded flex flex-col hover:border-border-strong transition-colors',
        isInstalled ? 'border-agent-line' : 'border-border',
      )}
    >
      <div className="p-4 flex-1">
        <div className="flex items-start gap-3 mb-3">
          <span className="w-9 h-9 rounded bg-agent-subtle border border-agent-line text-agent flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground truncate">{template.name}</h3>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              <span
                className={cn(
                  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-semibold',
                  autonomyStyle[autonomy],
                )}
              >
                <ShieldCheck className="w-3 h-3" />
                {AUTONOMY_COPY[autonomy].label}
              </span>
              {/* Provenance is the one thing a card must not blur: an agent a
                  stranger wrote and one we curate warrant different amounts of
                  reading before you hand either your mailbox. */}
              {template.source === 'curated' ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary-line bg-primary-subtle text-primary text-[11px] font-semibold">
                  <Sparkles className="w-3 h-3" />
                  Built in
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-secondary text-muted-foreground text-[11px] font-semibold">
                  <User className="w-3 h-3" />
                  {template.is_mine ? 'You' : template.author}
                </span>
              )}
              {/* Joined client-side on `Agent.template_slug`: installing writes
                  it and nothing edits it afterwards, so this cannot drift the
                  way a name match could. */}
              {isInstalled && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-agent-line bg-agent-subtle text-agent text-[11px] font-semibold">
                  <Check className="w-3 h-3" />
                  {installed.length === 1 ? 'Installed' : `Installed × ${installed.length}`}
                </span>
              )}
              {/* The engine badge: an entry whose grants cannot run here. */}
              {unavailable && (
                <span
                  title={unavailableReason}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px] font-semibold"
                >
                  <AlertTriangle className="w-3 h-3" />
                  Not available on this server
                </span>
              )}
            </div>
          </div>
        </div>

        <p className="text-[13px] text-muted-foreground leading-relaxed mb-3">
          {template.tagline}
        </p>

        {template.config.schedule && (
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground mb-3">
            <Clock className="w-3 h-3" />
            Scheduled
            <span className="font-mono">· {template.config.schedule}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary border border-border text-[11px] text-muted-foreground"
            >
              <Wrench className="w-3 h-3" />
              {c}
            </span>
          ))}
        </div>
      </div>

      {template.source === 'community' && (
        <div className="px-4 pb-3 text-[12px] text-muted-foreground">
          {template.install_count === 0
            ? 'No installs yet'
            : `${template.install_count} ${template.install_count === 1 ? 'install' : 'installs'}`}
          {template.is_listed === false && ' · withdrawn'}
        </div>
      )}

      {/* An installed entry stops offering itself and starts pointing at what
          exists: open the agent, or remove it again. Uninstalling deletes the
          agent rows — the runs stay on Runs, marked as deleted. */}
      {isInstalled ? (
        <div className="flex border-t border-border">
          <Link
            to={`/agents/${installed[0].id}`}
            className="flex-1 px-3 py-2 text-[12px] font-semibold text-muted-foreground hover:bg-secondary inline-flex items-center justify-center gap-1.5"
          >
            Open
            {installed.length > 1 ? ` first of ${installed.length}` : ''}
          </Link>
          <button
            type="button"
            onClick={() => onUninstall(installed)}
            className="flex-1 border-l border-border px-3 py-2 text-[12px] font-semibold text-muted-foreground hover:bg-secondary inline-flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-3 h-3" />
            Uninstall
          </button>
        </div>
      ) : unavailable ? (
        <div
          title={unavailableReason}
          className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-[12px] font-semibold text-muted-foreground/60 cursor-not-allowed"
        >
          <AlertTriangle className="w-3 h-3" />
          Not available on this server
        </div>
      ) : (
        <button
          type="button"
          onClick={onInstall}
          className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-[12px] font-semibold text-muted-foreground hover:bg-secondary"
        >
          <Download className="w-3 h-3" />
          Use this {template.source === 'curated' ? 'template' : 'agent'}
        </button>
      )}
    </div>
  );
}

/**
 * One pack as a section: the header is the one-click install, the grid
 * underneath is the same members installed singly. The two stay consistent
 * because both read the same membership — each member's `pack` field — and
 * the same installed map, so "2 of 3 installed" and the per-card badges
 * cannot disagree.
 */
function PackSection({
  title,
  blurb,
  icon: PackIcon,
  members,
  installedBySlug,
  packBusy,
  onInstallPack,
  onInstallTemplate,
  onUninstall,
}: {
  title: string;
  blurb: string;
  icon: LucideIcon;
  members: AgentTemplate[];
  installedBySlug: Map<string, Agent[]>;
  packBusy: boolean;
  onInstallPack: () => void;
  onInstallTemplate: (t: AgentTemplate) => void;
  onUninstall: (agents: Agent[], label: string) => void;
}) {
  const installedCount = members.filter(
    (m) => (installedBySlug.get(m.slug) ?? []).length > 0,
  ).length;
  const allInstalled = installedCount === members.length;
  const installedAgents = members.flatMap((m) => installedBySlug.get(m.slug) ?? []);
  /* Pack availability derives from the members' server-computed flags: the
     pack is down only when every member is (the code pack with no workspace
     engine). A partially blocked pack still installs what can run. */
  const packDown = packAvailability(members);
  const packUnavailableReason =
    packDown.reasons[0] ?? 'This pack cannot run on this server.';

  return (
    <section className="mb-8">
      <div className="rounded border border-agent-line bg-agent-subtle p-4 mb-3 flex items-start gap-3">
        <span className="w-9 h-9 rounded bg-card border border-agent-line text-agent flex items-center justify-center shrink-0">
          <PackIcon className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="font-semibold text-foreground text-[14px]">{title}</h2>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {installedCount} of {members.length} installed
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed mt-1">{blurb}</p>
          {!packDown.available && (
            <p
              title={packUnavailableReason}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-amber-600 dark:text-amber-400 leading-relaxed mt-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Not available on this server — {packUnavailableReason}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {installedAgents.length > 0 && (
            <button
              type="button"
              onClick={() => onUninstall(installedAgents, title)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card text-muted-foreground text-[12px] font-semibold hover:bg-secondary"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Uninstall
            </button>
          )}
          <button
            type="button"
            disabled={packBusy || allInstalled || !packDown.available}
            onClick={onInstallPack}
            title={
              !packDown.available
                ? packUnavailableReason
                : allInstalled
                  ? 'Every member of this pack is installed'
                  : undefined
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            {packBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : allInstalled ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {allInstalled ? 'Installed' : 'Install pack'}
          </button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {members.map((t) => (
          <TemplateCard
            key={t.slug}
            template={t}
            installed={installedBySlug.get(t.slug) ?? []}
            onInstall={() => onInstallTemplate(t)}
            onUninstall={(agents) => onUninstall(agents, t.name)}
          />
        ))}
      </div>
    </section>
  );
}

function InstallDialog({
  template,
  onClose,
}: {
  template: AgentTemplate;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState(template.name);
  const [choices, setChoices] = useState<RequirementChoices>(() => {
    /* Preselect where there is exactly one candidate — with a single knowledge
       base there is no choice to make, and asking anyway reads as a question
       the user got wrong when they leave it alone. The provider hint put the
       likeliest connection first, but a first is not an only, so a connection
       is never preselected out of a longer list. A custom tool with no
       candidates of your own preselects the author's copy: it is the only
       way to satisfy the requirement, and it arrives unauthenticated. */
    const initial: RequirementChoices = {};
    for (const req of template.requirements) {
      if (req.candidates.length === 1) initial[req.key] = req.candidates[0].id;
      else if (
        isToolRequirement(req.type) &&
        req.candidates.length === 0 &&
        req.snapshot
      ) {
        initial[req.key] = 'install';
      }
    }
    return initial;
  });

  const install = useMutation({
    mutationFn: () =>
      templatesService.install(template.slug, { name: name.trim(), requirements: choices }),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      const needed = agent.credentials_needed ?? [];
      if (needed.length > 0) {
        /* Tools arrived, credentials did not — they never travel. Name what
           to link so the agent is not silently missing its tools. */
        toast.success(`${agent.name} installed`, {
          description: `Link your own credential for ${needed
            .map((n) => `"${n.tool}" (${n.slug})`)
            .join(', ')} on the Tools page.`,
          duration: 8000,
        });
      } else {
        toast.success(`${agent.name} installed`);
      }
      /* Straight into the builder: a template is a starting point, and the
         first thing anyone wants is to see what they just agreed to and
         change the brief. */
      navigate(`/agents/${agent.id}`);
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      toast.error(detail || 'Could not install this template.');
    },
  });

  const missing = template.requirements.filter(
    (r) => !r.optional && choices[r.key] === undefined,
  );
  const config = template.config;
  const fileAccess = (config.fileAccess ?? 'scoped') as FileAccess;
  const autonomy = (config.autonomy ?? 'ask') as Autonomy;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg">Install {template.name}</h2>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              {template.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary text-muted-foreground shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <label className="block">
            <span className="text-[12px] font-semibold text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm"
            />
          </label>

          {/* Every line here is enforced, not described: it renders from the
              same config the backend validates and the runtime reads. */}
          <div>
            <h3 className="text-[12px] font-semibold text-muted-foreground mb-2">
              This agent will be able to
            </h3>
            <ul className="space-y-1.5">
              {granted(template).map((line) => (
                <li key={line} className="flex items-start gap-2 text-[13px]">
                  <Check className="w-3.5 h-3.5 mt-0.5 text-agent shrink-0" />
                  {line}
                </li>
              ))}
              {granted(template).length === 0 && (
                <li className="text-[13px] text-muted-foreground">
                  Nothing beyond answering you. It has no tools at all.
                </li>
              )}
            </ul>
          </div>

          {template.requirements.length > 0 && (
            <div>
              <h3 className="text-[12px] font-semibold text-muted-foreground mb-2">
                What it should use
              </h3>
              <div className="space-y-3">
                {template.requirements.map((req) => (
                  <div key={req.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium">
                        {req.label}
                        {req.optional && (
                          <span className="text-muted-foreground font-normal"> · optional</span>
                        )}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {REQUIREMENT_NOUN[req.type] ?? req.type}
                      </span>
                    </div>
                    <p className="text-[12px] text-muted-foreground mb-1">{req.why}</p>
                    {req.candidates.length === 0 && !req.snapshot ? (
                      /* An empty pool is a real answer, not a broken dropdown:
                         say what is missing and where it is made. */
                      <p className="text-[12px] text-destructive">
                        You have no {(REQUIREMENT_NOUN[req.type] ?? req.type).toLowerCase()} to
                        use here yet.
                        {req.type === 'connector' && ' Add one on Connections.'}
                        {req.type === 'knowledge_base' && ' Add one on Documents.'}
                      </p>
                    ) : (
                      <select
                        value={choices[req.key] ?? ''}
                        onChange={(e) =>
                          setChoices((prev) => {
                            const next = { ...prev };
                            if (e.target.value === '') delete next[req.key];
                            else if (e.target.value === 'install') next[req.key] = 'install';
                            else next[req.key] = Number(e.target.value);
                            return next;
                          })
                        }
                        className="w-full px-3 py-2 bg-background border border-border rounded text-sm"
                      >
                        <option value="">Choose…</option>
                        {req.snapshot && (
                          <option value="install">
                            Install author&apos;s copy of “{req.label}”
                          </option>
                        )}
                        {req.candidates.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                            {c.doc_count !== undefined ? ` · ${c.doc_count} documents` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                    {isToolRequirement(req.type) &&
                      choices[req.key] === 'install' &&
                      req.snapshot?.auth_shape?.needs && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Arrives unauthenticated — you will link your own{' '}
                          <span className="font-mono">
                            {req.snapshot.auth_shape.needs.slug}
                          </span>{' '}
                          credential after installing.
                        </p>
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-[12px] font-semibold text-muted-foreground mb-2">Limits</h3>
            <ul className="space-y-1.5 text-[13px]">
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                {AUTONOMY_COPY[autonomy].hint}
              </li>
              {/* A fact about every agent, not a per-template setting: the
                  sandbox runs on an internal-only network. */}
              <li className="flex items-start gap-2">
                <Globe className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                Sandboxed code cannot reach the network.
              </li>
              <li className="flex items-start gap-2">
                <LayoutGrid className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                {FILE_ACCESS_COPY[fileAccess].hint}
              </li>
              <li className="flex items-start gap-2">
                <Coins className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                Spends at most ₹{config.spendCapRupees ?? 500} a month.
              </li>
              {config.schedule && (
                <li className="flex items-start gap-2">
                  <Clock className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  Runs on its own schedule (
                  <span className="font-mono">{config.schedule}</span>) in your timezone, and is
                  therefore cleared to run with nobody watching.
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 p-5 border-t border-border">
          <p className="text-[12px] text-muted-foreground">
            {isUnavailable(template)
              ? (template.unavailable_reason ??
                'This template cannot run on this server.')
              : 'You can change any of this afterwards.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-border hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                install.isPending ||
                missing.length > 0 ||
                !name.trim() ||
                isUnavailable(template)
              }
              title={
                isUnavailable(template)
                  ? (template.unavailable_reason ??
                    'This template cannot run on this server.')
                  : undefined
              }
              onClick={() => install.mutate()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {install.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Install
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The filters, in the order they read. `mine` is last because it is the only
 *  one about you rather than about what is available. */
const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'curated', label: 'Built in' },
  { key: 'community', label: 'From the community' },
  { key: 'mine', label: 'Shared by you' },
];

export default function Templates() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [installing, setInstalling] = useState<AgentTemplate | null>(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  /* Which installed agents the uninstall confirm is about, if any. One dialog
     for a card and for a whole pack: both remove agent rows, differing only
     in how many. */
  const [uninstalling, setUninstalling] = useState<{ agents: Agent[]; label: string } | null>(null);
  const queryClient = useQueryClient();

  /* The caller's own agents, joined to entries on `template_slug` — the one
     field installing writes and nothing edits, so the "installed" marks this
     page renders cannot drift the way a name match could. */
  const { data: myAgents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsService.list(),
    staleTime: 30 * 1000,
  });
  const installedBySlug = useMemo(() => {
    const map = new Map<string, Agent[]>();
    for (const a of myAgents) {
      if (!a.template_slug) continue;
      const list = map.get(a.template_slug) ?? [];
      list.push(a);
      map.set(a.template_slug, list);
    }
    return map;
  }, [myAgents]);

  /* Uninstalling is deleting the installed agent rows — the runs stay on
     Runs, marked as deleted. No second endpoint: a second way to remove an
     agent is a second place for the ownership check to be forgotten. Deletes
     run one at a time rather than in parallel, for the same reason pack
     installs write one row per transaction. */
  const uninstall = useMutation({
    mutationFn: async (agents: Agent[]) => {
      for (const a of agents) await agentsService.remove(a.id);
    },
    onSuccess: (_data, agents) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success(
        agents.length === 1 ? `${agents[0].name} uninstalled` : `${agents.length} agents uninstalled`,
      );
      setUninstalling(null);
    },
    onError: () => {
      toast.error('Could not uninstall.');
    },
  });

  const packInstall = useMutation({
    mutationFn: (pack: string) => templatesService.installPack(pack),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent-templates'] });
      if (result.installed.length > 0) {
        toast.success(
          `Installed ${result.installed.map((i) => i.name).join(', ')}`,
        );
      } else {
        toast.success('That pack is already installed');
      }
      if (result.skipped.length > 0) {
        const needsSetup = result.skipped.filter((s) => s.reason === 'needs setup');
        if (needsSetup.length > 0) {
          toast.success(
            `${needsSetup.map((s) => s.slug).join(', ')} need setup — open them to finish installing.`,
          );
        }
        const engineBlocked = result.skipped.filter((s) =>
          s.reason.startsWith('engine unavailable'),
        );
        if (engineBlocked.length > 0) {
          toast.error(
            `${engineBlocked.map((s) => s.slug).join(', ')} need an engine this server has not configured.`,
          );
        }
      }
    },
    onError: (error: unknown) => {
      /* A 409 names the missing engine — that sentence is the whole point of
         refusing, so it is what the toast shows rather than a generic line. */
      const detail = (error as { response?: { data?: { error?: string } } })
        ?.response?.data?.error;
      toast.error(detail || 'Could not install that pack.');
    },
  });

  /* A deep link is the only way to reach a `link`-visibility share, so it is
     fetched on its own rather than looked up in the grid — by design that
     entry is not in any listing. A slug that resolves to nothing simply leaves
     the grid showing, which is the right landing for a withdrawn link. */
  const { data: linked } = useQuery({
    queryKey: ['agent-template', slug],
    queryFn: () => templatesService.get(slug as string),
    enabled: !!slug,
    retry: false,
  });

  /* Derived, not mirrored into state. Copying the fetched entry into
     `installing` would need an effect and a second source of truth; this way
     clearing the slug from the URL is what closes a deep-linked dialog,
     because the query it came from is keyed on that slug. */
  const active = installing ?? linked ?? null;

  /* Closing returns to the grid, so the URL stops naming an entry that is no
     longer open — otherwise a reload reopens a dialog the user dismissed. */
  const closeInstall = () => {
    setInstalling(null);
    if (slug) navigate('/templates', { replace: true });
  };

  /* The filter is a server parameter, not a client-side `.filter()`: "shared
     by you" includes listings you have withdrawn, which by definition are not
     in the listing everyone else gets, so it cannot be derived from it. */
  const { data: templates = [], isLoading, isError } = useQuery({
    queryKey: ['agent-templates', filter],
    queryFn: () =>
      templatesService.list(
        filter === 'mine'
          ? { mine: true }
          : filter === 'all'
            ? {}
            : { source: filter as TemplateSource },
      ),
    staleTime: 60 * 1000,
  });

  const q = query.trim().toLowerCase();
  /* A query matching a pack's own title or blurb pulls in the whole pack:
     searching "code" should surface the roster even when no single member
     mentions the word. Catalogue order is kept, so the groups stay stable. */
  const visibleTemplates = useMemo(() => {
    if (!q) return templates;
    const order = new Map(templates.map((t, i) => [t.slug, i]));
    const packHits = new Set(
      PACKS.filter((p) => `${p.slug} ${p.title} ${p.blurb}`.toLowerCase().includes(q)).map((p) => p.slug),
    );
    const matches = (t: AgentTemplate) =>
      `${t.name} ${t.tagline} ${t.description} ${t.slug} ${(t.tags ?? []).join(' ')}`.toLowerCase().includes(q);
    return templates
      .filter((t) => matches(t) || (t.pack != null && packHits.has(t.pack)))
      .sort((a, b) => (order.get(a.slug) ?? 0) - (order.get(b.slug) ?? 0));
  }, [templates, q]);

  /* Curated entries group by their server-computed `pack`; entries in no
     pack stand alone. Community entries are never in a pack and render as
     their own section. A pack the backend knows and this build's PACKS
     metadata does not still renders — under its own slug — rather than
     dropping its members. */
  const curated = visibleTemplates.filter((t) => t.source === 'curated');
  const community = visibleTemplates.filter((t) => t.source === 'community');
  const knownPackSlugs = new Set(PACKS.map((p) => p.slug));
  const packSections = PACKS.map((meta) => ({
    ...meta,
    members: curated.filter((t) => t.pack === meta.slug),
  })).filter((s) => s.members.length > 0);
  const orphanPackSlugs = [...new Set(
    curated.map((t) => t.pack).filter((p): p is string => !!p && !knownPackSlugs.has(p)),
  )];
  const solo = curated.filter((t) => !t.pack);
  const showCurated = filter === 'all' || filter === 'curated';
  const showCommunity = filter === 'all' || filter === 'community' || filter === 'mine';
  const installedAgents = myAgents.filter((a) => a.template_slug).length;

  const subtitle = isLoading
    ? 'Loading…'
    : q
      ? `${visibleTemplates.length} of ${templates.length} · "${query.trim()}"`
      : `${templates.length} ${templates.length === 1 ? 'entry' : 'entries'} · ${installedAgents} installed · install and edit`;

  return (
    <div className="h-full flex flex-col">
      <PageHeader icon={LayoutGrid} title="Explore" subtitle={subtitle} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <p className="text-[13px] text-muted-foreground max-w-2xl mb-4 leading-relaxed">
          Installing adds a copy to your account — your connections, your
          documents, editable in the builder. Nothing of the author's travels
          with it. Uninstalling removes the copy again; its past runs stay on
          Runs, marked as deleted.
        </p>

        <div className="flex items-center gap-2 mb-4 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates and packs…"
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
              {visibleTemplates.length} {visibleTemplates.length === 1 ? 'result' : 'results'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 mb-5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'px-3 py-1.5 rounded text-[12px] font-semibold border',
                filter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:bg-secondary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-12">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading…
          </div>
        ) : isError ? (
          <p className="text-[13px] text-destructive py-12">
            Could not load this list. Reload the page to try again.
          </p>
        ) : visibleTemplates.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-12 max-w-md leading-relaxed">
            {q
              ? `No results for "${query.trim()}". Try a different name, tag or pack.`
              : filter === 'mine'
                ? 'You have not published anything yet. Open an agent on the Agents page and choose Share to list it here.'
                : filter === 'community'
                  ? 'Nobody has published an agent yet. Yours would be the first.'
                  : 'Nothing to show.'}
          </p>
        ) : (
          <>
            {showCurated && packSections.map((pack) => (
              <PackSection
                key={pack.slug}
                title={pack.title}
                blurb={pack.blurb}
                icon={pack.icon}
                members={pack.members}
                installedBySlug={installedBySlug}
                packBusy={packInstall.isPending && packInstall.variables === pack.slug}
                onInstallPack={() => packInstall.mutate(pack.slug)}
                onInstallTemplate={(t) => setInstalling(t)}
                onUninstall={(agents, label) => setUninstalling({ agents, label })}
              />
            ))}
            {showCurated && orphanPackSlugs.map((packSlug) => (
              <PackSection
                key={packSlug}
                title={packSlug}
                blurb=""
                icon={LayoutGrid}
                members={curated.filter((t) => t.pack === packSlug)}
                installedBySlug={installedBySlug}
                packBusy={packInstall.isPending && packInstall.variables === packSlug}
                onInstallPack={() => packInstall.mutate(packSlug)}
                onInstallTemplate={(t) => setInstalling(t)}
                onUninstall={(agents, label) => setUninstalling({ agents, label })}
              />
            ))}
            {showCurated && solo.length > 0 && (
              <section className="mb-8">
                <div className="mb-3">
                  <h2 className="font-semibold text-foreground text-[14px]">Standalone agents</h2>
                  <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
                    Installed one at a time — these belong to no pack.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {solo.map((t) => (
                    <TemplateCard
                      key={t.slug}
                      template={t}
                      installed={installedBySlug.get(t.slug) ?? []}
                      onInstall={() => setInstalling(t)}
                      onUninstall={(agents) => setUninstalling({ agents, label: t.name })}
                    />
                  ))}
                </div>
              </section>
            )}
            {showCommunity && community.length > 0 && (
              <section className="mb-8">
                <div className="mb-3">
                  <h2 className="font-semibold text-foreground text-[14px]">
                    {filter === 'mine' ? 'Shared by you' : 'From the community'}
                  </h2>
                  <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
                    {filter === 'mine'
                      ? 'Agents you have published. Installing one still makes a separate copy.'
                      : 'Agents other people published. Same install flow, read the permissions either way.'}
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {community.map((t) => (
                    <TemplateCard
                      key={t.slug}
                      template={t}
                      installed={[]}
                      onInstall={() => setInstalling(t)}
                      onUninstall={() => undefined}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {active && <InstallDialog template={active} onClose={closeInstall} />}
      {uninstalling && (
        <ConfirmDialog
          title={`Uninstall ${uninstalling.label}?`}
          body={
            uninstalling.agents.length === 1
              ? `${uninstalling.agents[0].name} and its schedules and settings are removed for good. Its past runs stay on Runs, marked as deleted. To keep the agent, archive it in the builder instead.`
              : `${uninstalling.agents.length} agents (${uninstalling.agents.map((a) => a.name).join(', ')}) and their schedules and settings are removed for good. Their past runs stay on Runs, marked as deleted.`
          }
          confirmLabel="Uninstall"
          busy={uninstall.isPending}
          onCancel={() => setUninstalling(null)}
          onConfirm={() => uninstall.mutate(uninstalling.agents)}
        />
      )}
    </div>
  );
}
