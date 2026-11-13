/**
 * The cron wording contract, as data. Copied from better-n8n-frontend/src/lib/__tests__/cron.test.ts.
 *
 * `CANONICAL` is the same table as `agents/tests/test_schedules.py::DescribeTests.CANONICAL`,
 * verbatim. Both readings must produce these strings for these expressions. A
 * test in either app should import or mirror this table so a one-word drift
 * fails loudly instead of rewriting the sentence under the user's cursor.
 *
 * Usage: for each [cron, expected], `describe(fromCron(cron))` must equal `expected`.
 */

export const CANONICAL: [string, string][] = [
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

/** Expressions that must survive `toCron(fromCron(x)) === x`. */
export const ROUND_TRIP: string[] = [
  '0 9 * * *', '30 7 * * 1-5', '0 18 * * 1,4', '30 6 1 * *',
  '*/15 * * * *', '0 */4 * * *', '* * * * *', '5 * * * *',
];

/** Expressions the pickers cannot model. They must come back as `custom`, unchanged. */
export const CUSTOM_ONLY: string[] = ['0 9 13 * FRI', '0 9 1 1 *', '0,30 9-17 * * *', 'nonsense'];

/** `describe` of a custom expression is the empty string, never the raw cron. */
export const CUSTOM_READING = '';

/** Weekly with no days reads as a refusal, not as a valid schedule. */
export const NO_DAYS_READING = 'Pick at least one day';

/** With a zone, the zone is appended in brackets. */
export const ZONED: { cron: string; zone: string; expected: string }[] = [
  { cron: '0 9 * * *', zone: 'Asia/Kolkata', expected: 'Every day at 09:00 (Asia/Kolkata)' },
];
