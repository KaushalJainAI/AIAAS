/**
 * What the assistant sees in this conversation, drawn for the user.
 *
 * Props-only, like the other chat pieces: `ChatContextView` fetches and hands
 * the result down. Every figure here comes from the server's own context
 * builder (`chat/turn/context_view.py`), so the panel shows what the next turn
 * would really send — the notes and task index, the messages replayed, the
 * plan, the system prompt with user memory, a token split, and how much of the
 * prompt the provider served from its cache.
 */
import type React from 'react';
import { CheckCircle2, Circle, CircleDot, ExternalLink, Loader2, OctagonAlert, RefreshCw } from 'lucide-react';

import type { CacheSummary, ChatContext, TodoItem } from '../../api/chat';
import { formatRate, formatTokens } from '../../lib/contextFormat';
import { cn } from '../../lib/utils';

/** The four parts of the prompt, in the order they are sent. */
const PARTS = [
  { key: 'system', label: 'System prompt + memory', swatch: 'bg-primary' },
  { key: 'notes', label: 'Conversation notes', swatch: 'bg-success' },
  { key: 'history', label: 'Messages replayed', swatch: 'bg-warning' },
  { key: 'tools', label: 'Tool definitions (est.)', swatch: 'bg-muted-foreground/60' },
] as const;

const HISTORY_MODE: Record<ChatContext['history']['mode'], string> = {
  task: 'The current task in full, plus the latest few messages. Older tasks are rows in the notes, opened on demand.',
  window: 'The last 20 messages. Notes take over after the first reply is filed.',
  off: 'Memory is off: the assistant sees only your current message.',
};

