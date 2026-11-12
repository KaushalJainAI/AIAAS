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

  it('escapes prices so two of them do not become one formula', () => {
    const text = 'the maker lists it at **$399** (per [Spy](https://x.com/a-b)). Earlier it was $299.';
    expect(normalizeMathDelimiters(text)).toBe(
      'the maker lists it at **&#36;399** (per [Spy](https://x.com/a-b)). Earlier it was &#36;299.',
    );
  });

  it('escapes a price range and prices separated by words', () => {
    expect(normalizeMathDelimiters('$5-$10')).toBe('&#36;5-&#36;10');
    expect(normalizeMathDelimiters('costs $5 and $10 total')).toBe('costs &#36;5 and &#36;10 total');
  });

  it('keeps real inline maths, including maths starting with a digit', () => {
    expect(normalizeMathDelimiters('so $x^2$ grows')).toBe('so $x^2$ grows');
    expect(normalizeMathDelimiters('there are $2^n$ subsets')).toBe('there are $2^n$ subsets');
    expect(normalizeMathDelimiters('$5 now, then $x$')).toBe('&#36;5 now, then $x$');
  });

  it('keeps display maths, escaped dollars and dollars in code', () => {
    expect(normalizeMathDelimiters('$$x^2$$')).toBe('$$x^2$$');
    expect(normalizeMathDelimiters('a \\$5 fee')).toBe('a &#36;5 fee');
    expect(normalizeMathDelimiters('run `echo $HOME` now')).toBe('run `echo $HOME` now');
    const code = '```sh\necho $5 $6\n```';
    expect(normalizeMathDelimiters(code)).toBe(code);
  });

  it('does not read spaced LaTeX delimiters as prices', () => {
    expect(normalizeMathDelimiters('\\( x \\)')).toBe('$ x $');
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
