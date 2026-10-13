/**
 * The "needs you" toasts currently on screen, so answering can take them down.
 *
 * A nudge ("Waiting for your approval") is raised by the reminder socket and
 * answered somewhere else entirely — the chat card, the Activity inbox — and
 * used to sit there after the approval it asked for had been given. The
 * surfaces that answer call `dismissNudges()`; nothing else needs to know the
 * toast ids.
 */
import { toast } from 'sonner';

const shown = new Set<string>();

export function trackNudge(id: string): void {
  shown.add(id);
}

export function dismissNudges(): void {
  shown.forEach((id) => toast.dismiss(id));
  shown.clear();
}
