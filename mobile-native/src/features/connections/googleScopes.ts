/**
 * Google OAuth scopes to request per connection. Copied from
 * better-n8n-frontend/src/lib/googleScopes.ts.
 *
 * The backend's default scope set (Sheets + read-only Drive) is right for
 * nothing in particular: connecting Gmail with it yields a token that cannot
 * read mail, so the connection reports success and then fails on first use.
 * Each connector asks for what it actually needs. Keyed on `icon_slug`.
 */

export const GOOGLE_SCOPES: Record<string, string[]> = {
  /* `gmail.modify` alone cannot send. `settings.basic` is kept so tokens issued
     before the native tools keep their grant. `settings.sharing` is deliberately
     NOT asked for: it is restricted and drags the app into a heavier review. */
  gmail: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.settings.basic',
  ],
  'google-calendar': ['https://www.googleapis.com/auth/calendar'],
  /* Drive and Sheets are served natively by the backend, each card asking only
     for what its own tools call. `drive.file` is the narrow scope. */
  'google-sheets': ['https://www.googleapis.com/auth/spreadsheets'],
  'google-drive': [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
  ],
  /* Docs has no working connector; kept so the row still resolves if one lands. */
  'google-docs': ['https://www.googleapis.com/auth/documents'],
};

/**
 * Scopes for a connector, or undefined to let the backend choose. Undefined is
 * right for a connector with no mapping: a guessed scope would fail the consent
 * screen outright, while the backend default at least completes.
 */
export function googleScopesFor(iconSlug: string | undefined): string[] | undefined {
  if (!iconSlug) return undefined;
  return GOOGLE_SCOPES[iconSlug];
}
