/**
 * The empty chat screen, for a signed-in person and for a guest.
 *
 * Light on purpose: a centred greeting, one line about what is waiting, a few
 * short suggestions as pills, and the last few conversations as plain links.
 * No boxes, no icon per suggestion, nothing that pushes the composer off the
 * screen on a short laptop window.
 *
 * The "Get set up" card (members only) reads the same queries as the
 * Connections and Agents pages, so it asks no question those pages do not.
 * Everything else is props. The meaning of each step lives in
 * `../lib/setupSteps.ts`; the starter sets live in `../lib/starters.ts`.
 */
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Circle } from 'lucide-react';

import type { ChatSessionSummary } from '@/api/chat';
import { credentialsService } from '@/api/credentials';
import { mcpService } from '@/api/mcp';
import agentsService from '@/api/agents';
import { cn } from '@/lib/utils';
import { firstName, greeting, shortAgo } from '../lib/welcome';
import {
  hasConnectedAccount,
  hasLiveAgent,
  setupFinished,
  setupSteps,
  type SetupStep,
} from '../lib/setupSteps';
import { pickStarters } from '../lib/starters';

const RECENT_LIMIT = 3;

/** Stored in localStorage; if storage throws, the card just shows. */
const HIDDEN_KEY = 'aiaas.setupHidden';

function readSetupHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSetupHidden(): void {
  try {
    window.localStorage.setItem(HIDDEN_KEY, '1');
  } catch {
    // Storage is blocked: the card stays until the page is left.
  }
}

export interface ChatWelcomeProps {
  isGuest: boolean;
  userName?: string;
  conversations: ChatSessionSummary[];
  /** Approvals and questions waiting on this person. */
  pendingCount: number;
  onPick: (text: string) => void;
  onOpenConversation: (id: string) => void;
}

