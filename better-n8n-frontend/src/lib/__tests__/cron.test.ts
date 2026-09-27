import { describe as group, expect, it } from 'vitest';
import {
  DEFAULT_SPEC,
  describe as readable,
  fromCron,
  toCron,
  type ScheduleSpec,
} from '../cron';

const spec = (over: Partial<ScheduleSpec>): ScheduleSpec => ({
  ...DEFAULT_SPEC, ...over,
});

group('toCron', () => {
  it('compiles each preset to the five fields the backend parses', () => {
    expect(toCron(spec({ kind: 'daily', hour: 9, minute: 0 }))).toBe('0 9 * * *');
    expect(toCron(spec({ kind: 'weekdays', hour: 7, minute: 30 }))).toBe('30 7 * * 1-5');
    expect(toCron(spec({ kind: 'weekly', weekdays: [1, 4], hour: 18, minute: 0 })))
      .toBe('0 18 * * 1,4');
    expect(toCron(spec({ kind: 'monthly', monthday: 1, hour: 6, minute: 30 })))
      .toBe('30 6 1 * *');
    expect(toCron(spec({ kind: 'minutes', interval: 15 }))).toBe('*/15 * * * *');
    expect(toCron(spec({ kind: 'hourly', interval: 4, minute: 0 }))).toBe('0 */4 * * *');
  });

  it('writes an interval of one without a step, which is what cron means', () => {
    expect(toCron(spec({ kind: 'minutes', interval: 1 }))).toBe('* * * * *');
    expect(toCron(spec({ kind: 'hourly', interval: 1, minute: 5 }))).toBe('5 * * * *');
  });

  it('falls back to Monday rather than emitting an expression that matches nothing', () => {
    expect(toCron(spec({ kind: 'weekly', weekdays: [], hour: 9, minute: 0 })))
      .toBe('0 9 * * 1');
  });

  it('clamps out-of-range numbers instead of trusting the input', () => {
    expect(toCron(spec({ kind: 'daily', hour: 99, minute: -5 }))).toBe('0 23 * * *');
    expect(toCron(spec({ kind: 'monthly', monthday: 40, hour: 0, minute: 0 })))
      .toBe('0 0 31 * *');
  });
});

group('fromCron', () => {
  it('round-trips every preset, so an existing schedule opens in the pickers', () => {
    for (const cron of [
      '0 9 * * *', '30 7 * * 1-5', '0 18 * * 1,4', '30 6 1 * *',
      '*/15 * * * *', '0 */4 * * *', '* * * * *', '5 * * * *',
    ]) {
      expect(toCron(fromCron(cron))).toBe(cron);
    }
  });

  it('recognises the shape, not just the string', () => {
    expect(fromCron('0 9 * * *').kind).toBe('daily');
    expect(fromCron('30 7 * * 1-5').kind).toBe('weekdays');
    expect(fromCron('0 18 * * 1,4')).toMatchObject({
      kind: 'weekly', weekdays: [1, 4], hour: 18, minute: 0,
    });
    expect(fromCron('30 6 1 * *')).toMatchObject({ kind: 'monthly', monthday: 1 });
    expect(fromCron('*/15 * * * *')).toMatchObject({ kind: 'minutes', interval: 15 });
  });

  it('round-trips the weekdays preset with its time intact', () => {
    // The "Weekdays" chip compiles to `m h * * 1-5`, and an existing
    // weekday schedule must open back on that chip — not as raw cron.
    expect(fromCron('30 7 * * 1-5')).toMatchObject({
      kind: 'weekdays', hour: 7, minute: 30,
    });
    expect(toCron(fromCron('30 7 * * 1-5'))).toBe('30 7 * * 1-5');
  });

  it('folds 7 onto 0 for Sunday, as cron itself does', () => {
    // Otherwise the day row shows two Sundays, or one that will not tick.
    expect(fromCron('0 9 * * 7').weekdays).toEqual([0]);
    expect(fromCron('0 9 * * 0,7').weekdays).toEqual([0]);
  });

  it('falls back to custom for anything the pickers cannot model', () => {
    // A complete answer, not a failure: the raw expression stays editable.
    for (const cron of ['0 9 13 * FRI', '0 9 1 1 *', '0,30 9-17 * * *', 'nonsense']) {
      const parsed = fromCron(cron);
      expect(parsed.kind).toBe('custom');
      expect(parsed.expression).toBe(cron);
      expect(toCron(parsed)).toBe(cron);
    }
  });
});

