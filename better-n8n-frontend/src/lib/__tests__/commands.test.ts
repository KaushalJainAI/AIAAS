import { describe as group, expect, it } from 'vitest';
import {
  buildCommandPayload,
  chipLabel,
  findCommand,
  isCommandLine,
  parseDurationSeconds,
  prefillCommandInput,
  rankCommands,
  splitCommandLine,
  type CommandDef,
} from '../commands';

const catalogue = (names: string[]): CommandDef[] =>
  names.map((name) => ({
    name,
    summary: `${name} does things`,
    kind: 'turn',
    group: 'general',
  }));

group('splitCommandLine', () => {
  it('splits a leading slash line, allowing leading whitespace', () => {
    expect(splitCommandLine('/agent Reporter hi')).toEqual({
      name: 'agent',
      rest: 'Reporter hi',
    });
    expect(splitCommandLine('   /goal chase invoices')).toEqual({
      name: 'goal',
      rest: 'chase invoices',
    });
  });

  it('ignores a slash anywhere else, so paths in sentences never trigger', () => {
    expect(splitCommandLine('see /Chat/notes.md for it')).toBeNull();
    expect(splitCommandLine('a / b')).toBeNull();
    expect(splitCommandLine('/')).toBeNull();
    expect(splitCommandLine('')).toBeNull();
  });

  it('isCommandLine mirrors the split', () => {
    expect(isCommandLine('/help')).toBe(true);
    expect(isCommandLine('help me with /agent')).toBe(false);
  });
});

group('rankCommands', () => {
  const commands = catalogue(['agent', 'code-review', 'goal', 'memory', 'help']);

  it('ranks a prefix match first', () => {
    const ranked = rankCommands('ag', commands).map((c) => c.name);
    expect(ranked[0]).toBe('agent');
  });

  it('finds aliases', () => {
    const withAlias: CommandDef[] = [
      { name: 'new', summary: 'new conversation', kind: 'client', group: 'general', aliases: ['clear'] },
    ];
    expect(rankCommands('cle', withAlias).map((c) => c.name)).toEqual(['new']);
    expect(findCommand('clear', withAlias)?.name).toBe('new');
  });

  it('returns everything on an empty query, and nothing on no match', () => {
    expect(rankCommands('', commands)).toHaveLength(commands.length);
    expect(rankCommands('zzz-no-such-command', commands)).toEqual([]);
  });
});

group('chips', () => {
  it('carries ids so the request never re-resolves a chosen name', () => {
    const command: CommandDef = {
      name: 'agent',
      summary: 'hand a task over',
      kind: 'turn',
      group: 'agents',
    };
    const payload = buildCommandPayload(
      command,
      [{ arg: 'agent', id: '12', label: 'Reporter' }],
      'summarise inbox',
    );
    expect(payload).toEqual({
      name: 'agent',
      args: { agent: '12' },
      text: 'summarise inbox',
    });
  });

  it('renders the transcript chip from the resolved label', () => {
    expect(chipLabel('agent', { agent: '12' }, { '12': 'Reporter' })).toBe(
      '/agent Reporter',
    );
    expect(chipLabel('goal', {})).toBe('/goal');
  });
});

group('prefillCommandInput', () => {
  it('starts a bare command when the box is empty or just a slash', () => {
    expect(prefillCommandInput('', 'agent')).toBe('/agent ');
    expect(prefillCommandInput('   ', 'goal')).toBe('/goal ');
    expect(prefillCommandInput('/', 'help')).toBe('/help ');
  });

  it('replaces a partial filter but keeps the typed task', () => {
    expect(prefillCommandInput('/ag', 'agent')).toBe('/agent ');
    expect(prefillCommandInput('/agent summarise inbox', 'goal')).toBe(
      '/goal summarise inbox',
    );
  });

  it('keeps prose typed before the palette was opened via the button', () => {
    expect(prefillCommandInput('summarise this', 'agent')).toBe(
      '/agent summarise this',
    );
  });
});

group('parseDurationSeconds', () => {
  it('reads 90m, 2h, 3d and bare minutes', () => {
    expect(parseDurationSeconds('90m')).toBe(5400);
    expect(parseDurationSeconds('2h')).toBe(7200);
    expect(parseDurationSeconds('3d')).toBe(259200);
    expect(parseDurationSeconds('30')).toBe(1800);
  });

  it('refuses rather than guesses', () => {
    expect(parseDurationSeconds('soon')).toBeNull();
    expect(parseDurationSeconds('')).toBeNull();
  });
});
