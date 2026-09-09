# GitHub Actions Cron & Schedule Viewer

Read GitHub Actions cron schedules without leaving your editor. Open any file under
`.github/workflows/`, and every `cron:` entry gets a one-line summary above it — when it runs, in
which timezone, and how long until the next run. Click it for a calendar of the whole month.

No account, no GitHub token, no network calls. Everything is calculated locally.

## What it does

Given a workflow like this:

```yaml
name: Nightly checks

on:
  schedule:
    - cron: '0 4 * * 1-5'
    - cron: '30 2 * * 0'
      timezone: 'Asia/Yerevan'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
```

you see a short CodeLens above each schedule, not a wall of text:

```
📅 Mon–Fri · 04:00 UTC → 08:00 local · next in 6h 24m
   - cron: '0 4 * * 1-5'
```

Click it and the **Schedule Calendar** opens beside the file:

```
Nightly checks
3 schedules · Next run in 5h 37m · Local timezone: Asia/Yerevan

● Weekdays            ● Sunday             ● Every 6 hours
  04:00 UTC → 08:00     02:30 Asia/Yerevan    :15 America/New_York

[ Calendar ]  Upcoming   Details

September 2026  ‹ ›                              Today
  SUN     MON     TUE     WED     THU     FRI     SAT
                    1       2       3       4       5
                  5 runs  5 runs  5 runs  5 runs  4 runs
                  ▄▄▄▄▄   ▄▄▄▄▄   ▄▄▄▄▄   ▄▄▄▄▄   ▄▄▄▄▄
    6       7       8       9      10      11      12
  ...

September 10 · 5 runs
LOCAL TIME   SCHEDULE          WORKFLOW TIME
08:00        ● Weekdays        04:00 UTC
08:15        ● Every 6 hours   00:15 America/New_York
14:15        ● Every 6 hours   06:15 America/New_York
20:15        ● Every 6 hours   12:15 America/New_York
02:15 Sep 11 ● Every 6 hours   18:15 America/New_York
```

Every schedule in the file is drawn on the same month, each with its own colour, so you can see
where two workflows collide. Click a day to see the exact times.

## Features

- **Short CodeLens** above every `cron:` entry: `Mon–Fri · 04:00 UTC → 08:00 local · next in 6h 24m`.
  The countdown refreshes while you work, and clicking anywhere on it opens the calendar.
- **Schedule Calendar panel** with three views:
  - **Calendar** — a month grid with the run count and a colour bar per schedule on every day.
    Selecting a day lists its runs underneath, sorted by your local time, next to the workflow time.
    Today is selected automatically.
  - **Upcoming** — the next runs of all schedules merged into one chronological list.
  - **Details** — the cron expression, its full description, the timezone, the next runs, and the
    GitHub-specific notes.
- **Your local time next to the workflow time.** A schedule declared as `04:00 UTC` also shows as
  `08:00 Asia/Yerevan` if that is where you are, everywhere times appear.
- **Hover details** on the cron value — description, timezone, next runs and notes, without opening
  anything.
- **Command Palette** — `GitHub Actions: Open Schedule Calendar` and
  `GitHub Actions: Preview Schedule` (a Quick Pick breakdown, useful when you just want a glance).
- **Validation in the Problems panel**:
  - invalid cron expressions, including the 5-field rule (`@daily` and friends are not valid on
    GitHub Actions);
  - schedules that fire more often than the GitHub Actions minimum interval of 5 minutes;
  - non-standard cron syntax (`L`, `W`, `#`, `?`) that GitHub does not support;
  - unknown timezone names.
- **GitHub-specific notes** you would otherwise have to remember, shown as a separate block:
  scheduled workflows only run on the default branch, scheduled runs can be delayed under load, and
  `XX:00` is the busiest minute to pick.
- Handles **multiple schedules per workflow** and **multiple workflow files**, and stays quiet on
  workflows that have no `schedule` trigger.
- **Never modifies your YAML.** It only reads the file.

## Timezone support

GitHub Actions interprets cron schedules in UTC unless a `timezone` is declared next to the entry:

```yaml
on:
  schedule:
    - cron: '0 4 * * 1-5'
      timezone: 'Asia/Yerevan'
```

The extension uses that timezone for every calculation and labels it everywhere. When no `timezone`
key is present, it falls back to UTC and tells you so. If the timezone name is not a valid IANA
identifier, you get a warning and UTC is used instead.

Alongside the workflow's own timezone, the panel shows the same instant in your local timezone:

```
Workflow    04:00  UTC (default)
Your time   08:00  Asia/Yerevan
```

Runs that land on a different calendar day locally are marked, so a `23:30 UTC` job does not
silently look like it runs today.

## Screenshots

<!--
Screenshots are not bundled yet. Before publishing, capture the CodeLens and the Schedule Calendar
panel on samples/.github/workflows/demo.yml, save them as media/screenshot-codelens.png and
media/screenshot-calendar.png, and replace this comment with:

![Inline schedule CodeLens](https://raw.githubusercontent.com/adck8888/github-actions-cron-viewer/main/media/screenshot-codelens.png)
![Schedule Calendar panel](https://raw.githubusercontent.com/adck8888/github-actions-cron-viewer/main/media/screenshot-calendar.png)

The Marketplace does not resolve relative image paths, so keep the absolute raw.githubusercontent.com URLs.
-->

_Screenshots are on the way._

## Installation

- **VS Code Marketplace** — search for “GitHub Actions Cron & Schedule Viewer” in the Extensions view
  (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click Install.
- **Open VSX** (VSCodium, Gitpod, Cursor and friends) — search for the same name in the Extensions
  view.
- **From a `.vsix`** — `code --install-extension github-actions-cron-viewer-0.2.0.vsix`, or
  **Extensions → … → Install from VSIX…**

## Usage

1. Open a repository that contains `.github/workflows/*.yml`.
2. Open a workflow that uses `on: schedule`.
3. The summary and the countdown appear above each `cron:` line.
4. Click the CodeLens — or run **GitHub Actions: Open Schedule Calendar** from the Command Palette
   (`Ctrl+Shift+P` / `Cmd+Shift+P`) — to open the calendar beside the file. It follows whichever
   workflow you are editing and updates as you type.

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `githubActionsCron.enableCodeLens` | `true` | Show the inline CodeLens above each cron schedule. |
| `githubActionsCron.nextRunsCount` | `5` | How many upcoming runs to calculate. |
| `githubActionsCron.use24HourFormat` | `true` | Use a 24-hour clock instead of AM/PM. |
| `githubActionsCron.showDiagnostics` | `true` | Report cron problems in the Problems panel. |

## Limitations

- Only files matching `.github/workflows/*.yml` and `.github/workflows/*.yaml` are analysed. That is
  where GitHub Actions looks for workflows, and it keeps the extension out of the way in every other
  YAML file.
- Next runs are computed from the cron expression alone. They are what GitHub *would* schedule —
  actual runs can be delayed, and scheduled workflows are disabled automatically after 60 days of
  repository inactivity.
- No workflow run history, no workflow monitoring, no GitHub API. This extension reads your files and
  nothing else.

## Privacy

The extension runs entirely offline. It does not collect telemetry, does not contact any server, does
not require authentication, and never writes to your workflow files.

## Contributing

Issues and pull requests are welcome on
[GitHub](https://github.com/adck8888/github-actions-cron-viewer).

## License

[MIT](LICENSE)
