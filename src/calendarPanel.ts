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
      { enableScripts: true, retainContextWhenHidden: true }
    );
    SchedulePanel.current = new SchedulePanel(panel, document);
    SchedulePanel.current.focusedIndex = scheduleIndex;
    SchedulePanel.current.render();
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
    return panelHtml(this.panel.webview.cspSource, nonce());
  }
}

/** The webview document. Pure, so it can be rendered outside VS Code for review. */
export function panelHtml(cspSource: string, scriptNonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${scriptNonce}';">
<title>GitHub Actions Schedule</title>
<style>${STYLES}</style>
</head>
<body>
<div id="root"><p class="empty">Loading schedules…</p></div>
<script nonce="${scriptNonce}">${SCRIPT}</script>
</body>
</html>`;
}

const STYLES = `
:root {
  --gap: 16px;
  --radius: 6px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 20px 24px 32px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
}
h1 { font-size: 1.35em; font-weight: 600; margin: 0 0 4px; }
.subtitle { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin: 0 0 var(--gap); }
.empty { color: var(--vscode-descriptionForeground); }
code, .mono {
  font-family: var(--vscode-editor-font-family);
  font-size: 0.92em;
}

.legend { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--gap); }
.chip {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 11px;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
  border-radius: 999px;
  background: var(--vscode-editorWidget-background);
  color: inherit; font: inherit; cursor: pointer;
}
.chip:hover { background: var(--vscode-list-hoverBackground); }
.chip.focused { border-color: var(--vscode-focusBorder); }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.chip .tz { color: var(--vscode-descriptionForeground); }

.tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3)); margin-bottom: var(--gap); }
.tab {
  padding: 7px 14px; border: none; background: none; color: var(--vscode-descriptionForeground);
  font: inherit; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tab:hover { color: var(--vscode-foreground); }
.tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }

.month-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.month-label { font-weight: 600; font-size: 1.05em; min-width: 170px; text-align: center; }
.nav, .today {
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
  background: var(--vscode-button-secondaryBackground, transparent);
  color: var(--vscode-foreground);
  border-radius: var(--radius); cursor: pointer; font: inherit;
}
.nav { width: 30px; height: 28px; line-height: 1; }
.today { padding: 4px 12px; margin-left: auto; }
.nav:hover, .today:hover { background: var(--vscode-list-hoverBackground); }

