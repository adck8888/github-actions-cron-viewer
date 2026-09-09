import {
  dayKey,
  dateInTimezone,
  describeSchedule,
  localTimezone,
  nextRunDates,
  relativeTime,
  runsInMonth,
  ScheduleWarning,
  shortSummary,
  timeInTimezone
} from './cronService';
import { findSchedules, findWorkflowName } from './workflowParser';

/** Chart colours the webview cycles through, one per schedule. */
export const SCHEDULE_COLORS = ['blue', 'green', 'purple', 'orange', 'red', 'yellow'] as const;

const MAX_RUNS_PER_DAY = 12;
const MAX_MERGED_UPCOMING = 20;

export interface RunView {
  iso: string;
  /** Time in the schedule's own timezone, e.g. "04:00". */
  time: string;
  /** Date in the schedule's own timezone, e.g. "Sep 10". */
  date: string;
  weekday: string;
  /** Same instant in the user's timezone. */
  localTime: string;
  localDate: string;
  /** True when the run lands on a different calendar day locally. */
  localDateDiffers: boolean;
  relative: string;
}

export interface DayRuns {
  runs: Array<{
    iso: string;
    time: string;
    localTime: string;
    localDateDiffers: boolean;
    localDate: string;
  }>;
  more: number;
}

export interface SchedulePayload {
  index: number;
  color: string;
  expression: string;
  timezone: string;
  timezoneExplicit: boolean;
  localTimezone: string;
  showLocalTime: boolean;
  valid: boolean;
  error?: string;
  /** Compact label for the CodeLens and the panel header. */
  short: string;
  /** "Weekdays", "Every 6 hours" - the schedule without its time. */
  title: string;
  /** "04:00", ":15" or '' when the schedule has no single time of day. */
  timeLabel: string;
  /** Full sentence from cronstrue. */
  description: string;
  line: number;
  monthRunCount: number;
  days: Record<string, DayRuns>;
  nextRuns: RunView[];
  warnings: ScheduleWarning[];
}

export interface CalendarPayload {
  workflowName: string;
  fileName: string;
  localTimezone: string;
  year: number;
  /** 1-12. */
  month: number;
  monthLabel: string;
  /** Day of week the month starts on, 0 = Sunday. */
  firstWeekday: number;
  daysInMonth: number;
  todayKey: string;
  focusedIndex: number;
  schedules: SchedulePayload[];
  merged: Array<RunView & { scheduleIndex: number; color: string; expression: string }>;
}

export interface BuildOptions {
  nextRunsCount?: number;
  use24HourFormat?: boolean;
  focusedIndex?: number;
  /** Reference "now". Used by tests. */
  from?: Date;
}

const FULL_WEEKDAY: Record<string, string> = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday'
};

function friendlyDays(label: string): string {
  if (label === 'Mon–Fri') {
    return 'Weekdays';
  }
  return FULL_WEEKDAY[label] ?? label;
}

/**
 * Splits a compact summary into the name of the schedule and the time it runs
 * at, so the panel can put them on separate lines: "Mon–Fri · 04:00" becomes
 * { title: 'Weekdays', time: '04:00' }. Purely a display concern.
 */
export function splitSummary(short: string): { title: string; time: string } {
  const parts = short.split(' · ');
  const clock = /^(\d{1,2}:\d{2}(?: [AP]M)?)\s*(.*)$/.exec(parts[parts.length - 1]);
  if (clock && parts.length > 1) {
    const days = friendlyDays(parts.slice(0, -1).join(' · '));
    return { title: clock[2] ? `${days} ${clock[2]}` : days, time: clock[1] };
  }

  const interval = /^every (\d+)([hm])(?: at (:\d{2}))?$/.exec(short);
  if (interval) {
    const count = Number(interval[1]);
    const unit = interval[2] === 'h' ? 'hour' : 'minute';
    return {
      title: `Every ${count} ${unit}${count === 1 ? '' : 's'}`,
      time: interval[3] ?? ''
    };
  }

  return { title: friendlyDays(short), time: '' };
}

function shortDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function weekday(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date);
}

