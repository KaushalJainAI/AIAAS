import { describe, expect, it } from 'vitest';

import { isSafeExternalUrl } from '../safeUrl';

describe('isSafeExternalUrl', () => {
  it('opens http and https', () => {
    expect(isSafeExternalUrl('https://example.com/a?b=c')).toBe(true);
    expect(isSafeExternalUrl('http://example.com')).toBe(true);
  });

  it('refuses every scheme that can run script', () => {
    for (const url of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://example.com/uuid',
      'vbscript:msgbox(1)',
    ]) {
      expect(isSafeExternalUrl(url)).toBe(false);
    }
  });

  it('refuses what does not parse', () => {
    expect(isSafeExternalUrl('')).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl('example.com')).toBe(false);
  });
});
