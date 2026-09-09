import * as vscode from 'vscode';
import { buildCalendarPayload, currentMonth, shiftMonth } from './scheduleModel';
import { isWorkflowPath } from './workflowParser';

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'month'; delta: number }
  | { type: 'today' }
  | { type: 'reveal'; line: number };

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
    ''
  );
}

/**
 * The "GitHub Actions Schedule" panel: a month calendar of every scheduled run
 * in the current workflow, the upcoming runs and the per-schedule details.
 * One panel is reused for the whole window.
 */
export class SchedulePanel {
  private static current: SchedulePanel | undefined;
  private static extensionUri: vscode.Uri | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private documentUri: vscode.Uri;
  private view: { year: number; month: number };
  private focusedIndex: number;

  private constructor(private readonly panel: vscode.WebviewPanel, document: vscode.TextDocument) {
    this.documentUri = document.uri;
    this.view = currentMonth();
    this.focusedIndex = 0;

    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: IncomingMessage) => this.handleMessage(message),
      null,
      this.disposables
    );

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() === this.documentUri.toString()) {
          this.render();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // Follow the user to another workflow file, but do not clear the panel
        // when they switch to an unrelated editor.
        if (editor && isWorkflowPath(editor.document.uri.fsPath)) {
          this.documentUri = editor.document.uri;
          this.focusedIndex = 0;
          this.render();
        }
      })
    );
  }

  /** Called once on activation so the webview can load the codicon font. */
  static configure(extensionUri: vscode.Uri): void {
    SchedulePanel.extensionUri = extensionUri;
  }

  static show(document: vscode.TextDocument, scheduleIndex = 0): void {
    const column = vscode.ViewColumn.Beside;

    if (SchedulePanel.current) {
      SchedulePanel.current.documentUri = document.uri;
      SchedulePanel.current.focusedIndex = scheduleIndex;
      SchedulePanel.current.panel.reveal(column, true);
      SchedulePanel.current.render();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'githubActionsCronSchedule',
      'GitHub Actions Schedule',
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: SchedulePanel.mediaRoots()
      }
    );
    SchedulePanel.current = new SchedulePanel(panel, document);
    SchedulePanel.current.focusedIndex = scheduleIndex;
    SchedulePanel.current.render();
  }

  private static mediaRoots(): vscode.Uri[] | undefined {
    return SchedulePanel.extensionUri
      ? [vscode.Uri.joinPath(SchedulePanel.extensionUri, 'media')]
      : undefined;
  }

  private handleMessage(message: IncomingMessage): void {
    switch (message.type) {
      case 'ready':
        this.render();
        break;
      case 'month':
        this.view = shiftMonth(this.view.year, this.view.month, message.delta);
        this.render();
        break;
      case 'today':
        this.view = currentMonth();
        this.render();
        break;
      case 'reveal':
        void this.reveal(message.line);
        break;
    }
  }

  private async reveal(line: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(this.documentUri);
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false
    });
    const range = document.lineAt(Math.min(line, document.lineCount - 1)).range;
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private render(): void {
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === this.documentUri.toString()
    );
    if (!document) {
      return;
    }

    const config = vscode.workspace.getConfiguration('githubActionsCron');
    const payload = buildCalendarPayload(
      document.getText(),
      document.uri.path.split('/').pop() ?? 'workflow.yml',
      this.view.year,
      this.view.month,
      {
        nextRunsCount: Math.max(config.get<number>('nextRunsCount', 5), 5),
        use24HourFormat: config.get<boolean>('use24HourFormat', true),
        focusedIndex: this.focusedIndex
      }
    );

    this.panel.title = payload.schedules.length
      ? `Schedule: ${payload.workflowName}`
      : 'GitHub Actions Schedule';
    void this.panel.webview.postMessage({ type: 'payload', payload });
  }

  private dispose(): void {
    SchedulePanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }

  private html(): string {
    const font = SchedulePanel.extensionUri
      ? this.panel.webview
          .asWebviewUri(
            vscode.Uri.joinPath(SchedulePanel.extensionUri, 'media', 'codicons', 'codicon.ttf')
          )
          .toString()
      : '';
    return panelHtml(this.panel.webview.cspSource, nonce(), font);
  }
}

