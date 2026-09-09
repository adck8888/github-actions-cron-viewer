import * as assert from 'assert';
import { describeSchedule, formatRunShort, MIN_INTERVAL_MINUTES } from '../cronService';

// Fixed reference point so the expected "next runs" never drift.
const FROM = new Date('2026-09-09T12:00:00Z');

describe('describeSchedule', () => {
  it('describes a simple daily cron in UTC', () => {
    const info = describeSchedule('0 4 * * *', undefined, { from: FROM, count: 3 });

    assert.strictEqual(info.valid, true);
    assert.strictEqual(info.timezone, 'UTC');
    assert.strictEqual(info.description, 'At 04:00');
    assert.deepStrictEqual(info.nextRuns, [
      'Sep 10, 2026, 04:00',
      'Sep 11, 2026, 04:00',
      'Sep 12, 2026, 04:00'
    ]);
  });

  it('describes a weekday cron and skips the weekend', () => {
    const info = describeSchedule('0 4 * * 1-5', undefined, { from: FROM, count: 5 });

    assert.strictEqual(info.valid, true);
    assert.match(info.description, /Monday through Friday/);
    // Sep 12/13 2026 are Saturday and Sunday.
    assert.deepStrictEqual(info.nextRuns, [
      'Sep 10, 2026, 04:00',
      'Sep 11, 2026, 04:00',
      'Sep 14, 2026, 04:00',
      'Sep 15, 2026, 04:00',
      'Sep 16, 2026, 04:00'
    ]);
  });

  it('honours an explicit timezone', () => {
    const info = describeSchedule('0 4 * * *', 'Asia/Yerevan', { from: FROM, count: 1 });

    assert.strictEqual(info.valid, true);
    assert.strictEqual(info.timezone, 'Asia/Yerevan');
    assert.strictEqual(info.timezoneExplicit, true);
    assert.deepStrictEqual(info.nextRuns, ['Sep 10, 2026, 04:00']);
    assert.ok(!info.warnings.some((warning) => /No timezone declared/.test(warning.message)));
  });

  it('assumes UTC and says so when no timezone is declared', () => {
    const info = describeSchedule('0 4 * * *', undefined, { from: FROM });

    assert.strictEqual(info.timezone, 'UTC');
    assert.strictEqual(info.timezoneExplicit, false);
    assert.ok(info.warnings.some((warning) => /interpreted as UTC/.test(warning.message)));
  });

  it('falls back to UTC for an unknown timezone', () => {
    const info = describeSchedule('0 4 * * *', 'Mars/Olympus', { from: FROM, count: 1 });

    assert.strictEqual(info.valid, true);
    assert.strictEqual(info.timezone, 'UTC');
    assert.ok(info.warnings.some((warning) => /Unknown timezone/.test(warning.message)));
  });

  it('reports invalid cron expressions without throwing', () => {
    for (const expression of ['not a cron', '', '99 4 * * *', '0 4 * *']) {
      const info = describeSchedule(expression, undefined, { from: FROM });
      assert.strictEqual(info.valid, false, `expected "${expression}" to be invalid`);
      assert.match(info.error ?? '', /Invalid cron expression/);
      assert.deepStrictEqual(info.nextRuns, []);
    }
  });

  it('rejects non five-field expressions such as @daily', () => {
    const info = describeSchedule('@daily', undefined, { from: FROM });

    assert.strictEqual(info.valid, false);
    assert.match(info.error ?? '', /5 fields/);
  });

  it('warns when the schedule is more frequent than GitHub allows', () => {
    const info = describeSchedule('*/2 * * * *', undefined, { from: FROM });

    assert.strictEqual(info.valid, true);
    const warning = info.warnings.find((candidate) => candidate.severity === 'error');
    assert.ok(warning, 'expected a minimum interval warning');
    assert.match(warning!.message, new RegExp(`${MIN_INTERVAL_MINUTES} minutes`));
  });

  it('does not warn about the interval for a five minute schedule', () => {
    const info = describeSchedule('*/5 * * * *', undefined, { from: FROM });

    assert.ok(!info.warnings.some((warning) => warning.severity === 'error'));
  });

  it('mentions the top of the hour as a busy slot', () => {
    const busy = describeSchedule('0 4 * * *', undefined, { from: FROM });
    const offset = describeSchedule('23 4 * * *', undefined, { from: FROM });

    assert.ok(busy.warnings.some((warning) => /top of the hour/.test(warning.message)));
    assert.ok(!offset.warnings.some((warning) => /top of the hour/.test(warning.message)));
  });

  it('always notes the default branch and delay caveats', () => {
    const info = describeSchedule('23 4 * * *', undefined, { from: FROM });

    assert.ok(info.warnings.some((warning) => /default branch/.test(warning.message)));
    assert.ok(info.warnings.some((warning) => /delayed/.test(warning.message)));
  });

  it('can render times on a 12 hour clock', () => {
    const info = describeSchedule('0 16 * * *', undefined, {
      from: FROM,
      count: 1,
      use24HourFormat: false
    });

    assert.deepStrictEqual(info.nextRuns, ['Sep 9, 2026, 04:00 PM']);
  });
});

describe('formatRunShort', () => {
  const date = new Date('2026-09-10T04:00:00Z');

  it('renders a compact date and time in the schedule timezone', () => {
    assert.strictEqual(formatRunShort(date, 'UTC', true), 'Sep 10 04:00');
    assert.strictEqual(formatRunShort(date, 'Asia/Yerevan', true), 'Sep 10 08:00');
    assert.strictEqual(formatRunShort(date, 'UTC', false), 'Sep 10 04:00 AM');
  });
});
