import { describe, expect, it } from 'vitest';

import { htmlDocument, PAGE_HTML_CSP, splitReport } from '../pageBody';

describe('splitReport', () => {
  it('lifts chart fences out of the markdown, in order', () => {
    const body = [
      '# Q3',
      'Revenue grew.',
      '```chart',
      '{"kind":"column","title":"Revenue","series":[{"name":"R","points":[{"x":"Q1","y":1}]}]}',
      '```',
      'Done.',
    ].join('\n');
    const parts = splitReport(body);
    expect(parts.map((p) => p.kind)).toEqual(['markdown', 'chart', 'markdown']);
    expect(parts[1].kind === 'chart' && parts[1].chart.title).toBe('Revenue');
  });

  it('leaves a broken or foreign block as text rather than dropping the report', () => {
    const parts = splitReport('Intro\n```chart\nnot json\n```\n```chart\n{"kind":"sankey","series":[]}\n```');
    expect(parts).toHaveLength(1);
    expect(parts[0].kind).toBe('markdown');
  });
});

describe('htmlDocument', () => {
  it('puts the no-network CSP first in an existing head', () => {
    const doc = htmlDocument('<html><head><title>x</title></head><body>hi</body></html>');
    expect(doc.indexOf(PAGE_HTML_CSP)).toBeLessThan(doc.indexOf('<title>'));
  });

  it('wraps a fragment in a document carrying the CSP', () => {
    const doc = htmlDocument('<p>hi</p>');
    expect(doc).toContain(PAGE_HTML_CSP);
    expect(doc).toContain('<body><p>hi</p></body>');
  });
});