/** One step. A row with a page to go to is a link; the chat box needs no link. */
function SetupRow({ step }: { step: SetupStep }) {
  const body = (
    <>
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {step.done ? (
          <Check aria-hidden className="h-4 w-4 text-success" />
        ) : (
          <Circle aria-hidden className="h-4 w-4 text-muted-foreground/60" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn('block text-[14px]', step.done ? 'text-muted-foreground' : 'text-foreground')}>
          <span className="sr-only">{step.done ? 'Done: ' : 'To do: '}</span>
          {step.title}
        </span>
        <span className="block text-[12.5px] leading-snug text-muted-foreground">{step.detail}</span>
      </span>
      {step.to && <ChevronRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const rowClass = 'flex min-h-11 w-full items-start gap-3 rounded-md px-2 py-2 text-left';
  if (!step.to) return <div className={rowClass}>{body}</div>;
  return (
    <Link
      to={step.to}
      className={cn(rowClass, 'transition-colors hover:bg-secondary/60')}
    >
      {body}
    </Link>
  );
}

export default function ChatWelcome({
  isGuest,
  userName,
  conversations,
  pendingCount,
  onPick,
  onOpenConversation,
}: ChatWelcomeProps) {
  const name = firstName(userName);
  const recent = isGuest ? [] : conversations.slice(0, RECENT_LIMIT);

  // Same queries, keys and staleness as the Connections and Agents pages, so
  // these resolve from the cache when those pages were already open. Guests
  // have no account, so nothing is fetched for them.
  const serversQuery = useQuery({
    queryKey: ['mcpServers'],
    queryFn: () => mcpService.list(),
    staleTime: 5 * 60 * 1000,
    enabled: !isGuest,
  });
  const credsQuery = useQuery({
    queryKey: ['credentials'],
    queryFn: () => credentialsService.list(),
    staleTime: 60 * 1000,
    enabled: !isGuest,
  });
  const typesQuery = useQuery({
    queryKey: ['credentialTypes'],
    queryFn: () => credentialsService.getTypes(),
    staleTime: 10 * 60 * 1000,
    enabled: !isGuest,
  });
  const agentsQuery = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsService.list(),
    enabled: !isGuest,
  });
  // Read-only view of the Connections page's credential check. It has no
  // queryFn here on purpose: the check is one call per connector, so this
  // never runs it. It only sees the result when that page has run.
  const validationQuery = useQuery<Map<number, { ok: boolean; errors: string[] }>>({
    queryKey: ['mcpValidation'],
    enabled: false,
  });

  const [setupHidden, setSetupHidden] = useState(readSetupHidden);
  const sourcesReady =
    !isGuest &&
    !serversQuery.isPending &&
    !credsQuery.isPending &&
    !typesQuery.isPending &&
    !agentsQuery.isPending;

  const hasConnection = hasConnectedAccount({
    servers: serversQuery.data?.servers ?? [],
    credentials: credsQuery.data?.credentials ?? [],
    types: typesQuery.data?.types ?? [],
    validation: validationQuery.data,
  });
  const steps: SetupStep[] = setupSteps({
    hasConversation: conversations.length > 0,
    hasConnection,
    hasAgent: hasLiveAgent(agentsQuery.data ?? []),
  });
  const showSetup = sourcesReady && !setupHidden && !setupFinished(steps);

  const starters = pickStarters(isGuest, hasConnection);

  return (
    <div className="flex w-full max-w-2xl animate-fade-in flex-col items-center gap-6 py-6 text-center">
      <header className="space-y-2">
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground md:text-[30px]">
          {isGuest
            ? 'What can I take off your plate?'
            : `${greeting(new Date().getHours())}${name ? `, ${name}` : ''}`}
        </h1>
        <p className="text-[15px] text-muted-foreground">
          {isGuest ? (
            <>
              Try it without an account.{' '}
              <Link to="/signup" className="text-foreground underline underline-offset-4 hover:text-primary">
                Sign up
              </Link>{' '}
              to connect Gmail, Drive and your files.
            </>
          ) : (
            'Ask a question, or hand off a job.'
          )}
        </p>
      </header>

      {!isGuest && pendingCount > 0 && (
        <Link
          to="/runs"
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-warning/40 bg-warning-subtle px-3 py-1 text-[13px] text-foreground transition-colors hover:bg-warning/15 md:min-h-0"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" />
          {pendingCount === 1 ? '1 request needs your answer' : `${pendingCount} requests need your answer`}
        </Link>
      )}

      <ul aria-label="Suggestions" className="flex flex-wrap justify-center gap-2">
        {starters.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              title={s.prompt}
              onClick={() => onPick(s.prompt)}
              className="min-h-11 rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-secondary/60 hover:text-foreground md:min-h-0"
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>

      {showSetup && (
        <section
          aria-labelledby="welcome-setup"
          className="w-full max-w-md rounded-lg border border-border bg-card p-3 text-left"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id="welcome-setup" className="px-2 text-[14px] font-medium text-foreground">
              Get set up
            </h2>
            <button
              type="button"
              onClick={() => {
                writeSetupHidden();
                setSetupHidden(true);
              }}
              className="min-h-11 rounded-md px-3 text-[13px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              Hide
            </button>
          </div>
          <ol className="mt-1 space-y-0.5">
            {steps.map((step) => (
              <li key={step.id}>
                <SetupRow step={step} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {recent.length > 0 && (
        <nav aria-labelledby="welcome-recent" className="w-full max-w-md text-left">
          <h2 id="welcome-recent" className="mb-1 px-3 text-[12px] text-muted-foreground/70">Recent</h2>
          <ul className="space-y-0.5">
            {recent.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpenConversation(String(c.id))}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground md:min-h-0"
                >
                  <span className="min-w-0 flex-1 truncate">{c.title || 'Untitled conversation'}</span>
                  <span className="shrink-0 text-[12px] text-muted-foreground/70">{shortAgo(c.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
