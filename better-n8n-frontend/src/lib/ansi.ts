/**
 * Terminal colour codes, removed from text that is about to be displayed.
 *
 * Tool output (a shell command, a test runner, a package manager) arrives with
 * ANSI escapes — `\x1b[31m` for red, `\x1b[0m` to reset. Rendered as text they
 * are invisible; rendered into a highlighted code block they appear as `[31m`
 * and break the highlighter's tokenizing from that point on. Copying such a
 * block pastes those bytes into someone's editor.
 *
 * Both colour (CSI) and title/hyperlink (OSC) sequences are dropped. The copy
 * button copies the stripped text for the same reason.
 */

/* eslint-disable no-control-regex -- the control characters are the thing being stripped */
/** CSI sequences (`ESC [ … letter`) and OSC sequences (`ESC ] … BEL|ESC \\`). */
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;

/** Carriage returns used as line resets by progress bars, and stray NULs. */
const CONTROL_PATTERN = /[\u0000\u0008]/g;
/* eslint-enable no-control-regex */

/** Whether the text carries anything the stripper would remove. */
export function hasAnsi(text: string): boolean {
  return text.includes('\u001b');
}

/** The same text with terminal control sequences removed. */
export function stripAnsi(text: string): string {
  if (!hasAnsi(text)) return text;
  return text.replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, '');
}
