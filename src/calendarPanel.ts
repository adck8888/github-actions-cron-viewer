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
`;

const STYLES = `${CODICONS}
:root {
  --radius: 4px;
  --radius-sm: 3px;
  --width: 720px;
  /* contrastBorder only exists in high contrast themes, where it must win. */
  --line: var(--vscode-contrastBorder, var(--vscode-widget-border, rgba(128, 128, 128, 0.25)));
  --accent: var(--vscode-contrastActiveBorder, var(--vscode-focusBorder));
  --accent-text: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 16px 18px 32px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.5;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
.empty { color: var(--vscode-descriptionForeground); }
code { font-family: var(--vscode-editor-font-family); font-size: 0.92em; }
.muted { color: var(--vscode-descriptionForeground); }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }

/* Header */
h1 { font-size: 1.25em; font-weight: 600; margin: 0 0 2px; letter-spacing: -0.01em; }
.summary { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin-bottom: 12px; }
.summary .strong { color: var(--vscode-foreground); font-weight: 600; }

.schedules { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.sched {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 5px 12px 6px 9px; min-width: 168px;
  border: 1px solid var(--line); border-left: 2px solid var(--line);
  border-radius: var(--radius);
  background: none; color: inherit; font: inherit; text-align: left; cursor: pointer;
}
.sched:hover { background: var(--vscode-list-hoverBackground); }
.sched:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.sched.focused { border-color: var(--accent); }
.sched .dot { margin-top: 6px; }
.sched-body { display: flex; flex-direction: column; line-height: 1.35; }
.sched-title { font-weight: 600; }
.sched-time { color: var(--vscode-descriptionForeground); font-size: 0.9em; }

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
.tab:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }
.tab.active {
  color: var(--vscode-panelTitle-activeForeground, var(--vscode-foreground));
  border-bottom-color: var(--vscode-contrastActiveBorder, var(--vscode-panelTitle-activeBorder, var(--vscode-focusBorder)));
}

/* Month toolbar */
.month-bar { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; max-width: var(--width); }
.month-label { font-weight: 600; font-size: 1.05em; margin-right: 4px; }
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
  outline: 1px solid var(--accent); outline-offset: -1px;
}

/* Month grid */
.grid { max-width: var(--width); display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.weekday {
  text-align: center; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground); padding-bottom: 4px;
}
.day {
  display: flex; flex-direction: column; min-height: 58px; padding: 4px 6px 5px;
  border: 1px solid var(--line); border-radius: var(--radius-sm);
  background: none; text-align: left; font: inherit; color: inherit; cursor: default;
}
.day.blank { border-color: transparent; }
.day.has-runs { cursor: pointer; }
.day.has-runs:hover { background: var(--vscode-list-hoverBackground); }
.day:focus-visible { outline: 1px solid var(--accent); outline-offset: -2px; }
.day .num { font-size: 1.05em; font-weight: 500; line-height: 1.2; }
.day.has-runs .num { font-weight: 600; }
.day:not(.has-runs) .num { color: var(--vscode-descriptionForeground); font-weight: 400; }
.day .count { font-size: 0.72em; color: var(--vscode-descriptionForeground); }
.day .bars { display: flex; gap: 2px; margin-top: auto; padding-top: 5px; }
.day .bars i { flex: 1; height: 3px; border-radius: 1px; }

/* Today keeps its accent number; the selected day takes the list selection. */
.day.today { border-color: var(--accent); }
.day.today .num { color: var(--accent-text); }
.day.selected {
  border-color: var(--accent);
  outline: 1px solid var(--accent); outline-offset: -3px;
  background: var(--vscode-list-activeSelectionBackground, var(--vscode-list-hoverBackground));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
}
.day.selected .num, .day.selected .count { color: inherit; }
.day.selected .num { font-weight: 700; }

