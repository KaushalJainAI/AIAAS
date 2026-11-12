/**
 * The empty chat screen, for a signed-in person and for a guest.
 *
 * Plain on purpose: a greeting, what is waiting, where you left off, and a few
 * things to try. No mascot, no glowing badge, no icon per suggestion. The
 * suggestions are text because the text is the useful part.
 *
 * Props only, like the other chat pieces: no hooks that fetch, no API calls.
 */
import { Link } from 'react-router-dom';

import type { ChatSessionSummary } from '../../api/chat';
import { firstName, greeting, shortAgo } from '../../lib/welcome';

interface Starter {
  label: string;
  hint: string;
}

/** Each maps to something a signed-in account can really do. */
const MEMBER_STARTERS: Starter[] = [
  { label: 'Email me a digest of overdue invoices', hint: 'Every Monday at 9am' },
  { label: 'Find files nobody has opened in 3 years', hint: 'Google Drive' },
  { label: 'Pull the line items out of this invoice', hint: 'Upload a PDF' },
  { label: 'Draft first replies to support tickets', hint: 'Sent only after you approve' },
];

/** Guests have no connections and no uploads, so these need neither. */
const GUEST_STARTERS: Starter[] = [
  { label: 'Write a polite reminder for an unpaid invoice', hint: 'Drafting' },
  { label: 'Compare Notion, Asana and Trello for a team of five', hint: 'Searches the web' },
  { label: 'Explain GST input tax credit in simple words', hint: 'Explaining' },
  { label: 'Plan a one-week launch checklist for a small product', hint: 'Planning' },
];

const RECENT_LIMIT = 3;

export interface ChatWelcomeProps {
  isGuest: boolean;
  userName?: string;
  conversations: ChatSessionSummary[];
  /** Approvals and questions waiting on this person. */
  pendingCount: number;
  onPick: (text: string) => void;
  onOpenConversation: (id: string) => void;
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
  const recent = conversations.slice(0, RECENT_LIMIT);
  const starters = isGuest ? GUEST_STARTERS : MEMBER_STARTERS;

  return (
    <div className="w-full max-w-2xl animate-fade-in space-y-8 pb-4 md:pb-8">
      {isGuest ? (
        <header className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px]">
            Hand off the busywork.
          </h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            AIAAS answers questions and does the work: it reads your files and inbox,
            drafts, schedules, and asks before anything is sent.
          </p>
          <p className="text-[13px] text-muted-foreground">
            Try it below without an account.{' '}
            <Link to="/signup" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
              Create one
            </Link>{' '}
            to connect Gmail, Drive and your own files.
          </p>
        </header>
      ) : (
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px]">
            {greeting(new Date().getHours())}{name ? `, ${name}` : ''}
          </h1>
          <p className="text-[15px] text-muted-foreground">
            Ask a question, or describe a job to hand off.
          </p>
        </header>
      )}

      {!isGuest && pendingCount > 0 && (
        <Link
          to="/runs"
          className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning-subtle px-4 py-3 text-[13px] transition-colors hover:bg-warning/15"
        >
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warning" />
          <span className="flex-1 text-foreground">
            {pendingCount === 1
              ? '1 request is waiting for your answer'
              : `${pendingCount} requests are waiting for your answer`}
          </span>
          <span className="font-medium text-warning">Review</span>
        </Link>
      )}

      {!isGuest && recent.length > 0 && (
        <section aria-labelledby="welcome-recent">
          <h2 id="welcome-recent" className="micro-label mb-2">Pick up where you left off</h2>
          <ul className="overflow-hidden rounded-md border border-border bg-card divide-y divide-border/60">
            {recent.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpenConversation(String(c.id))}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/60"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {c.title || 'Untitled conversation'}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {shortAgo(c.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="welcome-try">
        <h2 id="welcome-try" className="micro-label mb-2">Try</h2>
        <ul className="grid overflow-hidden rounded-md border border-border bg-card sm:grid-cols-2">
          {starters.map((s, i) => (
            <li
              key={s.label}
              className={[
                'border-border/60',
                i > 0 ? 'border-t' : '',
                i === 1 ? 'sm:border-t-0' : '',
                i % 2 === 1 ? 'sm:border-l' : '',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => onPick(s.label)}
                className="block h-full w-full px-4 py-3 text-left transition-colors hover:bg-secondary/60"
              >
                <span className="block text-[13px] leading-snug text-foreground">{s.label}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">{s.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
