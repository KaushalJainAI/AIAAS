/**
 * The suggestion pills on the empty chat, and which set a person is shown.
 *
 * Each starter maps to something the person can really do with what they have:
 * guests have nothing connected, members without an account have nothing
 * connected, and only connected members get the set that uses their accounts.
 */

export interface Starter {
  /** What the pill says. */
  label: string;
  /** What goes into the message box. */
  prompt: string;
}

/** Connected members: these use their own Gmail, Drive and files. */
export const MEMBER_STARTERS: Starter[] = [
  { label: 'Weekly invoice digest', prompt: 'Email me a digest of overdue invoices every Monday at 9am' },
  { label: 'Tidy my Drive', prompt: 'Find files in my Google Drive nobody has opened in 3 years' },
  { label: 'Read an invoice', prompt: 'Pull the line items out of this invoice' },
  { label: 'Draft support replies', prompt: 'Draft first replies to my open support tickets, and wait for my approval before sending' },
];

/** Guests have no connections and no uploads, so these need neither. */
export const GUEST_STARTERS: Starter[] = [
  { label: 'Payment reminder', prompt: 'Write a polite reminder for an unpaid invoice' },
  { label: 'Compare tools', prompt: 'Compare Notion, Asana and Trello for a team of five' },
  { label: 'Explain GST credit', prompt: 'Explain GST input tax credit in simple words' },
  { label: 'Launch checklist', prompt: 'Plan a one-week launch checklist for a small product' },
];

/** Signed-in members with no connected account: none of these need one. */
export const NO_CONNECTION_STARTERS: Starter[] = [
  { label: 'Summarise a PDF', prompt: "Summarise the PDF I'm about to attach in five bullet points" },
  { label: 'Plan my week', prompt: 'Plan my week around these deadlines and meetings, which I will list next' },
  { label: 'Draft an email', prompt: 'Draft a short, polite email asking a client for an update on their payment' },
  { label: 'Make a chart', prompt: 'Make a bar chart of monthly sales: Jan 120, Feb 150, Mar 90' },
];

export function pickStarters(isGuest: boolean, hasConnection: boolean): Starter[] {
  if (isGuest) return GUEST_STARTERS;
  return hasConnection ? MEMBER_STARTERS : NO_CONNECTION_STARTERS;
}
