/**
 * What a notification tap navigates to. The backend's only navigable key is
 * `data.action_url`; these pin that the identifiers beside it never become
 * links, and that hostile or unknown values never become navigation.
 */
import { describe, expect, it } from 'vitest';
import { notificationLink } from '../notificationLink';

const withData = (data: Record<string, unknown>) => ({ data });

describe('notificationLink', () => {
  it('returns the in-app action_url of a HITL request', () => {
    expect(
      notificationLink(withData({
        request_id: 'r1',
        execution_id: 'e1',
        action_url: '/runs?request=r1',
      })),
    ).toBe('/runs?request=r1');
  });

  it('keeps chat session deep links', () => {
    expect(notificationLink(withData({ action_url: '/ai-chat?session=s1' }))).toBe(
      '/ai-chat?session=s1',
    );
  });

  it('keeps org-scoped team links with a tab', () => {
    expect(notificationLink(withData({ action_url: '/team?org=7&tab=queue' }))).toBe(
      '/team?org=7&tab=queue',
    );
  });

  it('keeps a detail path under a known route', () => {
    expect(notificationLink(withData({ action_url: '/agents/12' }))).toBe('/agents/12');
  });

  it('returns null when there is no action_url, only identifiers', () => {
    expect(notificationLink(withData({ request_id: 'r1', execution_id: 'e1' }))).toBeNull();
    expect(notificationLink(withData({ pending_count: 3, request_ids: ['a', 'b'] }))).toBeNull();
    expect(notificationLink(withData({}))).toBeNull();
  });

  it('returns null for a missing or malformed notification', () => {
    expect(notificationLink(null)).toBeNull();
    expect(notificationLink(undefined)).toBeNull();
    expect(notificationLink({ data: null as unknown as Record<string, unknown> })).toBeNull();
  });

  it('refuses non-string and empty action_url values', () => {
    expect(notificationLink(withData({ action_url: 42 }))).toBeNull();
    expect(notificationLink(withData({ action_url: null }))).toBeNull();
    expect(notificationLink(withData({ action_url: '' }))).toBeNull();
    expect(notificationLink(withData({ action_url: ['/runs'] }))).toBeNull();
  });

  it('refuses absolute, protocol-relative and scheme URLs', () => {
    expect(notificationLink(withData({ action_url: 'https://evil.example/runs' }))).toBeNull();
    expect(notificationLink(withData({ action_url: '//evil.example/runs' }))).toBeNull();
    expect(notificationLink(withData({ action_url: 'javascript:alert(1)' }))).toBeNull();
    expect(notificationLink(withData({ action_url: 'runs' }))).toBeNull();
  });

  it('refuses backslash and whitespace tricks that browsers normalise into a host', () => {
    expect(notificationLink(withData({ action_url: '/\\evil.example' }))).toBeNull();
    expect(notificationLink(withData({ action_url: '/runs\\..\\x' }))).toBeNull();
    expect(notificationLink(withData({ action_url: '/\t/evil.example' }))).toBeNull();
    expect(notificationLink(withData({ action_url: '/runs?x=1 2' }))).toBeNull();
    expect(notificationLink(withData({ action_url: '/runs\n' }))).toBeNull();
  });

  it('refuses a path under a route the app does not serve', () => {
    expect(notificationLink(withData({ action_url: '/admin' }))).toBeNull();
    expect(notificationLink(withData({ action_url: '/' }))).toBeNull();
    expect(notificationLink(withData({ action_url: '/chat' }))).toBeNull();
  });
});
