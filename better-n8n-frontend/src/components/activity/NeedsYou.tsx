/**
 * Needs you — the approval inbox above everything else.
 *
 * A run waiting on an approval is the only state that costs time while
 * producing nothing, so it renders first and only when non-empty. Moved as-is
 * from `pages/Runs.tsx` during the Activity split. The nav badge reads the
 * same `useHitlPending` query.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Hand, HelpCircle, ShieldQuestion, X } from 'lucide-react';
import { toast } from 'sonner';
import { useHitlPending } from '../../hooks/useHitlPending';
import {
  orchestratorService,
  hitlOption,
  type HITLResponse,
} from '../../api';
import { cn } from '../../lib/utils';
import MarkdownMessage from '../chat/MarkdownMessage';
import QuestionCard from '../chat/QuestionCard';
import { toQuestionSpec } from '../../lib/question';

/* Which option values are a real `HITLResponse.action` rather than free text.
   A button that posts `retry` here must post `retry` everywhere this queue is
   answered, so the set lives next to the queue. */
const ACTIONS = new Set(['approve', 'reject', 'retry', 'skip', 'stop']);

const typeConfig = {
  approval: { icon: ShieldQuestion, label: 'Needs your approval' },
  clarification: { icon: HelpCircle, label: 'Needs an answer' },
  error: { icon: AlertTriangle, label: 'Failed — needs a decision' },
} as const;

