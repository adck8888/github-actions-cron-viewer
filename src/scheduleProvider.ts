import * as vscode from 'vscode';
import { describeSchedule, formatRunShort, nextRunDates, ScheduleDescription } from './cronService';
import { findSchedules, isWorkflowPath, WorkflowSchedule } from './workflowParser';

export const PREVIEW_COMMAND = 'githubActionsCron.previewSchedule';

interface Settings {
  enableCodeLens: boolean;
  nextRunsCount: number;
  use24HourFormat: boolean;
  showDiagnostics: boolean;
}

function settings(): Settings {
  const config = vscode.workspace.getConfiguration('githubActionsCron');
  return {
    enableCodeLens: config.get<boolean>('enableCodeLens', true),
    nextRunsCount: config.get<number>('nextRunsCount', 5),
    use24HourFormat: config.get<boolean>('use24HourFormat', true),
    showDiagnostics: config.get<boolean>('showDiagnostics', true)
  };
}

export interface AnnotatedSchedule {
  schedule: WorkflowSchedule;
  info: ScheduleDescription;
  /** Range of the cron value inside the document. */
  range: vscode.Range;
}

/** Parses a document and describes every schedule it contains. Returns [] for non-workflow files. */
export function collectSchedules(document: vscode.TextDocument): AnnotatedSchedule[] {
  if (!isWorkflowPath(document.uri.fsPath) && !isWorkflowPath(document.uri.path)) {
    return [];
  }
  const { nextRunsCount, use24HourFormat } = settings();
  return findSchedules(document.getText()).map((schedule) => ({
    schedule,
    info: describeSchedule(schedule.expression, schedule.timezone, {
      count: nextRunsCount,
      use24HourFormat
    }),
    range: new vscode.Range(
      document.positionAt(schedule.range.start),
      document.positionAt(schedule.range.end)
    )
  }));
}

function lensTitle(entry: AnnotatedSchedule): string {
  const { info, schedule } = entry;
  if (!info.valid) {
    return `$(error) ${info.error ?? 'Invalid cron expression'}`;
  }
  const { use24HourFormat } = settings();
  const upcoming = nextRunDates(schedule.expression, info.timezone, 3)
    .map((date) => formatRunShort(date, info.timezone, use24HourFormat))
    .join(' · ');
  const blocking = info.warnings.some((warning) => warning.severity === 'error');
  const icon = blocking ? '$(warning)' : '$(clock)';
  const head = `${icon} ${info.description} · ${info.timezone}`;
  return upcoming ? `${head} · Next: ${upcoming}` : head;
}

export class ScheduleCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  dispose(): void {
    this.changed.dispose();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!settings().enableCodeLens) {
      return [];
    }
    return collectSchedules(document).map(
      (entry, index) =>
        new vscode.CodeLens(entry.range, {
          title: lensTitle(entry),
          tooltip: 'Show schedule details',
          command: PREVIEW_COMMAND,
          arguments: [{ uri: document.uri.toString(), index }]
        })
    );
  }
}

export class ScheduleHoverProvider implements vscode.HoverProvider {
  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const entry = collectSchedules(document).find((candidate) => candidate.range.contains(position));
    if (!entry) {
      return undefined;
    }
    return new vscode.Hover(hoverMarkdown(entry), entry.range);
  }
}

function hoverMarkdown(entry: AnnotatedSchedule): vscode.MarkdownString {
  const { info } = entry;
  const markdown = new vscode.MarkdownString(undefined, true);
  markdown.appendMarkdown(`**${info.description}**\n\n`);
  markdown.appendMarkdown('`' + info.expression + '`\n\n');

  if (info.valid) {
    markdown.appendMarkdown(
      `Timezone: \`${info.timezone}\`${info.timezoneExplicit ? '' : ' _(default)_'}\n\n`
    );
    markdown.appendMarkdown('**Next runs**\n\n');
    for (const run of info.nextRuns) {
      markdown.appendMarkdown(`- ${run}\n`);
    }
    markdown.appendMarkdown('\n');
  }

  for (const warning of info.warnings) {
    const icon = warning.severity === 'info' ? '$(info)' : '$(warning)';
    markdown.appendMarkdown(`${icon} ${warning.message}\n\n`);
  }
  return markdown;
}