group('describe', () => {
  /**
   * The same table as `agents/tests/test_schedules.py::DescribeTests.CANONICAL`,
   * verbatim. The client renders this reading while the user types and the
   * server's replaces it ~350ms later when the preview lands, so a wording that
   * differs by one word shows up as the sentence rewriting itself under the
   * cursor. Two tables that must agree is the cheapest way to catch a drift.
   */
  const CANONICAL: Array<[string, string]> = [
    ['* * * * *', 'Every minute'],
    ['*/15 * * * *', 'Every 15 minutes'],
    ['5 * * * *', 'Every hour at :05'],
    ['0 */4 * * *', 'Every 4 hours, at :00'],
    ['0 9 * * *', 'Every day at 09:00'],
    ['9 0 * * *', 'Every day at 00:09'],
    ['30 7 * * 1-5', 'Every weekday at 07:30'],
    ['0 18 * * 1,4', 'Every Monday and Thursday at 18:00'],
    ['0 9 * * 0,6', 'Every Saturday and Sunday at 09:00'],
    ['30 6 1 * *', 'On the 1st of every month at 06:30'],
  ];

  it('reads every picker shape exactly as the server reads it', () => {
    // The failure this catches is silent: `0 9 * * 1` and `9 0 * * 1` are both
    // valid, both plausible, and nine hours apart.
    for (const [cron, expected] of CANONICAL) {
      expect(readable(fromCron(cron)), cron).toBe(expected);
    }
  });

  it('gives an interval no day clause', () => {
    // "Every minute, every day" — the tail says nothing the head has not.
    for (const cron of ['* * * * *', '*/15 * * * *', '5 * * * *', '0 */4 * * *']) {
      expect(readable(fromCron(cron))).not.toContain('every day');
    }
  });

  it('reads an hour step as a step, not as its expansion', () => {
    // The picker says "every 4 hours"; the reading must not answer with the
    // six clock times it happens to expand to.
    expect(readable(fromCron('0 */4 * * *'))).toBe('Every 4 hours, at :00');
  });

  it('lists weekdays Monday first', () => {
    // Cron numbers weeks from Sunday, so sorting by the raw value would give
    // "Sunday and Saturday", which reads like a mistake.
    expect(readable(fromCron('0 9 * * 0,6')))
      .toBe('Every Saturday and Sunday at 09:00');
    expect(readable(fromCron('0 9 * * 6,0')))
      .toBe('Every Saturday and Sunday at 09:00');
  });

  it('names the zone, because that is the half that used to be missing', () => {
    expect(readable(fromCron('0 9 * * *'), 'Asia/Kolkata'))
      .toBe('Every day at 09:00 (Asia/Kolkata)');
  });

  it('says so when a weekly schedule has no days rather than reading as valid', () => {
    expect(readable(spec({ kind: 'weekly', weekdays: [] })))
      .toBe('Pick at least one day');
  });

  it('says nothing for a custom expression rather than echoing the cron', () => {
    // Only the server parses the general case. Showing `0 9 13 * 5` as the
    // headline for a third of a second is exactly the syntax this reading
    // exists to spare the user; the editor shows "Reading…" until the preview
    // lands and supplies real words.
    expect(readable(fromCron('0 9 13 * 5'))).toBe('');
  });
});
