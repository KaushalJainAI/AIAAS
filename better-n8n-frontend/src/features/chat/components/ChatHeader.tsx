/**
 * The conversation's own toolbar, one 44px row: history, the conversation's
 * title, the organisation picker for a new chat, the approval level, the
 * run settings (model and effort), and "This chat" (memory, sharing, cost and
 * chat settings, behind one button).
 *
 * It sits under the global Topbar, so it is deliberately a *toolbar*, not a
 * second app bar. It names the conversation rather than the section.
 */
import type { ReactNode } from 'react';
import { ChevronDown, History, Users } from 'lucide-react';

import type { ChatSession } from '@/api';
import type { Org } from '@/api/orgs';
import { AUTONOMY_COPY } from '@/types/agentConfig';
import { cn } from '@/lib/utils';
import type { ChatMode } from '../lib/chatMode';
import { CHAT_APPROVAL_ORDER, approvalSelectClass } from '../lib/approvalTone';
import ThisChatMenu from './ThisChatMenu';

interface ChatHeaderProps {
  isGuest: boolean;
  /** When the history drawer is open its own header has a close button, so ours hides. */
  historyOpen: boolean;
  onOpenHistory: () => void;
  session: ChatSession | null;
  /** The last conversation is still being fetched, so this is not a new one. */
  restoring?: boolean;
  /** "This chat" → Chat settings…: resets the prompt draft to the saved one, then opens the dialog. */
  onEditSettings: () => void;
  /**
   * Saves memory or sharing for this conversation, from "This chat". Absent
   * for guests. The chat page owns the call, the toasts and the state update.
   */
  onSaveSettings?: (patch: Partial<ChatSession>) => void;
  /**
   * The orgs the user belongs to. The org picker for a new conversation shows
   * only when there is at least one; absent or empty, a new chat is simply
   * started in the active org, as before.
   */
  orgs?: Org[];
  /** The org the next conversation starts in: an org id, or null for personal. */
  newChatOrgId?: number | null;
  /** The person picked an org (or Personal) for the conversation they are starting. */
  onNewChatOrgChange?: (orgId: number | null) => void;
  /** The approval level in force for this conversation. */
  mode?: ChatMode;
  /** The person picked an approval level. Guests run one pinned level, so no picker. */
  onModeChange?: (mode: ChatMode) => void;
  /** The run settings control (model and effort), supplied by the page that owns them. */
  runSettings?: ReactNode;
}

export default function ChatHeader({
  isGuest,
  historyOpen,
  onOpenHistory,
  session,
  restoring = false,
  onEditSettings,
  onSaveSettings,
  orgs = [],
  newChatOrgId = null,
  onNewChatOrgChange,
  mode = 'ask',
  onModeChange,
  runSettings,
}: ChatHeaderProps) {
  // The picker is for choosing where a conversation starts, so it is shown
  // only before the conversation exists — after that the org is fixed and the
  // badge below says where it is.
  const showOrgPicker = !isGuest && !session && orgs.length > 0 && !!onNewChatOrgChange;
  const showModePicker = !isGuest && !!onModeChange;
  // A saved conversation shows its title; a new one says so plainly.
  // While the last conversation is still being fetched this is not a new
  // one, and saying so invited a message that then landed in the old thread.
  const title = session?.title?.trim()
    || (restoring ? 'Opening your last conversation…' : 'New conversation');

  return (
    <header className={cn(
      "h-11 shrink-0 flex items-center gap-3 px-3 md:px-5 justify-between border-b border-border bg-background",
      // Guest: the banner band overlays the top — push the header below
      // it instead of stretching it.
      isGuest && "mt-14 md:mt-10"
    )}>
      <div className="flex items-center gap-1.5 min-w-0">
        {!historyOpen && (
          <button
            onClick={onOpenHistory}
            className={toolbarButton}
            aria-label="Conversation history"
            title="Conversation history"
          >
            <History className="h-[16px] w-[16px]" />
          </button>
        )}
        <h2
          className={cn(
            "ml-1 truncate text-sm font-medium",
            // Phones: "New conversation" says nothing the empty page does not,
            // and truncated to "New co…" it only crowds the controls.
            session?.title?.trim() ? "text-foreground" : "text-muted-foreground max-sm:hidden",
          )}
          title={title}
        >
          {title}
        </h2>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 min-w-0 shrink-0">
        {showOrgPicker && (
          <label className="flex h-11 md:h-8 items-center gap-1.5 min-w-0 text-xs text-muted-foreground shrink-0">
            <span className="hidden sm:inline">Chat in</span>
            {/* A soft pill: the icon and chevron are drawn over the select,
                so the browser's own boxy control never shows. */}
            <span className="relative flex items-center min-w-0">
              <Users className="pointer-events-none absolute left-2.5 w-3.5 h-3.5" aria-hidden="true" />
              <select
                value={newChatOrgId ?? ''}
                onChange={(e) => onNewChatOrgChange?.(e.target.value === '' ? null : Number(e.target.value))}
                aria-label="Organisation for this conversation"
                className="h-8 max-w-[7.5rem] sm:max-w-[12rem] appearance-none truncate rounded-full bg-secondary pl-7 pr-6 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <option value="">Personal</option>
                {orgs.map((org) => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 w-3 h-3" aria-hidden="true" />
            </span>
          </label>
        )}
        {/* Phones pick the level in the composer (the coloured chip beside
            "+"), where H-132 put it; the header row has no room for it next
            to the title, the model and "This chat". */}
        {showModePicker && (
          <label
            className="hidden sm:flex items-center gap-1.5 min-w-0 shrink-0 font-mono text-[11px] text-muted-foreground"
            title={`Approval: ${AUTONOMY_COPY[mode].hint}`}
          >
            <span className="hidden sm:inline">Approval</span>
            <select
              value={mode}
              onChange={(e) => onModeChange?.(e.target.value as ChatMode)}
              aria-label="Approval"
              className={cn(
                // 44px on phones; desktop keeps the compact 28px row.
                "h-11 md:h-7 max-w-[8.5rem] sm:max-w-none truncate rounded-md border px-2 font-mono text-[11px] shrink-0",
                approvalSelectClass(mode),
              )}
            >
              {CHAT_APPROVAL_ORDER.map((key) => (
                <option key={key} value={key}>{AUTONOMY_COPY[key].label}</option>
              ))}
            </select>
          </label>
        )}
        {runSettings}
        {/* Memory, sharing, cost and the chat settings live behind one
            button. A dot on it shows when memory is off or the chat shares
            with the team, so that state is never hidden. */}
        {session && (
          <ThisChatMenu
            session={session}
            isGuest={isGuest}
            onSaveSettings={isGuest ? undefined : onSaveSettings}
            onEditSettings={onEditSettings}
          />
        )}
      </div>
    </header>
  );
}

/**
 * A flat icon button, the same shape as the Topbar's, so the bars read as one
 * set. 44px on phones (the header is 44px tall), 32px on desktop.
 */
const toolbarButton =
  'flex h-11 w-11 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground ' +
  'transition-[color,background-color,transform] duration-fast hover:bg-secondary hover:text-foreground active:scale-95';
