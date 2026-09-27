/**
 * The normalisation that stops the Inbox crashing.
 *
 * `open_request` writes `options` as `[{label, value}]`. The type said
 * `string[]` and `Inbox.tsx` rendered `<button key={opt}>{opt}</button>`, so
 * React refused the object as a child and took the detail pane into the error
 * boundary — for every genuine request, which is why the screen was never seen
 * working. The type lied and nothing checked it.
 *
 * These run in Node (see `vitest.config.ts`), so what is pinned here is the
 * shape the renderer is handed, not the render itself.
 */
import { describe, expect, it } from 'vitest';

import { hitlOption } from '../orchestrator';

describe('hitlOption', () => {
  it('reads the label and the value the backend actually writes', () => {
    expect(hitlOption({ label: 'Approve', value: 'approve' }))
      .toEqual({ label: 'Approve', value: 'approve' });
  });

  it('still accepts a bare string', () => {
    // Rows predating `open_request` carry these, and `options` is a free JSON
    // column that other writers may reach.
    expect(hitlOption('Approve')).toEqual({ label: 'Approve', value: 'approve' });
  });

  it('always returns strings, whatever it was given', () => {
    const odd = [
      { label: 'Send it' },
      { value: 'approve' },
      {},
      'Reject',
    ] as Parameters<typeof hitlOption>[0][];

    for (const option of odd) {
      const { label, value } = hitlOption(option);
      expect(typeof label).toBe('string');
      expect(typeof value).toBe('string');
    }
  });

  it('falls back between the two halves rather than rendering undefined', () => {
    expect(hitlOption({ value: 'approve' } as never).label).toBe('approve');
    expect(hitlOption({ label: 'Send it' } as never).value).toBe('Send it');
  });
});