/** The webview document. Pure, so it can be rendered outside VS Code for review. */
export function panelHtml(cspSource: string, scriptNonce: string, codiconUri = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
<title>GitHub Actions Schedule</title>
<style>@font-face { font-family: "codicon"; font-display: block; src: url("${codiconUri}") format("truetype"); }</style>
<style>${STYLES}</style>
</head>
<body>
<div id="root"><p class="empty">Loading schedules…</p></div>
<script nonce="${scriptNonce}">${SCRIPT}</script>
</body>
</html>`;
}

/**
 * Only the handful of codicons the panel uses. The escapes are doubled so the
 * emitted CSS keeps its backslash.
 */
const CODICONS = `
.codicon {
  font: normal normal normal 16px/1 codicon;
  display: inline-block;
  text-decoration: none;
  text-rendering: auto;
  text-align: center;
  -webkit-font-smoothing: antialiased;
  user-select: none;
  flex: none;
}
.codicon-sm { font-size: 13px; }
.codicon-chevron-left:before { content: "\\eab5"; }
.codicon-chevron-right:before { content: "\\eab6"; }
.codicon-arrow-small-right:before { content: "\\ea9f"; }
.codicon-info:before { content: "\\ea74"; }
.codicon-warning:before { content: "\\ea6c"; }
.codicon-error:before { content: "\\ea87"; }
.codicon-calendar:before { content: "\\eab0"; }
`;

const STYLES = `${CODICONS}
:root {
  --radius: 4px;
  --radius-sm: 3px;
  --width: 700px;
  /* contrastBorder only exists in high contrast themes, where it must win. */
  --line: var(--vscode-contrastBorder, var(--vscode-widget-border, rgba(128, 128, 128, 0.25)));
  /* High contrast themes mark the active element with contrastActiveBorder. */
  --accent: var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 14px 18px 28px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.5;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
h1 { font-size: 1.1em; font-weight: 600; margin: 0; }
.subtitle { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin: 1px 0 12px; }
.empty { color: var(--vscode-descriptionForeground); }
code { font-family: var(--vscode-editor-font-family); font-size: 0.92em; }
.muted { color: var(--vscode-descriptionForeground); }

/* Schedule chips */
.legend { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 1px 8px; min-height: 22px;
  border: 1px solid var(--line); border-radius: var(--radius);
  background: none; color: inherit; font: inherit; font-size: 0.92em;
  text-align: left; cursor: pointer;
}
.chip:hover { background: var(--vscode-list-hoverBackground); }
.chip:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.chip.focused { border-color: var(--accent); }
.chip .tz { color: var(--vscode-descriptionForeground); }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }

/* Panel-style tab bar */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--vscode-panel-border, var(--line));
  margin-bottom: 14px;
}
.tab {
  padding: 5px 0; margin: 0 18px -1px 0;
  border: none; border-bottom: 1px solid transparent;
  background: none; font: inherit; cursor: pointer;
  color: var(--vscode-panelTitle-inactiveForeground, var(--vscode-descriptionForeground));
}
.tab:hover { color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground)); }
.tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
.tab.active {
  color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
  border-bottom-color: var(--vscode-contrastActiveBorder, var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)));
}

/* Month toolbar */
.month-bar { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; max-width: var(--width); }
.month-label { font-weight: 600; margin-right: 4px; }
.icon-btn, .today-btn {
  border: 1px solid transparent; background: none;
  color: var(--vscode-foreground); font: inherit;
  border-radius: var(--radius-sm); cursor: pointer;
}
.icon-btn { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; }
.today-btn { padding: 2px 9px; margin-left: auto; border-color: var(--line); font-size: 0.92em; }
.icon-btn:hover, .today-btn:hover {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}
.icon-btn:focus-visible, .today-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
}

