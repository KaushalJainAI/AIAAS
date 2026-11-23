/**
 * The phone composer's "+" sheet. Below `sm` the composer keeps only the
 * message box, the mic and send; the rest of its tools live here as 44px rows:
 * attach a file, slash commands, and the two web toggles with their on/off
 * state. On desktop the same tools stay in the composer row and this sheet is
 * never opened (its trigger is `sm:hidden`).
 */
import { Check, Globe2, Paperclip, Search, Slash } from 'lucide-react';

import { Modal } from '@/components/ui/Modal';
import { AUTONOMY_COPY } from '@/types/agentConfig';
import { CHAT_APPROVAL_ORDER } from '../lib/approvalTone';
import type { ChatMode } from '../lib/chatMode';
import { PopMenuItem } from './PopMenu';

interface ComposerMoreSheetProps {
  onClose: () => void;
  onAttach: () => void;
  onCommands: () => void;
  /** Commands are unavailable while a turn runs. */
  commandsDisabled: boolean;
  searchOn: boolean;
  onToggleSearch: () => void;
  researchOn: boolean;
  onToggleResearch: () => void;
  /** The chat's approval level. Phones pick it here; the header select is desktop-only. */
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
}

export default function ComposerMoreSheet({
  onClose,
  onAttach,
  onCommands,
  commandsDisabled,
  searchOn,
  onToggleSearch,
  researchOn,
  onToggleResearch,
  mode,
  onModeChange,
}: ComposerMoreSheetProps) {
  return (
    <Modal size="sm" label="More options" onClose={onClose}>
      <div className="p-2 space-y-0.5">
        {mode && onModeChange && (
          <div role="radiogroup" aria-label="Approval" className="pb-2 mb-1 border-b border-border">
            <p className="px-3 pt-1 pb-1 text-[12px] font-medium text-muted-foreground">Approval</p>
            {CHAT_APPROVAL_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={mode === key}
                onClick={() => { onModeChange(key); onClose(); }}
                className="flex min-h-11 w-full items-start gap-2.5 rounded-md px-3 py-2 text-left hover:bg-secondary"
              >
                <Check
                  className={`mt-0.5 h-4 w-4 shrink-0 ${mode === key ? 'text-primary' : 'invisible'}`}
                  aria-hidden="true"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] text-foreground">{AUTONOMY_COPY[key].label}</span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">{AUTONOMY_COPY[key].hint}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <PopMenuItem onClick={() => { onClose(); onAttach(); }}>
          <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
          Attach a file
        </PopMenuItem>
        <PopMenuItem onClick={() => { onClose(); onCommands(); }} disabled={commandsDisabled}>
          <Slash className="h-4 w-4 shrink-0" aria-hidden="true" />
          Commands
        </PopMenuItem>
        <PopMenuItem onClick={onToggleSearch}>
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Search the web</span>
          <span className="font-mono text-[12px] text-muted-foreground">{searchOn ? 'On' : 'Off'}</span>
        </PopMenuItem>
        <PopMenuItem onClick={onToggleResearch}>
          <Globe2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">Deep research</span>
          <span className="font-mono text-[12px] text-muted-foreground">{researchOn ? 'On' : 'Off'}</span>
        </PopMenuItem>
        <p className="px-3 pb-1 pt-2 text-[12px] leading-relaxed text-muted-foreground">
          Search and Deep research stay on until you turn them off or start a new chat.
        </p>
      </div>
    </Modal>
  );
}
