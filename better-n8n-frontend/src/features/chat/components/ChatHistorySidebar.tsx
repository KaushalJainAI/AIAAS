/**
 * The conversation list on the left of the chat page.
 *
 * An overlay drawer on phones (with its own backdrop and close button) and an
 * in-flow column on desktop. It only draws the list; loading, starting and
 * deleting conversations are done by `StandaloneChat` through the callbacks.
 *
 * When the server says what each conversation is doing (`run_state`), the list
 * is grouped: waiting for you first, then running, then everything else. Older
 * payloads carry no run state and get the plain list they always had.
 */
import { useRef, useState } from 'react';
import type React from 'react';
import {
  History,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import type { ChatSessionSummary } from '@/api/chat';
import { IconButton } from '@/components/ui/IconButton';
import { describeCost, formatCost } from '@/lib/cost';
import { cn } from '@/lib/utils';
import {
  displayTitle,
  filterByTitle,
  groupByDay,
  TITLE_MAX_LENGTH,
} from '../lib/historyGroups';

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
  /** Asks for a delete. The parent confirms before anything is removed. */
  onDeleteConversation: (e: React.MouseEvent, id: string) => void;
  /** Saves a new title. Only ever called with a trimmed, non-empty, changed title. */
  onRenameConversation: (id: string, title: string) => void;
}

/** On phones the drawer is above the page, so it folds before a dialog opens. */
function isPhone(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 767px)').matches;
}

type Group = 'waiting' | 'running' | 'finished';

const GROUP_LABELS: Record<Group, string> = {
  waiting: 'Waiting for you',
  running: 'Running',
  finished: 'Finished',
};

/**
 * Which group a conversation sits in. A conversation still streaming in this
 * tab counts as running even before the server's list catches up.
 */
