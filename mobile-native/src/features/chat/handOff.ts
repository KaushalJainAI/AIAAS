/**
 * The "I'm done" text a Browser screen hands back to the conversation under it.
 *
 * The Browser screen is only ever pushed from a conversation, so the screen
 * beneath it is the conversation that asked. "I'm done" sets this slot and goes
 * back; that conversation takes the text when it comes back into view and
 * sends it through its own send path (steer while a turn runs, send otherwise).
 * One slot is enough because nothing else is waiting; it lives in memory only.
 */
let pending: string | null = null;

/** Holds one hand-off until the conversation takes it. */
export function queueHandOff(text: string): void {
  pending = text;
}

/** The waiting hand-off, or null. Taking it clears it, so it is sent once. */
export function takeHandOff(): string | null {
  const text = pending;
  pending = null;
  return text;
}
