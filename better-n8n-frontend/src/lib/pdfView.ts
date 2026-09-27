/**
 * The arithmetic behind the PDF reader (`components/files/PdfJsViewer.tsx`),
 * kept pure so it can be tested without a canvas or pdf.js.
 */
import type { ViewState } from '../api/recents';

/** `'fit'` follows the reader's width; a number is a fixed scale (1 = 100%). */
export type Zoom = 'fit' | number;

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];

/**
 * Most pixels one page canvas may hold. iOS Safari refuses canvases over
 * ~16.7M pixels and draws nothing at all, which is how a zoomed-in page on a
 * phone went blank. Past this, the page is drawn at a lower pixel density.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** The scale at which a page `pageWidth` wide fills `containerWidth`. */
export function fitScale(containerWidth: number, pageWidth: number, gutter = 32): number {
  if (containerWidth <= 0 || pageWidth <= 0) return 1;
  return clampZoom(Math.round(((containerWidth - gutter) / pageWidth) * 1000) / 1000);
}

/** The next zoom step above or below `current`, whatever `current` is. */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < current - 1e-6) ?? MIN_ZOOM;
}

/**
 * The 1-based page at scroll position `y`, given each page's top offset in
 * ascending order: the last page whose top is at or above `y`.
 */
export function pageAt(tops: number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] <= y) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found + 1;
}

/** The pixel density to draw a `width`×`height` CSS-pixel page at. */
export function canvasOutputScale(width: number, height: number, dpr: number, maxPixels = MAX_CANVAS_PIXELS): number {
  const wanted = Math.max(1, dpr || 1);
  const area = width * height;
  if (area <= 0) return wanted;
  const cap = Math.sqrt(maxPixels / area);
  return Math.max(0.25, Math.min(wanted, cap));
}

/** Where a reader was left, from the saved view state, with anything odd ignored. */
export function parseViewState(state: ViewState, pages: number): { page: number; zoom: Zoom } {
  const rawPage = state.page;
  const page = typeof rawPage === 'number' && Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= pages ? rawPage : 1;
  const rawZoom = state.zoom;
  const zoom: Zoom = typeof rawZoom === 'number' && Number.isFinite(rawZoom) ? clampZoom(rawZoom) : 'fit';
  return { page, zoom };
}

/** 1-based pages whose text contains `needle`, case-insensitively. */
export function matchingPages(texts: string[], needle: string): number[] {
  const n = needle.trim().toLowerCase();
  if (!n) return [];
  const out: number[] = [];
  texts.forEach((t, i) => {
    if (t.toLowerCase().includes(n)) out.push(i + 1);
  });
  return out;
}
