import { describe, expect, it } from 'vitest';

import {
  answeredPercent,
  attentionLabel,
  cleanTag,
  flagOn,
  isCuratorTab,
  nextPageParam,
  openIdOf,
  paramOfScope,
  problemFromQuery,
  scopeOfParam,
  teamTabOf,
  visibleTabs,
} from '../solutionsPage';

describe('teamTabOf', () => {
  it('opens each named tab', () => {
    expect(teamTabOf('library')).toBe('library');
    expect(teamTabOf('drafts')).toBe('drafts');
    expect(teamTabOf('queue')).toBe('queue');
    expect(teamTabOf('insights')).toBe('insights');
    expect(teamTabOf('team')).toBe('team');
  });

  it('maps the old names to their new tabs', () => {
    expect(teamTabOf('solutions')).toBe('library');
    expect(teamTabOf('organisation')).toBe('team');
  });

  it('falls back to the library for a missing or unknown value', () => {
    expect(teamTabOf(null)).toBe('library');
    expect(teamTabOf('')).toBe('library');
    expect(teamTabOf('nonsense')).toBe('library');
    expect(teamTabOf('constructor')).toBe('library');
  });
});

describe('visibleTabs', () => {
  it('hides the curator tabs from a member', () => {
    expect(visibleTabs(false)).toEqual(['library', 'drafts', 'team']);
  });

  it('shows every tab to a curator, in order', () => {
    expect(visibleTabs(true)).toEqual(['library', 'drafts', 'queue', 'insights', 'team']);
  });

  it('marks exactly the queue and insights as curator tabs', () => {
    expect(isCuratorTab('queue')).toBe(true);
    expect(isCuratorTab('insights')).toBe(true);
    expect(isCuratorTab('library')).toBe(false);
    expect(isCuratorTab('team')).toBe(false);
  });
});

describe('scopeOfParam', () => {
  it('reads personal as no organisation', () => {
    expect(scopeOfParam('personal')).toBeNull();
  });

  it('reads a positive id as an organisation', () => {
    expect(scopeOfParam('3')).toBe(3);
    expect(scopeOfParam('120')).toBe(120);
  });

  it('treats an absent or invalid value as "use the active organisation"', () => {
    expect(scopeOfParam(null)).toBeUndefined();
    expect(scopeOfParam('')).toBeUndefined();
    expect(scopeOfParam('0')).toBeUndefined();
    expect(scopeOfParam('-2')).toBeUndefined();
    expect(scopeOfParam('3abc')).toBeUndefined();
    expect(scopeOfParam('1.5')).toBeUndefined();
  });

  it('writes a scope back the way it is read', () => {
    expect(paramOfScope(null)).toBe('personal');
    expect(scopeOfParam(paramOfScope(7))).toBe(7);
    expect(scopeOfParam(paramOfScope(null))).toBeNull();
  });
});

describe('openIdOf and flagOn', () => {
  it('reads a solution id and rejects anything else', () => {
    expect(openIdOf('12')).toBe(12);
    expect(openIdOf('0')).toBeNull();
    expect(openIdOf('x')).toBeNull();
    expect(openIdOf(null)).toBeNull();
  });

  it('reads 1 and true as on, anything else as off', () => {
    expect(flagOn('1')).toBe(true);
    expect(flagOn('true')).toBe(true);
    expect(flagOn('0')).toBe(false);
    expect(flagOn('yes')).toBe(false);
    expect(flagOn(null)).toBe(false);
  });
});

describe('cleanTag', () => {
  it('trims, lower-cases and bounds a tag like the server', () => {
    expect(cleanTag('  CI  ')).toBe('ci');
    expect(cleanTag(null)).toBe('');
    expect(cleanTag('a'.repeat(60))).toHaveLength(40);
  });
});

describe('attentionLabel', () => {
  it('names each reason in plain words', () => {
    expect(attentionLabel('needs_check')).toBe('Needs check');
    expect(attentionLabel('doubtful')).toBe('Doubtful');
    expect(attentionLabel('claims_stale')).toBe('Claims may be out of date');
  });

  it('still reads an unknown reason as attention', () => {
    expect(attentionLabel('something_new')).toBe('Needs attention');
  });
});

describe('nextPageParam', () => {
  it('returns the offset of the next page', () => {
    expect(nextPageParam({ next_offset: 100 })).toBe(100);
  });

  it('returns undefined on the last page', () => {
    expect(nextPageParam({ next_offset: null })).toBeUndefined();
    expect(nextPageParam({})).toBeUndefined();
  });
});

describe('answeredPercent', () => {
  it('rounds the answered share to a whole percent', () => {
    expect(answeredPercent(3, 4)).toBe('75%');
    expect(answeredPercent(1, 3)).toBe('33%');
    expect(answeredPercent(0, 5)).toBe('0%');
  });

  it('shows a dash when there were no searches', () => {
    expect(answeredPercent(0, 0)).toBe('—');
  });
});

describe('problemFromQuery', () => {
  it('puts the first letter back after the server lower-cases it', () => {
    expect(problemFromQuery('build fails on windows')).toBe('Build fails on windows');
    expect(problemFromQuery('  padded  ')).toBe('Padded');
    expect(problemFromQuery('   ')).toBe('');
  });
});
