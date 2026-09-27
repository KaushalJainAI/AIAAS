import { describe, it, expect } from 'vitest';
import { cn, generateUniqueNodeLabel } from '../utils';

describe('cn', () => {
  it('merges classnames and dedupes tailwind conflicts', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    // The constant `false` is the point: `cn` has to drop falsy entries the
    // way `clsx` does, and that is exactly how call sites write a
    // conditional class. Not a mistake for the linter to flag.
    // eslint-disable-next-line no-constant-binary-expression
    expect(cn('text-red-500', false && 'hidden', undefined, 'font-bold')).toBe('text-red-500 font-bold');
  });
});

describe('generateUniqueNodeLabel', () => {
  it('returns base name when not taken', () => {
    expect(generateUniqueNodeLabel('HTTP', [])).toBe('HTTP');
  });

  it('appends counter on collision', () => {
    const existing = [{ data: { label: 'HTTP' } }];
    expect(generateUniqueNodeLabel('HTTP', existing)).toBe('HTTP 1');
  });

  it('skips taken counters', () => {
    const existing = [
      { data: { label: 'HTTP' } },
      { data: { label: 'HTTP 1' } },
      { data: { label: 'HTTP 2' } },
    ];
    expect(generateUniqueNodeLabel('HTTP', existing)).toBe('HTTP 3');
  });

  it('normalizes generic names', () => {
    expect(generateUniqueNodeLabel('', [])).toBe('Node');
    expect(generateUniqueNodeLabel('node', [])).toBe('Node');
    expect(generateUniqueNodeLabel('custom', [])).toBe('Node');
  });

  it('ignores nodes without labels', () => {
    const existing = [{ data: {} }, { data: { label: undefined } }];
    expect(generateUniqueNodeLabel('Foo', existing)).toBe('Foo');
  });
});
