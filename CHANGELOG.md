# Changelog

## 0.2.0

- **Schedule Calendar panel.** Clicking the CodeLens (or running
  `GitHub Actions: Open Schedule Calendar`) opens a panel beside the workflow with three views:
  a month calendar with every run day marked, an `Upcoming` list merging all schedules of the file
  in chronological order, and `Details` with the expression, timezone, next runs and notes.
- All schedules of a workflow are drawn on the same calendar, colour coded. Clicking a day shows the
  exact times of that day.
- **Local time everywhere.** Each run is shown both in the workflow's timezone and in yours, with
  runs that fall on a different calendar day locally marked as such.
- **Much shorter CodeLens** — `⏱ Mon–Fri · 04:00 UTC · Next in 6h 24m · Calendar` instead of the
  full sentence and a list of dates. The countdown refreshes every minute.
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
