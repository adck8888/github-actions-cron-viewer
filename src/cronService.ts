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
