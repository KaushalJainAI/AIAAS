/**
 * The conversation's own toolbar: history, the conversation's title, the
 * memory-off warning, the running cost, and chat settings.
 *
 * It sits under the global Topbar, so it is deliberately a *toolbar*, not a
 * second app bar: 48px (the history drawer's header is the same height, so
 * their borders meet in one line), the canvas colour rather than the Topbar's
 * card colour, and the Topbar's flat 36px icon buttons. It names the
 * conversation rather than the section — the Topbar already says "Ask".
 */
import { BrainCircuit, Coins, History, Settings2, Shield } from 'lucide-react';

import type { ChatSession } from '../../api';
import { costQualifier, describeConversationCost, formatCost } from '../../lib/cost';
import { cn } from '../../lib/utils';
import SidebarMenuButton from '../layout/SidebarMenuButton';

interface ChatHeaderProps {
  isGuest: boolean;
  /** When the history drawer is open its own header has a close button, so ours hides. */
  historyOpen: boolean;
  onOpenHistory: () => void;
  session: ChatSession | null;
  /** The "Memory off" chip: opens the settings dialog as it is. */
  onShowSettings: () => void;
  /** The gear button: resets the prompt draft to the saved one, then opens the dialog. */
  onEditSettings: () => void;
}

export default function ChatHeader({
  isGuest,
  historyOpen,
  onOpenHistory,
  session,
  onShowSettings,
  onEditSettings,
}: ChatHeaderProps) {
  // A saved conversation shows its title; a new one says so plainly. The
  // "Assistant online" pill this replaces was always green — it checked
  // nothing, so it said nothing.
  const title = session?.title?.trim() || 'New conversation';

  return (
    <header className={cn(
      "h-12 shrink-0 flex items-center gap-3 px-3 md:px-6 justify-between border-b border-border bg-background",
      // Guest: the banner band overlays the top — push the header below
      // it instead of stretching it.
      isGuest && "mt-14 md:mt-10"
    )}>
      <div className="flex items-center gap-1.5 min-w-0">
        {!isGuest && <SidebarMenuButton />}
        {!historyOpen && (
          <button
            onClick={onOpenHistory}
            className={toolbarButton}
            aria-label="Conversation history"
            title="Conversation history"
          >
            <History className="h-[18px] w-[18px]" />
          </button>
        )}
        <h2
          className={cn(
            "ml-1 truncate text-sm font-medium",
            session?.title?.trim() ? "text-foreground" : "text-muted-foreground",
          )}
          title={title}
        >
          {title}
        </h2>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 min-w-0 shrink-0">
         {/* Memory state is shown in the header, not buried in the panel:
             with it off the assistant behaves very differently, and a user
             who forgot they switched it off reads that as the model being
             broken. */}
         {!isGuest && session && !session.memory_enabled && (
           <button
             onClick={onShowSettings}
             title="Memory is off for this chat — click to change"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-500/40
                         bg-warning-subtle text-[11px] font-semibold text-amber-500
                         transition-colors duration-200 hover:bg-amber-500/20
                         animate-in fade-in slide-in-from-right-2 shrink-0"
           >
             <BrainCircuit className="w-3.5 h-3.5" />
             Memory off
           </button>
         )}
         {/* What this conversation has cost so far. In the header, not the
             settings panel, so it is noticed while the conversation is still
             growing. Hidden until there is a figure: "—" on every new chat
             would be noise. */}
         {session && session.cost_source
           && session.cost_source !== 'unpriced' && (
            <div
              className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground tabular-nums shrink-0"
              title={describeConversationCost(
                session.total_cost_usd, session.cost_source,
                session.total_tokens_used ?? 0,
                session.paid_by ?? '',
              )}
            >
              <Coins className="w-3.5 h-3.5" />
              {formatCost(session.total_cost_usd, session.cost_source)}
              {/* Never a bare figure: whether it was charged or estimated
                  is half of what the number means. The qualifier hides on
                  phones where the header is crowded. */}
              <span className="hidden sm:inline font-normal opacity-80">
                {costQualifier(session.cost_source)}
              </span>
            </div>
         )}
         <div
           className="hidden lg:flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground"
           title="Sent over an encrypted connection; your API keys are encrypted at rest"
         >
            <Shield className="w-3.5 h-3.5" />
            Encrypted
         </div>
         {session && (
           <button
             onClick={onEditSettings}
             title="Chat settings"
             aria-label="Chat settings"
             className={toolbarButton}
           >
             <Settings2 className="h-[18px] w-[18px]" />
           </button>
         )}
      </div>
    </header>
  );
}

/** The Topbar's icon-button shape (bell, avatar), so the two bars read as one set. */
const toolbarButton =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground ' +
  'transition-colors hover:bg-secondary hover:text-foreground active:scale-95';
