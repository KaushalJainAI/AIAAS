import { describe, expect, it } from 'vitest';
import { firstName, greeting, shortAgo } from '../welcome';

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greeting(8)).toBe('Good morning');
    expect(greeting(13)).toBe('Good afternoon');
    expect(greeting(20)).toBe('Good evening');
    expect(greeting(2)).toBe('Good evening');
  });
});

describe('firstName', () => {
  it('takes the first word of a name', () => {
    expect(firstName('Kaushal Jain')).toBe('Kaushal');
  });
  it('uses the part of an email before the @', () => {
    expect(firstName('sam@example.com')).toBe('Sam');
  });
  it('is empty when there is no name', () => {
    expect(firstName('')).toBe('');
    expect(firstName(undefined)).toBe('');
  });
});

describe('shortAgo', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  it('counts minutes, hours and days', () => {
    expect(shortAgo('2026-11-12T11:59:30Z', now)).toBe('now');
    expect(shortAgo('2026-11-12T11:55:00Z', now)).toBe('5m');
    expect(shortAgo('2026-11-12T09:00:00Z', now)).toBe('3h');
    expect(shortAgo('2026-11-10T12:00:00Z', now)).toBe('2d');
  });
  it('is empty for a date it cannot read', () => {
    expect(shortAgo('not a date', now)).toBe('');
  });
});
