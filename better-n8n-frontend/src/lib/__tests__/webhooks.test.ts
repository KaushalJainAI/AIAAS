import { describe, expect, it } from 'vitest';

import { absoluteHookUrl, curlFor } from '../webhooks';

describe('absoluteHookUrl', () => {
  it('prepends the origin the app is loaded from', () => {
    expect(absoluteHookUrl('/api/orchestrator/hooks/abc/', 'https://app.example.com'))
      .toBe('https://app.example.com/api/orchestrator/hooks/abc/');
  });

  it('does not double the slash when the origin carries one', () => {
    expect(absoluteHookUrl('/api/orchestrator/hooks/abc/', 'https://app.example.com/'))
      .toBe('https://app.example.com/api/orchestrator/hooks/abc/');
  });

  it('leaves an already-absolute URL alone', () => {
    const abs = 'https://api.example.com/api/orchestrator/hooks/abc/';
    expect(absoluteHookUrl(abs, 'https://app.example.com')).toBe(abs);
  });

  it('is empty for a trigger with no hook, so nothing renders a broken link', () => {
    expect(absoluteHookUrl(null, 'https://app.example.com')).toBe('');
  });
});

describe('curlFor', () => {
  it('POSTs, because the receiver accepts nothing else', () => {
    expect(curlFor('https://x/api/orchestrator/hooks/abc/')).toContain('-X POST');
  });

  it('is empty when there is no URL, rather than a curl to nowhere', () => {
    expect(curlFor('')).toBe('');
  });
});