/* Month grid */
.grid { max-width: var(--width); display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.weekday {
  text-align: center; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--vscode-descriptionForeground); padding-bottom: 3px;
}
.day {
  min-height: 50px; padding: 3px 5px 4px;
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: none; text-align: left; font: inherit; color: inherit; cursor: default;
}
.day.blank { border-color: transparent; }
.day.has-runs { cursor: pointer; }
.day.has-runs:hover { background: var(--vscode-list-hoverBackground); }
.day:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -2px; }
.day.today { border-color: var(--accent); }
.day.selected {
  border-color: var(--accent);
  background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground));
}
.day .num { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.day.has-runs .num, .day.today .num { color: var(--vscode-foreground); }
.day.has-runs .num { font-weight: 600; }
.day .dots { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.day .times {
  margin-top: 2px; font-size: 0.74em; line-height: 1.3;
  color: var(--vscode-descriptionForeground);
}

/* Day details under the calendar */
.day-detail {
  max-width: var(--width); margin-top: 10px; padding: 9px 11px;
  border: 1px solid var(--line); border-radius: var(--radius);
}
.day-detail h3 {
  margin: 0 0 6px; font-size: 0.92em; font-weight: 600;
  display: flex; align-items: center; gap: 6px;
}
.day-row {
  display: grid; grid-template-columns: 7px 52px minmax(96px, auto) 1fr;
  gap: 9px; align-items: baseline; padding: 2px 0;
}
.day-row .time { font-weight: 600; font-variant-numeric: tabular-nums; }
.day-row .zone {
  display: flex; align-items: baseline; gap: 6px;
  color: var(--vscode-descriptionForeground);
}

/* Run lists */
.list { max-width: var(--width); border: 1px solid var(--line); border-radius: var(--radius); }
.list .run-row { padding: 5px 11px; border-top: 1px solid var(--line); }
.list .run-row:first-child { border-top: none; }
.run-row { display: flex; align-items: baseline; gap: 9px; padding: 3px 0; flex-wrap: wrap; }
.run-row .date { min-width: 52px; font-weight: 600; }
.run-row .wd { min-width: 30px; }
.run-row .time { min-width: 46px; font-variant-numeric: tabular-nums; }
.run-row .tz { min-width: 122px; }
.run-row .local { min-width: 168px; }
.local { display: inline-flex; align-items: baseline; gap: 4px; }
.day-row .local:empty { display: none; }

/* Details cards */
.card {
  max-width: var(--width); margin-bottom: 8px; padding: 11px 13px;
  border: 1px solid var(--line); border-radius: var(--radius);
}
.card-head { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; }
.card-head .title { font-weight: 600; }
.card .expr { margin: 0 0 8px; }
.zone-row { display: flex; gap: 8px; padding: 1px 0; }
.zone-row .label { min-width: 74px; color: var(--vscode-descriptionForeground); }
.section-label {
  font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--vscode-descriptionForeground); margin: 10px 0 3px;
}
.notes {
  margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 4px;
}
.note { display: flex; gap: 7px; align-items: flex-start; line-height: 1.45; }
.note .codicon { margin-top: 2px; }
.note.error .codicon { color: var(--vscode-editorError-foreground); }
.note.warning .codicon { color: var(--vscode-editorWarning-foreground); }
.note.info .codicon { color: var(--vscode-editorInfo-foreground); }
.note.info { color: var(--vscode-descriptionForeground); }
.invalid { color: var(--vscode-editorError-foreground); }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const root = document.getElementById('root');
let payload = null;
let tab = 'calendar';
let selectedKey = null;

const COLORS = {
  blue: 'var(--vscode-charts-blue, #3794ff)',
  green: 'var(--vscode-charts-green, #3fb950)',
  purple: 'var(--vscode-charts-purple, #b180d7)',
  orange: 'var(--vscode-charts-orange, #d18616)',
  red: 'var(--vscode-charts-red, #f14c4c)',
  yellow: 'var(--vscode-charts-yellow, #cca700)'
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function el(tag, props, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children || []) {
    if (child) node.appendChild(child);
  }
  return node;
}

function icon(name, small) {
  return el('span', {
    class: 'codicon codicon-' + name + (small ? ' codicon-sm' : ''),
    'aria-hidden': 'true'
  });
}

function dot(color) {
  return el('span', { class: 'dot', style: 'background:' + (COLORS[color] || COLORS.blue) });
}

function pad(n) { return String(n).padStart(2, '0'); }
function keyFor(day) { return payload.year + '-' + pad(payload.month) + '-' + pad(day); }

/** The schedule without its time: "Mon-Fri · 04:00" -> "Mon-Fri", "every 6h at :15" -> "every 6h". */
function scheduleLabel(schedule) {
  if (!schedule.valid) return 'Invalid cron';
  const parts = (schedule.short || '').split(' · ');
  const last = parts[parts.length - 1]
    .replace(/ at :\\d{2}$/, '')
    .replace(/^\\d{1,2}:\\d{2}(\\s?[AP]M)?\\s*/i, '');
  if (last) parts[parts.length - 1] = last;
  else parts.pop();
  return parts.join(' · ') || schedule.short;
}

function localLine(run, schedule) {
  // An empty placeholder keeps the columns aligned when one schedule already
  // runs in the user's own timezone.
  if (!schedule || !schedule.showLocalTime) return el('span', { class: 'muted local' });
  const label = run.localDateDiffers ? run.localDate + ' ' + run.localTime : run.localTime;
  return el('span', { class: 'muted local' }, [
    icon('arrow-small-right', true),
    el('span', { text: label + ' your time' })
  ]);
}

function render() {
  root.textContent = '';
  if (!payload) return;

  root.appendChild(el('h1', { text: payload.workflowName }));

  if (payload.schedules.length === 0) {
    root.appendChild(el('p', { class: 'subtitle', text: payload.fileName }));
    root.appendChild(el('p', { class: 'empty', text: 'This workflow has no cron schedules.' }));
    return;
  }

  const count = payload.schedules.length;
  root.appendChild(el('p', {
    class: 'subtitle',
    text: payload.fileName + ' · ' + count + (count === 1 ? ' schedule' : ' schedules') +
      ' · your timezone: ' + payload.localTimezone
  }));

  const legend = el('div', { class: 'legend' });
  for (const schedule of payload.schedules) {
    legend.appendChild(el('button', {
      class: 'chip' + (schedule.index === payload.focusedIndex ? ' focused' : ''),
      title: schedule.expression + ' — go to line ' + (schedule.line + 1),
      onclick: () => vscode.postMessage({ type: 'reveal', line: schedule.line })
    }, [
      dot(schedule.color),
      el('span', { text: schedule.short }),
      el('span', { class: 'tz', text: schedule.timezone })
    ]));
  }
  root.appendChild(legend);

  const tabs = el('div', { class: 'tabs' });
  for (const [id, label] of [['calendar', 'Calendar'], ['upcoming', 'Upcoming'], ['details', 'Details']]) {
    tabs.appendChild(el('button', {
      class: 'tab' + (tab === id ? ' active' : ''),
      text: label,
      onclick: () => { tab = id; render(); }
    }));
  }
  root.appendChild(tabs);

  if (tab === 'calendar') renderCalendar();
  else if (tab === 'upcoming') renderUpcoming();
  else renderDetails();
}

function runsForDay(key) {
  const result = [];
  for (const schedule of payload.schedules) {
    const bucket = schedule.days[key];
    if (bucket) result.push({ schedule, bucket });
  }
  return result;
}

function countRuns(entries) {
  return entries.reduce((sum, entry) => sum + entry.bucket.runs.length + entry.bucket.more, 0);
}

function renderCalendar() {
  root.appendChild(el('div', { class: 'month-bar' }, [
    el('div', { class: 'month-label', text: payload.monthLabel }),
    el('button', {
      class: 'icon-btn', title: 'Previous month', 'aria-label': 'Previous month',
      onclick: () => vscode.postMessage({ type: 'month', delta: -1 })
    }, [icon('chevron-left')]),
    el('button', {
      class: 'icon-btn', title: 'Next month', 'aria-label': 'Next month',
      onclick: () => vscode.postMessage({ type: 'month', delta: 1 })
    }, [icon('chevron-right')]),
    el('button', { class: 'today-btn', text: 'Today', onclick: () => vscode.postMessage({ type: 'today' }) })
  ]));

  const grid = el('div', { class: 'grid' });
  for (const name of WEEKDAYS) grid.appendChild(el('div', { class: 'weekday', text: name }));
  for (let i = 0; i < payload.firstWeekday; i++) grid.appendChild(el('div', { class: 'day blank' }));

  for (let day = 1; day <= payload.daysInMonth; day++) {
    const key = keyFor(day);
    const entries = runsForDay(key);
    const classes = ['day'];
    if (entries.length) classes.push('has-runs');
    if (key === payload.todayKey) classes.push('today');
    if (key === selectedKey) classes.push('selected');

    const dots = el('div', { class: 'dots' });
    for (const entry of entries) dots.appendChild(dot(entry.schedule.color));

    const children = [el('div', { class: 'num', text: String(day) }), entries.length ? dots : null];
    if (entries.length === 1 && entries[0].bucket.runs.length <= 2) {
      children.push(el('div', {
        class: 'times',
        text: entries[0].bucket.runs.map((run) => run.time).join(' ')
      }));
    } else if (entries.length) {
      children.push(el('div', { class: 'times', text: countRuns(entries) + ' runs' }));
    }

    grid.appendChild(el('button', {
      class: classes.join(' '),
      onclick: entries.length ? (() => { selectedKey = key; render(); }) : (() => {})
    }, children));
  }
  root.appendChild(grid);

  if (selectedKey) renderDayDetail(selectedKey);
}

function renderDayDetail(key) {
  const entries = runsForDay(key);
  if (!entries.length) return;
  const [year, month, day] = key.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const total = countRuns(entries);

  const box = el('div', { class: 'day-detail' }, [
    el('h3', {}, [
      icon('calendar', true),
      el('span', { text: weekday + ', ' + payload.monthLabel.slice(0, 3) + ' ' + day }),
      el('span', { class: 'muted', text: '· ' + total + (total === 1 ? ' run' : ' runs') })
    ])
  ]);

  // Schedules can sit in different timezones, so order by the actual instant.
  const rows = entries
    .flatMap(({ schedule, bucket }) => bucket.runs.map((run) => ({ schedule, run })))
    .sort((a, b) => a.run.iso.localeCompare(b.run.iso));

  for (const { schedule, run } of rows) {
    box.appendChild(el('div', { class: 'day-row', title: schedule.expression }, [
      dot(schedule.color),
      el('span', { class: 'time', text: run.time }),
      el('span', { text: scheduleLabel(schedule) }),
      el('span', { class: 'zone' }, [
        el('span', { text: schedule.timezone }),
        localLine(run, schedule)
      ])
    ]));
  }

  const more = entries.reduce((sum, entry) => sum + entry.bucket.more, 0);
  if (more > 0) {
    box.appendChild(el('div', { class: 'muted', text: '+ ' + more + ' more runs' }));
  }
  root.appendChild(box);
}

function renderUpcoming() {
  if (!payload.merged.length) {
    root.appendChild(el('p', { class: 'empty', text: 'No upcoming runs could be calculated.' }));
    return;
  }
  const box = el('div', { class: 'list' });
  for (const run of payload.merged) {
    const schedule = payload.schedules[run.scheduleIndex];
    box.appendChild(el('div', { class: 'run-row', title: schedule.expression }, [
      dot(run.color),
      el('span', { class: 'date', text: run.date }),
      el('span', { class: 'muted wd', text: run.weekday }),
      el('span', { class: 'time', text: run.time }),
      el('span', { class: 'muted tz', text: schedule.timezone }),
      localLine(run, schedule),
      el('span', { class: 'muted', text: run.relative })
    ]));
  }
  root.appendChild(box);
}

function renderDetails() {
  for (const schedule of payload.schedules) {
    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        dot(schedule.color),
        el('span', {
          class: schedule.valid ? 'title' : 'title invalid',
          text: schedule.valid ? schedule.short : 'Invalid cron expression'
        })
      ]),
      el('p', { class: 'expr' }, [el('code', { text: schedule.expression })])
    ]);

    if (schedule.valid) {
      card.appendChild(el('div', { class: 'muted', text: schedule.description }));
      card.appendChild(el('div', { class: 'section-label', text: 'Timezone' }));
      card.appendChild(el('div', { class: 'zone-row' }, [
        el('span', { class: 'label', text: 'Workflow' }),
        el('span', {
          text: (schedule.nextRuns[0] ? schedule.nextRuns[0].time + ' ' : '') + schedule.timezone +
            (schedule.timezoneExplicit ? '' : ' (default)')
        })
      ]));
      if (schedule.showLocalTime && schedule.nextRuns[0]) {
        card.appendChild(el('div', { class: 'zone-row' }, [
          el('span', { class: 'label', text: 'Your time' }),
          el('span', { text: schedule.nextRuns[0].localTime + ' ' + schedule.localTimezone })
        ]));
      }

      card.appendChild(el('div', { class: 'section-label', text: 'Next runs' }));
      for (const run of schedule.nextRuns) {
        card.appendChild(el('div', { class: 'run-row' }, [
          el('span', { class: 'date', text: run.date }),
          el('span', { class: 'muted wd', text: run.weekday }),
          el('span', { class: 'time', text: run.time }),
          localLine(run, schedule),
          el('span', { class: 'muted', text: run.relative })
        ]));
      }
    } else {
      card.appendChild(el('div', { class: 'invalid', text: schedule.error || '' }));
    }

    const notes = schedule.warnings.filter((w) => schedule.valid || w.severity !== 'error');
    if (notes.length) {
      const block = el('div', { class: 'notes' });
      for (const note of notes) {
        const name = note.severity === 'info' ? 'info' : note.severity === 'error' ? 'error' : 'warning';
        block.appendChild(el('div', { class: 'note ' + note.severity }, [
          icon(name, true),
          el('span', { text: note.message })
        ]));
      }
      card.appendChild(block);
    }
    root.appendChild(card);
  }
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'payload') {
    payload = message.payload;
    if (selectedKey && !selectedKey.startsWith(payload.year + '-' + pad(payload.month))) {
      selectedKey = null;
    }
    render();
  }
});

vscode.postMessage({ type: 'ready' });
`;
