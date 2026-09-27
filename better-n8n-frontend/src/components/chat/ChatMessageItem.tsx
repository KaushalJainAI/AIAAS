/**
 * One saved message in the chat transcript: the question, or the answer with
 * everything that came with it (reasoning, tool activity, code runs, sources,
 * charts, files, command cards) and the row of actions under it.
 *
 * Perplexity-style turn: the question is a heading and the answer is the page
 * under it. No avatars, no bubbles, no alternating sides. The rule between
 * turns is what separates them.
 *
 * It only draws. Every action (copy, delete, rewrite, edit, ...) is handled by
 * `StandaloneChat` through the callbacks below.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowUpFromLine,
  BrainCircuit,
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
  Zap,
} from 'lucide-react';

import type { StandaloneChatMessage as ChatMessage } from '../../api';
import type { ChartSpec, HtmlArtifact as HtmlArtifactData } from '../../api/chat';
import type { MessagePanel } from '../../hooks/useMessagePanels';
import { prettyModel } from '../../lib/modelNames';
import { cn } from '../../lib/utils';
import FileCards from '../files/FileCards';
import FeedbackControl from '../runs/FeedbackControl';
import ChartArtifact from './ChartArtifact';
import { CollapsiblePanel } from './CollapsiblePanel';
import CommandCard from './CommandCard';
import { formatWordCount, stripXmlTags } from './format';
import HtmlArtifact from './HtmlArtifact';
import MarkdownMessage from './MarkdownMessage';
import { MediaPreview } from './MediaPreview';
import PlanSummary from '../plan/PlanSummary';
import { actionsFrom, historyFrom } from '../../lib/planView';

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
  isPanelOpen: (panel: MessagePanel, messageId: number | undefined) => boolean;
  togglePanel: (panel: MessagePanel, messageId: number) => void;
  /** A confirm sheet on a command card is being submitted. */
  confirmBusy: boolean;
  onCopy: () => void;
  onDelete: (messageId: number) => void;
  /** Regenerate from this message (deletes it and what follows). */
  onRewrite: (messageId: number) => void;
  /** Keep this question, delete the answers after it. */
  onRewind: (messageId: number) => void;
  onEdit: (messageId: number, content: string) => void;
  onCommandConfirm: (
    name: string, baseArgs: Record<string, unknown>, confirm: Record<string, unknown>,
  ) => void;
}

