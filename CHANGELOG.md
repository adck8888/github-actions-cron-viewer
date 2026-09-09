# Changelog

## 0.1.0

Initial release.

- Inline CodeLens with a human-readable description and the next runs for every `cron:` entry in
  `.github/workflows/*.yml`.
- Hover showing the schedule, the timezone and the next 5 runs.
- `GitHub Actions: Preview Schedule` command.
- Diagnostics for invalid cron expressions, schedules below the 5 minute GitHub Actions minimum,
  non-standard cron syntax and unknown timezones.
- Support for the per-entry `timezone` key, with a UTC fallback.
