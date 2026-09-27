/**
 * What an eval run wanted from a person, shown under its result.
 *
 * An eval never stops to ask. Every question the agent put through `ask_user`
 * and every call that would have paused for approval under its own autonomy
 * is recorded instead, and this is where it is read back.
 */
import { MessageCircleQuestion, ShieldAlert } from 'lucide-react';

import type { EvalIntent } from '../../api/evals';

export default function IntentList({ intents }: { intents?: EvalIntent[] }) {
  if (!intents?.length) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {intents.map((intent, i) => (
        <li key={intent.call_id || i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
          {intent.kind === 'question' ? (
            <>
              <MessageCircleQuestion className="w-3 h-3 mt-0.5 shrink-0 text-sky-600 dark:text-sky-400" />
              <span className="min-w-0 break-words">
                <span className="text-foreground">Asked:</span> {intent.question}
                {intent.assumption && <> — assumed {intent.assumption}</>}
              </span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="min-w-0 break-words">
                <span className="text-foreground">Would ask approval:</span>{' '}
                {intent.sentence || intent.tool}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