function groupOf(conv: ChatSessionSummary, runningKeys: string[]): Group {
  if (conv.run_state === 'waiting') return 'waiting';
  if (conv.run_state === 'running' || runningKeys.includes(conv.id)) return 'running';
  return 'finished';
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
  onRenameConversation,
}: ChatHistorySidebarProps) {
  const [query, setQuery] = useState('');
  /** The row whose More panel is open, if any. */
  const [menuId, setMenuId] = useState<string | null>(null);
  /** The row being renamed, and the title typed so far. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // A rename ends once. Enter, Escape and the blur that follows the input's
  // removal must not each save or cancel it again.
  const editSettled = useRef(false);

  const list = Array.isArray(conversations) ? conversations : [];
  const visible = filterByTitle(list, query);
  const now = new Date();
  // Headings only when the server says what each conversation is doing. A list
  // without run state keeps its own order, as it did before; a conversation
  // streaming here still shows "working" in place.
  const grouped = list.some((c) => c.run_state !== undefined);
  const sections: { group: Group; items: ChatSessionSummary[] }[] = grouped
    ? (['waiting', 'running', 'finished'] as Group[]).map((group) => ({
        group,
        items: visible.filter((c) => groupOf(c, runningKeys) === group),
      })).filter((s) => s.items.length > 0)
    : [{ group: 'finished', items: visible }];

  const startRename = (conv: ChatSessionSummary) => {
    editSettled.current = false;
    setDraft(displayTitle(conv));
    setEditingId(conv.id);
    setMenuId(null);
  };

  /** Saves the draft when `save` and it is a real change; always leaves edit mode. */
  const finishRename = (conv: ChatSessionSummary, save: boolean) => {
    if (editSettled.current) return;
    editSettled.current = true;
    setEditingId(null);
    const next = draft.trim();
    if (save && next && next !== displayTitle(conv)) {
      onRenameConversation(conv.id, next);
    }
  };

  const askDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setMenuId(null);
    // The drawer covers the page on phones and the confirm sits under it, so it folds first.
    if (isPhone()) onClose();
    onDeleteConversation(e, id);
  };

  const renderRow = (conv: ChatSessionSummary) => {
    const title = displayTitle(conv);

    if (editingId === conv.id) {
      return (
        <div
          key={conv.id}
          className="px-2 py-1.5 rounded-md border border-primary-line bg-primary-subtle"
        >
          <input
            autoFocus
            type="text"
            value={draft}
            maxLength={TITLE_MAX_LENGTH}
            aria-label="Conversation title"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finishRename(conv, true);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                finishRename(conv, false);
              }
            }}
            onBlur={() => finishRename(conv, true)}
            className="w-full h-11 md:h-8 px-2.5 rounded-md bg-background border border-border text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      );
    }

    const running = runningKeys.includes(conv.id);
    const menuOpen = menuId === conv.id;

    return (
      <div key={conv.id} className="group relative">
        <div
          className={cn(
            "flex items-stretch rounded-md border transition",
            activeId === conv.id
              ? "bg-primary-subtle border-primary-line"
              : "border-transparent hover:bg-secondary"
          )}
        >
          {/* Opening goes through the parent's `loadConversation`, not a
              second copy of it: an inline copy once claimed the agent was
              thinking and opened the settings panel against the previous
              conversation. */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenConversation(conv.id);
            }}
            className="flex-1 min-w-0 min-h-11 md:min-h-0 px-3 py-2 flex items-center gap-2.5 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* A conversation still streaming in the background says so
                here — otherwise leaving it looks like cancelling it. */}
            {running ? (
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <span
              className="truncate flex-1 text-[13px] font-normal text-foreground"
              title={title}
            >
              {title}
            </span>
            {conv.last_agent && (
              <span
                className="shrink-0 max-w-[6rem] truncate rounded bg-agent-subtle px-1.5 py-0.5 font-mono text-[10px] text-agent"
                title={`Last worked on by ${conv.last_agent}`}
              >
                {conv.last_agent}
              </span>
            )}
            {running && activeId !== conv.id && (
              <span className="shrink-0 font-mono text-[11px] text-primary">
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
          </button>
          {/* Always on a phone; on desktop it shows on hover, and on keyboard
              focus, so nothing needs a mouse to reach it. */}
          <IconButton
            label={`More actions for ${title}`}
            aria-expanded={menuOpen}
            onClick={() => setMenuId(menuOpen ? null : conv.id)}
            className={cn(
              "h-11 w-11 md:h-7 md:w-7 mr-0.5 self-center shrink-0 flex items-center justify-center",
              "md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100",
              menuOpen && "md:opacity-100 bg-secondary text-foreground"
            )}
          >
            <MoreHorizontal className="w-4 h-4" />
          </IconButton>
        </div>
        {menuOpen && (
          <div
            role="group"
            aria-label={`Actions for ${title}`}
            className="flex gap-2 px-2 pt-1 pb-1.5"
          >
            <button
              type="button"
              onClick={() => startRename(conv)}
              className="flex-1 min-h-11 md:min-h-8 flex items-center justify-center gap-2 px-3 rounded-md border border-border bg-card text-[13px] hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil className="w-3.5 h-3.5" />
              Rename
            </button>
            <button
              type="button"
              onClick={(e) => askDelete(e, conv.id)}
              aria-label="Delete conversation"
              className="flex-1 min-h-11 md:min-h-8 flex items-center justify-center gap-2 px-3 rounded-md border border-border bg-card text-[13px] text-destructive hover:bg-destructive-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>
    );
  };

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
            // `invisible` when closed: at w-0 the list is clipped but still in
            // the tab order, so a keyboard user could Tab into a drawer they
            // cannot see.
            : "invisible w-0 -translate-x-full md:translate-x-0 md:w-0 md:opacity-0 md:border-none"
        )}
      >
        <div className="w-[85vw] max-w-[320px] md:w-[300px] flex flex-col h-full">
          {/* h-11, the chat toolbar's height, so the two borders meet in one line. */}
          <div className="h-11 px-4 flex items-center justify-between border-b border-border shrink-0">
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
              className="w-full h-9 flex items-center gap-2 px-3 rounded-md bg-muted/60 hover:bg-accent text-[13px] font-medium transition"
            >
              <Plus className="w-4 h-4 text-muted-foreground" />
              New conversation
            </button>
          </div>

          {list.length > 0 && (
            <div className="px-3 pb-2 shrink-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search titles"
                  aria-label="Search conversations"
                  className="w-full h-11 md:h-8 pl-8 pr-3 rounded-md bg-background border border-border text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-2 pb-4 custom-scrollbar">
            {list.length > 0 && visible.length === 0 && (
              <p className="px-3 py-2 text-[13px] text-muted-foreground">
                No conversation matches
              </p>
            )}
            {sections.map((section) => (
              <div key={section.group} className="space-y-0.5 pb-2">
                {grouped && (
                  <h3 className="label-mono px-3 pt-2 pb-1">
                    {GROUP_LABELS[section.group]}
                  </h3>
                )}
                {section.group === 'finished'
                  ? groupByDay(section.items, now).map((day) => (
                      <div key={day.label} className="space-y-0.5">
                        <h4 className="label-mono px-3 pt-2 pb-1">{day.label}</h4>
                        {day.items.map(renderRow)}
                      </div>
                    ))
                  : section.items.map(renderRow)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
