/**
 * Browser calls passed from an answer to the Browser screen, and the picture
 * and host helpers that screen and the answer chip share.
 *
 * The list is too large for a route param, so the chip stores it here and passes
 * only a key. The store lives in memory: after an app restart the key is gone and
 * the screen says so. Only the newest few are kept, so a long session cannot grow it.
 */
import { buildUrl } from '../files/transfer';
import type { BrowserView } from './types';

const MAX_KEPT = 20;
const kept = new Map<string, BrowserView[]>();
let counter = 0;

/** Stores one answer's browser calls and returns the key the screen reads them with. */
export function rememberBrowserViews(views: BrowserView[]): string {
  counter += 1;
  const key = `browser-${counter}`;
  kept.set(key, views);
  while (kept.size > MAX_KEPT) {
    const oldest = kept.keys().next();
    if (oldest.done) break;
    kept.delete(oldest.value);
  }
  return key;
}

/** The calls stored under a key, or null when the key is unknown or was dropped. */
export function recallBrowserViews(key: string): BrowserView[] | null {
  return kept.get(key) ?? null;
}

/** The host of an http(s) URL, without user info or port. Empty when the URL is not one. */
export function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!match) return '';
  return match[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '');
}

/** The API path of a kept picture: `GET /api/browser/frames/<id>/`, bearer token required. */
export function browserFramePath(frameId: string): string {
  return `/browser/frames/${encodeURIComponent(frameId)}/`;
}

/** The full URL of a kept picture, for an `<Image>` source (send `authorizationHeaders()` with it). */
export function browserFrameUrl(frameId: string): string {
  return buildUrl(browserFramePath(frameId));
}