/* Day details */
.dd { max-width: var(--width); margin-top: 16px; }
.dd-title { font-weight: 600; font-size: 1.02em; margin-bottom: 4px; }
.dd-grid { display: grid; grid-template-columns: 104px minmax(130px, 1fr) minmax(170px, 1fr); }
.dd-grid > span { padding: 5px 0; border-top: 1px solid var(--line); }
.dd-grid > .head {
  border-top: none; padding: 0 0 3px;
  font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--vscode-descriptionForeground);
}
.dd-local { font-weight: 600; font-variant-numeric: tabular-nums; }
.dd-name { display: flex; align-items: baseline; gap: 7px; }
.dd-when { color: var(--vscode-descriptionForeground); font-variant-numeric: tabular-nums; }
.dd-more { padding-top: 6px; }

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

/* Details cards */
.card {
  max-width: var(--width); margin-bottom: 8px; padding: 11px 13px;
  border: 1px solid var(--line); border-radius: var(--radius);
}
.card-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 3px; }
.card-head .dot { align-self: center; }
.card-head .title { font-weight: 600; }
.card .expr { margin: 0 0 8px; }
.zone-row { display: flex; gap: 8px; padding: 1px 0; }
.zone-row .label { min-width: 74px; color: var(--vscode-descriptionForeground); }
.section-label {
  font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em;
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

function color(name) { return COLORS[name] || COLORS.blue; }
function dot(name) { return el('span', { class: 'dot', style: 'background:' + color(name) }); }

function pad(n) { return String(n).padStart(2, '0'); }
function monthPrefix() { return payload.year + '-' + pad(payload.month); }
function keyFor(day) { return monthPrefix() + '-' + pad(day); }

/** "04:00 UTC \\u2192 08:00 local", or just ":15 America/New_York" for intervals. */
function scheduleTimeLine(schedule) {
  const clock = /^\\d/.test(schedule.timeLabel);
  const head = (schedule.timeLabel || schedule.short) + ' ' + schedule.timezone;
  if (!clock || !schedule.showLocalTime || !schedule.nextRuns[0]) return head;
  return head + ' \\u2192 ' + schedule.nextRuns[0].localTime + ' local';
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
    root.appendChild(el('p', { class: 'summary', text: payload.fileName }));
    root.appendChild(el('p', { class: 'empty', text: 'This workflow has no cron schedules.' }));
    return;
  }

  renderHeader();

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

function renderHeader() {
  const count = payload.schedules.length;
  const summary = el('div', { class: 'summary' }, [
    el('span', { text: count + (count === 1 ? ' schedule' : ' schedules') })
  ]);
  const next = payload.merged[0];
  if (next) {
    summary.appendChild(el('span', { text: ' \\u00b7 Next run ' }));
    summary.appendChild(el('span', { class: 'strong', text: next.relative }));
  }
  summary.appendChild(el('span', { text: ' \\u00b7 Local timezone: ' + payload.localTimezone }));
  root.appendChild(summary);

  const list = el('div', { class: 'schedules' });
  for (const schedule of payload.schedules) {
    list.appendChild(el('button', {
      class: 'sched' + (schedule.index === payload.focusedIndex ? ' focused' : ''),
      style: 'border-left-color:' + color(schedule.color),
      title: schedule.expression + ' \\u2014 go to line ' + (schedule.line + 1),
      onclick: () => vscode.postMessage({ type: 'reveal', line: schedule.line })
    }, [
      dot(schedule.color),
      el('span', { class: 'sched-body' }, [
        el('span', { class: 'sched-title', text: schedule.valid ? schedule.title : 'Invalid cron' }),
        el('span', {
          class: 'sched-time',
          text: schedule.valid ? scheduleTimeLine(schedule) : schedule.expression
        })
      ])
    ]));
  }
  root.appendChild(list);
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

/** The runs of one day, ordered by the actual instant, which is local-time order. */
function dayRows(entries) {
  return entries
    .flatMap(({ schedule, bucket }) => bucket.runs.map((run) => ({ schedule, run })))
    .sort((a, b) => a.run.iso.localeCompare(b.run.iso));
}

/**
 * Today when it is in view and has runs, otherwise the first day that does:
 * an empty details section under the calendar is wasted space.
 */
function defaultSelection() {
  if (payload.todayKey.startsWith(monthPrefix()) && runsForDay(payload.todayKey).length) {
    return payload.todayKey;
  }
  for (let day = 1; day <= payload.daysInMonth; day++) {
    const key = keyFor(day);
    if (runsForDay(key).length) return key;
  }
  return null;
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

    const children = [el('div', { class: 'num', text: String(day) })];
    if (entries.length) {
      const total = countRuns(entries);
      children.push(el('div', { class: 'count', text: total + (total === 1 ? ' run' : ' runs') }));
      const bars = el('div', { class: 'bars' });
      for (const entry of entries) {
        bars.appendChild(el('i', { style: 'background:' + color(entry.schedule.color) }));
      }
      children.push(bars);
    }

    grid.appendChild(el('button', {
      class: classes.join(' '),
      title: entries.length ? dayTooltip(day, entries) : '',
      onclick: entries.length ? (() => { selectedKey = key; render(); }) : (() => {})
    }, children));
  }
  root.appendChild(grid);

  if (selectedKey) renderDayDetails(selectedKey);
}

function dayTooltip(day, entries) {
  const total = countRuns(entries);
  const head = payload.monthLabel.slice(0, 3) + ' ' + day + ' \\u00b7 ' + total + (total === 1 ? ' run' : ' runs');
  const lines = dayRows(entries).map(({ schedule, run }) =>
    run.localTime + ' your time \\u2014 ' + schedule.title + ' (' + run.time + ' ' + schedule.timezone + ')'
  );
  return [head].concat(lines).join('\\n');
}

function renderDayDetails(key) {
  const entries = runsForDay(key);
  if (!entries.length) return;
  const day = Number(key.slice(8));
  const total = countRuns(entries);

  const box = el('div', { class: 'dd' }, [
    el('div', { class: 'dd-title' }, [
      el('span', { text: payload.monthLabel.split(' ')[0] + ' ' + day }),
      el('span', { class: 'muted', text: ' \\u00b7 ' + total + (total === 1 ? ' run' : ' runs') })
    ])
  ]);

  const grid = el('div', { class: 'dd-grid' }, [
    el('span', { class: 'head', text: 'Local time' }),
    el('span', { class: 'head', text: 'Schedule' }),
    el('span', { class: 'head', text: 'Workflow time' })
  ]);

  for (const { schedule, run } of dayRows(entries)) {
    grid.appendChild(el('span', { class: 'dd-local' }, [
      el('span', { text: run.localTime }),
      run.localDateDiffers ? el('span', { class: 'muted', text: ' ' + run.localDate }) : null
    ]));
    grid.appendChild(el('span', { class: 'dd-name' }, [
      dot(schedule.color),
      el('span', { text: schedule.title })
    ]));
    grid.appendChild(el('span', { class: 'dd-when', text: run.time + ' ' + schedule.timezone }));
  }
  box.appendChild(grid);

  const more = entries.reduce((sum, entry) => sum + entry.bucket.more, 0);
  if (more > 0) {
    box.appendChild(el('div', { class: 'muted dd-more', text: '+ ' + more + ' more runs' }));
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
          text: schedule.valid ? schedule.title : 'Invalid cron expression'
        }),
        schedule.valid ? el('span', { class: 'muted', text: scheduleTimeLine(schedule) }) : null
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
    if (!selectedKey || !selectedKey.startsWith(monthPrefix()) || !runsForDay(selectedKey).length) {
      selectedKey = defaultSelection();
    }
    render();
  }
});

vscode.postMessage({ type: 'ready' });
`;
