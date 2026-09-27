/**
 * Per-chat settings: the conversation's system prompt and its memory switch.
 *
 * The prompt is edited as a draft owned by the parent and saved only on Save.
 * The memory switch saves straight away.
 */
import type React from 'react';
import { Loader2, X } from 'lucide-react';

import type { ChatSession } from '../../api';
import { cn } from '../../lib/utils';

interface ChatSettingsDialogProps {
  session: ChatSession;
  isGuest: boolean;
  promptDraft: string;
  onPromptDraftChange: (value: string) => void;
  saving: boolean;
  onSave: (patch: Partial<ChatSession>) => void;
  onClose: () => void;
}

export default function ChatSettingsDialog({
  session,
  isGuest,
  promptDraft,
  onPromptDraftChange,
  saving,
  onSave,
  onClose,
}: ChatSettingsDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm
                 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-lg border border-border bg-card shadow-lg
                   animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 ease-out"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-bold text-foreground">Chat settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div>
            <label htmlFor="system-prompt" className="block text-xs font-bold text-foreground">
              System prompt
            </label>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Standing instructions for this conversation. Applies to every message,
              including ones already sent.
            </p>
            <textarea
              id="system-prompt"
              value={promptDraft}
              onChange={e => onPromptDraftChange(e.target.value)}
              rows={5}
              placeholder="e.g. Answer concisely. Prefer tables over prose. Always cite sources."
              className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-3 py-2
                         text-xs leading-relaxed text-foreground outline-none
                         transition-colors duration-200 placeholder:text-muted-foreground/50
                         focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {!isGuest ? (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/20 p-3.5">
              <div className="min-w-0">
                <div className="text-xs font-bold text-foreground">Memory</div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {session.memory_enabled
                    ? 'The assistant sees recent turns and can search the rest of this conversation.'
                    : 'The assistant answers from your current message alone. Nothing is deleted – turning this back on restores the full history.'}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={session.memory_enabled}
                aria-label="Toggle memory"
                disabled={saving}
                onClick={() => onSave({ memory_enabled: !session.memory_enabled })}
                className={cn(
                  "mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5",
                  "transition-colors duration-300 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                  "disabled:opacity-50",
                  session.memory_enabled ? "bg-primary" : "bg-muted-foreground/30"
                )}
              >
                <span
                  className={cn(
                    "h-5 w-5 shrink-0 rounded-full bg-white shadow-sm transition-transform duration-300 ease-out",
                    session.memory_enabled ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-warning-subtle p-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <span>Memory</span>
                  <span className="rounded border border-border bg-card px-1.5 py-0.5 micro-label">Login required</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Conversation memory is only available to logged-in users. Log in to let the assistant remember previous turns.
                </p>
              </div>
              <button
                role="switch"
                aria-checked={false}
                aria-label="Memory requires login"
                disabled
                title="Log in to use memory"
                className="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 bg-muted-foreground/20 opacity-50 cursor-not-allowed"
              >
                <span className="h-5 w-5 shrink-0 rounded-full bg-white shadow-sm translate-x-0" />
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-muted-foreground
                       transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            disabled={saving}
            onClick={() => onSave({ system_prompt: promptDraft })}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-bold
                       text-primary-foreground transition-colors duration-200
                       hover:brightness-110 active:scale-95 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
