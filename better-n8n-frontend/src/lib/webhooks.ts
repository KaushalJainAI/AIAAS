/**
 * Turning a webhook trigger into something a person can paste somewhere.
 *
 * `Trigger.webhook_url` arrives as a root-relative path — `TriggerSerializer`
 * builds it without a host on purpose, because the server does not reliably
 * know the name it is reached by (behind Cloudflare and nginx, `request.host`
 * is whatever the proxy passed on). The browser does know, and the API is
 * same-origin in every environment: nginx proxies `/api` in the image, and the
 * `/api` rule in `vite.config.ts` does it in dev. So the origin the app is
 * loaded from is the right one to prepend, and it is prepended here rather
 * than inline in a component so it can be tested without a DOM.
 */

/** The full URL a caller POSTs to. Empty for a trigger that has no hook. */
export function absoluteHookUrl(path: string | null, origin: string): string {
  if (!path) return '';
  // Belt and braces: an absolute URL from a future server build is already
  // finished, and double-prefixing it would produce a link to nowhere.
  if (/^https?:\/\//i.test(path)) return path;
  return `${origin.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * The one-line `curl` that exercises the real receiver.
 *
 * Shown instead of a "Test" button, deliberately: `trigger_run_now` refuses
 * non-schedules, because a test button that reached the runtime directly would
 * skip the unauthenticated path, the enabled check and the payload-is-context
 * rule — it would prove the button works and nothing else. This proves the
 * thing the user actually wants to know.
 */
export function curlFor(url: string): string {
  if (!url) return '';
  return `curl -X POST ${url} \\n  -H 'Content-Type: application/json' \\n  -d '{"example": "this body becomes context, never the instruction"}'`;
}
