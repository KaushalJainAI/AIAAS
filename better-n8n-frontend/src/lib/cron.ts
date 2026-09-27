/**
 * Cron as a form, not as a string.
 *
 * The schedule field used to be a bare text input holding `0 9 * * 1`, which
 * asks the user to be fluent in a syntax whose two commonest mistakes —
 * transposing minute and hour, and Sunday being both 0 and 7 — are both silent.
 * This module is the translation layer: a small set of shapes people actually
 * schedule (`daily at 09:00`, `every 15 minutes`, `weekdays`, `monthly on the
 * 1st`) that compile down to the same five fields the backend already parses.
 *
 * Two rules keep it honest:
 *
 * 1. **Cron stays the storage.** The spec is a view of an expression, never a
 *    second source of truth — `toCron` and `fromCron` round-trip, and anything
 *    that does not fit a preset falls back to `custom`, which is the raw string.
 *    A stored schedule this file cannot model is still editable, just not with
 *    the pickers.
 * 2. **The reading here is a draft.** `describe` renders instantly as the user
 *    types, but the reading that matters is the one `/triggers/preview/`
 *    returns, because that is the code the sweep will actually run. Two cron
 *    implementations agree right up until the day they do not, so the server's
 *    answer replaces this one as soon as it arrives.
 */

/** The shapes offered as pickers. `custom` is the escape hatch to raw cron. */
export type ScheduleKind =
  | 'minutes'
  | 'hourly'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'custom';

export interface ScheduleSpec {
  kind: ScheduleKind;
  /** For `minutes` / `hourly`: the interval. */
  interval: number;
  /** Wall-clock time in the schedule's own timezone, 0-23 / 0-59. */
  hour: number;
  minute: number;
  /** For `weekly`: cron weekdays, Sunday = 0. Never empty when saved. */
  weekdays: number[];
  /** For `monthly`: day of the month, 1-31. */
  monthday: number;
  /** For `custom`: the expression itself. */
  expression: string;
}

export const DEFAULT_SPEC: ScheduleSpec = {
  kind: 'daily',
  interval: 15,
  hour: 9,
  minute: 0,
  weekdays: [1],
  monthday: 1,
  expression: '0 9 * * *',
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/**
 * Intervals that divide their unit evenly. A step of 7 minutes is legal cron
 * and fires at :00, :07 … :56 and then again at :00 — a 4-minute gap once an
 * hour that nobody choosing "every 7 minutes" is asking for. Offering only
 * clean divisors is cheaper than explaining the wrap.
 */
export const MINUTE_INTERVALS = [1, 2, 5, 10, 15, 20, 30];
export const HOUR_INTERVALS = [1, 2, 3, 4, 6, 8, 12];

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.trunc(n) : lo));

/** A spec as the five cron fields the backend parses. */
export function toCron(spec: ScheduleSpec): string {
  const m = clamp(spec.minute, 0, 59);
  const h = clamp(spec.hour, 0, 23);

  switch (spec.kind) {
    case 'minutes': {
      const n = clamp(spec.interval, 1, 59);
      return n === 1 ? '* * * * *' : `*/${n} * * * *`;
    }
    case 'hourly': {
      const n = clamp(spec.interval, 1, 23);
      return n === 1 ? `${m} * * * *` : `${m} */${n} * * *`;
    }
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekdays':
      return `${m} ${h} * * 1-5`;
    case 'weekly': {
      // Empty would compile to an expression that matches nothing, so the
      // fallback is Monday rather than an invalid string the user has to
      // decode an error about.
      const days = spec.weekdays.length ? [...spec.weekdays].sort() : [1];
      return `${m} ${h} * * ${days.join(',')}`;
    }
    case 'monthly':
      return `${m} ${h} ${clamp(spec.monthday, 1, 31)} * *`;
    case 'custom':
    default:
      return spec.expression.trim();
  }
}

/**
 * The nearest spec for an expression, so an existing schedule opens in the
 * pickers rather than as an opaque string. Anything outside the presets comes
 * back as `custom` — which is a complete answer, not a failure.
 */
export function fromCron(expression: string): ScheduleSpec {
  const raw = (expression || '').trim();
  const parts = raw.split(/\s+/);
  const custom: ScheduleSpec = { ...DEFAULT_SPEC, kind: 'custom', expression: raw };
  if (parts.length !== 5) return custom;

  const [min, hr, dom, mon, dow] = parts;
  if (mon !== '*') return custom;

  const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);
  const step = (s: string) => (/^\*\/\d+$/.test(s) ? Number(s.slice(2)) : null);

  // Every N minutes.
  if (hr === '*' && dom === '*' && dow === '*') {
    if (min === '*') return { ...custom, kind: 'minutes', interval: 1 };
    const n = step(min);
    if (n) return { ...custom, kind: 'minutes', interval: n };
  }

  const m = num(min);
  if (m === null) return custom;

  // Every N hours, at :mm.
  if (dom === '*' && dow === '*') {
    if (hr === '*') return { ...custom, kind: 'hourly', interval: 1, minute: m };
    const n = step(hr);
    if (n) return { ...custom, kind: 'hourly', interval: n, minute: m };
  }

  const h = num(hr);
  if (h === null) return custom;
  const base = { ...custom, hour: h, minute: m };

  if (dom === '*' && dow === '*') return { ...base, kind: 'daily' };
  if (dom === '*' && dow === '1-5') return { ...base, kind: 'weekdays' };

  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
    // 7 and 0 both mean Sunday; folded so the checkbox row cannot show two
    // Sundays or, worse, one that will not tick.
    const days = [...new Set(dow.split(',').map((d) => (Number(d) === 7 ? 0 : Number(d))))];
    return { ...base, kind: 'weekly', weekdays: days.sort() };
  }

  const day = num(dom);
  if (day !== null && dow === '*') return { ...base, kind: 'monthly', monthday: day };

  return custom;
}

