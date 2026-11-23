/**
 * "This chat": the one place for what is true of this conversation. It holds
 * the memory switch, sharing with the organisation (when the chat is in one),
 * what it has cost so far, the encryption note, and the way into the full
 * chat settings.
 *
 * The header used to show each of these as its own chip. They are rare
 * settings, so they live behind one button; the button shows a dot while
 * memory is off or the chat shares with the team, so that state stays visible.
 */
import { useState } from 'react';
import { Settings2, Shield } from 'lucide-react';

import type { ChatSession } from '@/api';
import { useCountUp } from '@/hooks/useCountUp';
import { costQualifier, describeConversationCost, formatCost, type MaybeCostSource } from '@/lib/cost';
import { cn } from '@/lib/utils';
import PopMenu, { PopMenuItem } from './PopMenu';

interface ThisChatMenuProps {
  session: ChatSession;
  isGuest: boolean;
  /**
   * Saves one setting on this conversation (memory or sharing). Absent for
   * guests, who have neither. The chat page owns the call and its toasts.
   */
  onSaveSettings?: (patch: Partial<ChatSession>) => void;
  /** Opens the full chat settings, with the prompt draft reset to the saved one. */
  onEditSettings: () => void;
}

export default function ThisChatMenu({ session, isGuest, onSaveSettings, onEditSettings }: ThisChatMenuProps) {
  const [open, setOpen] = useState(false);
  const orgName = session.org_name ?? 'your organisation';
  const hasOrg = Boolean(session.org);
  const memoryOff = !isGuest && !session.memory_enabled;
  const sharing = hasOrg && Boolean(session.share_solutions);
  const priced = Boolean(session.cost_source && session.cost_source !== 'unpriced');

  const stateNote = [
    memoryOff ? 'memory is off' : '',
    sharing ? `shared with ${orgName}` : '',
  ].filter(Boolean).join(' · ');

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-label="This chat"
      aria-expanded={open}
      title={stateNote ? `This chat — ${stateNote}` : 'This chat'}
      className={cn(
        // 44px on phones (the header is 44px tall), 32px on desktop.
        'relative flex h-11 w-11 md:h-8 md:w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground',
        'transition-[color,background-color,transform] duration-fast hover:bg-secondary hover:text-foreground active:scale-95',
      )}
    >
      <Settings2 className="h-[16px] w-[16px]" aria-hidden="true" />
      {(memoryOff || sharing) && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute right-2 top-2 h-2 w-2 rounded-full ring-2 ring-background',
            memoryOff ? 'bg-warning' : 'bg-primary',
          )}
        />
      )}
    </button>
  );

  return (
    <PopMenu label="Options for this chat" open={open} onOpenChange={setOpen} trigger={trigger}>
      {!isGuest && onSaveSettings && (
        <SwitchRow
          label="Memory"
          description={session.memory_enabled
            ? 'The assistant remembers earlier turns here.'
            : 'Earlier turns are not remembered.'}
          on={Boolean(session.memory_enabled)}
          onToggle={() => onSaveSettings({ memory_enabled: !session.memory_enabled })}
        />
      )}
      {hasOrg && onSaveSettings && (
        <SwitchRow
          label={`Share solutions with ${orgName}`}
          description={sharing
            ? 'Fixes from this chat go to the team.'
            : 'Fixes from this chat stay private.'}
          on={sharing}
          onToggle={() => onSaveSettings({ share_solutions: !session.share_solutions })}
        />
      )}
      <div className="flex min-h-11 items-center justify-between gap-3 px-3 text-[13px] md:min-h-8 md:text-[12px]">
        <span className="text-muted-foreground">Cost so far</span>
        <CostFigure
          usd={session.total_cost_usd}
          source={session.cost_source}
          title={priced
            ? describeConversationCost(
              session.total_cost_usd, session.cost_source,
              session.total_tokens_used ?? 0, session.paid_by ?? '',
            )
            : undefined}
        />
      </div>
      <p className="flex items-start gap-2 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Sent over an encrypted connection. Your API keys are encrypted at rest.
      </p>
      <div className="my-1 border-t border-border" />
      <PopMenuItem onClick={() => { setOpen(false); onEditSettings(); }}>
        <Settings2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Chat settings…
      </PopMenuItem>
    </PopMenu>
  );
}

/**
 * The conversation's cost. Its own component so the count-up re-renders only
 * this figure, not the menu or the header (H-095).
 */
function CostFigure({
  usd,
  source,
  title,
}: {
  usd: string;
  source: MaybeCostSource;
  title?: string;
}) {
  const priced = Boolean(source && source !== 'unpriced');
  const value = parseFloat(usd);
  const shown = useCountUp(priced && Number.isFinite(value) ? value : 0);
  return (
    <span className="font-mono tabular-nums text-foreground" title={title}>
      {priced
        ? `${formatCost(shown, source)} ${costQualifier(source)}`.trim()
        : 'Not known yet'}
    </span>
  );
}

/** A setting you switch on or off. A button with role "switch", so screen readers say its state. */
function SwitchRow({
  label,
  description,
  on,
  onToggle,
}: {
  label: string;
  description: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-secondary md:min-h-8 md:py-1.5"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-foreground md:text-[12px]">{label}</span>
        <span className="block text-[12px] leading-snug text-muted-foreground">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200',
          on ? 'bg-primary' : 'bg-muted-foreground/30',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform duration-200',
            on ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}
