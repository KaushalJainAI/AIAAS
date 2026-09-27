/**
 * The conversation list on the left of the chat page.
 *
 * An overlay drawer on phones (with its own backdrop and close button) and an
 * in-flow column on desktop. It only draws the list; loading, starting and
 * deleting conversations are done by `StandaloneChat` through the callbacks.
 */
import type React from 'react';
import { History, Loader2, MessageSquare, Plus, Trash2, X } from 'lucide-react';

import type { ChatSessionSummary } from '../../api/chat';
import { describeCost, formatCost } from '../../lib/cost';
import { cn } from '../../lib/utils';

interface ChatHistorySidebarProps {
  open: boolean;
  onClose: () => void;
  conversations: ChatSessionSummary[];
  /** The conversation on screen, highlighted in the list. */
  activeId: string | undefined;
  /** Conversations with a turn still streaming in the background. */
  runningKeys: string[];
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onDeleteConversation: (e: React.MouseEvent, id: string) => void;
}

export default function ChatHistorySidebar({
  open,
  onClose,
  conversations,
  activeId,
  runningKeys,
  onNewConversation,
  onOpenConversation,
  onDeleteConversation,
}: ChatHistorySidebarProps) {
  return (
    <>
      {open && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50 animate-in fade-in duration-200"
          onClick={onClose}
        />
      )}
      <div
        className={cn(
          "h-full bg-card border-r border-border transition-colors duration-300 ease-in-out flex flex-col overflow-hidden",
          // Mobile: fixed overlay drawer (own backdrop, own close button).
          // Title-bar menu buttons are in-flow, so nothing floats over this
          // header while it is open.
          "fixed md:relative left-0 top-0 z-[70] md:z-30 md:flex-shrink-0",
          open
            ? "w-[85vw] max-w-[320px] md:w-[300px] translate-x-0"
            : "w-0 -translate-x-full md:translate-x-0 md:w-0 md:opacity-0 md:border-none"
        )}
      >
        <div className="w-[85vw] max-w-[320px] md:w-[300px] flex flex-col h-full">
          {/* h-12, the chat toolbar's height, so the two borders meet in one line. */}
          <div className="h-12 px-4 flex items-center justify-between border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold tracking-tight">
                Conversations
              </h2>
            </div>
            <button
              onClick={onClose}
              aria-label="Close conversation history"
              className="p-1.5 hover:bg-secondary rounded-md transition text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 shrink-0">
            <button
              onClick={() => {
                onNewConversation();
                onClose();
              }}
              className="w-full h-9 flex items-center gap-2 px-3 rounded-lg bg-muted/60 hover:bg-accent text-[13px] font-medium transition"
            >
              <Plus className="w-4 h-4 text-muted-foreground" />
              New conversation
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-0.5 custom-scrollbar">
            {Array.isArray(conversations) && conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "w-full px-3 py-2 rounded-lg text-left transition flex items-center gap-2.5 group relative cursor-pointer border",
                  activeId === conv.id
                    ? "bg-primary-subtle border-primary-line"
                    : "border-transparent hover:bg-secondary"
                )}
                // Opening goes through the parent's `loadConversation`, not a
                // second copy of it: an inline copy once claimed the agent was
                // thinking and opened the settings panel against the previous
                // conversation.
                onClick={() => {
                  onClose();
                  onOpenConversation(conv.id);
                }}
              >
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  {/* A conversation still streaming in the background says so
                      here — otherwise leaving it looks like cancelling it. */}
                  {runningKeys.includes(conv.id) ? (
                    <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span
                    className="truncate flex-1 text-[13px] font-normal text-foreground"
                    title={conv.title || conv.id.slice(0, 18)}
                  >
                    {conv.title || conv.id.slice(0, 18)}
                  </span>
                  {runningKeys.includes(conv.id) && activeId !== conv.id && (
                    <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary">
                      working
                    </span>
                  )}
                  {/* Only where there is a real figure. An unpriced or
                      unanswered conversation shows nothing rather than a dash:
                      a column of dashes tells the reader less than blank space. */}
                  {conv.cost_source && conv.cost_source !== 'unpriced' && (
                    <span
                      className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
                      title={describeCost(conv.total_cost_usd, conv.cost_source)}
                    >
                      {formatCost(conv.total_cost_usd, conv.cost_source)}
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => onDeleteConversation(e, conv.id)}
                  aria-label="Delete conversation"
                  className="p-1 hover:bg-destructive-subtle hover:text-destructive rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-colors shrink-0 text-muted-foreground"
                  title="Delete conversation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
