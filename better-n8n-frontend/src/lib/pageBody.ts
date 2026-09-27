/**
 * A report page's body, split into prose and charts.
 *
 * A published report is markdown, and a chart travels inside it as a fenced
 * ```chart block holding the same spec `render_chart` takes. The page draws
 * those with `ChartArtifact` — the one chart renderer — rather than asking the
 * model to embed a picture. A block that is not valid JSON, or not a chart,
 * stays as text: a broken chart must not take the rest of the report with it.
 */
import type { ChartSpec } from '../api/chat';

export type ReportPart = { kind: 'markdown'; text: string } | { kind: 'chart'; chart: ChartSpec };

const FENCE = /```chart[ \t]*\r?\n([\s\S]*?)```/g;
const KINDS = new Set(['bar', 'column', 'line', 'area', 'scatter', 'pie']);

export function splitReport(body: string): ReportPart[] {
  const parts: ReportPart[] = [];
  let last = 0;
  for (const match of body.matchAll(FENCE)) {
    const index = match.index ?? 0;
    let chart: ChartSpec | null = null;
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && KINDS.has(parsed.kind) && Array.isArray(parsed.series)) chart = parsed as ChartSpec;
    } catch {
      chart = null;
    }
    if (!chart) continue;
    if (index > last) parts.push({ kind: 'markdown', text: body.slice(last, index) });
    parts.push({ kind: 'chart', chart });
    last = index + match[0].length;
  }
  if (last < body.length) parts.push({ kind: 'markdown', text: body.slice(last) });
  return parts.filter((p) => p.kind === 'chart' || p.text.trim() !== '');
}

/** The CSP a published HTML page runs under: its own inline code, no network. */
export const PAGE_HTML_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

export function htmlDocument(html: string): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PAGE_HTML_CSP}" />`;
  // Injected into an existing <head> when there is one, so the policy is the
  // first thing the document parses; otherwise the body is wrapped.
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${csp}`);
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />${csp}</head><body>${html}</body></html>`;
}
