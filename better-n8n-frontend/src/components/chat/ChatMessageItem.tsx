/**
 * One saved message in the chat transcript: the question, or the answer with
 * everything that came with it (reasoning, tool activity, code runs, sources,
 * charts, files, command cards) and the row of actions under it.
 *
 * The question is left-aligned under a round avatar and "You · time", with no
 * bubble. The answer is headed by the agent badge and "Lead · time". A plain
 * reply is just text under that header. A reply where agents worked (tool
 * calls, files, delegation) sits inside a bordered block that says how many
 * steps it took and how long.
 *
 * It only draws. Every action (copy, delete, rewrite, edit, ...) is handled by
 * `StandaloneChat` through the callbacks below.
 */
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUpFromLine,
  Check,
  ChevronDown,
  Code,
  Copy,
  File as FileIcon,
  FileText,
  Globe2,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Trash2,
  Video,
  Volume2,
  VolumeX,
  ListChecks,
} from 'lucide-react';

import type { StandaloneChatMessage as ChatMessage } from '../../api';
import type { ChartSpec, HtmlArtifact as HtmlArtifactData } from '../../api/chat';
import type { SolutionUsed } from '../../api/solutions';
import type { MessagePanel } from '../../hooks/useMessagePanels';
import { prettyModel } from '../../lib/modelNames';
import { cn } from '../../lib/utils';
import FileCards from '../files/FileCards';
import FeedbackControl from '../runs/FeedbackControl';
import ChartArtifact from './ChartArtifact';
import { CollapsiblePanel } from './CollapsiblePanel';
import CommandCard from './CommandCard';
import { badgeInitials, personLabel, formatClock, formatElapsed, formatSteps, formatWordCount, stripXmlTags } from './format';
import HtmlArtifact from './HtmlArtifact';
import MarkdownMessage from './MarkdownMessage';
import { MediaPreview } from './MediaPreview';
import TeamSolutionsChip, { type SolutionVerdict } from './TeamSolutionsChip';
import SolutionDraftCard, { type DraftAction, type SolutionDraftInfo } from '../solutions/SolutionDraftCard';
import PlanSummary from '../plan/PlanSummary';
import { actionsFrom, historyFrom } from '../../lib/planView';

/** The chat lead's name on every reply. Worker replies carry their own. */
export const LEAD_NAME = 'Lead';

/**
 * The agent badge: the agent's initials in a small square. Violet, because it
 * marks an agent acting. People get round avatars instead.
 */
export function AgentBadge({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-agent-subtle font-mono text-[10px] font-semibold text-agent"
    >
      {badgeInitials(name)}
    </span>
  );
}

/** A person's round avatar, for the user's own messages. */
function PersonAvatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary-line bg-primary-subtle font-mono text-[10px] font-semibold leading-none tracking-tight text-primary"
    >
      {initials}
    </span>
  );
}

/**
 * "Lead · time · reasoned ›" — the header of an answer. Shared with the live
 * turn in `StandaloneChat`, so a reply reads the same while it is written and
 * after it settles. `reasoned` only appears when there is a reasoning trace to
 * open, and opens it through the caller's own toggle.
 */
export function AssistantHeader({
  name = LEAD_NAME,
  time,
  onReasoned,
  right,
}: {
  name?: string;
  time?: string;
  /** When set, a "reasoned ›" control opens the reasoning trace. */
  onReasoned?: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <AgentBadge name={name} />
      <span className="font-medium text-foreground">{name}</span>
      {time && <span>· {time}</span>}
      {onReasoned && (
        <button
          onClick={onReasoned}
          className="font-mono text-[12px] text-muted-foreground hover:text-foreground transition-colors"
        >
          · reasoned ›
        </button>
      )}
      {right && <span className="ml-auto flex items-center gap-2 font-mono text-[12px]">{right}</span>}
    </div>
  );
}

/**
 * The bordered block around a turn where agents worked. While `live`, a thin
 * violet line runs along its top edge. The header is the caller's, so the
 * saved and live views say the same thing in the same place.
 */
