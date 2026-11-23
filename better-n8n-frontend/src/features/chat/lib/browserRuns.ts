/**
 * The names the chat gives a run of the agent's browser, so its tab is the
 * same tab every time it is opened.
 *
 * A turn that is streaming is `live<turnSeq>`. When it is saved, its answer
 * is `m<messageId>`, and the chip under the answer opens that. The two are
 * different tabs: the live one stays as it was when the turn ended.
 */

/** The browser tab of the turn being streamed (`turnSeq` counts sends). */
export function liveRunKey(turnSeq: number): string {
  return `live${turnSeq}`;
}

/** The browser tab of a saved answer. */
export function savedRunKey(messageId: number | string): string {
  return `m${messageId}`;
}
