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
import { BrainCircuit, Coins, History, Lock, Settings2, Shield, Users } from 'lucide-react';

import type { ChatSession } from '../../api';
import type { Org } from '../../api/orgs';
import { costQualifier, describeConversationCost, formatCost } from '../../lib/cost';
import { cn } from '../../lib/utils';
import SidebarMenuButton from '../layout/SidebarMenuButton';

interface ChatHeaderProps {
  isGuest: boolean;
  /** When the history drawer is open its own header has a close button, so ours hides. */
  historyOpen: boolean;
  onOpenHistory: () => void;
  session: ChatSession | null;
  /** The last conversation is still being fetched, so this is not a new one. */
  restoring?: boolean;
  /** The "Memory off" chip: opens the settings dialog as it is. */
  onShowSettings: () => void;
  /** The gear button: resets the prompt draft to the saved one, then opens the dialog. */
  onEditSettings: () => void;
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
}

export default function ChatHeader({
  isGuest,
  historyOpen,
  onOpenHistory,
  session,
  restoring = false,
  onShowSettings,
  onEditSettings,
  orgs = [],
  newChatOrgId = null,
  onNewChatOrgChange,
}: ChatHeaderProps) {
  // The picker is for choosing where a conversation starts, so it is shown
  // only before the conversation exists — after that the org is fixed and the
  // badge below says where it is.
  const showOrgPicker = !isGuest && !session && orgs.length > 0 && !!onNewChatOrgChange;
  // A saved conversation shows its title; a new one says so plainly. The
  // "Assistant online" pill this replaces was always green — it checked
  // nothing, so it said nothing.
  // While the last conversation is still being fetched this is not a new
  // one, and saying so invited a message that then landed in the old thread.
  const title = session?.title?.trim()
    || (restoring ? 'Opening your last conversation…' : 'New conversation');

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
         {showOrgPicker && (
           <label className="flex items-center gap-1.5 min-w-0 text-[11px] font-semibold text-muted-foreground shrink-0">
             <Users className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
             <span className="hidden sm:inline">Chat in</span>
             <select
               value={newChatOrgId ?? ''}
               onChange={(e) => onNewChatOrgChange?.(e.target.value === '' ? null : Number(e.target.value))}
               aria-label="Organisation for this conversation"
               className="max-w-[9rem] sm:max-w-[12rem] truncate rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-foreground"
             >
               <option value="">Personal</option>
               {orgs.map((org) => (
                 <option key={org.id} value={org.id}>{org.name}</option>
               ))}
             </select>
           </label>
         )}
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
         {/* Which organisation this chat belongs to, and whether its fixes
             reach it. Visible because it is a sharing decision, and a hidden
             one is how someone shares what they meant to keep. On phones
             there is no room for the words, so it is the icon alone, and the
             organisation's name is in its title and aria-label on every width. */}
         {!isGuest && session?.org && (() => {
           const orgName = session.org_name ?? 'your organisation';
           const label = session.share_solutions
             ? `Solutions from this chat are shared with ${orgName}`
             : `Solutions from this chat stay private, in ${orgName}`;
           return (
             <button
               onClick={onShowSettings}
               title={`${label} — click to change`}
               aria-label={label}
               className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full border border-border
                          text-[11px] font-semibold text-muted-foreground hover:bg-secondary shrink-0"
             >
               {session.share_solutions ? <Users className="w-3.5 h-3.5" aria-hidden="true" /> : <Lock className="w-3.5 h-3.5" aria-hidden="true" />}
               <span className="hidden sm:inline">
                 {session.share_solutions ? `Sharing with ${orgName}` : 'Private'}
               </span>
             </button>
           );
         })()}
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
