import { describe, expect, it } from 'vitest';

import { healStreamingTail } from '../streamHeal';

describe('healStreamingTail', () => {
  it('closes a bold run still arriving', () => {
    expect(healStreamingTail('The result was **very')).toBe('The result was **very**');
  });

  it('closes an italic run', () => {
    expect(healStreamingTail('only *slightly')).toBe('only *slightly*');
  });

  it('closes strikethrough', () => {
    expect(healStreamingTail('~~withdrawn')).toBe('~~withdrawn~~');
  });

  it('closes a code span', () => {
    expect(healStreamingTail('run `npm test')).toBe('run `npm test`');
  });

  it('drops a backtick typed with nothing after it', () => {
    expect(healStreamingTail('run `')).toBe('run ');
  });

  it('rewrites a half-typed link to its label', () => {
    expect(healStreamingTail('see [the docs](https://exa')).toBe('see the docs');
  });

  it('drops a half-typed image entirely', () => {
    expect(healStreamingTail('see ![chart](https://exa')).toBe('see ');
  });

  it('leaves a completed block alone', () => {
    const settled = '**done** and `code`.\n\nNow typing';
    expect(healStreamingTail(settled)).toBe(settled);
  });

  it('does not touch anything before the last block', () => {
    const text = '1 * 2 * 3 is settled.\n\nand **this';
    expect(healStreamingTail(text)).toBe('1 * 2 * 3 is settled.\n\nand **this**');
  });

  it('leaves an unclosed fence alone: it is already code', () => {
    const text = 'Here:\n\n```python\ndef f(:\n    return "**unclosed';
    expect(healStreamingTail(text)).toBe(text);
  });

  it('leaves a tilde fence alone, and a backtick line inside it', () => {
    const text = '~~~\n```\n**still code';
    expect(healStreamingTail(text)).toBe(text);
  });

  it('does not treat a degree range as strikethrough', () => {
    expect(healStreamingTail('between 20~25°C')).toBe('between 20~25°C');
  });

  it('does not treat an identifier as emphasis', () => {
    expect(healStreamingTail('the snake_case name')).toBe('the snake_case name');
  });

  it('does not close over multiplication', () => {
    expect(healStreamingTail('1 * 2 * 3')).toBe('1 * 2 * 3');
  });

  it('does not count delimiters inside a closed code span', () => {
    expect(healStreamingTail('use `a**b` here')).toBe('use `a**b` here');
  });

  it('closes an emphasis run around a code span, innermost first', () => {
    // `**` opened outside the span and the span was closed, so only `**` is
    // still open.
    expect(healStreamingTail('**bold with `code`')).toBe('**bold with `code`**');
  });

  it('is a no-op for text with nothing open', () => {
    expect(healStreamingTail('plain prose.')).toBe('plain prose.');
    expect(healStreamingTail('')).toBe('');
  });
});
