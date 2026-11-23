/**
 * When something the agent made opens in the side pane by itself.
 *
 * The decision is a pure function so vitest can test every rule. The chat
 * (`AutoOpenFiles`) supplies the inputs. Two things qualify: a turn's first
 * file that was created, and a turn's first browser update. Both follow the
 * same rules, so they share this function.
 */

/** Tailwind's `md` breakpoint. Below it the pane is a full-screen page, so it never opens by itself. */
export const AUTO_OPEN_MIN_WIDTH = 768;

export interface AutoOpenInput {
  /** The window's inner width in px. */
  width: number;
  /** The user closed the pane during this turn. Their choice wins for the rest of it. */
  userClosed: boolean;
  /** The Chat settings switch, "Open new files beside the chat". */
  setting: boolean;
  /**
   * This is the turn's first qualifying item: the first file created, or the
   * first browser update. Later ones never open anything.
   */
  qualifies: boolean;
}

export function shouldAutoOpen({ width, userClosed, setting, qualifies }: AutoOpenInput): boolean {
  return setting && qualifies && !userClosed && width >= AUTO_OPEN_MIN_WIDTH;
}
