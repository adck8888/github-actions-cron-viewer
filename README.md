# GitHub Actions Cron & Schedule Viewer

Read GitHub Actions cron schedules without leaving your editor. Open any file under
`.github/workflows/`, and every `cron:` entry gets a plain-English description, the timezone that
will actually be used, and the next runs — inline, as you type.

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

you see a CodeLens above each schedule:

```
⏱ At 04:00, Monday through Friday · UTC · Next: Sep 10 04:00 · Sep 11 04:00 · Sep 14 04:00
   - cron: '0 4 * * 1-5'
```

Hover the cron value for the full picture:

```
At 04:00, Monday through Friday
0 4 * * 1-5

Timezone: UTC (default)

Next runs
- Sep 10, 2026, 04:00
- Sep 11, 2026, 04:00
- Sep 14, 2026, 04:00
- Sep 15, 2026, 04:00
- Sep 16, 2026, 04:00

ⓘ No timezone declared, so this schedule is interpreted as UTC.
ⓘ Runs at the top of the hour are the busiest slot on GitHub Actions and are more likely to be delayed.
ⓘ Scheduled workflows only run on the default branch.
```

## Features

- **Inline CodeLens** above every `cron:` entry with the human-readable schedule and the next runs.
- **Hover details** — description, timezone, the next 5 runs and GitHub-specific notes.
- **Command Palette** — `GitHub Actions: Preview Schedule` opens a Quick Pick with the full breakdown
  for the schedule under the cursor, or lets you pick one when the workflow has several.
- **Validation in the Problems panel**:
  - invalid cron expressions, including the 5-field rule (`@daily` and friends are not valid on
    GitHub Actions);
  - schedules that fire more often than the GitHub Actions minimum interval of 5 minutes;
  - non-standard cron syntax (`L`, `W`, `#`, `?`) that GitHub does not support;
  - unknown timezone names.
- **GitHub-specific notes** you would otherwise have to remember: scheduled workflows only run on the
  default branch, scheduled runs can be delayed under load, and `XX:00` is the busiest minute to
  pick.
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

The extension uses that timezone for every calculation and labels it in the CodeLens and hover.
When no `timezone` key is present, it falls back to UTC and tells you so. If the timezone name is
not a valid IANA identifier, you get a warning and UTC is used instead.

## Screenshots

<!--
Screenshots are not bundled yet. Before publishing, capture the CodeLens and the hover on
samples/.github/workflows/nightly.yml, save them as media/screenshot-codelens.png and
media/screenshot-hover.png, and replace this comment with:

![Inline schedule CodeLens](https://raw.githubusercontent.com/adck8/github-actions-cron-viewer/main/media/screenshot-codelens.png)
![Schedule details on hover](https://raw.githubusercontent.com/adck8/github-actions-cron-viewer/main/media/screenshot-hover.png)

The Marketplace does not resolve relative image paths, so keep the absolute raw.githubusercontent.com URLs.
-->

_Screenshots are on the way._

## Installation

- **VS Code Marketplace** — search for “GitHub Actions Cron & Schedule Viewer” in the Extensions view
  (`Ctrl+Shift+X` / `Cmd+Shift+X`) and click Install.
- **Open VSX** (VSCodium, Gitpod, Cursor and friends) — search for the same name in the Extensions
  view.
- **From a `.vsix`** — `code --install-extension github-actions-cron-viewer-0.1.0.vsix`, or
  **Extensions → … → Install from VSIX…**

## Usage

1. Open a repository that contains `.github/workflows/*.yml`.
2. Open a workflow that uses `on: schedule`.
3. The description and the next runs appear above each `cron:` line. Hover for details, or click the
   CodeLens.
4. Run **GitHub Actions: Preview Schedule** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
   at any time.

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
- Schedules are evaluated for the declared timezone or UTC; the extension does not translate them to
  your local time.
- No workflow run history, no workflow monitoring, no GitHub API. This extension reads your files and
  nothing else.

## Privacy

The extension runs entirely offline. It does not collect telemetry, does not contact any server, does
not require authentication, and never writes to your workflow files.

## Contributing

Issues and pull requests are welcome on
[GitHub](https://github.com/adck8/github-actions-cron-viewer).

## License

[MIT](LICENSE)
