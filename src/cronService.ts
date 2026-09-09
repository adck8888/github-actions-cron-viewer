import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';

/** GitHub Actions will not run a scheduled workflow more often than every 5 minutes. */
export const MIN_INTERVAL_MINUTES = 5;

export const DEFAULT_TIMEZONE = 'UTC';

export type WarningSeverity = 'error' | 'warning' | 'info';

export interface ScheduleWarning {
  severity: WarningSeverity;
  message: string;
}

export interface DescribeOptions {
  /** How many upcoming runs to compute. Defaults to 5. */
  count?: number;
  /** Render times on a 24-hour clock. Defaults to true. */
  use24HourFormat?: boolean;
  /** Reference point for "next" runs. Defaults to now. Used by tests. */
  from?: Date;
}

export interface ScheduleDescription {
  /** The raw cron expression as written in the workflow. */
  expression: string;
  /** Timezone actually used for the calculation (falls back to UTC). */
  timezone: string;
  /** Whether the workflow explicitly declared a timezone. */
  timezoneExplicit: boolean;
  valid: boolean;
  /** Set when `valid` is false. */
  error?: string;
  /** Human readable schedule, e.g. "At 04:00, Monday through Friday". */
  description: string;
  /** Upcoming runs, already formatted in `timezone`. */
  nextRuns: string[];
  warnings: ScheduleWarning[];
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function formatRun(date: Date, timezone: string, use24HourFormat: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: use24HourFormat ? 'h23' : 'h12'
  }).format(date);
}

/** Short "Sep 10 04:00" form used in the inline CodeLens. */
export function formatRunShort(date: Date, timezone: string, use24HourFormat: boolean): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: use24HourFormat ? 'h23' : 'h12'
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const dayPeriod = value('dayPeriod');

  return `${value('month')} ${value('day')} ${value('hour')}:${value('minute')}${
    dayPeriod ? ` ${dayPeriod}` : ''
  }`;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** The timezone VS Code is running in, used for the "your time" line. */
export function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Detects an evenly spaced field (a step such as "every 6") for the short label. */
function uniformStep(values: number[], wrapAt: number): number | undefined {
  if (values.length < 2) {
    return undefined;
  }
  const step = values[1] - values[0];
  if (step <= 0 || wrapAt % step !== 0 || values.length !== wrapAt / step) {
    return undefined;
  }
  return values.every((value, index) => value === values[0] + index * step) ? step : undefined;
}

function weekdayLabel(days: number[]): string {
  if (days.length === 2 && days[0] === 0 && days[1] === 6) {
    return 'Weekends';
  }
  const consecutive = days.every((day, index) => index === 0 || day === days[index - 1] + 1);
  if (consecutive && days.length >= 3) {
    return `${WEEKDAY_NAMES[days[0]]}–${WEEKDAY_NAMES[days[days.length - 1]]}`;
  }
  if (days.length <= 3) {
    return days.map((day) => WEEKDAY_NAMES[day]).join(', ');
  }
  return `${days.length} days/wk`;
}

function dayOfMonthLabel(days: number[]): string {
  return days.length <= 3 ? `Day ${days.join(', ')}` : `${days.length} days/mo`;
}

function timeLabel(minutes: number[], hours: number[]): string | undefined {
  if (minutes.length === 1 && hours.length === 1) {
    return `${pad(hours[0])}:${pad(minutes[0])}`;
  }
  if (minutes.length === 1 && hours.length > 1) {
    const step = uniformStep(hours, 24);
    if (step) {
      return minutes[0] === 0 ? `every ${step}h` : `every ${step}h at :${pad(minutes[0])}`;
    }
    if (hours.length <= 3) {
      return hours.map((hour) => `${pad(hour)}:${pad(minutes[0])}`).join(', ');
    }
    return `${hours.length}× daily`;
  }
  if (minutes.length > 1 && hours.length === 24) {
    const step = uniformStep(minutes, 60);
    return step ? `every ${step}m` : `${minutes.length}× hourly`;
  }
  return undefined;
}

/**
 * A compact "Mon–Fri · 04:00" label for the inline CodeLens, derived from the
 * parsed cron fields. Returns undefined for exotic expressions so the caller can
 * fall back to the full description.
 */
