import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RESERVED_BROWSER_CHORDS,
  SEQUENCE_TIMEOUT_MS,
  SHORTCUTS,
  formatKeys,
  isMac,
  isSingleKeySpec,
  matchesChord,
  readSingleKeyEnabled,
  stepSequence,
  writeSingleKeyEnabled,
  type SequenceState,
  type Shortcut,
} from '../shortcuts';

type Ev = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean };

const none: Ev = { key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

/** An event that presses exactly the keys a spec names. */
function eventFor(spec: string): Ev {
  const parts = spec.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const shift = mods.includes('shift') || key === '?';
  return {
    key: shift && key.length === 1 ? key.toUpperCase() : key,
    ctrlKey: mods.includes('mod'),
    metaKey: false,
    altKey: mods.includes('alt'),
    shiftKey: shift,
  };
}

const chordRows = SHORTCUTS.filter((s) => !s.handledElsewhere && !s.sequence);
const goRows = SHORTCUTS.filter((s) => s.group === 'Go to');

function byId(id: string): Shortcut {
  const row = SHORTCUTS.find((s) => s.id === id);
  if (!row) throw new Error(`no shortcut ${id}`);
  return row;
}

describe('SHORTCUTS table', () => {
  it('every chord row matches its own spec', () => {
    for (const row of chordRows) {
      for (const spec of row.keys) {
        expect(matchesChord(eventFor(spec), spec), `${row.id} ${spec}`).toBe(true);
      }
    }
  });

  it('no chord takes a key the browser or the OS owns', () => {
    for (const row of SHORTCUTS) {
      for (const spec of row.keys) {
        expect(RESERVED_BROWSER_CHORDS, `${row.id} ${spec}`).not.toContain(spec);
      }
    }
  });

  it('no two rows share keys', () => {
    const seen = new Map<string, string>();
    for (const row of SHORTCUTS) {
      const signatures = row.sequence ? [row.keys.join(' ')] : row.keys;
      for (const sig of signatures) {
        expect(seen.has(sig), `${sig} is on ${seen.get(sig)} and ${row.id}`).toBe(false);
        seen.set(sig, row.id);
      }
    }
  });

  it('go-to rows are the seven pages, each a g-then-letter sequence', () => {
    expect(goRows.map((r) => r.keys.join(''))).toEqual(['gc', 'gr', 'ga', 'ge', 'gf', 'gk', 'gs']);
    for (const row of goRows) {
      expect(row.sequence).toBe(true);
      expect(row.to).toMatch(/^\//);
    }
  });

  it('marks single-key rows, and the help sheet lists every row', () => {
    expect(byId('focus-search').singleKey).toBe(true);
    expect(byId('toggle-sidebar').singleKey).toBe(false);
    expect(byId('help').keys).toEqual(['?', 'mod+/']);
  });
});

describe('matchesChord', () => {
  it("'?' matches with shift", () => {
    expect(matchesChord({ ...none, key: '?', shiftKey: true }, '?')).toBe(true);
    expect(matchesChord({ ...none, key: '?' }, '?')).toBe(true);
  });

  it("'?' does not match when Ctrl is held", () => {
    expect(matchesChord({ ...none, key: '?', ctrlKey: true, shiftKey: true }, '?')).toBe(false);
  });

  it("'mod+/' does not match a plain '/'", () => {
    expect(matchesChord({ ...none, key: '/' }, 'mod+/')).toBe(false);
    expect(matchesChord({ ...none, key: '/', ctrlKey: true }, 'mod+/')).toBe(true);
    expect(matchesChord({ ...none, key: '/', metaKey: true }, 'mod+/')).toBe(true);
  });

  it('plain letters do not match when an unlisted modifier is held', () => {
    expect(matchesChord({ ...none, key: '/', shiftKey: true }, '/')).toBe(false);
    expect(matchesChord({ ...none, key: 'k', altKey: true }, 'mod+k')).toBe(false);
    expect(matchesChord({ ...none, key: 'O', ctrlKey: true }, 'mod+shift+o')).toBe(false);
  });

  it('compares the key case-insensitively', () => {
    expect(matchesChord({ ...none, key: 'K', ctrlKey: true }, 'mod+k')).toBe(true);
    expect(matchesChord({ ...none, key: 'o', ctrlKey: true, shiftKey: true }, 'mod+shift+o')).toBe(true);
  });

  it('detects single-key specs', () => {
    expect(isSingleKeySpec('?')).toBe(true);
    expect(isSingleKeySpec('/')).toBe(true);
    expect(isSingleKeySpec('mod+/')).toBe(false);
    expect(isSingleKeySpec('alt+arrowleft')).toBe(false);
  });
});

describe('go-to sequence', () => {
  const start: SequenceState = { pending: null, at: 0 };

  it('g then c matches the Ask page within 1500 ms', () => {
    const first = stepSequence(start, 'g', 0);
    expect(first.match).toBeNull();
    const second = stepSequence(first.state, 'c', 1000);
    expect(second.match?.to).toBe('/ai-chat');
    expect(second.state.pending).toBeNull();
  });

  it('does not match after the timeout', () => {
    const first = stepSequence(start, 'g', 0);
    const late = stepSequence(first.state, 'c', SEQUENCE_TIMEOUT_MS + 100);
    expect(late.match).toBeNull();
  });

  it('a g that expired starts a new sequence', () => {
    const first = stepSequence(start, 'g', 0);
    const again = stepSequence(first.state, 'g', 5000);
    expect(again.state.pending).toBe('g');
    expect(stepSequence(again.state, 's', 5100).match?.to).toBe('/settings');
  });

  it('a key that is not a go-to letter clears the sequence', () => {
    const first = stepSequence(start, 'g', 0);
    const other = stepSequence(first.state, 'x', 100);
    expect(other.match).toBeNull();
    expect(other.state.pending).toBeNull();
    expect(stepSequence(other.state, 'c', 200).match).toBeNull();
  });

  it('matches letters in either case', () => {
    const first = stepSequence(start, 'G', 0);
    expect(stepSequence(first.state, 'R', 10).match?.to).toBe('/runs');
  });
});

describe('formatKeys', () => {
  it('shows Cmd on a Mac and Ctrl elsewhere', () => {
    const k = byId('command-menu');
    expect(formatKeys(k, true)).toBe('⌘K');
    expect(formatKeys(k, false)).toBe('Ctrl+K');
  });

  it('shows the new-chat chord with Shift', () => {
    const n = byId('new-chat');
    expect(formatKeys(n, true)).toBe('⌘⇧O');
    expect(formatKeys(n, false)).toBe('Ctrl+Shift+O');
  });

  it('shows a sequence as G then C', () => {
    expect(formatKeys(byId('go-chat'), true)).toBe('G then C');
    expect(formatKeys(byId('go-chat'), false)).toBe('G then C');
  });

  it('shows both help keys as alternatives', () => {
    expect(formatKeys(byId('help'), false)).toBe('? or Ctrl+/');
    expect(formatKeys(byId('help'), true)).toBe('? or ⌘/');
  });
});

describe('isMac', () => {
  it('recognises Apple user agents only', () => {
    expect(isMac('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe(true);
    expect(isMac('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(true);
    expect(isMac('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
  });
});

describe('single-key storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to on when nothing is stored', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      dispatchEvent: () => true,
    });
    expect(readSingleKeyEnabled()).toBe(true);
  });

  it('round-trips a write', () => {
    const store = new Map<string, string>();
    const dispatched: string[] = [];
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
      dispatchEvent: (e: { type: string }) => {
        dispatched.push(e.type);
        return true;
      },
    });
    writeSingleKeyEnabled(false);
    expect(readSingleKeyEnabled()).toBe(false);
    expect(dispatched).toEqual(['aiaas:shortcuts-single-key']);
    writeSingleKeyEnabled(true);
    expect(readSingleKeyEnabled()).toBe(true);
  });

  it('reads true when storage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(readSingleKeyEnabled()).toBe(true);
  });

  it('a write to blocked storage does not throw', () => {
    vi.stubGlobal('window', {
      localStorage: {
        setItem: () => {
          throw new Error('blocked');
        },
      },
      dispatchEvent: () => true,
    });
    expect(() => writeSingleKeyEnabled(false)).not.toThrow();
  });

  it('reads true with no window at all', () => {
    expect(readSingleKeyEnabled()).toBe(true);
  });
});
