import * as vscode from 'vscode';
import {
  PREVIEW_COMMAND,
  ScheduleCodeLensProvider,
  ScheduleHoverProvider,
  previewSchedule,
  refreshDiagnostics
} from './scheduleProvider';

const WORKFLOW_SELECTOR: vscode.DocumentSelector = [
  { language: 'yaml', scheme: 'file' },
  { language: 'github-actions-workflow', scheme: 'file' }
];

const DIAGNOSTIC_DELAY_MS = 300;

export function activate(context: vscode.ExtensionContext): void {
  const codeLensProvider = new ScheduleCodeLensProvider();
  const diagnostics = vscode.languages.createDiagnosticCollection('githubActionsCron');
  let pending: NodeJS.Timeout | undefined;

  const scheduleDiagnostics = (document: vscode.TextDocument): void => {
    if (pending) {
      clearTimeout(pending);
    }
    pending = setTimeout(() => safeRefresh(document, diagnostics), DIAGNOSTIC_DELAY_MS);
  };

  context.subscriptions.push(
    codeLensProvider,
    diagnostics,
    vscode.languages.registerCodeLensProvider(WORKFLOW_SELECTOR, codeLensProvider),
    vscode.languages.registerHoverProvider(WORKFLOW_SELECTOR, new ScheduleHoverProvider()),
    vscode.commands.registerCommand(PREVIEW_COMMAND, previewSchedule),
    vscode.workspace.onDidOpenTextDocument((document) => safeRefresh(document, diagnostics)),
    vscode.workspace.onDidChangeTextDocument((event) => scheduleDiagnostics(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('githubActionsCron')) {
        return;
      }
      codeLensProvider.refresh();
      for (const document of vscode.workspace.textDocuments) {
        safeRefresh(document, diagnostics);
      }
    }),
    new vscode.Disposable(() => {
      if (pending) {
        clearTimeout(pending);
      }
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    safeRefresh(document, diagnostics);
  }
}

/** A broken document must never take the extension down with it. */
function safeRefresh(document: vscode.TextDocument, diagnostics: vscode.DiagnosticCollection): void {
  try {
    refreshDiagnostics(document, diagnostics);
  } catch (error) {
    console.error('[github-actions-cron-viewer] failed to analyse schedules', error);
  }
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
