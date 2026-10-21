import * as vscode from 'vscode';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReportEditorProvider } from './reportEditorProvider';
import { l10n } from '../webview/l10n';

/** Native walkthrough and offline documentation; examples are always edited in a separate working copy. */
export function registerGettingStarted(context: vscode.ExtensionContext): void {
  const command = (id: string, run: () => unknown) =>
    vscode.commands.registerCommand(`bcReportBuilder.${id}`, run);
  const guide = (english: string, german: string) => vscode.commands.executeCommand('markdown.showPreview',
    vscode.Uri.joinPath(context.extensionUri, 'docs', l10n.language.toLowerCase().startsWith('de') ? german : english));

  context.subscriptions.push(
    command('gettingStarted', () => vscode.commands.executeCommand('workbench.action.openWalkthrough',
      `${context.extension.id}#bcReportBuilder.gettingStarted`, false)),
    command('openUserGuide', () => guide('USER-GUIDE.md', 'ANWENDERHANDBUCH.md')),
    command('openMigrationGuide', () => guide('MIGRATION.md', 'UMSTIEG-REPORT-BUILDER.md')),
    command('openAiToolsGuide', () => guide('AI-TOOLS.md', 'AI-TOOLS.de.md')),
    command('openExample', async () => {
      const directory = vscode.Uri.file(await mkdtemp(join(tmpdir(), 'bc-report-builder-example-')));
      for (const name of ['Umsatzbericht.rdl', 'Umsatzbericht.data.json']) {
        const data = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'samples', name));
        await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, name), data);
      }
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.joinPath(directory, 'Umsatzbericht.rdl'),
        ReportEditorProvider.viewType, { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }),
  );
}
