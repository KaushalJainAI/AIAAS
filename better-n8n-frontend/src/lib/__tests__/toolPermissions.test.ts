import { describe, expect, it } from 'vitest';
import {
  countToolPermissions,
  pruneToolPermissions,
  toggleToolPermission,
} from '../toolPermissions';

describe('toggleToolPermission', () => {
  it('sets an unset tool to the picked mode', () => {
    expect(toggleToolPermission({}, 'write_file', 'ask')).toEqual({ write_file: 'ask' });
  });

  it('picking the active mode clears it back to inherit', () => {
    expect(toggleToolPermission({ write_file: 'ask' }, 'write_file', 'ask')).toEqual({});
  });

  it('switching modes replaces without a clear step', () => {
    expect(toggleToolPermission({ write_file: 'ask' }, 'write_file', 'deny')).toEqual({
      write_file: 'deny',
    });
  });

  it('leaves other tools alone and tolerates undefined', () => {
    expect(toggleToolPermission(undefined, 'read_file', 'allow')).toEqual({ read_file: 'allow' });
    expect(
      toggleToolPermission({ write_file: 'ask' }, 'read_file', 'allow'),
    ).toEqual({ write_file: 'ask', read_file: 'allow' });
  });
});

describe('pruneToolPermissions', () => {
  it('drops rules for tools the grants no longer unlock', () => {
    expect(
      pruneToolPermissions({ write_file: 'ask', generate_image: 'deny' }, ['write_file']),
    ).toEqual({ write_file: 'ask' });
  });

  it('keeps everything when nothing changed and tolerates undefined', () => {
    expect(pruneToolPermissions(undefined, ['write_file'])).toEqual({});
    expect(pruneToolPermissions({}, [])).toEqual({});
  });
});

describe('countToolPermissions', () => {
  it('counts only rules on granted tools', () => {
    expect(
      countToolPermissions({ write_file: 'ask', generate_image: 'deny' }, ['write_file']),
    ).toBe(1);
  });
});