export default function ChatMessageItem({
  message,
  index,
  animate,
  deleting,
  copied,
  isPanelOpen,
  togglePanel,
  confirmBusy,
  onCopy,
  onDelete,
  onRewrite,
  onRewind,
  onEdit,
  onCommandConfirm,
}: ChatMessageItemProps) {
  return (
    <div
      data-message-id={message.id}
      className={cn(
        "group",
        animate && "animate-in fade-in slide-in-from-bottom-2 duration-300",
        // The rule is the separator; the padding is breathing
        // room for it. 20px on phones, 24px on desktop — the old
        // 40px stacked with the list rhythm into the ~88px gap.
        message.role === 'user' && index > 0 && "border-t border-border/70 pt-5 md:pt-6"
      )}
    >
      {/* Section label. Violet for the agent, per the token rule
          that colour encodes agency; the user's own question does
          not need one because it reads as the heading. */}
      {message.role === 'assistant' && (
        <div className="flex items-center gap-2 mb-3">
          <BrainCircuit className="w-4 h-4 text-agent" />
          <span className="text-[13px] font-semibold text-foreground">Answer</span>
        </div>
      )}

      <div className="w-full min-w-0 space-y-3">

        {/* A resolved command: the chip, not expanded text. */}
        {(message.metadata as { command?: { name?: string; args?: Record<string, unknown> } })?.command?.name && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex min-h-[28px] items-center rounded-md bg-primary/10 px-2 py-1 font-mono text-[12px] font-bold text-primary">
              /{String((message.metadata as { command?: { name?: string } }).command!.name)}
            </span>
          </div>
        )}

        {/* Query as heading / answer as body. break-words so a
            long URL or token wraps instead of pushing the column
            past the viewport on a phone. */}
        <div className={cn(
          "prose prose-base dark:prose-invert max-w-none ai-chat-prose break-words min-w-0",
          message.role === 'user'
            ? "text-[17px] md:text-[19px] leading-[1.45] font-semibold tracking-[-0.01em] text-foreground"
            : message.role === 'system'
            ? "w-full"
            : "text-[16px] leading-[1.75] text-foreground"
        )}>

          {message.role === 'system' ? (
            <div className="bg-muted p-4 rounded-lg shadow-sm border border-border inline-flex flex-col gap-3 min-w-0 w-full max-w-sm sm:min-w-[300px]">
              <div className="flex items-start gap-3">
                 <div className="w-10 h-10 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
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
                      <span className="micro-label bg-card px-1.5 py-0.5 rounded border border-border">
                        {message.metadata?.file_type || 'File'}
                      </span>
                      {message.metadata?.has_extracted_text && (
                         <span className="text-[11px] font-semibold text-success bg-success-subtle px-1.5 py-0.5 rounded border border-border">
                           Parsed
                         </span>
                      )}
                    </div>
                    <button
                      onClick={() => onDelete(message.id as number)}
                      disabled={deleting}
                      className="absolute right-0 top-0 p-1.5 text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
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
                      className="absolute right-8 top-0 p-1.5 text-muted-foreground/40 hover:text-amber-500 hover:bg-warning-subtle rounded-lg transition-colors disabled:opacity-50"
                      title="Rewind conversation from here (deletes this and following)"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                 </div>
              </div>
              {/* Hide the raw extracted text preview from the user to keep UI clean, but keep the success indication */}
              <div className="text-xs font-medium text-muted-foreground bg-background/50 p-2 rounded-lg border border-border/30">
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
        {/* Quick Summary, Reasoning & Activity Row. Two columns on
            phones (a 140px minimum in a flex row made the third
            chip stretch and collide), a wrapping row on desktop. */}
        {message.role === 'assistant' && (message.metadata?.summary || message.metadata?.thinking || (message.metadata?.tool_trace && (message.metadata?.tool_trace?.length ?? 0) > 0) || message.metadata?.has_code_execution) && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-4 mb-2">
            {message.metadata?.summary && (
              <div className="min-w-0 sm:flex-1 sm:min-w-[140px] group/summary animate-in fade-in slide-in-from-top-2 duration-500">
                <button
                  onClick={() => togglePanel('summary', message.id as number)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border w-full",
                    isPanelOpen('summary', message.id)
                      ? "bg-primary/10 border-primary/30 text-primary shadow-sm" 
                      : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50 hover:border-border/60 hover:text-foreground"
                  )}
                >
                  <FileText className={cn("w-4 h-4", isPanelOpen('summary', message.id) ? "text-primary" : "text-muted-foreground/70")} />
                  <span className="text-[12px] font-bold">Summary</span>
                  <div className="flex-1" />
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", isPanelOpen('summary', message.id) && "rotate-180")} />
                </button>
              </div>
            )}

            {message.metadata?.thinking && (
              <div className="min-w-0 sm:flex-1 sm:min-w-[140px] group/thinking animate-in fade-in slide-in-from-top-2 duration-500">
                <button
                  onClick={() => togglePanel('thinking', message.id as number)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border w-full",
                    isPanelOpen('thinking', message.id)
                      ? "bg-primary/10 border-primary/30 text-primary shadow-sm" 
                      : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50 hover:border-border/60 hover:text-foreground"
                  )}
                >
                  <BrainCircuit className={cn("w-4 h-4", isPanelOpen('thinking', message.id) ? "text-primary" : "text-muted-foreground/70")} />
                  <span className="text-[12px] font-bold">Reasoning</span>
                  {/* Length hint: without it there is no way to
                      tell a one-line thought from six paragraphs
                      before committing to opening it. */}
                  <span className="text-[10px] font-medium tabular-nums opacity-50">
                    {formatWordCount(message.metadata.thinking)}
                  </span>
                  <div className="flex-1" />
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", isPanelOpen('thinking', message.id) && "rotate-180")} />
                </button>
              </div>
            )}
            {message.metadata?.tool_trace && (message.metadata?.tool_trace?.length ?? 0) > 0 && (
              <div className="min-w-0 sm:flex-1 sm:min-w-[140px] group/activity animate-in fade-in slide-in-from-top-2 duration-500">
                <button
                  onClick={() => togglePanel('activity', message.id as number)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border w-full",
                    isPanelOpen('activity', message.id)
                      ? "bg-warning-subtle border-border text-amber-600 shadow-sm" 
                      : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50 hover:border-border/60 hover:text-foreground"
                  )}
                >
                  <Zap className={cn("w-4 h-4", isPanelOpen('activity', message.id) ? "text-amber-600" : "text-muted-foreground/70")} />
                  <span className="text-[12px] font-bold">Activity</span>
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
                    "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors border w-full",
                    isPanelOpen('code', message.id)
                      ? "bg-success-subtle border-emerald-500/30 text-emerald-600 shadow-sm" 
                      : "bg-muted/30 border-border/40 text-muted-foreground hover:bg-muted/50 hover:border-border/60 hover:text-foreground"
                  )}
                >
                  <Code className={cn("w-4 h-4", isPanelOpen('code', message.id) ? "text-emerald-600" : "text-muted-foreground/70")} />
                  <span className="text-[12px] font-bold">Code</span>
                  <div className="flex-1" />
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", isPanelOpen('code', message.id) && "rotate-180")} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Expanded Summary Content */}
        {message.role === 'assistant' && message.metadata?.summary && (
          <CollapsiblePanel open={isPanelOpen('summary', message.id)}>
          <div className="mt-2 p-4 bg-card border border-border rounded-lg shadow-sm relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />
            {/* Model-written summary — markdown via the shared renderer. */}
            <div className="text-[14px] text-foreground leading-relaxed italic">
              <MarkdownMessage content={message.metadata.summary} variant="compact" />
            </div>
          </div>
          </CollapsiblePanel>
        )}

        {/* Expanded Thinking Content */}
        {message.role === 'assistant' && message.metadata?.thinking && (
          <CollapsiblePanel open={isPanelOpen('thinking', message.id)}>
          <div className="mt-2 overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-2">
              <BrainCircuit className="h-3 w-3 text-muted-foreground" />
              <span className="micro-label">
                How the assistant got here
              </span>
            </div>
            {/* Capped and scrollable: an unbounded trace can run
                longer than the answer it explains, pushing the
                actual reply off screen. */}
            <div className="max-h-[420px] overflow-y-auto p-4">
              <div className="prose prose-sm prose-invert max-w-none text-[14px] leading-relaxed text-muted-foreground italic select-text">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.metadata.thinking}
                </ReactMarkdown>
              </div>
            </div>
          </div>
          </CollapsiblePanel>
        )}

        {/* No placeholder when reasoning is absent. A greeting has
            no chain of thought to show, so a dashed "not fully
            captured" box was reporting a fault on every trivial
            reply and taking up a row under it. Reasoning that does
            arrive gets its own toggle above; silence here is the
            honest rendering of nothing to report. */}

        {/* Tool Activity Trace — shows which tools the agent called */}
        {message.role === 'assistant' && message.metadata?.tool_trace && (message.metadata?.tool_trace?.length ?? 0) > 0 && (
          <CollapsiblePanel open={isPanelOpen('activity', message.id)}>
          <div className="mt-2 p-4 bg-warning-subtle border border-border rounded-lg">
            <div className="flex items-center gap-3 px-1 mb-3">
              <Zap className="w-3.5 h-3.5 text-warning" />
              <span className="micro-label">Agent activity log</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-1">
              {(message.metadata?.tool_trace ?? []).map((trace, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-1.5 py-2 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-3 text-[14px] text-muted-foreground">
                    <span className="flex items-center justify-center w-6 h-6 rounded-md bg-muted text-[11px] font-semibold text-muted-foreground shrink-0 border border-border">
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
        {message.role === 'assistant' && message.metadata?.code_executions && (message.metadata?.code_executions?.length ?? 0) > 0 && (
          <CollapsiblePanel open={isPanelOpen('code', message.id)}>
          <div className="mt-2 p-4 bg-card border border-border rounded-lg">
            <div className="flex items-center gap-3 px-1 mb-3">
              <Code className="w-3.5 h-3.5 text-success" />
              <span className="micro-label">Secure sandbox code</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-4">
              {(message.metadata?.code_executions ?? []).map((exec, i) => (
                <div key={i} className="space-y-2 border-b border-border last:border-0 pb-4 last:pb-0">
                  <div className="flex items-center gap-2">
                     <span className="micro-label">Execution #{exec.iteration || i+1}</span>
                     <div className="h-px flex-1 bg-border" />
                  </div>
                  <div className="rounded-lg overflow-hidden border border-border bg-muted shadow-sm">
                     <div className="px-3 py-1.5 bg-muted flex items-center justify-between border-b border-border">
                        <span className="micro-label">Input code</span>
                     </div>
                     <pre className="p-4 text-[13px] overflow-x-auto text-zinc-300 font-mono leading-relaxed bg-zinc-950">
                        <code>{exec.code}</code>
                     </pre>
                  </div>
                  {(exec.output || exec.result) && (
                     <div className="rounded-lg overflow-hidden border border-border bg-card shadow-sm">
                        <div className="px-3 py-1.5 bg-zinc-900/50 flex items-center justify-between border-b border-white/5">
                           <span className="text-[9px] font-bold text-zinc-500 ">Execution output</span>
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
        {message.role === 'assistant' && ((message.metadata?.sources?.length ?? 0) > 0 || (message.metadata?.images?.length ?? 0) > 0 || (message.metadata?.videos?.length ?? 0) > 0) && (
          <div className="mt-4 md:mt-5 flex flex-wrap gap-2">
            {(message.metadata?.sources?.length ?? 0) > 0 && (
              <button
                onClick={() => togglePanel('sources', message.id as number)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors border group",
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
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors border group",
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
                  "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors border group",
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
        {message.role === 'assistant' && (message.metadata?.sources?.length ?? 0) > 0 && (
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

        {message.role === 'assistant' && (message.metadata?.images?.length ?? 0) > 0 && (
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

        {message.role === 'assistant' && (message.metadata?.videos?.length ?? 0) > 0 && (
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


        {/* The plan the turn worked to, kept as a record of what
            it set out to do and what it could not finish. */}
        {Array.isArray(message.metadata?.todos) &&
          (message.metadata?.todos ?? []).length > 0 && (
            <PlanSummary
              history={historyFrom(message.metadata?.todo_history, message.metadata?.todos)}
              actions={actionsFrom(message.metadata?.tool_trace)}
            />
          )}

        {/* Files the turn saved, linked by id rather than by
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


        {/* Both roles now start at the same left edge, so the
            actions do too. The old `justify-end` belonged to the
            right-aligned user bubble and would strand these
            controls on the far side of the column. */}
        {message.role !== 'system' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-1 -ml-1.5">
          {/* Always visible on touch (no hover there); larger
              hit targets on phones. Without this the row was an
              invisible strip of touch targets beside the model
              label on mobile. */}
          <div className="flex items-center gap-1 sm:gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity duration-300">
            <button
              onClick={onCopy}
              className="text-muted-foreground hover:text-primary transition-colors p-2 md:p-1.5 hover:bg-primary/5 rounded-lg"
              title="Copy message"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
            {message.role !== 'user' && (
              <button
                onClick={() => onRewrite(message.id as number)}
                disabled={deleting}
                className="text-muted-foreground hover:text-amber-500 transition-colors p-2 md:p-1.5 hover:bg-warning-subtle rounded-lg disabled:opacity-50"
                title="Rewrite prompt (regenerates response without subsequent context)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {message.role === 'assistant' && typeof message.id === 'number' && (
              <FeedbackControl
                target="message"
                id={message.id}
                initial={(message as { feedback?: { rating: number; reason: string; comment: string } | null }).feedback ?? null}
              />
            )}
            {message.role === 'user' && (
              <button
                onClick={() => onRewind(message.id as number)}
                disabled={deleting}
                className="text-muted-foreground hover:text-emerald-500 transition-colors p-2 md:p-1.5 hover:bg-success-subtle rounded-lg disabled:opacity-50"
                title="Reverse context (keep this message, delete answers)"
              >
                <ArrowUpFromLine className="w-4 h-4" />
              </button>
            )}
            {message.role === 'user' && (
              <button
                onClick={() => onEdit(message.id as number, message.content)}
                disabled={deleting}
                className="text-muted-foreground hover:text-blue-500 transition-colors p-2 md:p-1.5 hover:bg-blue-500/10 rounded-lg disabled:opacity-50"
                title="Edit and resend message"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => onDelete(message.id as number)}
              disabled={deleting}
              className="text-muted-foreground hover:text-red-500 transition-colors p-2 md:p-1.5 hover:bg-red-500/10 rounded-lg disabled:opacity-50"
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
          {message.role === 'assistant' && message.metadata?.model && (
            <span className="ml-auto min-w-0 max-w-[50vw] sm:max-w-none truncate text-[11px] text-muted-foreground/70 whitespace-nowrap">
              Prepared with{' '}
              <span className="text-muted-foreground">
                {prettyModel(message.metadata.model)}
              </span>
            </span>
          )}
          </div>
        )}
      </div>
    </div>
  );
}
