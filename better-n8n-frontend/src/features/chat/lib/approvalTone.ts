/**
 * Tailwind classes for the chat's approval level. The level's tone (from
 * `APPROVAL_TONE`) picks the colour; these functions only name the classes, so
 * the composer and the header agree and a test can pin the mapping.
 */
import { APPROVAL_TONE, type ApprovalTone } from '@/types/agentConfig';
import type { ChatMode } from './chatMode';

const BORDER: Record<ApprovalTone, string> = {
  neutral: 'border-border',
  primary: 'border-primary/40',
  warning: 'border-warning/60',
  destructive: 'border-destructive/60',
};

const SELECT: Record<ApprovalTone, string> = {
  neutral: 'border-border bg-background text-foreground',
  primary: 'border-primary/40 bg-background text-foreground',
  warning: 'border-warning/40 bg-warning-subtle text-warning',
  destructive: 'border-destructive/40 bg-destructive-subtle text-destructive',
};

/** The levels a chat offers, least reach first. Chat has no `review` (the
 *  builder's step-by-step level); the words come from `AUTONOMY_COPY`. */
export const CHAT_APPROVAL_ORDER: ChatMode[] = ['plan', 'ask', 'auto', 'full'];

/** The composer box's border colour for an approval level. Colour only: the width stays 1px. */
export function approvalBorderClass(mode: ChatMode): string {
  return BORDER[APPROVAL_TONE[mode]];
}

/** The approval select's colours for an approval level. */
export function approvalSelectClass(mode: ChatMode): string {
  return SELECT[APPROVAL_TONE[mode]];
}
