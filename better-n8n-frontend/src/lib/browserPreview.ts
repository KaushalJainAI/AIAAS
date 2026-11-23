/**
 * What a link preview says when it does not work. Pure, so each status has a
 * test. The server's own sentence is shown only for 400, where it names the
 * fault (an address the safety check refused); the others are said here.
 */

/** A plain sentence for a failed `POST /api/browser/preview/`. */
export function previewFailure(status: number | undefined, serverMessage?: string): string {
  switch (status) {
    case 429:
      return 'Too many previews this hour. Try again later.';
    case 404:
      return 'Link previews are not set up on this server.';
    case 400:
      return serverMessage?.trim() || 'This link cannot be previewed.';
    case 502:
      return 'The page could not be opened. Try again, or open it in a new tab.';
    default:
      return 'The preview failed. Try again, or open it in a new tab.';
  }
}