/** Publishes invalid-cron errors and GitHub limit warnings to the Problems panel. */
export function refreshDiagnostics(
  document: vscode.TextDocument,
  collection: vscode.DiagnosticCollection
): void {
  if (!settings().showDiagnostics) {
    collection.delete(document.uri);
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  for (const entry of collectSchedules(document)) {
    if (!entry.info.valid) {
      diagnostics.push(
        new vscode.Diagnostic(
          entry.range,
          entry.info.error ?? 'Invalid cron expression',
          vscode.DiagnosticSeverity.Error
        )
      );
      continue;
    }
    for (const warning of entry.info.warnings) {
      if (warning.severity === 'info') {
        continue;
      }
      diagnostics.push(
        new vscode.Diagnostic(entry.range, warning.message, vscode.DiagnosticSeverity.Warning)
      );
    }
  }

  for (const diagnostic of diagnostics) {
    diagnostic.source = 'GitHub Actions Cron';
  }
  collection.set(document.uri, diagnostics);
}

/** Backing implementation of the "GitHub Actions: Preview Schedule" command. */
export async function previewSchedule(arg?: { uri?: string; index?: number }): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage(
      'Open a GitHub Actions workflow file to preview its schedule.'
    );
    return;
  }

  const entries = collectSchedules(editor.document);
  if (entries.length === 0) {
    void vscode.window.showInformationMessage(
      'No cron schedule found. This command works on .github/workflows files that use "on: schedule".'
    );
    return;
  }

  if (typeof arg?.index === 'number' && entries[arg.index]) {
    showDetails(entries[arg.index]);
    return;
  }

  const atCursor = entries.find((entry) => entry.range.contains(editor.selection.active));
  if (atCursor || entries.length === 1) {
    showDetails(atCursor ?? entries[0]);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    entries.map((entry, index) => ({
      label: entry.info.valid ? entry.info.description : 'Invalid cron expression',
      description: `${entry.schedule.expression}  ·  ${entry.info.timezone}`,
      detail: `Line ${entry.range.start.line + 1}`,
      index
    })),
    { title: 'GitHub Actions schedules in this workflow', placeHolder: 'Select a schedule to preview' }
  );

  if (picked) {
    showDetails(entries[picked.index]);
  }
}

function showDetails(entry: AnnotatedSchedule): void {
  const { info } = entry;
  const items: vscode.QuickPickItem[] = [
    {
      label: info.valid ? info.description : 'Invalid cron expression',
      description: info.expression
    },
    {
      label: `Timezone: ${info.timezone}`,
      description: info.timezoneExplicit ? 'declared in the workflow' : 'default'
    }
  ];

  if (info.nextRuns.length > 0) {
    items.push({ label: 'Next runs', kind: vscode.QuickPickItemKind.Separator });
    items.push(...info.nextRuns.map((run) => ({ label: run })));
  }

  if (info.warnings.length > 0) {
    items.push({ label: 'Notes', kind: vscode.QuickPickItemKind.Separator });
    items.push(
      ...info.warnings.map((warning) => ({
        label: `${warning.severity === 'info' ? '$(info)' : '$(warning)'} ${warning.message}`
      }))
    );
  }

  const quickPick = vscode.window.createQuickPick();
  quickPick.title = `Schedule: ${info.expression}`;
  quickPick.placeholder = 'Press Escape to close';
  quickPick.items = items;
  quickPick.onDidAccept(() => quickPick.hide());
  quickPick.onDidHide(() => quickPick.dispose());
  quickPick.show();
}
