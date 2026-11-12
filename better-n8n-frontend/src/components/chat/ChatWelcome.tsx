/**
 * The empty chat screen, for a signed-in person and for a guest.
 *
 * Light on purpose: a centred greeting, one line about what is waiting, a few
 * short suggestions as pills, and the last few conversations as plain links.
 * No boxes, no icon per suggestion, nothing that pushes the composer off the
 * screen on a short laptop window.
 *
 * Props only, like the other chat pieces: no hooks that fetch, no API calls.
 */
import { Link } from 'react-router-dom';

import type { ChatSessionSummary } from '../../api/chat';
import { firstName, greeting, shortAgo } from '../../lib/welcome';

interface Starter {
  /** What the pill says. */
  label: string;
  /** What goes into the message box. */
  prompt: string;
}

/** Each maps to something a signed-in account can really do. */
const MEMBER_STARTERS: Starter[] = [
  { label: 'Weekly invoice digest', prompt: 'Email me a digest of overdue invoices every Monday at 9am' },
  { label: 'Tidy my Drive', prompt: 'Find files in my Google Drive nobody has opened in 3 years' },
  { label: 'Read an invoice', prompt: 'Pull the line items out of this invoice' },
  { label: 'Draft support replies', prompt: 'Draft first replies to my open support tickets, and wait for my approval before sending' },
];

/** Guests have no connections and no uploads, so these need neither. */
const GUEST_STARTERS: Starter[] = [
  { label: 'Payment reminder', prompt: 'Write a polite reminder for an unpaid invoice' },
  { label: 'Compare tools', prompt: 'Compare Notion, Asana and Trello for a team of five' },
  { label: 'Explain GST credit', prompt: 'Explain GST input tax credit in simple words' },
  { label: 'Launch checklist', prompt: 'Plan a one-week launch checklist for a small product' },
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
  const recent = isGuest ? [] : conversations.slice(0, RECENT_LIMIT);
  const starters = isGuest ? GUEST_STARTERS : MEMBER_STARTERS;

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
          className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning-subtle px-3 py-1 text-[13px] text-foreground transition-colors hover:bg-warning/15"
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
              className="rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-secondary/60 hover:text-foreground"
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>

      {recent.length > 0 && (
        <nav aria-labelledby="welcome-recent" className="w-full max-w-md text-left">
          <h2 id="welcome-recent" className="mb-1 px-3 text-[12px] text-muted-foreground/70">Recent</h2>
          <ul className="space-y-0.5">
            {recent.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onOpenConversation(String(c.id))}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
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
