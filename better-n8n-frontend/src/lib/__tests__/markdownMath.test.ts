import { describe, expect, it } from 'vitest';

import { looksLikeMath, normalizeMathDelimiters } from '../markdownMath';

describe('normalizeMathDelimiters', () => {
  it('turns LaTeX inline delimiters into dollars', () => {
    expect(normalizeMathDelimiters('Euler: \\(e^{i\\pi}+1=0\\)')).toBe('Euler: $e^{i\\pi}+1=0$');
  });

  it('turns LaTeX display delimiters into double dollars', () => {
    expect(normalizeMathDelimiters('\\[x^2\\]')).toBe('$$x^2$$');
  });

  it('handles a display block split across lines', () => {
    expect(normalizeMathDelimiters('\\[\nx^2\n\\]')).toBe('$$\nx^2\n$$');
  });

  it('leaves fenced code alone', () => {
    const code = '```latex\n\\(x^2\\)\n```';
    expect(normalizeMathDelimiters(code)).toBe(code);
  });

  it('leaves inline code alone', () => {
    expect(normalizeMathDelimiters('use `\\(x\\)` for this')).toBe('use `\\(x\\)` for this');
  });

  it('does not treat a tilde fence as a backtick fence', () => {
    // Inside a ~~~ block a ``` line is content, so the fence must still hold.
    const code = '~~~\n\\(x\\)\n~~~';
    expect(normalizeMathDelimiters(code)).toBe(code);
  });

  it('is a no-op when there is nothing to rewrite', () => {
    expect(normalizeMathDelimiters('plain text')).toBe('plain text');
  });
});

describe('looksLikeMath', () => {
  it('spots every delimiter we render', () => {
    expect(looksLikeMath('$x$')).toBe(true);
    expect(looksLikeMath('$$x$$')).toBe(true);
    expect(looksLikeMath('\\(x\\)')).toBe(true);
    expect(looksLikeMath('\\[x\\]')).toBe(true);
  });

  it('says no for prose without a delimiter', () => {
    expect(looksLikeMath('just words')).toBe(false);
  });
});
