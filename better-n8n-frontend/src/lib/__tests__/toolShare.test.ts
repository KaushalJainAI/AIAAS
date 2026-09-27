import { describe, expect, it } from 'vitest';
import { parseToolShareSlug } from '../toolShare';

describe('parseToolShareSlug', () => {
  it('takes a bare slug as-is', () => {
    expect(parseToolShareSlug('acme-orders-api')).toBe('acme-orders-api');
  });

  it('takes the last segment of a pasted URL', () => {
    expect(parseToolShareSlug('https://app.example.com/tools/shared/acme-orders-api'))
      .toBe('acme-orders-api');
  });

  it('tolerates trailing slashes and whitespace', () => {
    expect(parseToolShareSlug('  /tools/shared/acme/  ')).toBe('acme');
  });

  it('answers empty for empty input', () => {
    expect(parseToolShareSlug('   ')).toBe('');
  });
});
