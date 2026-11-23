import { describe, expect, it } from 'vitest';

import { previewFailure } from '@/lib/browserPreview';

describe('previewFailure', () => {
  it('says the rate limit in plain words', () => {
    expect(previewFailure(429)).toBe('Too many previews this hour. Try again later.');
  });

  it('says a missing browser plainly, not the server\'s "Not found."', () => {
    expect(previewFailure(404, 'Not found.')).toBe('Link previews are not set up on this server.');
  });

  it('shows the server\'s sentence for a refused address, and a default when it sent none', () => {
    expect(previewFailure(400, 'That address is not allowed.')).toBe('That address is not allowed.');
    expect(previewFailure(400, '   ')).toBe('This link cannot be previewed.');
  });

  it('says the page could not be opened for a 502, and a generic line for anything else', () => {
    expect(previewFailure(502, 'boom')).toBe(
      'The page could not be opened. Try again, or open it in a new tab.',
    );
    expect(previewFailure(undefined)).toBe('The preview failed. Try again, or open it in a new tab.');
  });
});