function toRunView(
  run: Date,
  timezone: string,
  local: string,
  use24HourFormat: boolean,
  from: Date
): RunView {
  const localDate = shortDate(run, local);
  return {
    iso: run.toISOString(),
    time: timeInTimezone(run, timezone, use24HourFormat),
    date: shortDate(run, timezone),
    weekday: weekday(run, timezone),
    localTime: timeInTimezone(run, local, use24HourFormat),
    localDate,
    localDateDiffers: dayKey(run, timezone) !== dayKey(run, local),
    relative: relativeTime(run, from)
  };
}

/**
 * Turns a workflow file into everything the schedule panel needs to render:
 * the month grid, the merged upcoming list and the per-schedule details.
 */
export function buildCalendarPayload(
  text: string,
  fileName: string,
  year: number,
  month: number,
  options: BuildOptions = {}
): CalendarPayload {
  const nextRunsCount = options.nextRunsCount ?? 5;
  const use24HourFormat = options.use24HourFormat ?? true;
  const from = options.from ?? new Date();
  const local = localTimezone();

  const schedules: SchedulePayload[] = findSchedules(text).map((schedule, index) => {
    const info = describeSchedule(schedule.expression, schedule.timezone, {
      count: nextRunsCount,
      use24HourFormat,
      from
    });
    const timezone = info.timezone;

    const days: Record<string, DayRuns> = {};
    let monthRunCount = 0;
    if (info.valid) {
      for (const run of runsInMonth(schedule.expression, timezone, year, month)) {
        monthRunCount++;
        const key = dayKey(run, timezone);
        const bucket = (days[key] ??= { runs: [], more: 0 });
        if (bucket.runs.length < MAX_RUNS_PER_DAY) {
          bucket.runs.push({
            iso: run.toISOString(),
            time: timeInTimezone(run, timezone, use24HourFormat),
            localTime: timeInTimezone(run, local, use24HourFormat),
            localDate: shortDate(run, local),
            localDateDiffers: dayKey(run, timezone) !== dayKey(run, local)
          });
        } else {
          bucket.more++;
        }
      }
    }

    const nextRuns = info.valid
      ? nextRunDates(schedule.expression, timezone, nextRunsCount, from).map((run) =>
          toRunView(run, timezone, local, use24HourFormat, from)
        )
      : [];

    const short = (info.valid && shortSummary(schedule.expression, timezone)) || info.description;
    const { title, time } = splitSummary(short);

    return {
      index,
      color: SCHEDULE_COLORS[index % SCHEDULE_COLORS.length],
      expression: schedule.expression,
      timezone,
      timezoneExplicit: info.timezoneExplicit,
      localTimezone: local,
      showLocalTime: local !== timezone,
      valid: info.valid,
      error: info.error,
      short,
      title,
      timeLabel: time,
      description: info.description,
      line: text.slice(0, schedule.range.start).split('\n').length - 1,
      monthRunCount,
      days,
      nextRuns,
      warnings: info.warnings
    };
  });

  const merged = schedules
    .flatMap((schedule) =>
      schedule.nextRuns.map((run) => ({
        ...run,
        scheduleIndex: schedule.index,
        color: schedule.color,
        expression: schedule.expression
      }))
    )
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .slice(0, MAX_MERGED_UPCOMING);

  return {
    workflowName: findWorkflowName(text) ?? fileName,
    fileName,
    localTimezone: local,
    year,
    month,
    monthLabel: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
      new Date(Date.UTC(year, month - 1, 1))
    ),
    firstWeekday: new Date(Date.UTC(year, month - 1, 1)).getUTCDay(),
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    todayKey: dayKey(from, local),
    focusedIndex: options.focusedIndex ?? 0,
    schedules,
    merged
  };
}

/** The month that contains `date`, in the user's timezone. */
export function currentMonth(date: Date = new Date()): { year: number; month: number } {
  const { year, month } = dateInTimezone(date, localTimezone());
  return { year, month };
}

/** Steps the month view forward or backward, rolling the year over. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const zeroBased = month - 1 + delta;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1
  };
}
