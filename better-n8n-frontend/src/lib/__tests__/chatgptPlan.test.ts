import { describe, expect, it } from 'vitest';
import { planErrorMessage, planView } from '../chatgptPlan';

const status = (over = {}) => ({
  enabled: true, connected: false, email: '', needs_sign_in: false,
  manage_usage_url: 'https://chatgpt.com/#settings/Usage', ...over,
});

describe('planView', () => {
  it('draws nothing until the server has answered', () => {
    expect(planView(null, false)).toBe('hidden');
  });

  it('draws nothing where the feature is switched off, even mid sign-in', () => {
    expect(planView(status({ enabled: false }), true)).toBe('hidden');
    expect(planView(status({ enabled: false, connected: true }), false)).toBe('hidden');
  });

  it('offers the button to someone who has never signed in', () => {
    expect(planView(status(), false)).toBe('connect');
  });

  it('waits while the popup is open', () => {
    expect(planView(status(), true)).toBe('waiting');
  });

  it('shows connected as soon as the server says so, popup or not', () => {
    expect(planView(status({ connected: true }), true)).toBe('connected');
  });

  it('asks for a new sign-in when the old one ended', () => {
    expect(planView(status({ needs_sign_in: true }), false)).toBe('reconnect');
  });
});

describe('planErrorMessage', () => {
  it('keeps the sentence the server wrote', () => {
    const error = { response: { data: { error: 'Only works on this machine.' } } };
    expect(planErrorMessage(error)).toBe('Only works on this machine.');
  });

  it('falls back to a plain sentence', () => {
    expect(planErrorMessage(new Error('Network Error'))).toMatch(/Try again/);
    expect(planErrorMessage({ response: { data: { error: { nested: 1 } } } })).toMatch(/Try again/);
  });
});