.grid { max-width: 780px; display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.weekday {
  text-align: center; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--vscode-descriptionForeground); padding-bottom: 4px;
}
.day {
  position: relative; min-height: 56px; padding: 5px 6px;
  border: 1px solid transparent; border-radius: var(--radius);
  background: var(--vscode-editorWidget-background);
  cursor: default; text-align: left; font: inherit; color: inherit;
}
.day.blank { background: none; }
.day.has-runs { cursor: pointer; }
.day.has-runs:hover { border-color: var(--vscode-focusBorder); }
.day.today { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.day.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground); }
.day .num { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
.day.has-runs .num { color: var(--vscode-foreground); font-weight: 600; }
.day .dots { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 5px; }
.day .times { margin-top: 3px; font-size: 0.76em; color: var(--vscode-descriptionForeground); line-height: 1.35; }

.day-detail {
  margin-top: var(--gap); padding: 12px 14px;
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: var(--radius); background: var(--vscode-editorWidget-background);
}
.day-detail h3 { margin: 0 0 8px; font-size: 1em; }
.run-row { display: flex; align-items: baseline; gap: 9px; padding: 4px 0; flex-wrap: wrap; }
.run-row .time { font-weight: 600; min-width: 58px; }
.run-row .tz { min-width: 126px; }
.run-row .local { min-width: 172px; }
.run-row .muted, .muted { color: var(--vscode-descriptionForeground); }
.arrow { color: var(--vscode-descriptionForeground); }

.card {
  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
  border-radius: var(--radius); padding: 14px 16px; margin-bottom: 12px;
  background: var(--vscode-editorWidget-background);
}
.card-head { display: flex; align-items: center; gap: 9px; margin-bottom: 6px; }
.card-head .title { font-weight: 600; }
.card .expr { margin: 0 0 10px; }
.zone-row { display: flex; gap: 8px; padding: 2px 0; }
.zone-row .label { min-width: 78px; color: var(--vscode-descriptionForeground); }
.section-label {
  font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--vscode-descriptionForeground); margin: 12px 0 5px;
}
.notes { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.note { display: flex; gap: 8px; align-items: flex-start; line-height: 1.45; }
.note .icon { flex: none; }
.note.error .icon { color: var(--vscode-editorError-foreground); }
.note.warning .icon { color: var(--vscode-editorWarning-foreground); }
.note.info .icon { color: var(--vscode-editorInfo-foreground); }
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

function dot(color) {
  return el('span', { class: 'dot', style: 'background:' + (COLORS[color] || COLORS.blue) });
}

function pad(n) { return String(n).padStart(2, '0'); }
function keyFor(day) { return payload.year + '-' + pad(payload.month) + '-' + pad(day); }

function localLine(run, schedule) {
  if (!schedule || !schedule.showLocalTime) return null;
  const label = run.localDateDiffers ? run.localDate + ' ' + run.localTime : run.localTime;
  return el('span', { class: 'muted local', text: '→ ' + label + ' your time' });
}

function render() {
  root.textContent = '';
  if (!payload) return;

  if (payload.schedules.length === 0) {
    root.appendChild(el('h1', { text: payload.workflowName }));
    root.appendChild(el('p', { class: 'empty', text: 'This workflow has no cron schedules.' }));
    return;
  }

  root.appendChild(el('h1', { text: payload.workflowName }));
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
      title: 'Go to line ' + (schedule.line + 1),
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

function renderCalendar() {
  const bar = el('div', { class: 'month-bar' }, [
    el('button', { class: 'nav', text: '‹', title: 'Previous month', onclick: () => vscode.postMessage({ type: 'month', delta: -1 }) }),
    el('div', { class: 'month-label', text: payload.monthLabel }),
    el('button', { class: 'nav', text: '›', title: 'Next month', onclick: () => vscode.postMessage({ type: 'month', delta: 1 }) }),
    el('button', { class: 'today', text: 'Today', onclick: () => vscode.postMessage({ type: 'today' }) })
  ]);
  root.appendChild(bar);

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
      const total = entries.reduce((sum, entry) => sum + entry.bucket.runs.length + entry.bucket.more, 0);
      children.push(el('div', { class: 'times', text: total + ' runs' }));
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
  const heading = new Date(Date.UTC(year, month - 1, day));
  const title = WEEKDAYS[heading.getUTCDay()] + ', ' + payload.monthLabel.split(' ')[0] + ' ' + day;

  const box = el('div', { class: 'day-detail' }, [el('h3', { text: title })]);

  // Schedules can sit in different timezones, so order by the actual instant.
  const rows = entries
    .flatMap(({ schedule, bucket }) => bucket.runs.map((run) => ({ schedule, run })))
    .sort((a, b) => a.run.iso.localeCompare(b.run.iso));

  for (const { schedule, run } of rows) {
    box.appendChild(el('div', { class: 'run-row' }, [
      dot(schedule.color),
      el('span', { class: 'time', text: run.time }),
      el('span', { class: 'muted tz', text: schedule.timezone }),
      localLine(run, schedule),
      el('code', { class: 'muted', text: schedule.expression })
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
  const box = el('div', { class: 'card' });
  for (const run of payload.merged) {
    const schedule = payload.schedules[run.scheduleIndex];
    box.appendChild(el('div', { class: 'run-row' }, [
      dot(run.color),
      el('span', { class: 'time', text: run.date }),
      el('span', { class: 'muted', text: run.weekday }),
      el('span', { text: run.time }),
      el('span', { class: 'muted tz', text: schedule.timezone }),
      localLine(run, schedule),
      el('span', { class: 'muted', text: '· ' + run.relative })
    ]));
  }
  root.appendChild(box);
}

function renderDetails() {
  for (const schedule of payload.schedules) {
    const card = el('div', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        dot(schedule.color),
        el('span', { class: schedule.valid ? 'title' : 'title invalid', text: schedule.valid ? schedule.short : 'Invalid cron expression' })
      ]),
      el('p', { class: 'expr' }, [el('code', { text: schedule.expression })])
    ]);

    if (schedule.valid) {
      card.appendChild(el('div', { class: 'muted', text: schedule.description }));
      card.appendChild(el('div', { class: 'section-label', text: 'Timezone' }));
      card.appendChild(el('div', { class: 'zone-row' }, [
        el('span', { class: 'label', text: 'Workflow' }),
        el('span', { text: (schedule.nextRuns[0] ? schedule.nextRuns[0].time + ' ' : '') + schedule.timezone + (schedule.timezoneExplicit ? '' : ' (default)') })
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
          el('span', { class: 'time', text: run.date }),
          el('span', { text: run.weekday }),
          el('span', { text: run.time }),
          localLine(run, schedule),
          el('span', { class: 'muted', text: '· ' + run.relative })
        ]));
      }
    } else {
      card.appendChild(el('div', { class: 'invalid', text: schedule.error || '' }));
    }

    const notes = schedule.warnings.filter((w) => schedule.valid || w.severity !== 'error');
    if (notes.length) {
      const block = el('div', { class: 'notes' });
      for (const note of notes) {
        block.appendChild(el('div', { class: 'note ' + note.severity }, [
          el('span', { class: 'icon', text: note.severity === 'info' ? 'ⓘ' : '⚠' }),
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
    payload.showLocal = payload.schedules.some((schedule) => schedule.showLocalTime);
    if (selectedKey && !selectedKey.startsWith(payload.year + '-' + pad(payload.month))) {
      selectedKey = null;
    }
    render();
  }
});

vscode.postMessage({ type: 'ready' });
`;