const two = (n: number) => String(n).padStart(2, '0');
const at = (h: number, m: number) => `${two(h)}:${two(m)}`;

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? '';
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13
    ? 'th'
    : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${s}`;
}

/**
 * Monday first. Cron numbers weeks from Sunday, but "Saturday and Sunday" is
 * how people say the weekend — sorting by the raw cron number renders it
 * "Sunday and Saturday", which reads like a mistake.
 */
const weekdayOrder = (d: number) => (d + 6) % 7;

/**
 * A spec in words, rendered locally so the reading keeps up with typing.
 *
 * **Every string this produces has to match `agents/triggers.py::describe`
 * exactly.** The server's reading replaces this one when the preview lands
 * ~350ms later, so any difference in wording shows up as the sentence rewriting
 * itself under the user's cursor — which reads as a bug even when both
 * readings are correct. The shared vocabulary is:
 *
 * - `Every minute` / `Every 15 minutes` / `Every hour at :05`
 * - `Every 4 hours, at :00` — never the six clock times it expands to
 * - `Every day at 09:00` / `Every weekday at 09:00`
 * - `Every Monday and Thursday at 18:00`
 * - `On the 1st of every month at 06:30`
 *
 * An interval phrase never takes a trailing day clause: `* * * * *` is
 * "Every minute", not "Every minute, every day".
 */
export function describe(spec: ScheduleSpec, tz?: string): string {
  const zone = tz ? ` (${tz})` : '';

  // `custom` holds an arbitrary expression the pickers cannot model, so there
  // is nothing to read from the spec's fields — only the server parses the
  // general case. Returning '' rather than echoing the raw cron matters:
  // showing `0 9 13 * 5` as the headline for a third of a second is exactly
  // the syntax this whole reading exists to spare the user. The editor shows
  // "Reading…" instead until the preview lands.
  if (spec.kind === 'custom') return '';

  // The time half, and whether it already implies "all day" — an interval
  // takes no day clause.
  let when: string;
  let interval: boolean;
  switch (spec.kind) {
    case 'minutes':
      when = spec.interval === 1 ? 'Every minute' : `Every ${spec.interval} minutes`;
      interval = true;
      break;
    case 'hourly':
      when = spec.interval === 1
        ? `Every hour at :${two(spec.minute)}`
        : `Every ${spec.interval} hours, at :${two(spec.minute)}`;
      interval = true;
      break;
    default:
      when = `at ${at(spec.hour, spec.minute)}`;
      interval = false;
  }

  // The day half.
  let days: string;
  switch (spec.kind) {
    case 'weekdays':
      days = 'every weekday';
      break;
    case 'weekly': {
      if (!spec.weekdays.length) return 'Pick at least one day';
      days = 'every ' + joinWords(
        [...spec.weekdays]
          .sort((a, b) => weekdayOrder(a) - weekdayOrder(b))
          .map((d) => DAY_FULL[d]),
      );
      break;
    }
    case 'monthly':
      days = `on the ${ordinal(spec.monthday)} of every month`;
      break;
    default:
      days = 'every day';
  }

  const text = interval
    ? (days === 'every day' ? when : `${when}, ${days}`)
    : `${days} ${when}`;
  const sentence = `${text}${zone}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * The viewer's own IANA zone, which is the only sensible default: a schedule
 * typed as "9am" means 9am where the person typing it is.
 */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Every zone this browser knows, newest API first. The fallback list is short
 * on purpose — it exists so the picker is never empty on an old engine, not to
 * be a second copy of the tz database.
 */
export function allZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      const zones = supported('timeZone');
      if (zones?.length) return ['UTC', ...zones.filter((z) => z !== 'UTC')];
    } catch {
      /* fall through to the short list */
    }
  }
  const here = localZone();
  const common = [
    'UTC', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo',
    'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York',
    'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Australia/Sydney',
  ];
  return common.includes(here) ? common : [here, ...common];
}

/** e.g. "UTC+05:30", for showing what a zone choice actually costs in offset. */
export function zoneOffsetLabel(zone: string, when: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, timeZoneName: 'longOffset',
    }).formatToParts(when);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}
