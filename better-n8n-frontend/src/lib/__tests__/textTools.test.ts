import { describe, expect, it } from 'vitest';

import {
  dedupeLines, latexTable, markdownTable, readingTime, sortLines, stepFontSize, textStats,
  timestamp, titleCase, trimTrailingSpaces,
} from '../textTools';

describe('textTools', () => {
  it('counts lines, words and characters', () => {
    expect(textStats('')).toEqual({ lines: 0, words: 0, chars: 0 });
    expect(textStats('one two\nthree')).toEqual({ lines: 2, words: 3, chars: 13 });
  });

  it('never reports a zero-minute read', () => {
    expect(readingTime(0)).toBe('1 min read');
    expect(readingTime(660)).toBe('3 min read');
  });

  it('sorts lines the way a person would, numbers included', () => {
    expect(sortLines('item 10\nitem 2\nApple\nbanana')).toBe('Apple\nbanana\nitem 2\nitem 10');
  });

  it('removes repeated lines and keeps the first of each', () => {
    expect(dedupeLines('a\nb\na\nc\nb')).toBe('a\nb\nc');
  });

  it('trims trailing spaces without touching indentation', () => {
    expect(trimTrailingSpaces('  a  \n\tb\t\nc')).toBe('  a\n\tb\nc');
  });

  it('title-cases words after spaces, hyphens and quotes', () => {
    expect(titleCase('the QUICK brown-fox "said"')).toBe('The Quick Brown-Fox "Said"');
  });

  it('builds a Markdown table with a header and a rule', () => {
    expect(markdownTable(2, 1).split('\n')).toEqual([
      '| Column 1 | Column 2 |',
      '| --- | --- |',
      '|     |     |',
    ]);
  });

  it('builds a LaTeX table with one column spec letter per column', () => {
    const table = latexTable(3, 2);
    expect(table).toContain('\\begin{tabular}{lll}');
    expect(table.match(/ \\\\$/gm)).toHaveLength(3);
  });

  it('formats a timestamp in local time', () => {
    expect(timestamp(new Date(2026, 9, 10, 4, 5))).toBe('2026-10-10 04:05');
  });

  it('keeps the font size inside its range', () => {
    expect(stepFontSize(24, 1)).toBe(24);
    expect(stepFontSize(10, -1)).toBe(10);
    expect(stepFontSize(13, 1)).toBe(14);
  });
});