interface ChatContextPanelProps {
  data: ChatContext | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export default function ChatContextPanel({ data, loading, error, onRefresh }: ChatContextPanelProps) {
  if (!data) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-xs text-muted-foreground">
        {error ? (
          <div className="space-y-2 text-center">
            <p>{error}</p>
            <button onClick={onRefresh} className="rounded-md border border-border px-2.5 py-1 font-semibold hover:bg-muted">
              Try again
            </button>
          </div>
        ) : (
          <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading the context…</span>
        )}
      </div>
    );
  }

  const { tokens } = data;
  const contextWindow = data.context_window || 0;
  const scale = Math.max(contextWindow, tokens.total, 1);

  return (
    <div className="space-y-4 text-xs">
      {/* ── Size and cache ── */}
      <section aria-label="Context size" className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-bold text-foreground">
            ~{formatTokens(tokens.total)} tokens
            <span className="font-normal text-muted-foreground">
              {contextWindow ? ` of ${formatTokens(contextWindow)} (${data.model})` : ` (${data.model})`}
            </span>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh context"
            title="Refresh"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-sm bg-muted" role="img"
             aria-label={PARTS.map(p => `${p.label} ${formatTokens(tokens[p.key])}`).join(', ')}>
          {PARTS.map(p => (
            <div key={p.key} className={p.swatch} style={{ width: `${(tokens[p.key] / scale) * 100}%` }} />
          ))}
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {PARTS.map(p => (
            <li key={p.key} className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 shrink-0 rounded-sm', p.swatch)} aria-hidden="true" />
                {p.label}
              </span>
              <span className="font-mono tabular-nums text-foreground">{formatTokens(tokens[p.key])}</span>
            </li>
          ))}
        </ul>
      </section>

      <CacheSection cache={data.cache} />

      {/* ── Plan ── */}
      <Section title="Plan" meta={data.plan ? `${data.plan.todos.filter(t => t.status === 'done').length}/${data.plan.todos.length} done` : undefined} open>
        {data.plan ? (
          <ul className="space-y-1">
            {data.plan.todos.map((todo, i) => <TodoRow key={i} todo={todo} />)}
          </ul>
        ) : (
          <Empty>No plan yet. The assistant writes one when a job takes more than a couple of steps.</Empty>
        )}
      </Section>

      {/* ── Notes ── */}
      <Section
        title="Conversation notes"
        meta={data.notes.tasks.length ? `${data.notes.tasks.length} tasks · ${formatTokens(data.notes.tokens)}` : undefined}
        open
      >
        {data.notes.tasks.length === 0 && !data.notes.text ? (
          <Empty>Written after the first reply: a summary, the decisions and a task index the assistant reads before every turn.</Empty>
        ) : (
          <div className="space-y-2">
            {data.notes.tasks.length > 0 && (
              <table className="w-full table-fixed border-collapse text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="w-12 py-1 font-semibold">Task</th>
                    <th className="py-1 font-semibold">Title</th>
                    <th className="w-20 py-1 font-semibold">Status</th>
                    <th className="w-12 py-1 text-right font-semibold">Msgs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.notes.tasks.map(task => (
                    <tr key={task.id} className="border-t border-border align-top" title={task.outcome}>
                      <td className="py-1 font-mono">
                        {task.id}
                        {task.id === data.notes.current && <span className="ml-1 text-primary" title="Current task">●</span>}
                      </td>
                      <td className="py-1 pr-2">
                        <div className="truncate text-foreground">{task.title}</div>
                        {task.outcome && <div className="truncate text-muted-foreground">{task.outcome}</div>}
                      </td>
                      <td className="py-1">{task.status.replace('_', ' ')}</td>
                      <td className="py-1 text-right font-mono tabular-nums">{task.messages.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex items-center gap-3">
              {data.notes.document_id && (
                <a
                  href={`/documents?doc=${data.notes.document_id}`}
                  className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                >
                  Open the notes file <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
            <Raw label="Notes as the assistant reads them" text={data.notes.text} />
          </div>
        )}
      </Section>

      {/* ── Messages ── */}
      <Section
        title="Messages replayed"
        meta={`${data.history.replayed} of ${data.history.total_messages} · ${formatTokens(data.history.tokens)}`}
      >
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">{HISTORY_MODE[data.history.mode]}</p>
        {data.history.messages.length > 0 && (
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {data.history.messages.map(m => (
              <li key={m.id} className="flex items-start gap-2 text-[11px]">
                <span className={cn('w-14 shrink-0 font-semibold', m.role === 'user' ? 'text-primary' : 'text-muted-foreground')}>
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {m.preview || '(empty)'}
                </span>
                {m.summarised && <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">summary</span>}
                <span className="w-10 shrink-0 text-right font-mono tabular-nums text-muted-foreground">{formatTokens(m.tokens)}</span>
              </li>
            ))}
          </ul>
        )}
        {data.history.not_shown > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {data.history.not_shown} earlier messages are not sent; the notes index them and the assistant can open any of them.
          </p>
        )}
      </Section>

      {/* ── System prompt + memory ── */}
      <Section title="System prompt and memory" meta={formatTokens(data.system_prompt.tokens)}>
        <div className="space-y-2">
          <Labelled label="This chat's instructions">
            {data.system_prompt.session_prompt || <Empty>None — set one on the Settings tab.</Empty>}
          </Labelled>
          <Labelled label="What the assistant knows about you">
            {data.system_prompt.user_memory || <Empty>Nothing stored yet.</Empty>}
          </Labelled>
          <Raw label="The whole system prompt" text={data.system_prompt.full} />
        </div>
      </Section>

      <Section title="Not counted here">
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
          {data.not_included.map(line => <li key={line}>{line}</li>)}
        </ul>
      </Section>
    </div>
  );
}

function CacheSection({ cache }: { cache: ChatContext['cache'] }) {
  const last = cache.last_turn;
  return (
    <section aria-label="Prompt cache" className="rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-bold text-foreground">Prompt cache</div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            The share of the prompt the provider reused from earlier turns. Cached tokens are cheaper and faster.
          </p>
        </div>
        <div className="flex shrink-0 gap-4 text-right">
          <Stat label="Last turn" value={formatRate(last?.hit_rate)} />
          <Stat label="This chat" value={formatRate(cache.conversation.hit_rate)} />
        </div>
      </div>
      {cache.recent.length > 1 && (
        <div className="mt-2 flex h-8 items-end gap-0.5" role="img"
             aria-label={`Cache hit rate over the last ${cache.recent.length} turns`}>
          {cache.recent.map(point => (
            <div
              key={point.message_id}
              title={formatRate(point.hit_rate)}
              className="flex-1 rounded-t-sm bg-primary/70"
              style={{ height: `${Math.max(4, (point.hit_rate ?? 0) * 100)}%` }}
            />
          ))}
        </div>
      )}
      <CacheBreakdown summary={cache.conversation} />
    </section>
  );
}

function CacheBreakdown({ summary }: { summary: CacheSummary }) {
  if (!summary.turns) {
    return <p className="mt-2 text-[11px] text-muted-foreground">No usage recorded yet.</p>;
  }
  return (
    <p className="mt-2 font-mono text-[11px] tabular-nums text-muted-foreground">
      {summary.turns} turns · {formatTokens(summary.prompt_tokens)} prompt tokens · {formatTokens(summary.cached_read_tokens)} from cache
      {summary.cached_write_tokens > 0 && ` · ${formatTokens(summary.cached_write_tokens)} written to cache`}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-base font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function TodoRow({ todo }: { todo: TodoItem }) {
  const Icon = todo.status === 'done' ? CheckCircle2
    : todo.status === 'doing' ? CircleDot
      : todo.status === 'blocked' ? OctagonAlert : Circle;
  return (
    <li className="flex items-start gap-2 text-[11px]">
      <Icon
        aria-label={todo.status}
        className={cn('mt-px h-3.5 w-3.5 shrink-0',
          todo.status === 'done' ? 'text-success'
            : todo.status === 'doing' ? 'text-primary'
              : todo.status === 'blocked' ? 'text-warning' : 'text-muted-foreground')}
      />
      <span className={cn('min-w-0', todo.status === 'done' && 'text-muted-foreground line-through')}>
        {todo.text}
        {todo.note && <span className="block text-muted-foreground no-underline">{todo.note}</span>}
      </span>
    </li>
  );
}

function Section({ title, meta, open, children }: {
  title: string; meta?: string; open?: boolean; children: React.ReactNode;
}) {
  return (
    <details open={open} className="group rounded-md border border-border">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 font-bold text-foreground">
        {title}
        {meta && <span className="font-mono text-[11px] font-normal tabular-nums text-muted-foreground">{meta}</span>}
      </summary>
      <div className="border-t border-border px-3 py-2.5">{children}</div>
    </details>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] font-semibold text-muted-foreground">{label}</div>
      <div className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-foreground">{children}</div>
    </div>
  );
}

function Raw({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <details>
      <summary className="cursor-pointer text-[11px] font-semibold text-muted-foreground hover:text-foreground">{label}</summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-background p-2 font-mono text-[10.5px] leading-relaxed text-foreground">
        {text}
      </pre>
    </details>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] italic text-muted-foreground">{children}</span>;
}
