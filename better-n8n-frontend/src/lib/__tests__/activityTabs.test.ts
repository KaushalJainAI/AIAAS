import { describe, expect, it } from 'vitest';
import { ACTIVITY_TABS, ACTIVITY_TAB_LABELS, parseActivityTab } from '../activityTabs';

describe('parseActivityTab', () => {
  it('reads every known tab', () => {
    for (const tab of ACTIVITY_TABS) expect(parseActivityTab(tab)).toBe(tab);
  });

  it('lands on now for a missing, empty or unknown value', () => {
    expect(parseActivityTab(null)).toBe('now');
    expect(parseActivityTab(undefined)).toBe('now');
    expect(parseActivityTab('')).toBe('now');
    expect(parseActivityTab('inbox')).toBe('now');
    expect(parseActivityTab('NOW')).toBe('now');
  });

  it('labels every tab', () => {
    for (const tab of ACTIVITY_TABS) expect(ACTIVITY_TAB_LABELS[tab]).toBeTruthy();
  });
});
