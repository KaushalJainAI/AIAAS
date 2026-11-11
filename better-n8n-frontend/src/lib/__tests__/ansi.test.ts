import { describe, expect, it } from 'vitest';

import { hasAnsi, stripAnsi } from '../ansi';

describe('stripAnsi', () => {
  it('removes colour codes from shell output', () => {
    expect(stripAnsi('\u001b[31mfailed\u001b[0m')).toBe('failed');
  });

  it('removes a title sequence', () => {
    expect(stripAnsi('\u001b]0;tab title\u0007text')).toBe('text');
  });

  it('keeps brackets that were never escapes', () => {
    expect(stripAnsi('grid[0] and [1, 2]')).toBe('grid[0] and [1, 2]');
  });

  it('reports whether there is anything to strip', () => {
    expect(hasAnsi('\u001b[32mok\u001b[0m')).toBe(true);
    expect(hasAnsi('plain')).toBe(false);
  });
});
