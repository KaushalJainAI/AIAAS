/**
 * Turning a webhook trigger into something a person can paste somewhere. Copied
 * from better-n8n-frontend/src/lib/webhooks.ts.
 *
 * `webhook_url` arrives as a root-relative path, so it is prefixed with the API
 * origin the app talks to. The one-line curl shows the real receiver, and is
 * offered instead of a Test button because a test button would skip the
 * unauthenticated path the user actually needs to prove.
 */

export function absoluteHookUrl(path: string | null, origin: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function curlFor(url: string): string {
  if (!url) return '';
  return [
    `curl -X POST ${url} \\`,
    "  -H 'Content-Type: application/json' \\",
    `  -d '{"example": "this body becomes context, never the instruction"}'`,
  ].join('\n');
}