export function TurnFrame({
  live = false,
  header,
  children,
}: {
  live?: boolean;
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-card">
      {live && (
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[2px] animate-pulse bg-agent" />
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        {header}
      </div>
      <div className="min-w-0 space-y-3 px-4 py-3">{children}</div>
    </div>
  );
}

/**
 * A turn's frame, chosen once: a bordered block when agents worked, and a plain
 * header over the text when they did not. Used by the live turn, so it can
 * decide which shape to draw after the first tool call arrives.
 */
export function TurnOrPlain({
  worked,
  live = false,
  header,
  className,
  children,
}: {
  worked: boolean;
  live?: boolean;
  header: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  if (worked) {
    return (
      <div className={className}>
        <TurnFrame live={live} header={header}>{children}</TurnFrame>
      </div>
    );
  }
  return (
    <div className={cn("space-y-2", className)}>
      {header}
      {children}
    </div>
  );
}

interface ChatMessageItemProps {
  message: ChatMessage;
  /** Position in the transcript. The first message gets no divider above it. */
  index: number;
  /** Play the entrance animation (false once the message has settled). */
  animate: boolean;
  /** This message is being deleted: its buttons are disabled. */
  deleting: boolean;
  /** Show the "copied" tick on the copy button. */
  copied: boolean;
  /** This message is the one currently being read aloud. */
  isSpeaking: boolean;
  /** The speaker button is waiting on `/api/chat/speak/` for this message. */
  speakLoading: boolean;
  isPanelOpen: (panel: MessagePanel, messageId: number | undefined) => boolean;
  togglePanel: (panel: MessagePanel, messageId: number) => void;
  /** A confirm sheet on a command card is being submitted. */
  confirmBusy: boolean;
  onCopy: () => void;
  /** Read this message aloud, or stop if it's already playing. */
  onSpeak: (messageId: number, text: string) => void;
  onDelete: (messageId: number) => void;
  /** Regenerate from this message (deletes it and what follows). */
  onRewrite: (messageId: number) => void;
  /** Keep this question, delete the answers after it. */
  onRewind: (messageId: number) => void;
  onEdit: (messageId: number, content: string) => void;
  onCommandConfirm: (
    name: string, baseArgs: Record<string, unknown>, confirm: Record<string, unknown>,
  ) => void;
  /** A person's verdict on a team solution this answer read ("Worked" / "Didn't work"). */
  onReviewSolution?: (solutionId: number, kind: SolutionVerdict) => void;
  /** A choice on the draft card: share with the team, keep private, or discard. */
  onDraftAction?: (solutionId: number, action: DraftAction) => void;
  /** The draft card's choice is being sent to the server. */
  draftBusy?: boolean;
  /** The signed-in person's name, to sign their own messages. Absent: "You". */
  userName?: string;
}

export default function ChatMessageItem({
  userName,
  message,
  index,
  animate,
  deleting,
  copied,
  isSpeaking,
  speakLoading,
  isPanelOpen,
  togglePanel,
  confirmBusy,
  onCopy,
  onSpeak,
  onDelete,
  onRewrite,
  onRewind,
  onEdit,
  onCommandConfirm,
  onReviewSolution,
  onDraftAction,
  draftBusy = false,
}: ChatMessageItemProps) {
  // Read as the frame delivers it: the metadata type is open, so the array is
  // checked here before any element is trusted.
  const solutionsUsed = Array.isArray(message.metadata?.solutions_used)
    ? (message.metadata.solutions_used as SolutionUsed[])
    : [];
  // The draft card exists only while the capture left a draft on this answer.
  const draft = (message.metadata as { solution_draft?: SolutionDraftInfo | null })?.solution_draft;
  const draftInfo = draft && typeof draft.id === 'number' ? draft : null;

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isAssistant = message.role === 'assistant';
  const meta = message.metadata;
  const traceCount = meta?.tool_trace?.length ?? 0;
  const agentRunId = (meta as { agent_run?: { execution_id?: string } })?.agent_run?.execution_id;
  // A reply is a block only when agents worked: a tool call, a file, a
  // delegated run, or code. A plain answer is text under its header.
  const agentsWorked = isAssistant && (
    traceCount > 0
    || (meta?.files?.length ?? 0) > 0
    || meta?.has_code_execution === true
    || Object.keys(meta?.worker_plans ?? {}).length > 0
    || Boolean(agentRunId)
  );
  const stepCount = typeof meta?.steps === 'number' ? meta.steps : traceCount;
  const elapsed = formatElapsed(meta?.elapsed_ms);
  const time = formatClock(message.created_at);
  const hasReasoning = Boolean(meta?.thinking);

  const reasonedToggle = hasReasoning
    ? () => togglePanel('thinking', message.id as number)
    : undefined;

  // The body: the question or the answer and everything attached to it.
  const body = (
    <div className="w-full min-w-0 space-y-3">

      {/* A resolved command: the chip, not expanded text. */}
      {(message.metadata as { command?: { name?: string; args?: Record<string, unknown> } })?.command?.name && (
        <div className="flex items-center gap-1.5">
          <span className="inline-flex min-h-[28px] items-center rounded bg-primary/10 px-2 py-1 font-mono text-[12px] font-bold text-primary">
            /{String((message.metadata as { command?: { name?: string } }).command!.name)}
          </span>
        </div>
      )}

      {/* Prose sits at ~72ch (MarkdownMessage does that per element), and
          code blocks and tables run the full width. break-words so a long
          URL or token wraps instead of pushing the column past a phone. */}
      <div className={cn(
        "prose prose-base dark:prose-invert max-w-none ai-chat-prose break-words min-w-0",
        isUser
          ? "text-[15px] leading-[1.7] font-medium text-foreground max-w-[72ch]"
          : isSystem
          ? "w-full"
          : "text-[15px] leading-[1.7] text-foreground"
      )}>

        {isSystem ? (
          <div className="bg-muted p-4 rounded-md border border-border inline-flex flex-col gap-3 min-w-0 w-full max-w-sm sm:min-w-[300px]">
            <div className="flex items-start gap-3">
               <div className="w-10 h-10 rounded-md bg-card border border-border flex items-center justify-center shrink-0">
                  {message.metadata?.file_type === 'image' ? <ImageIcon className="w-5 h-5 text-success" /> :
                   message.metadata?.file_type === 'pdf' ? <FileIcon className="w-5 h-5 text-destructive" /> :
                   message.metadata?.file_type === 'pptx' ? <FileIcon className="w-5 h-5 text-warning" /> :
                   <FileIcon className="w-5 h-5 text-primary" />}
               </div>
               <div className="flex-1 min-w-0 pr-8 relative">
                  <p className="text-sm font-semibold text-foreground truncate max-w-[90%]">
                    {message.content.match(/\*\*([^*]+)\*\*/)?.[1] || "Uploaded File"}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[11px] bg-card px-1.5 py-0.5 rounded border border-border">
                      {message.metadata?.file_type || 'File'}
                    </span>
                    {message.metadata?.has_extracted_text && (
                       <span className="font-mono text-[11px] text-success bg-success-subtle px-1.5 py-0.5 rounded border border-border">
                         Parsed
                       </span>
                    )}
                  </div>
                  <button
                    onClick={() => onDelete(message.id as number)}
                    disabled={deleting}
                    className="absolute right-0 top-0 p-1.5 text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                    title="Delete file"
                  >
                    {deleting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => onRewrite(message.id as number)}
                    disabled={deleting}
                    className="absolute right-8 top-0 p-1.5 text-muted-foreground/40 hover:text-amber-500 hover:bg-warning-subtle rounded-md transition-colors disabled:opacity-50"
                    title="Rewind conversation from here (deletes this and following)"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
               </div>
            </div>
            {/* Hide the raw extracted text preview from the user to keep UI clean, but keep the success indication */}
            <div className="text-xs font-medium text-muted-foreground bg-background/50 p-2 rounded-md border border-border/30">
              Added to conversation context
            </div>
          </div>
        ) : (
          <MarkdownMessage
            content={message.content}
            sources={message.metadata?.sources}
          />
        )}
      </div>

      {/* Summary, activity and code: the panels the turn left behind. The
          reasoning trace opens from the header instead. */}
      {isAssistant && (message.metadata?.summary || (message.metadata?.tool_trace && (message.metadata?.tool_trace?.length ?? 0) > 0) || message.metadata?.has_code_execution) && (
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-3 mb-1">
          {message.metadata?.summary && (
            <div className="min-w-0 sm:flex-1 sm:min-w-[140px] group/summary animate-in fade-in slide-in-from-top-2 duration-500">
              <button
                onClick={() => togglePanel('summary', message.id as number)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md transition-colors border w-full",
                  isPanelOpen('summary', message.id)
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <FileText className={cn("w-4 h-4", isPanelOpen('summary', message.id) ? "text-primary" : "text-muted-foreground/70")} />
                <span className="text-[12px] font-medium">Summary</span>
                <div className="flex-1" />
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", isPanelOpen('summary', message.id) && "rotate-180")} />
              </button>
            </div>
          )}

          {message.metadata?.tool_trace && (message.metadata?.tool_trace?.length ?? 0) > 0 && (
            <div className="min-w-0 sm:flex-1 sm:min-w-[140px] group/activity animate-in fade-in slide-in-from-top-2 duration-500">
              <button
                onClick={() => togglePanel('activity', message.id as number)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md transition-colors border w-full",
                  isPanelOpen('activity', message.id)
                    ? "bg-agent-subtle border-agent-line text-agent"
                    : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <ListChecks className={cn("w-4 h-4", isPanelOpen('activity', message.id) ? "text-agent" : "text-muted-foreground/70")} />
                <span className="text-[12px] font-medium">Steps</span>
                <div className="flex-1" />
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", isPanelOpen('activity', message.id) && "rotate-180")} />
              </button>
            </div>
          )}

          {message.metadata?.has_code_execution && message.metadata?.code_executions && (message.metadata?.code_executions?.length ?? 0) > 0 && (
            <div className="min-w-0 sm:flex-1 sm:min-w-[140px] group/code animate-in fade-in slide-in-from-top-2 duration-500">
              <button
                onClick={() => togglePanel('code', message.id as number)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md transition-colors border w-full",
                  isPanelOpen('code', message.id)
                    ? "bg-success-subtle border-success/30 text-success"
                    : "bg-muted/30 border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                <Code className={cn("w-4 h-4", isPanelOpen('code', message.id) ? "text-success" : "text-muted-foreground/70")} />
                <span className="text-[12px] font-medium">Code</span>
                <div className="flex-1" />
                <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", isPanelOpen('code', message.id) && "rotate-180")} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Expanded Summary Content */}
      {isAssistant && message.metadata?.summary && (
        <CollapsiblePanel open={isPanelOpen('summary', message.id)}>
        <div className="mt-2 p-4 bg-card border border-border rounded-md relative overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-px bg-primary" />
          {/* Model-written summary — markdown via the shared renderer. */}
          <div className="text-[14px] text-foreground leading-relaxed italic">
            <MarkdownMessage content={message.metadata.summary} variant="compact" />
          </div>
        </div>
        </CollapsiblePanel>
      )}

      {/* Expanded Thinking Content */}
      {isAssistant && message.metadata?.thinking && (
        <CollapsiblePanel open={isPanelOpen('thinking', message.id)}>
        <div className="mt-2 overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              How the assistant got here · {formatWordCount(message.metadata.thinking)}
            </span>
          </div>
          {/* Capped and scrollable: an unbounded trace can run
              longer than the answer it explains, pushing the
              actual reply off screen. */}
          <div className="max-h-[420px] overflow-y-auto p-4">
            <div className="prose prose-sm prose-invert max-w-[72ch] text-[14px] leading-relaxed text-muted-foreground italic select-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.metadata.thinking}
              </ReactMarkdown>
            </div>
          </div>
        </div>
        </CollapsiblePanel>
      )}

      {/* Tool Activity Trace — shows which tools the agent called */}
      {isAssistant && message.metadata?.tool_trace && (message.metadata?.tool_trace?.length ?? 0) > 0 && (
        <CollapsiblePanel open={isPanelOpen('activity', message.id)}>
        <div className="mt-2 p-4 bg-card border border-border rounded-md">
          <div className="flex items-center gap-3 px-1 mb-3">
            <span className="font-mono text-[11px] text-muted-foreground">Steps</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-1">
            {(message.metadata?.tool_trace ?? []).map((trace, i) => (
              <div
                key={i}
                className="flex flex-col gap-1.5 py-2 border-b border-border last:border-0"
              >
                <div className="flex items-center gap-3 text-[14px] text-muted-foreground">
                  <span className="flex items-center justify-center w-6 h-6 rounded bg-muted font-mono text-[11px] text-muted-foreground shrink-0 border border-border">
                    {trace.iteration || i + 1}
                  </span>
                  <span className="font-mono font-semibold text-foreground text-[13px]">{trace.tool}</span>
                  {(trace.args?.query || trace.args?.question) && (
                    <span className="truncate max-w-[40vw] sm:max-w-[360px] text-foreground/60 italic text-[13px] pl-1">"{stripXmlTags(trace.args.query || trace.args.question)}"</span>
                  )}
                  {trace.summary && !trace.args?.query && !trace.args?.question && (
                    <span className="truncate max-w-[40vw] sm:max-w-[360px] text-foreground/50 italic text-[12px] pl-1">{stripXmlTags(trace.summary)}</span>
                  )}
                </div>
                {trace.thought && (
                  <div className="pl-[38px] flex flex-col gap-1">
                     <div className="text-[13px] text-muted-foreground italic leading-relaxed border-l-2 border-border pl-3 pb-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {trace.thought}
                        </ReactMarkdown>
                     </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        </CollapsiblePanel>
      )}

      {/* Code Execution Log — shows sandbox results */}
      {isAssistant && message.metadata?.code_executions && (message.metadata?.code_executions?.length ?? 0) > 0 && (
        <CollapsiblePanel open={isPanelOpen('code', message.id)}>
        <div className="mt-2 p-4 bg-card border border-border rounded-md">
          <div className="flex items-center gap-3 px-1 mb-3">
            <span className="font-mono text-[11px] text-muted-foreground">Sandbox code</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-4">
            {(message.metadata?.code_executions ?? []).map((exec, i) => (
              <div key={i} className="space-y-2 border-b border-border last:border-0 pb-4 last:pb-0">
                <div className="flex items-center gap-2">
                   <span className="font-mono text-[11px] text-muted-foreground">Execution #{exec.iteration || i+1}</span>
                   <div className="h-px flex-1 bg-border" />
                </div>
                <div className="rounded-md overflow-hidden border border-border bg-muted">
                   <div className="px-3 py-1.5 bg-muted flex items-center justify-between border-b border-border">
                      <span className="font-mono text-[11px] text-muted-foreground">Input code</span>
                   </div>
                   <pre className="p-4 text-[13px] overflow-x-auto text-zinc-300 font-mono leading-relaxed bg-zinc-950">
                      <code>{exec.code}</code>
                   </pre>
                </div>
                {(exec.output || exec.result) && (
                   <div className="rounded-md overflow-hidden border border-border bg-card">
                      <div className="px-3 py-1.5 bg-zinc-900/50 flex items-center justify-between border-b border-white/5">
                         <span className="font-mono text-[11px] text-zinc-500">Execution output</span>
                      </div>
                      <pre className="p-4 text-[12px] overflow-x-auto text-blue-400/90 font-mono leading-relaxed whitespace-pre-wrap bg-zinc-950/20">
                         <code>{exec.output || exec.result}</code>
                      </pre>
                   </div>
                )}
              </div>
            ))}
          </div>
        </div>
        </CollapsiblePanel>
      )}


      {/* Discovered Media Row (Sources, Images, Videos on one line) */}
      {isAssistant && ((message.metadata?.sources?.length ?? 0) > 0 || (message.metadata?.images?.length ?? 0) > 0 || (message.metadata?.videos?.length ?? 0) > 0) && (
        <div className="mt-4 md:mt-5 flex flex-wrap gap-2">
          {(message.metadata?.sources?.length ?? 0) > 0 && (
            <button
              onClick={() => togglePanel('sources', message.id as number)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors border group",
                isPanelOpen('sources', message.id) ? "bg-primary-subtle border-primary-line text-primary" : "bg-secondary border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Globe2 className="w-3.5 h-3.5" />
              <span className="text-[12px] font-medium">{(message.metadata?.sources?.length ?? 0)} Sources</span>
            </button>
          )}

          {(message.metadata?.images?.length ?? 0) > 0 && (
            <button
              onClick={() => togglePanel('images', message.id as number)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors border group",
                isPanelOpen('images', message.id) ? "bg-primary-subtle border-primary-line text-primary" : "bg-secondary border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span className="text-[12px] font-medium">{(message.metadata?.images?.length ?? 0)} Images</span>
            </button>
          )}

          {(message.metadata?.videos?.length ?? 0) > 0 && (
            <button
              onClick={() => togglePanel('videos', message.id as number)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors border group",
                isPanelOpen('videos', message.id) ? "bg-primary-subtle border-primary-line text-primary" : "bg-secondary border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Video className="w-3.5 h-3.5" />
              <span className="text-[12px] font-medium">{(message.metadata?.videos?.length ?? 0)} Videos</span>
            </button>
          )}
        </div>
      )}

      {/* Content areas below the row triggers */}
      {isAssistant && (message.metadata?.sources?.length ?? 0) > 0 && (
        <CollapsiblePanel open={isPanelOpen('sources', message.id)}>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 animate-in fade-in slide-in-from-top-2 duration-300 md:px-1">
          {(message.metadata?.sources ?? []).map((item, i) => (
            <MediaPreview
              key={i}
              url={item.url}
              type="link"
              title={item.title}
              source={item.publisher || item.source}
              thumbnail={item.thumbnail}
              className="animate-in fade-in zoom-in-95 duration-500"
            />
          ))}
        </div>
        </CollapsiblePanel>
      )}

      {isAssistant && (message.metadata?.images?.length ?? 0) > 0 && (
        <CollapsiblePanel open={isPanelOpen('images', message.id)}>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 animate-in fade-in slide-in-from-top-2 duration-300 md:px-1">
          {(message.metadata?.images ?? []).flatMap((item, i) => {
            // No url, no tile. `any` used to let `undefined`
            // through to MediaPreview's required `url` prop.
            const url = item.image || item.url;
            return url ? [(
              <MediaPreview
                key={i}
                url={url}
                type="image"
                title={item.title}
                source={item.source}
                className="animate-in fade-in zoom-in-95 duration-500"
              />
            )] : [];
          })}
        </div>
        </CollapsiblePanel>
      )}

      {isAssistant && (message.metadata?.videos?.length ?? 0) > 0 && (
        <CollapsiblePanel open={isPanelOpen('videos', message.id)}>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3 animate-in fade-in slide-in-from-top-2 duration-300 md:px-1">
          {(message.metadata?.videos ?? []).flatMap((item, i) => (
            item.url ? [(
              <MediaPreview
                key={i}
                url={item.url}
                type="video"
                title={item.title}
                source={item.publisher || item.source}
                className="animate-in fade-in zoom-in-95 duration-500"
              />
            )] : []
          ))}
        </div>
        </CollapsiblePanel>
      )}


      {/* Team solutions the answer read from the organisation's library.
          "Checked", not "based on": this is what was read. */}
      {isAssistant && solutionsUsed.length > 0 && (
        <TeamSolutionsChip
          items={solutionsUsed}
          onReview={(id, kind) => onReviewSolution?.(id, kind)}
        />
      )}

      {/* A fix this answer's chat drafted for the team. Offered until the
          author chooses; afterwards it shows what became of it. */}
      {isAssistant && draftInfo && (
        <SolutionDraftCard
          draft={draftInfo}
          busy={draftBusy}
          onAction={(action) => onDraftAction?.(draftInfo.id, action)}
        />
      )}

      {/* The plan the turn worked to, kept as a record of what
          it set out to do and what it could not finish. */}
      {Array.isArray(message.metadata?.todos) &&
        (message.metadata?.todos ?? []).length > 0 && (
          <PlanSummary
            history={historyFrom(message.metadata?.todo_history, message.metadata?.todos)}
            actions={actionsFrom(message.metadata?.tool_trace)}
          />
        )}

      {/* The plans of the agents this reply handed work to. */}
      {Object.entries(message.metadata?.worker_plans ?? {}).map(([id, plan]) => (
        Array.isArray(plan?.todos) && plan.todos.length > 0 && (
          <PlanSummary key={id} history={[plan.todos]} label={plan.agent_name || 'Agent'} />
        )
      ))}

      {/* Outputs: files the turn saved, linked by id rather than by
          whatever path the prose happened to mention. */}
      <FileCards files={message.metadata?.files} />

      {/* Rendered HTML artifacts, replayed from stored history. */}
      {Array.isArray(message.metadata?.html_artifacts) &&
        (message.metadata?.html_artifacts ?? []).map((art: HtmlArtifactData, i: number) => (
          <HtmlArtifact key={`${message.id}-art-${i}`} artifact={art} />
        ))}

      {/* Charts, redrawn from the stored spec rather than from
          a stored picture — so a reopened conversation gets
          today's palette and today's accessibility fixes. */}
      {Array.isArray(message.metadata?.charts) &&
        (message.metadata?.charts ?? []).map((chart: ChartSpec, i: number) => (
          <ChartArtifact key={`${message.id}-chart-${i}`} chart={chart} />
        ))}

      {/* Command cards: mission, status, cost, memory,
          findings, confirm sheets. Stored on the message so
          a reopened conversation replays them. */}
      {(message.metadata as { command_card?: { type?: string } & Record<string, unknown> })?.command_card?.type && (
        <CommandCard
          card={(message.metadata as { command_card: { type: string } & Record<string, unknown> }).command_card}
          busy={confirmBusy}
          onConfirm={(confirm) => {
            const cmd = (message.metadata as { command?: { name?: string; args?: Record<string, unknown> } }).command;
            if (cmd?.name) onCommandConfirm(cmd.name, cmd.args ?? {}, confirm);
          }}
          onNavigate={(path) => { window.location.href = path; }}
        />
      )}

      {/* The delegated run's card, persisted on the message. */}
      {(message.metadata as { agent_run?: { agent_name?: string; execution_id?: string; status?: string } })?.agent_run?.execution_id && (
        <CommandCard
          card={{
            type: 'agent_run',
            agent_name: (message.metadata as { agent_run?: { agent_name?: string } }).agent_run?.agent_name ?? 'Agent',
            execution_id: (message.metadata as { agent_run?: { execution_id?: string } }).agent_run?.execution_id ?? '',
            status: (message.metadata as { agent_run?: { status?: string } }).agent_run?.status ?? 'running',
          }}
          onNavigate={(path) => { window.location.href = path; }}
        />
      )}
    </div>
  );

  // The action row sits outside the block, so its controls never read as part
  // of the agent's work.
  const actions = message.role !== 'system' && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-1 -ml-1.5">
      {/* Always visible on touch (no hover there); larger
          hit targets on phones. */}
      <div className="flex items-center gap-1 sm:gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity duration-300">
        <button
          onClick={onCopy}
          className="text-muted-foreground hover:text-primary transition-colors p-2 md:p-1.5 hover:bg-primary/5 rounded-md"
          title="Copy message"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
        </button>
        {isAssistant && message.content.trim() && (
          <button
            onClick={() => onSpeak(message.id as number, message.content)}
            className="text-muted-foreground hover:text-primary transition-colors p-2 md:p-1.5 hover:bg-primary/5 rounded-md"
            title={isSpeaking ? 'Stop reading aloud' : 'Read aloud'}
          >
            {speakLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : isSpeaking
                ? <VolumeX className="w-4 h-4 text-primary" />
                : <Volume2 className="w-4 h-4" />}
          </button>
        )}
        {!isUser && (
          <button
            onClick={() => onRewrite(message.id as number)}
            disabled={deleting}
            className="text-muted-foreground hover:text-amber-500 transition-colors p-2 md:p-1.5 hover:bg-warning-subtle rounded-md disabled:opacity-50"
            title="Rewrite prompt (regenerates response without subsequent context)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        {isAssistant && typeof message.id === 'number' && (
          <FeedbackControl
            target="message"
            id={message.id}
            initial={(message as { feedback?: { rating: number; reason: string; comment: string } | null }).feedback ?? null}
          />
        )}
        {isUser && (
          <button
            onClick={() => onRewind(message.id as number)}
            disabled={deleting}
            className="text-muted-foreground hover:text-emerald-500 transition-colors p-2 md:p-1.5 hover:bg-success-subtle rounded-md disabled:opacity-50"
            title="Take back (removes this message and everything after it, and puts the text back in the box)"
          >
            <ArrowUpFromLine className="w-4 h-4" />
          </button>
        )}
        {isUser && (
          <button
            onClick={() => onEdit(message.id as number, message.content)}
            disabled={deleting}
            className="text-muted-foreground hover:text-blue-500 transition-colors p-2 md:p-1.5 hover:bg-blue-500/10 rounded-md disabled:opacity-50"
            title="Edit and resend message"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => onDelete(message.id as number)}
          disabled={deleting}
          className="text-muted-foreground hover:text-red-500 transition-colors p-2 md:p-1.5 hover:bg-red-500/10 rounded-md disabled:opacity-50"
          title="Delete message"
        >
          {deleting ? (
            <Loader2 className="w-4 h-4 animate-spin text-red-500" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>
      {/* Which model wrote this answer. Attribution belongs to
          the answer, not to the picker in the composer: the
          model can be switched mid-thread, so reading it off
          the current selection would relabel old answers.
          Always visible — unlike the actions, this is
          information, and hiding it until hover means nobody
          finds it. */}
      {isAssistant && message.metadata?.model && (
        <span className="ml-auto min-w-0 max-w-[50vw] sm:max-w-none truncate font-mono text-[11px] text-muted-foreground/70 whitespace-nowrap">
          Prepared with{' '}
          <span className="text-muted-foreground">
            {prettyModel(message.metadata.model)}
          </span>
        </span>
      )}
    </div>
  );

  // The header of an answer. Where agents worked it is the block's header, with
  // the step count and duration on the right; a plain reply shows it above the text.
  const stepsRight = agentsWorked ? (
    <>
      <span>{formatSteps(stepCount)}</span>
      {elapsed && <span>· {elapsed}</span>}
      <span className="text-success">done</span>
    </>
  ) : undefined;

  const person = personLabel(userName);

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "group",
        animate && "animate-in fade-in slide-in-from-bottom-2 duration-300",
        // The rule is the separator; the padding is breathing room for it.
        isUser && index > 0 && "border-t border-border/70 pt-5 md:pt-6"
      )}
    >
      {isUser && (
        <div className="mb-2 flex items-center gap-2 text-[13px] text-muted-foreground">
          <PersonAvatar initials={person.initials} />
          <span className="font-medium text-foreground truncate">{person.name}</span>
          {time && <span>· {time}</span>}
        </div>
      )}

      {isAssistant && agentsWorked ? (
        <div className="space-y-3">
          <TurnFrame
            header={
              <AssistantHeader
                time={time}
                onReasoned={reasonedToggle}
                right={stepsRight}
              />
            }
          >
            {body}
          </TurnFrame>
        </div>
      ) : isAssistant ? (
        <div className="space-y-2">
          <AssistantHeader time={time} onReasoned={reasonedToggle} />
          {body}
        </div>
      ) : (
        body
      )}

      {actions}
    </div>
  );
}
