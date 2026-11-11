import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Credential } from '../../api/credentials';
import { healthView, maskedKey } from '../credentialHealth';

const base = {
  id: 1,
  name: 'Gmail',
  credential_type: 1,
  credential_type_display: 'Google',
  is_valid: true,
  is_verified: true,
  last_used_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  fields: [],
} as Credential;

describe('healthView', () => {
  it('reads each server health value as the copy the page shows', () => {
    expect(healthView({ ...base, health: 'ok' })).toMatchObject({ text: 'Working', dot: 'bg-success' });
    expect(healthView({ ...base, health: 'failed' })).toMatchObject({
      text: 'Rejected last time — check the key',
      dot: 'bg-destructive',
    });
    expect(healthView({ ...base, health: 'unverified' })).toMatchObject({
      text: 'Not checked yet',
      dot: 'bg-muted-foreground/50',
    });
  });

  describe('expiring', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('counts the days left from token_expires_at', () => {
      const c = { ...base, health: 'expiring', token_expires_at: '2026-06-06T12:00:00Z' } as Credential;
      expect(healthView(c).text).toBe('Expires in 5 days');
    });

    it('uses the singular for one day', () => {
      const c = { ...base, health: 'expiring', token_expires_at: '2026-06-02T11:00:00Z' } as Credential;
      expect(healthView(c).text).toBe('Expires in 1 day');
    });

    it('says expired once the date has passed', () => {
      const c = { ...base, health: 'expiring', token_expires_at: '2026-05-30T00:00:00Z' } as Credential;
      expect(healthView(c).text).toBe('Expired');
    });

    it('does not invent a count when there is no date', () => {
      const c = { ...base, health: 'expiring', token_expires_at: null } as Credential;
      expect(healthView(c).text).toBe('Expires soon');
    });
  });

  it('falls back to the old reading when health is missing (older server)', () => {
    expect(healthView({ ...base, is_verified: true })).toMatchObject({ text: 'Verified', tone: 'text-success' });
    expect(healthView({ ...base, is_verified: false })).toMatchObject({
      text: 'Needs verification',
      tone: 'text-warning',
    });
  });
});

describe('maskedKey', () => {
  it('shows the secret field exactly as the server masked it', () => {
    const c = {
      ...base,
      fields: [
        { key: 'region', label: 'Region', type: 'text', value: 'us-east-1' },
        { key: 'api_key', label: 'Key', type: 'password', value: '********wxyz' },
      ],
    } as Credential;
    expect(maskedKey(c)).toBe('********wxyz');
  });

  it('never shows a plain field as if it were a key', () => {
    const c = { ...base, fields: [{ key: 'region', label: 'Region', type: 'text', value: 'us-east-1' }] } as Credential;
    expect(maskedKey(c)).toBeNull();
  });

  it('shows nothing when the server sent no value', () => {
    const c = { ...base, fields: [{ key: 'api_key', label: 'Key', type: 'password', value: '' }] } as Credential;
    expect(maskedKey(c)).toBeNull();
  });
});
