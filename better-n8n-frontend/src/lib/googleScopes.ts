/**
 * Google OAuth scopes to request per connection.
 *
 * The backend's default scope set is Sheets + read-only Drive, which is right for
 * nothing in particular: connecting Gmail with it produces a token that cannot
 * read mail, so the connection reports success and then fails on first use.
 * Each connector asks for what it actually needs.
 *
 * Keyed on `icon_slug`, the same stable identifier the icon map uses.
 *
 * Connecting a second Google service re-runs the flow, and the auth URL is built
 * with `include_granted_scopes=true`, so the newer token also carries the scopes
 * already granted. Since credential lookup takes the most recently updated row,
 * connecting Gmail after Calendar keeps both working.
 */
export const GOOGLE_SCOPES: Record<string, string[]> = {
  /* `gmail.modify` alone cannot send: the connector ships `send_message` and
     `create_draft`, and a connection that reports success and then fails on the
     first send is the exact failure this map exists to prevent.
     `settings.basic` is kept so tokens issued before the native tools keep
     their grant; no native tool uses it yet.
     `settings.sharing` (delegates, send-as, S/MIME) is deliberately NOT asked
     for — it is a restricted scope that drags the whole app into a heavier
     Google verification review, and it buys a handful of rarely-used tools. */
  gmail: [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.settings.basic',
  ],
  'google-calendar': ['https://www.googleapis.com/auth/calendar'],
  /* Drive and Sheets are served natively by the backend since 2026-09-17
     (`chat/tools/google/drive.py`) as separate tool sets, so each card asks
     only for what its own tools call. `drive.readonly` covers search and read;
     `drive.file` is what `drive_create_file` needs, and it is the narrow scope —
     only files this app created — rather than full `drive`. Sheets tools address
     a spreadsheet by id, so `spreadsheets` alone is enough. */
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
 * correct for a connector we have no mapping for: guessing a scope would fail
 * the authorisation outright, while the backend default at least completes.
 */
export function googleScopesFor(iconSlug: string | undefined): string[] | undefined {
  if (!iconSlug) return undefined;
  return GOOGLE_SCOPES[iconSlug];
}
