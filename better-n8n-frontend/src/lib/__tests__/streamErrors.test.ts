import { describe, expect, it } from 'vitest';
import { describeStreamFailure } from '../streamErrors';

describe('describeStreamFailure', () => {
  it('explains a restart instead of printing the status', () => {
    const text = describeStreamFailure(502, 'Stream request failed: 502');
    expect(text).toContain('restarting or busy');
    expect(text).not.toContain('Stream request failed');
  });

  it('never shows a proxy HTML page', () => {
    expect(describeStreamFailure(504, '<html><body>504 Gateway Time-out</body></html>')).toContain('restarting or busy');
  });

  it('keeps a sentence the server wrote on purpose', () => {
    const policy = 'That request is not something this platform can help with.';
    expect(describeStreamFailure(400, policy)).toBe(policy);
  });

  it('explains a dropped connection', () => {
    expect(describeStreamFailure(undefined, 'Failed to fetch')).toMatch(/offline|connection to the server dropped/);
  });

  it('names throttling, size and sign-in', () => {
    expect(describeStreamFailure(429, 'Stream request failed: 429')).toContain('faster than allowed');
    expect(describeStreamFailure(413, 'Stream request failed: 413')).toContain('too large');
    expect(describeStreamFailure(401, 'Stream request failed: 401')).toContain('sign-in has expired');
  });
});