function waitedFor(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeLeft(req: { created_at: string; timeout_seconds: number | null }) {
  if (!req.timeout_seconds) return null;
  const deadline = new Date(req.created_at).getTime() + req.timeout_seconds * 1000;
  const mins = Math.floor((deadline - Date.now()) / 60000);
  if (mins <= 0) return 'expired';
  if (mins < 60) return `${mins}m left`;
  return `${Math.floor(mins / 60)}h left`;
}

export default function NeedsYou() {
  const queryClient = useQueryClient();
  const { data: pending = [] } = useHitlPending();
  // The selected approval lives in the URL (`?request=<id>`): a
  // notification's "Open" selects the request it is about instead of dropping
  // the user on the queue top. Read from `useSearchParams` directly rather
  // than mirrored into state — the two sync effects that kept a copy chased
  // each other. Adopted and published with `replace` so following a link never
  // spams history.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('request');
  const setSelectedId = (id: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set('request', id);
      else next.delete('request');
      return next;
    }, { replace: true });
  };
  const respond = useMutation({
    mutationFn: ({ id, action, response }: { id: string; action: HITLResponse['action']; response?: HITLResponse['response'] }) =>
      orchestratorService.respondToHITL(id, { action, response }),
    onSuccess: () => {
      toast.success('Response sent');
      setSelectedId(null);
      queryClient.invalidateQueries({ queryKey: ['hitl'] });
      queryClient.invalidateQueries({ queryKey: ['nav'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: () => toast.error('Could not send that response'),
  });
  const oldestWait = pending.length
    ? pending.reduce((a, b) => (a.created_at < b.created_at ? a : b))
    : null;
  const selected = pending.find((r) => r.request_id === selectedId) ?? pending[0] ?? null;
  // An `ask_user` question gets the same card as in chat: options, a number
  // box or a text box, instead of a row of approve/reject buttons.
  const selectedQuestion = selected ? toQuestionSpec(selected.question) : null;

  // Rendered only when something is actually waiting — the nav badge carries
  // the count the rest of the time.
  if (pending.length === 0) return null;

  return (
    <section className="mb-4 border border-primary-line bg-card rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-primary-subtle">
        <Hand className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-primary">
          {pending.length} {pending.length === 1 ? 'request needs' : 'requests need'} your attention
        </h2>
        {oldestWait && (
          <span className="text-[12px] text-primary/80">· longest {waitedFor(oldestWait.created_at)}</span>
        )}
      </div>
      <div className={cn(
        'flex lg:min-h-[280px] lg:max-h-[420px]',
        // On mobile the two panes stack, so the row must not reserve
        // 280px of nothing once the queue inside it is hidden.
        selected ? 'min-h-0' : 'min-h-[280px] max-h-[420px]',
      )}>
        {/* Queue. Hidden on mobile once something is selected: the
            detail renders *below* this 420px scroller, so tapping a
            row scrolled the answer off-screen and read as the tap
            doing nothing. Phones swap panes; they do not stack them. */}
        <div className={cn(
          'w-full lg:w-[380px] border-r border-border overflow-y-auto shrink-0',
          selected && 'hidden lg:block',
        )}>
          {pending.map((req) => {
            const cfg = typeConfig[req.request_type as keyof typeof typeConfig] ?? typeConfig.approval;
            const Icon = cfg.icon;
            const isError = req.request_type === 'error';
            const active = selected?.request_id === req.request_id;
            return (
              <button
                key={req.request_id}
                onClick={() => setSelectedId(req.request_id)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-border transition-colors relative',
                  active ? 'bg-primary-subtle' : 'hover:bg-secondary'
                )}
              >
                <span className={cn('absolute left-0 top-0 bottom-0 w-[3px]', isError ? 'bg-destructive' : 'bg-primary')} />
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={cn('w-4 h-4', isError ? 'text-destructive' : 'text-primary')} />
                  <span className={cn('text-[13px] font-semibold', isError ? 'text-destructive' : 'text-primary')}>
                    {cfg.label}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(req.created_at)}</span>
                </div>
                <p className="text-sm font-medium text-foreground mb-1 line-clamp-1">{req.title}</p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {req.workflow_name && <span className="truncate">{req.workflow_name}</span>}
                  {timeLeft(req) && (
                    <span className="flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      {timeLeft(req)}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        {/* Detail */}
        <div className="hidden lg:flex flex-1 flex-col overflow-y-auto">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Pick a request to see what the agent wants to do
            </div>
          ) : (
            <div className="p-5 max-w-2xl">
              <h2 className="text-lg font-semibold mb-1">{selected.title}</h2>
              {selected.workflow_name && (
                <p className="text-sm text-muted-foreground mb-3 flex items-center gap-1">
                  {selected.workflow_name}
                  <ChevronRight className="w-3 h-3" />
                  step {selected.node_id}
                </p>
              )}
              <div className="bg-card border border-border rounded p-4 mb-4">
                <div className="text-[14px] leading-relaxed text-foreground">
                  <MarkdownMessage content={selected.message} variant="compact" />
                </div>
              </div>
              {/* The backend supplies both the wording of each
                  choice and the action it posts — reading the action
                  off the button's position was a guess that held only
                  for the two-button case. */}
              {selectedQuestion ? (
                <QuestionCard
                  key={selected.request_id}
                  bare
                  spec={selectedQuestion}
                  busy={respond.isPending}
                  onSubmit={(answer) => respond.mutate({ id: selected.request_id, action: 'respond', response: answer })}
                  onSkip={() => respond.mutate({ id: selected.request_id, action: 'skip' })}
                />
              ) : (
              <div className="flex flex-wrap gap-2">
                {(selected.options?.length
                  ? selected.options.map(hitlOption)
                  : [{ label: 'Approve', value: 'approve' },
                     { label: 'Reject', value: 'reject' }]
                ).map(({ label, value }, i) => (
                  <button
                    key={`${value}-${label}`}
                    disabled={respond.isPending}
                    onClick={() =>
                      respond.mutate({
                        id: selected.request_id,
                        action: ACTIONS.has(value)
                          ? (value as HITLResponse['action'])
                          : 'respond',
                        response: label,
                      })
                    }
                    className={cn(
                      'px-4 py-2 text-sm rounded border transition-colors disabled:opacity-50',
                      i === 0
                        ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90 font-semibold'
                        : 'bg-card border-border hover:bg-secondary'
                    )}
                  >
                    {label}
                  </button>
                ))}
                <button
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ id: selected.request_id, action: 'reject' })}
                  className="px-4 py-2 text-sm rounded border border-border hover:bg-secondary text-muted-foreground flex items-center gap-1.5 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  Stop this run
                </button>
              </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-3">Nothing has left your account. This step runs only after you answer.</p>
            </div>
          )}
        </div>
      </div>
      {/* Mobile pane: replaces the queue rather than sitting under it. */}
      {selected && (
        <div className="lg:hidden p-4">
          <button
            onClick={() => setSelectedId(null)}
            className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back to queue
          </button>
          <h3 className="text-sm font-semibold mb-1">{selected.title}</h3>
          {selected.workflow_name && (
            <p className="text-[12px] text-muted-foreground mb-2 flex items-center gap-1">
              <span className="truncate">{selected.workflow_name}</span>
              <ChevronRight className="w-3 h-3 shrink-0" />
              <span className="shrink-0">step {selected.node_id}</span>
            </p>
          )}
          <div className="text-[14px] leading-relaxed bg-card border border-border rounded p-3 mb-3">
            <MarkdownMessage content={selected.message} variant="compact" />
          </div>
          {selectedQuestion ? (
            <QuestionCard
              key={selected.request_id}
              bare
              spec={selectedQuestion}
              busy={respond.isPending}
              onSubmit={(answer) => respond.mutate({ id: selected.request_id, action: 'respond', response: answer })}
              onSkip={() => respond.mutate({ id: selected.request_id, action: 'skip' })}
            />
          ) : (
          <div className="flex flex-wrap gap-2">
            {(selected.options?.length
              ? selected.options.map(hitlOption)
              : [{ label: 'Approve', value: 'approve' },
                 { label: 'Reject', value: 'reject' }]
            ).map(({ label, value }, i) => (
              <button
                key={`${value}-${label}`}
                disabled={respond.isPending}
                onClick={() =>
                  respond.mutate({
                    id: selected.request_id,
                    action: ACTIONS.has(value)
                      ? (value as HITLResponse['action'])
                      : 'respond',
                    response: label,
                  })
                }
                className={cn(
                  'px-3 py-1.5 text-sm rounded border disabled:opacity-50',
                  i === 0 ? 'bg-primary text-primary-foreground border-primary font-semibold' : 'bg-card border-border'
                )}
              >
                {label}
              </button>
            ))}
            <button
              disabled={respond.isPending}
              onClick={() => respond.mutate({ id: selected.request_id, action: 'reject' })}
              className="px-3 py-1.5 text-sm rounded border border-border text-muted-foreground flex items-center gap-1.5"
            >
              <X className="w-3 h-3" /> Stop
            </button>
          </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-3">
            Nothing has left your account. This step runs only after you answer.
          </p>
        </div>
      )}
    </section>
  );
}
