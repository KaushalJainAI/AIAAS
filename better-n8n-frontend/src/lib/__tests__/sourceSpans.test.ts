import { describe, expect, it } from 'vitest';

import { insertSourceMarkers } from '../sourceSpans';

const SOURCES = [
  { url: 'https://a.example/1' },
  { url: 'https://b.example/2' },
];

describe('insertSourceMarkers', () => {
  it('places the marker after the cited sentence', () => {
    expect(insertSourceMarkers('Paris is the capital.', [
      { url: 'https://a.example', start: 0, end: 5 },
    ])).toBe('Paris[1](citation:1) is the capital.');
  });

  it('uses the source’s position in the list as its number', () => {
    expect(insertSourceMarkers('One two three', [
      { url: 'https://a.example' },
      { url: 'https://b.example', start: 4, end: 7 },
    ])).toBe('One two[2](citation:2) three');
  });

  it('places two sources cited by one sentence in ascending order', () => {
    const out = insertSourceMarkers('Both said so.', [
      { url: 'https://a.example', start: 0, end: 4 },
      { url: 'https://b.example', start: 0, end: 4 },
    ]);
    expect(out).toBe('Both[1](citation:1)[2](citation:2) said so.');
  });

  it('leaves sources without spans alone', () => {
    expect(insertSourceMarkers('Plain answer.', SOURCES)).toBe('Plain answer.');
  });

  it('drops a span that points past the end of the text', () => {
    expect(insertSourceMarkers('Short.', [
      { url: 'https://a.example', start: 0, end: 999 },
    ])).toBe('Short.');
  });

  it('drops a span that points into a fenced block', () => {
    // Citing the code that was shown is legitimate for the provider, but a
    // marker spliced inside the fence would corrupt the text on copy.
    const content = 'Here:\n\n```python\nx = 1\n```\n\nThat is it.';
    const inside = content.indexOf('x = 1');
    expect(insertSourceMarkers(content, [
      { url: 'https://a.example', start: inside, end: inside + 5 },
    ])).toBe(content);
  });

  it('still places a span in prose next to a fence', () => {
    const content = '```\nx\n```\n\nCited prose.';
    const start = content.indexOf('Cited');
    expect(insertSourceMarkers(content, [
      { url: 'https://a.example', start, end: start + 5 },
    ])).toBe('```\nx\n```\n\nCited[1](citation:1) prose.');
  });

  it('ignores a span with an empty or inverted range', () => {
    expect(insertSourceMarkers('Text.', [{ start: 2, end: 2 }])).toBe('Text.');
    expect(insertSourceMarkers('Text.', [{ start: 3, end: 1 }])).toBe('Text.');
  });

  it('is a no-op without content or sources', () => {
    expect(insertSourceMarkers('', [{ start: 0, end: 1 }])).toBe('');
    expect(insertSourceMarkers('Text.')).toBe('Text.');
  });
});