export function shortSummary(expression: string, timezone: string = DEFAULT_TIMEZONE): string | undefined {
  let fields;
  try {
    fields = CronExpressionParser.parse(expression, { tz: timezone }).fields;
  } catch {
    return undefined;
  }

  // Day fields can also carry the non-numeric `L` marker, which has no short form.
  const numeric = (values: readonly unknown[]): number[] =>
    values.filter((value) => typeof value === 'number') as number[];

  const minutes = numeric(fields.minute.values);
  const hours = numeric(fields.hour.values);
  const daysOfMonth = numeric(fields.dayOfMonth.values);
  const months = numeric(fields.month.values);
  const daysOfWeek = [...new Set(numeric(fields.dayOfWeek.values).map((day) => (day === 7 ? 0 : day)))].sort(
    (a, b) => a - b
  );

  const time = timeLabel(minutes, hours);
  if (!time) {
    return undefined;
  }

  const everyDayOfMonth = daysOfMonth.length === 31;
  const everyDayOfWeek = daysOfWeek.length === 7;

  let days: string;
  if (everyDayOfMonth && everyDayOfWeek) {
    days = time.startsWith('every') ? '' : 'Daily';
  } else if (everyDayOfMonth) {
    days = weekdayLabel(daysOfWeek);
  } else if (everyDayOfWeek) {
    days = dayOfMonthLabel(daysOfMonth);
  } else {
    // Cron treats a restricted day-of-month and day-of-week as OR, which is too
    // subtle for a one-line label.
    return undefined;
  }

  const monthPart =
    months.length === 12
      ? ''
      : months.length <= 3
        ? ` (${months.map((month) => MONTH_NAMES[month - 1]).join(', ')})`
        : ` (${months.length} mo)`;

  return `${[days, time].filter(Boolean).join(' · ')}${monthPart}`;
}

/** "in 6h 24m" / "in 12m" / "in 3d 4h", for the next scheduled run. */
export function relativeTime(target: Date, from: Date = new Date()): string {
  const totalMinutes = Math.round((target.getTime() - from.getTime()) / 60000);
  if (totalMinutes <= 0) {
    return 'now';
  }
  if (totalMinutes < 1) {
    return 'in <1m';
  }
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `in ${days}d${hours > 0 ? ` ${hours}h` : ''}`;
  }
  if (hours > 0) {
    return `in ${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`;
  }
  return `in ${minutes}m`;
}

export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** Year/month/day of an instant as seen in a given timezone. */
export function dateInTimezone(date: Date, timezone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value('year'), month: value('month'), day: value('day') };
}

/** "2026-09-10" in the given timezone - the key the calendar grid is built on. */
export function dayKey(date: Date, timezone: string): string {
  const { year, month, day } = dateInTimezone(date, timezone);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Clock time of an instant in a timezone, e.g. "04:00". */
export function timeInTimezone(date: Date, timezone: string, use24HourFormat = true): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: use24HourFormat ? 'h23' : 'h12'
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const dayPeriod = value('dayPeriod');
  return `${value('hour')}:${value('minute')}${dayPeriod ? ` ${dayPeriod}` : ''}`;
}

const MAX_MONTH_RUNS = 2000;

/**
 * Every run of an expression that falls inside the given month. The expression
 * is always interpreted in the schedule's own timezone; `calendarTimezone`
 * decides which month a run belongs to, so a calendar can be laid out in the
 * reader's timezone while the cron still means what it says.
 */
export function runsInMonth(
  expression: string,
  timezone: string,
  year: number,
  month: number,
  calendarTimezone = timezone
): Date[] {
  const runs: Date[] = [];
  try {
    // Start well before the month so no run near the boundary is missed,
    // whatever the timezone offset is.
    const probe = new Date(Date.UTC(year, month - 1, 1) - 2 * 24 * 3600 * 1000);
    const interval = CronExpressionParser.parse(expression, { tz: timezone, currentDate: probe });

    for (let i = 0; i < MAX_MONTH_RUNS * 3 && runs.length < MAX_MONTH_RUNS; i++) {
      if (!interval.hasNext()) {
        break;
      }
      const run = interval.next().toDate();
      const { year: runYear, month: runMonth } = dateInTimezone(run, calendarTimezone);
      if (runYear > year || (runYear === year && runMonth > month)) {
        break;
      }
      if (runYear === year && runMonth === month) {
        runs.push(run);
      }
    }
  } catch {
    return [];
  }
  return runs;
}

function invalid(expression: string, timezone: string, timezoneExplicit: boolean, error: string): ScheduleDescription {
  return {
    expression,
    timezone,
    timezoneExplicit,
    valid: false,
    error,
    description: 'Invalid cron expression',
    nextRuns: [],
    warnings: [{ severity: 'error', message: error }]
  };
}

function describeInWords(expression: string, use24HourFormat: boolean): string {
  return cronstrue.toString(expression, {
    use24HourTimeFormat: use24HourFormat,
    verbose: false,
    throwExceptionOnParseError: true
  });
}

