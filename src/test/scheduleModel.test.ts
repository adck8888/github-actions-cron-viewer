import * as assert from 'assert';
import { relativeTime, runsInMonth, shortSummary } from '../cronService';
import { buildCalendarPayload, shiftMonth, splitSummary } from '../scheduleModel';

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

describe('splitSummary', () => {
  it('separates the schedule name from its time of day', () => {
    const cases: Array<[string, string, string]> = [
      ['Mon–Fri · 04:00', 'Weekdays', '04:00'],
      ['Sun · 02:30', 'Sunday', '02:30'],
      ['Daily · 04:00', 'Daily', '04:00'],
      ['Mon, Wed, Fri · 09:00', 'Mon, Wed, Fri', '09:00'],
      ['Day 1, 15 · 00:00', 'Day 1, 15', '00:00'],
      ['every 6h at :15', 'Every 6 hours', ':15'],
      ['every 4h', 'Every 4 hours', ''],
      ['every 5m', 'Every 5 minutes', ''],
      ['every 1h', 'Every 1 hour', '']
    ];

    for (const [short, title, time] of cases) {
      assert.deepStrictEqual(splitSummary(short), { title, time }, short);
    }
  });

  it('keeps a 12-hour clock and any trailing qualifier attached to the name', () => {
    assert.deepStrictEqual(splitSummary('Mon–Fri · 4:00 AM'), {
      title: 'Weekdays',
      time: '4:00 AM'
    });
    assert.deepStrictEqual(splitSummary('Daily · 00:00 +1'), {
      title: 'Daily +1',
      time: '00:00'
    });
  });

  it('falls back to the whole label when there is no time to split off', () => {
    assert.deepStrictEqual(splitSummary('at 04:00 on odd days'), {
      title: 'at 04:00 on odd days',
      time: ''
    });
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
    const payload = buildCalendarPayload(workflow, 'demo.yml', 2026, 9, { from: FROM, localTimezone: 'UTC' });

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

  it('files each run under the day it happens on for the reader', () => {
    // 18:15 in New York is 02:15 the next morning in Yerevan, so it belongs to
    // the next cell - and never to the previous day's details.
    const workflow =
      "on:\n  schedule:\n    - cron: '15 18 * * *'\n      timezone: 'America/New_York'\n";

    const yerevan = buildCalendarPayload(workflow, 'demo.yml', 2026, 9, {
      from: FROM,
      localTimezone: 'Asia/Yerevan'
    });
    const [schedule] = yerevan.schedules;

    // 18:15 on Sep 10 in New York is 22:15 UTC, and it sits in the Sep 11 cell.
    assert.strictEqual(schedule.days['2026-09-11'].runs[0].iso, '2026-09-10T22:15:00.000Z');
    assert.strictEqual(schedule.days['2026-09-11'].runs[0].localTime, '02:15');
    // The workflow time is left alone: it is still 18:15 where the cron runs.
    assert.strictEqual(schedule.days['2026-09-11'].runs[0].time, '18:15');

    // Every local day of the month gets exactly one run, and none spills out.
    assert.strictEqual(Object.keys(schedule.days).length, 30);
    assert.strictEqual(schedule.monthRunCount, 30);
    assert.ok(schedule.days['2026-09-01'], 'the local month must start on the 1st');
    assert.ok(!schedule.days['2026-10-01'], 'and must not spill into October');
    assert.ok(
      Object.values(schedule.days).every((day) => day.runs[0].localTime === '02:15'),
      'every cell holds the run that happens on it locally'
    );

    // The same schedule read from New York keeps its own day.
    const newYork = buildCalendarPayload(workflow, 'demo.yml', 2026, 9, {
      from: FROM,
      localTimezone: 'America/New_York'
    });
    assert.strictEqual(newYork.schedules[0].days['2026-09-10'].runs[0].localTime, '18:15');
  });

  it('merges the upcoming runs of all schedules in chronological order', () => {
    const payload = buildCalendarPayload(workflow, 'demo.yml', 2026, 9, { from: FROM, localTimezone: 'UTC' });
    const isos = payload.merged.map((run) => run.iso);

    assert.deepStrictEqual([...isos].sort(), isos);
    assert.ok(payload.merged.some((run) => run.scheduleIndex === 0));
    assert.ok(payload.merged.some((run) => run.scheduleIndex === 1));
  });

  it('keeps the panel usable when a workflow has no schedules or broken cron', () => {
    const empty = buildCalendarPayload('name: CI\non:\n  push:\n', 'ci.yml', 2026, 9, { from: FROM, localTimezone: 'UTC' });
    assert.deepStrictEqual(empty.schedules, []);
    assert.deepStrictEqual(empty.merged, []);

    const broken = buildCalendarPayload(
      "on:\n  schedule:\n    - cron: 'nope'\n",
      'broken.yml',
      2026,
      9,
      { from: FROM, localTimezone: 'UTC' }
    );
    assert.strictEqual(broken.schedules.length, 1);
    assert.strictEqual(broken.schedules[0].valid, false);
    assert.strictEqual(broken.schedules[0].monthRunCount, 0);
    assert.deepStrictEqual(broken.schedules[0].nextRuns, []);
  });
});
