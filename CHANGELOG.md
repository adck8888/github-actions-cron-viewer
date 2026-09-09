# Changelog

## 0.3.1

- **The calendar is now the reader's calendar.** Runs are filed under the day they happen in your
  timezone, not the workflow's: a job that fires at 18:15 in New York shows up on the next day in
  Yerevan, and the details of a day never list a run that happens for you on another one. The
  workflow time is untouched — it is still shown as written, next to its timezone.

## 0.3.0

- **Redesigned Schedule Calendar panel.** The header now names the workflow and summarises it in one
  line — schedule count, next run, your timezone — with the schedules below it as readable items
  instead of grey chips. Calendar days show the run count and a colour bar per schedule, Today and
  the selected day are styled apart, and hovering a day lists its runs.
- **Day details under the calendar.** Selecting a day lists every run of that day as
  local time / schedule / workflow time, sorted by local time. Today is selected on open, or the
  nearest day with a run when today is not in the month on screen.
- **Shorter CodeLens** — `Mon–Fri · 04:00 UTC → 08:00 local · next in 5h 50m`. The whole lens opens
  the calendar, and the local time is left out when the workflow already runs in your timezone.

## 0.2.0

- **Schedule Calendar panel.** Clicking the CodeLens (or running
  `GitHub Actions: Open Schedule Calendar`) opens a panel beside the workflow with three views:
  a month calendar with every run day marked, an `Upcoming` list merging all schedules of the file
  in chronological order, and `Details` with the expression, timezone, next runs and notes.
- All schedules of a workflow are drawn on the same calendar, colour coded: each day shows its run
  count and a colour bar per schedule that fires on it.
- **Day details.** Selecting a day lists every run of that day under the calendar — your local time,
  the schedule it belongs to and the workflow time — sorted by local time. Today is selected on
  open, or the nearest day with a run when today is not in view. Hovering a day shows the same list
  as a tooltip.
- The panel header names the workflow and summarises it in one line: how many schedules there are,
  when the next run is and which timezone you are in, followed by the schedules themselves.
- **Local time everywhere.** Each run is shown both in the workflow's timezone and in yours, with
  runs that fall on a different calendar day locally marked as such.
- **Much shorter CodeLens** — `Mon–Fri · 04:00 UTC → 08:00 local · next in 6h 24m` instead of the
  full sentence and a list of dates. The countdown refreshes every minute, and the whole lens opens
  the calendar, so it no longer spends words saying so. The local time is left out when the workflow
  already runs in your timezone.
- GitHub-specific notes moved into their own block in the panel instead of being mixed into the
  description.
- The panel is styled from VS Code theme variables and uses codicons, so it matches the editor in
  dark, light and high contrast themes.

## 0.1.0

Initial release.

- Inline CodeLens with a human-readable description and the next runs for every `cron:` entry in
  `.github/workflows/*.yml`.
- Hover showing the schedule, the timezone and the next 5 runs.
- `GitHub Actions: Preview Schedule` command.
- Diagnostics for invalid cron expressions, schedules below the 5 minute GitHub Actions minimum,
  non-standard cron syntax and unknown timezones.
- Support for the per-entry `timezone` key, with a UTC fallback.