/**
 * Turns a single GitHub Actions cron entry into something a human can read:
 * a description, the upcoming runs and any GitHub specific warnings.
 * Never throws - unparsable input comes back as `valid: false`.
 */
export function describeSchedule(
  expression: string,
  timezone?: string,
  options: DescribeOptions = {}
): ScheduleDescription {
  const count = options.count ?? 5;
  const use24HourFormat = options.use24HourFormat ?? true;
  const from = options.from ?? new Date();
  const raw = (expression ?? '').trim();

  const timezoneExplicit = Boolean(timezone && timezone.trim());
  const requestedTimezone = timezoneExplicit ? timezone!.trim() : DEFAULT_TIMEZONE;
  const timezoneKnown = isValidTimezone(requestedTimezone);
  const effectiveTimezone = timezoneKnown ? requestedTimezone : DEFAULT_TIMEZONE;

  if (!raw) {
    return invalid(raw, effectiveTimezone, timezoneExplicit, 'Invalid cron expression: the schedule is empty');
  }

  const fields = raw.split(/\s+/);
  if (fields.length !== 5) {
    return invalid(
      raw,
      effectiveTimezone,
      timezoneExplicit,
      `Invalid cron expression: GitHub Actions expects 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`
    );
  }

  let runs: Date[];
  let description: string;
  try {
    const interval = CronExpressionParser.parse(raw, { tz: effectiveTimezone, currentDate: from });
    // A few extra occurrences let us measure the real interval between runs.
    runs = interval.take(Math.max(count, 12)).map((date) => date.toDate());
    description = describeInWords(raw, use24HourFormat);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return invalid(raw, effectiveTimezone, timezoneExplicit, `Invalid cron expression: ${reason}`);
  }

  const warnings: ScheduleWarning[] = [];

  if (timezoneExplicit && !timezoneKnown) {
    warnings.push({
      severity: 'warning',
      message: `Unknown timezone "${requestedTimezone}". Falling back to UTC.`
    });
  }

  const shortestGapMinutes = smallestGapInMinutes(runs);
  if (shortestGapMinutes !== undefined && shortestGapMinutes < MIN_INTERVAL_MINUTES) {
    warnings.push({
      severity: 'error',
      message: `This schedule fires every ${formatMinutes(shortestGapMinutes)}, but GitHub Actions runs scheduled workflows at most once every ${MIN_INTERVAL_MINUTES} minutes.`
    });
  }

  if (/[LW#?]/i.test(raw)) {
    warnings.push({
      severity: 'warning',
      message: 'Non-standard cron syntax (L, W, #, ?) is not supported by GitHub Actions.'
    });
  }

  if (!timezoneExplicit) {
    warnings.push({
      severity: 'info',
      message: 'No timezone declared, so this schedule is interpreted as UTC.'
    });
  }

  if (fields[0].split(',').includes('0')) {
    warnings.push({
      severity: 'info',
      message: 'Runs at the top of the hour are the busiest slot on GitHub Actions and are more likely to be delayed. Consider an offset such as minute 7 or 23.'
    });
  }

  warnings.push({
    severity: 'info',
    message: 'Scheduled workflows only run on the default branch.'
  });
  warnings.push({
    severity: 'info',
    message: 'Scheduled runs can be delayed, or skipped entirely, during periods of high load.'
  });

  return {
    expression: raw,
    timezone: effectiveTimezone,
    timezoneExplicit,
    valid: true,
    description,
    nextRuns: runs.slice(0, count).map((date) => formatRun(date, effectiveTimezone, use24HourFormat)),
    warnings
  };
}

/** Same as `describeSchedule` but returns the runs as Dates - used for the inline CodeLens. */
export function nextRunDates(
  expression: string,
  timezone: string,
  count: number,
  from: Date = new Date()
): Date[] {
  try {
    return CronExpressionParser.parse(expression, { tz: timezone, currentDate: from })
      .take(count)
      .map((date) => date.toDate());
  } catch {
    return [];
  }
}

function smallestGapInMinutes(runs: Date[]): number | undefined {
  if (runs.length < 2) {
    return undefined;
  }
  let smallest = Infinity;
  for (let i = 1; i < runs.length; i++) {
    const gap = (runs[i].getTime() - runs[i - 1].getTime()) / 60000;
    if (gap > 0 && gap < smallest) {
      smallest = gap;
    }
  }
  return Number.isFinite(smallest) ? smallest : undefined;
}

function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes * 10) / 10;
  return rounded === 1 ? '1 minute' : `${rounded} minutes`;
}
