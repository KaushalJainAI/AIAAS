// @vitest-environment jsdom
/**
 * The citation pills, and — more importantly — the code around them.
 *
 * Turning a bare `[1]` into a pill used to be a regex over the raw markdown
 * string, applied before parsing. The parser had not run yet, so the rewrite
 * could not tell prose from code and the bracketed numbers inside a fenced
 * block came out as citations too: a Python snippet rendered as
 * `grid[0](citation:0)`, and the copy button handed that to the clipboard.
 * These tests hold that line.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import MarkdownMessage from '../MarkdownMessage';

afterEach(cleanup);

const PYTHON = [
  '```python',
  'class Solution:',
  '    def minPathXor(self, grid: list[list[int]]) -> int:',
  '        R, C = len(grid), len(grid[0])',
  '        dp[0][0][grid[0][0]] = True',
  '```',
].join('\n');

describe('MarkdownMessage', () => {
  it('leaves bracketed numbers in a code block alone', () => {
    const { container } = render(<MarkdownMessage content={PYTHON} />);
    const code = container.querySelector('code')?.textContent ?? '';
    expect(code).toContain('grid[0]');
    expect(code).toContain('dp[0][0][grid[0][0]]');
    expect(code).not.toContain('citation:');
  });

  it('copies the code block without the citation text', () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<MarkdownMessage content={PYTHON} />);
    fireEvent.click(screen.getByTitle('Copy code'));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('grid[0]');
    expect(writeText.mock.calls[0][0]).not.toContain('citation:');
  });

  it('leaves inline code alone', () => {
    const { container } = render(<MarkdownMessage content={'Use `dp[0]` for the base case.'} />);
    expect(container.querySelector('code')?.textContent).toBe('dp[0]');
  });

  it('draws a bare [1] in prose as a citation pill', () => {
    render(
      <MarkdownMessage
        content={'The docs say so [1].'}
        sources={[{ url: 'https://example.com/docs', title: 'Docs' }]}
      />,
    );
    expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe(
      'https://example.com/docs',
    );
  });

  it('reads the full-width 【1】 marker Perplexity and CJK models emit', () => {
    render(
      <MarkdownMessage content={'Claimed 【1】.'} sources={[{ url: 'https://a.example/x' }]} />,
    );
    expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe(
      'https://a.example/x',
    );
  });

  it('splits a multi-source marker into one pill per source', () => {
    render(
      <MarkdownMessage
        content={'Both said it [1, 2].'}
        sources={[{ url: 'https://a.example/1' }, { url: 'https://b.example/2' }]}
      />,
    );
    expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe('https://a.example/1');
    expect(screen.getByRole('link', { name: '2' }).getAttribute('href')).toBe('https://b.example/2');
  });

  it('leaves a marker beyond the source list as text', () => {
    const { container } = render(
      <MarkdownMessage content={'Grown [3].'} sources={[{ url: 'https://a.example/1' }]} />,
    );
    expect(container.textContent).toContain('[3]');
    expect(screen.queryByRole('link', { name: '3' })).toBeNull();
  });

  it('drops Claude’s <cite> wrapper around a cited sentence', () => {
    const { container } = render(
      <MarkdownMessage
        content={'Sky is blue <cite index="1-2">per the source</cite>.'}
        sources={[{ url: 'https://a.example/1' }]}
      />,
    );
    expect(container.textContent).toContain('Sky is blue per the source.');
    expect(container.textContent).not.toContain('<cite');
  });

  it('strips terminal colour codes from a code block', () => {
    const content = ['```bash', '\u001b[31mFAIL\u001b[0m', '```'].join('\n');
    const { container } = render(<MarkdownMessage content={content} />);
    expect(container.querySelector('code')?.textContent).toContain('FAIL');
    expect(container.querySelector('code')?.textContent).not.toContain('\u001b');
  });

  it('lets each message pick its own writing direction', () => {
    const { container } = render(<MarkdownMessage content={'مرحبا'} />);
    expect(container.firstElementChild?.getAttribute('dir')).toBe('auto');
  });

  it('gives a fence with no language a copy button, not inline-chip styling', () => {
    // A bare fence is a *block* in mdast even though it carries no info
    // string, and v10 gives the renderer no `inline` prop to tell them apart.
    const { container } = render(
      <MarkdownMessage content={['```', 'no colour here', '```'].join('\n')} />,
    );
    expect(screen.getByTitle('Copy code')).toBeTruthy();
    expect(container.textContent).toContain('TEXT');
  });

  it('draws a pill where the provider reported a span', () => {
    // OpenAI and Gemini send a source list plus offsets instead of writing
    // `[1]` in the text, so the marker has to be placed, not found.
    render(
      <MarkdownMessage
        content="Paris is the capital."
        sources={[{ url: 'https://a.example/paris', start: 0, end: 5 }]}
      />,
    );
    const link = screen.getByRole('link', { name: '1' });
    expect(link.getAttribute('href')).toBe('https://a.example/paris');
    // Immediately after the cited word, not at the end of the paragraph.
    expect(link.closest('p')?.firstChild?.textContent).toBe('Paris');
  });

  it('scopes footnote ids per message so two answers do not collide', () => {
    // remark-gfm numbers footnotes per document; a transcript is many
    // documents on one page, and a duplicate id makes the second answer's `[1]`
    // link jump to the first answer's note.
    const markdown = 'Claim[^1].\n\n[^1]: The note.';
    render(<MarkdownMessage content={markdown} />);
    render(<MarkdownMessage content={markdown} />);

    const refs = [...document.querySelectorAll('a[data-footnote-ref]')];
    expect(refs).toHaveLength(2);
    const targets = refs.map((ref) => ref.getAttribute('href'));
    expect(targets[0]).not.toBe(targets[1]);
    for (const target of targets) {
      expect(document.querySelector(target as string)).not.toBeNull();
    }
  });

  it('typesets LaTeX once the message has settled', async () => {
    const { container } = render(<MarkdownMessage content={'Euler: \\(e^{i\\pi}+1=0\\)'} />);
    // The plugin chunks are dynamic imports, so this waits on a network/jsdom
    // load rather than on the pipeline. 10s is slack for a loaded CI box.
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull(), { timeout: 10000 });
  });

  it('refuses a source URL that is not http(s)', () => {
    render(
      <MarkdownMessage content={'Claimed [1].'} sources={[{ url: 'javascript:alert(1)' }]} />,
    );
    expect(screen.getByRole('link', { name: '1' }).getAttribute('href')).toBe('#');
  });
});
