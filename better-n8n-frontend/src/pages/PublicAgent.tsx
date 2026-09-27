/**
 * `/a/:slug` — a publicly shared agent, readable with no account.
 *
 * This is the page a link posted outside the platform lands on, so it is
 * written for a stranger rather than for a user: no shell, no sidebar, and
 * nothing that assumes a session. It shows what the agent does and, at equal
 * weight, what it would be able to reach — because an agent is not something
 * you can read to know it is safe, and the permission envelope is the only
 * thing a visitor can actually evaluate.
 *
 * Installing still needs an account, and the page says so rather than
 * pretending otherwise: a signed-out visitor is sent to sign up with the slug
 * carried in `?next`, so they land back here rather than on a dashboard having
 * lost what they came for.
 *
 * Every refusal from the API is the same 404 — link-only, platform-only,
 * withdrawn and never-existed are deliberately indistinguishable from outside
 * — so this page can only ever say "not found", never why. That is the point,
 * not a gap in the copy.
 */
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  Check,
  Clock,
  Coins,
  Globe,
  Loader2,
  ShieldCheck,
  User,
  Wrench,
} from 'lucide-react';
import templatesService from '../api/templates';
import {
  AUTONOMY_COPY,
  FILE_ACCESS_COPY,
  type Autonomy,
  type FileAccess,
} from '../types/agentConfig';
import authService from '../api/auth';
import { withNext } from '../lib/nextPath';

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
  connector: 'a connection',
  knowledge_base: 'a knowledge base',
  skill: 'a skill',
};

export default function PublicAgent() {
  const { slug = '' } = useParams();
  /* Read straight from the token store rather than through `useAuth`: this
     page renders outside the authenticated shell, for visitors who usually
     have no session at all, and it only needs to know which call to action
     to show. */
  const signedIn = authService.isAuthenticated();

  const { data: agent, isLoading, isError } = useQuery({
    queryKey: ['public-agent', slug],
    queryFn: () => templatesService.publicGet(slug),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold mb-2">Not found</h1>
          <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
            This agent is not shared publicly, or the link is wrong. If someone
            sent it to you, ask them to check that it is published as public.
          </p>
          <Link to="/" className="text-[13px] text-primary hover:underline">
            Go to the home page
          </Link>
        </div>
      </div>
    );
  }

  const config = agent.config;
  const autonomy = (config.autonomy ?? 'ask') as Autonomy;
  const fileAccess = (config.fileAccess ?? 'scoped') as FileAccess;
  const grants = Object.entries(config.tools ?? {})
    .filter(([, on]) => on)
    .map(([key]) => GRANT_COPY[key] ?? key);

  /* Signed in, this is an ordinary install; signed out it is a sign-up that
     has to come back here afterwards, which is what `next` carries. */
  const installPath = `/templates/${agent.slug}`;
  const cta = signedIn
    ? { to: installPath, label: 'Install this agent' }
    : { to: withNext('/signup', installPath), label: 'Create an account to install' };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-5 py-10 md:py-16">
        <div className="flex items-start gap-4 mb-5">
          <span className="w-12 h-12 rounded-lg bg-agent-subtle border border-agent-line text-agent flex items-center justify-center shrink-0">
            <Bot className="w-6 h-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{agent.name}</h1>
            <p className="text-[13px] text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                {agent.author}
              </span>
              <span aria-hidden>·</span>
              <span>
                {agent.install_count === 0
                  ? 'No installs yet'
                  : `${agent.install_count} ${agent.install_count === 1 ? 'install' : 'installs'}`}
              </span>
            </p>
          </div>
        </div>

        <p className="text-[15px] leading-relaxed mb-3">{agent.tagline}</p>
        {agent.description && (
          <p className="text-[13px] text-muted-foreground leading-relaxed mb-6 whitespace-pre-line">
            {agent.description}
          </p>
        )}

        {/* The capability envelope, at the same weight as the pitch. An agent
            cannot be read to know it is safe, so this is the part a visitor
            can actually evaluate — burying it under the description would be
            selling the idea while hiding the terms. */}
        <section className="border border-border rounded-lg p-4 mb-4">
          <h2 className="text-[12px] font-semibold text-muted-foreground mb-2">
            What it will be able to do in your account
          </h2>
          <ul className="space-y-1.5 text-[13px]">
            {grants.map((g) => (
              <li key={g} className="flex items-start gap-2">
                <Wrench className="w-3.5 h-3.5 mt-0.5 text-agent shrink-0" />
                {g}
              </li>
            ))}
            {grants.length === 0 && (
              <li className="text-muted-foreground">
                Nothing beyond answering you. It has no tools at all.
              </li>
            )}
          </ul>
        </section>

        <section className="border border-border rounded-lg p-4 mb-4">
          <h2 className="text-[12px] font-semibold text-muted-foreground mb-2">
            Limits
          </h2>
          <ul className="space-y-1.5 text-[13px]">
            <li className="flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              {AUTONOMY_COPY[autonomy].hint}
            </li>
            <li className="flex items-start gap-2">
              <Globe className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              The sandbox it runs code in cannot reach the network.
            </li>
            <li className="flex items-start gap-2">
              <Check className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              {FILE_ACCESS_COPY[fileAccess].hint}
            </li>
            <li className="flex items-start gap-2">
              <Coins className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              Spends at most ₹{config.spendCapRupees ?? 500} a month.
            </li>
            {config.schedule && (
              <li className="flex items-start gap-2">
                <Clock className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                Runs on a schedule (
                <span className="font-mono">{config.schedule}</span>), in your
                own timezone.
              </li>
            )}
          </ul>
        </section>

        {agent.requirements.length > 0 && (
          <section className="border border-border rounded-lg p-4 mb-6">
            <h2 className="text-[12px] font-semibold text-muted-foreground mb-1">
              What you would need to supply
            </h2>
            <p className="text-[12px] text-muted-foreground mb-2 leading-relaxed">
              Nothing of the author&rsquo;s comes with it — no credentials, no
              documents. You point your own copy at your own things.
            </p>
            <ul className="space-y-1.5 text-[13px]">
              {agent.requirements.map((req) => (
                <li key={req.key} className="flex items-start gap-2">
                  <ArrowRight className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <span>
                    {req.label}{' '}
                    <span className="text-muted-foreground">
                      ({REQUIREMENT_NOUN[req.type] ?? req.type}
                      {req.optional ? ', optional' : ''})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={cta.to}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded font-semibold text-sm hover:bg-primary/90"
          >
            {cta.label}
            <ArrowRight className="w-4 h-4" />
          </Link>
          {!signedIn && (
            <Link
              to={withNext('/login', installPath)}
              className="text-[13px] text-muted-foreground hover:underline"
            >
              Already have an account? Sign in
            </Link>
          )}
        </div>

        <p className="text-[12px] text-muted-foreground mt-6 leading-relaxed">
          Installing creates your own copy. You approve what it may reach before
          it runs, and can change anything afterwards.
        </p>
      </div>
    </div>
  );
}
