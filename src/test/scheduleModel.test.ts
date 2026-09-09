import * as assert from 'assert';
import { relativeTime, runsInMonth, shortSummary } from '../cronService';
import { buildCalendarPayload, shiftMonth } from '../scheduleModel';

const FROM = new Date('2026-09-09T12:00:00Z');

describe('shortSummary', () => {
  it('compresses the common schedules into a one-line label', () => {
    const cases: Array<[string, string]> = [
      ['0 4 * * 1-5', 'Mon–Fri · 04:00'],
      ['0 4 * * *', 'Daily · 04:00'],
      ['30 2 * * 0', 'Sun · 02:30'],
      ['0 9 * * 1,3,5', 'Mon, Wed, Fri · 09:00'],
      ['0 12 * * 0,6', 'Weekends · 12:00'],
      ['0 0 1 * *', 'Day 1 · 00:00'],
      ['0 0 1,15 * *', 'Day 1, 15 · 00:00'],
      // An interval already implies "every day", so the day part is dropped.
      ['15 */6 * * *', 'every 6h at :15'],
      ['0 */4 * * *', 'every 4h'],
      ['*/5 * * * *', 'every 5m'],
      ['0 6 * 1,7 *', 'Daily · 06:00 (Jan, Jul)']
    ];

    for (const [expression, expected] of cases) {
      assert.strictEqual(shortSummary(expression), expected, `expression: ${expression}`);
    }
  });

  it('gives up on expressions that cannot be said in one line', () => {
    // Restricted day-of-month AND day-of-week is an OR in cron, too subtle to compress.
    assert.strictEqual(shortSummary('0 4 1 * 1'), undefined);
    assert.strictEqual(shortSummary('not a cron'), undefined);
  });
});

describe('relativeTime', () => {
  it('formats the countdown shown in the CodeLens', () => {
    const at = (minutes: number): string =>
      relativeTime(new Date(FROM.getTime() + minutes * 60000), FROM);

    assert.strictEqual(at(12), 'in 12m');
    assert.strictEqual(at(384), 'in 6h 24m');
    assert.strictEqual(at(120), 'in 2h');
    assert.strictEqual(at(60 * 24 * 3 + 60 * 4), 'in 3d 4h');
    assert.strictEqual(at(0), 'now');
    assert.strictEqual(at(-10), 'now');
  });
});

describe('runsInMonth', () => {
  it('returns every weekday run of the month in the schedule timezone', () => {
    const runs = runsInMonth('0 4 * * 1-5', 'UTC', 2026, 9);

    // September 2026 has 22 weekdays.
    assert.strictEqual(runs.length, 22);
    assert.ok(runs.every((run) => run.toISOString().endsWith('T04:00:00.000Z')));
  });

  it('respects the declared timezone when deciding which month a run belongs to', () => {
    // 00:30 on the 1st in Yerevan (UTC+4) is still 20:30 on the previous day in UTC.
    const runs = runsInMonth('30 0 1 * *', 'Asia/Yerevan', 2026, 9);

    assert.strictEqual(runs.length, 1);
    assert.strictEqual(runs[0].toISOString(), '2026-08-31T20:30:00.000Z');
  });

  it('returns nothing for an invalid expression', () => {
    assert.deepStrictEqual(runsInMonth('not a cron', 'UTC', 2026, 9), []);
  });
});

describe('shiftMonth', () => {
  it('rolls over the year in both directions', () => {
    assert.deepStrictEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepStrictEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepStrictEqual(shiftMonth(2026, 9, 0), { year: 2026, month: 9 });
  });
});

describe('buildCalendarPayload', () => {
  const workflow = [
    'name: Scheduled maintenance',
    'on:',
    '  schedule:',
    "    - cron: '0 4 * * 1-5'",
    "    - cron: '30 2 * * 0'",
    "      timezone: 'Asia/Yerevan'",
    ''
  ].join('\n');

  it('builds the month grid for every schedule at once', () => {
    const payload = buildCalendarPayload(workflow, 'demo.yml', 2026, 9, { from: FROM });

    assert.strictEqual(payload.workflowName, 'Scheduled maintenance');
    assert.strictEqual(payload.schedules.length, 2);
    assert.strictEqual(payload.monthLabel, 'September 2026');
    // 1 September 2026 is a Tuesday.
    assert.strictEqual(payload.firstWeekday, 2);
    assert.strictEqual(payload.daysInMonth, 30);

    const [weekdays, sundays] = payload.schedules;
    assert.strictEqual(weekdays.short, 'Mon–Fri · 04:00');
    assert.strictEqual(weekdays.monthRunCount, 22);
    assert.deepStrictEqual(weekdays.days['2026-09-10'].runs[0].time, '04:00');
    assert.ok(!weekdays.days['2026-09-12'], 'Saturday must stay empty');

    assert.strictEqual(sundays.timezone, 'Asia/Yerevan');
    assert.strictEqual(sundays.monthRunCount, 4);
    assert.notStrictEqual(weekdays.color, sundays.color);
  });

  it('merges the upcoming runs of all schedules in chronological order', () => {
    const payload = buildCalendarPayload(workflow, 'demo.yml', 2026, 9, { from: FROM });
    const isos = payload.merged.map((run) => run.iso);

    assert.deepStrictEqual([...isos].sort(), isos);
    assert.ok(payload.merged.some((run) => run.scheduleIndex === 0));
    assert.ok(payload.merged.some((run) => run.scheduleIndex === 1));
  });

  it('keeps the panel usable when a workflow has no schedules or broken cron', () => {
    const empty = buildCalendarPayload('name: CI\non:\n  push:\n', 'ci.yml', 2026, 9, { from: FROM });
    assert.deepStrictEqual(empty.schedules, []);
    assert.deepStrictEqual(empty.merged, []);

    const broken = buildCalendarPayload(
      "on:\n  schedule:\n    - cron: 'nope'\n",
      'broken.yml',
      2026,
      9,
      { from: FROM }
    );
    assert.strictEqual(broken.schedules.length, 1);
    assert.strictEqual(broken.schedules[0].valid, false);
    assert.strictEqual(broken.schedules[0].monthRunCount, 0);
    assert.deepStrictEqual(broken.schedules[0].nextRuns, []);
  });
});
