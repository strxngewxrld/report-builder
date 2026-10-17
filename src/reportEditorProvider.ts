import * as vscode from 'vscode';
import { parseCsv } from './csv';
import { parseXlsx } from './xlsx';
import { EditorProbe, probes, testing } from './testing';
import { LayoutService } from './layoutService';
import { BcContext } from '../webview/bc';
import { ExportBlock, writeDocx, writeXlsx } from './ooxml';

/** What the designer reports about itself (status bar, context keys of the editor title and context menus). */
export interface DesignerState {
  mode: 'design' | 'preview';
  zoom: number;
  unit: 'in' | 'cm';
  /** Selection or active insert tool, for the status bar. */
  status: string;
  hasSelection: boolean;
  canPaste: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  panes: { outline: boolean; reportData: boolean; properties: boolean };
  page?: { current: number; total: number };
}

/** Designer settings (bcReportBuilder.designer.*). */
export interface DesignerConfig { grid: boolean; snap: boolean; ruler: boolean; defaultZoom: number }

export function readConfig(): DesignerConfig {
  const c = vscode.workspace.getConfiguration('bcReportBuilder.designer');
  return { grid: c.get('showGrid', true), snap: c.get('snapToGrid', true), ruler: c.get('showRuler', true), defaultZoom: c.get('defaultZoom', 1) };
}

/** One open designer. */
export interface DesignerSession {
  readonly uri: vscode.Uri;
  readonly panel: vscode.WebviewPanel;
  state?: DesignerState;
  bc: BcContext | null;
  post(msg: { type: string; [k: string]: unknown }): Thenable<boolean>;
  /** Runs a designer command in the webview (toolbar, context menu, command palette). */
  command(id: string, arg?: unknown): Thenable<boolean>;
  revealAl(line?: number, character?: number): Promise<void>;
  /** Resolves once the webview has loaded the report and handles commands. */
  ready: Promise<void>;
}

/** Messages webview → extension. */
type FromWebview =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'importSampleData'; dataSet?: string }
  | { type: 'exportHtml'; html: string }
  | { type: 'print'; html: string }
  | { type: 'openXml' }
  | { type: 'error'; message: string }
  | { type: 'loaded'; items: number; raw: number }
  | { type: 'revealAl'; line: number; character: number }
  | { type: 'showProblems' }
  | { type: 'previewReady'; pages: number; errors: number }
  | { type: 'state'; state: DesignerState }
  /** Runs one of this extension's commands (buttons in the webview such as "Build project"). */
  | { type: 'run'; command: string; args?: unknown[] }
  | { type: 'exportDocument'; format: 'xlsx' | 'docx'; blocks: ExportBlock[]; page: { width: number; height: number; margins: [number, number, number, number] } };

/**
 * Custom text editor for .rdl files. The TextDocument stays the source of truth, so save, dirty state,
 * undo/redo and hot exit come from VS Code. The webview sends the full serialized RDL after each change.
 */
export class ReportEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'bcReportBuilder.designer';
  /** Open designers by document URI. */
  private static sessions = new Map<string, DesignerSession>();
  private static activeSession: DesignerSession | undefined;
  private static changed = new vscode.EventEmitter<DesignerSession | undefined>();
  /** Fires when the active designer changes or reports a new state (undefined: no designer active). */
  static readonly onDidChange = ReportEditorProvider.changed.event;

  /** The designer in the active editor tab, if any. */
  static get active() { return ReportEditorProvider.activeSession; }
  static sessionFor(uri: vscode.Uri) { return ReportEditorProvider.sessions.get(uri.toString()); }

  /** Pushes changed settings to all open designers. */
  static broadcastConfig() {
    const config = readConfig();
    for (const s of ReportEditorProvider.sessions.values()) s.post({ type: 'config', config });
  }

  constructor(private readonly context: vscode.ExtensionContext, private readonly service: LayoutService) {}

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out')] };
    webview.html = this.html(webview);

    // Text the webview produced last; changes equal to it must not be echoed back (it already has that state).
    let lastFromWebview: string | undefined;
    const probe: EditorProbe | undefined = testing ? { received: [], posted: [], deliver: m => handle(m as FromWebview) } : undefined;
    if (probe) probes.set(document.uri.toString(), probe);
    const post = (msg: { type: string; [k: string]: unknown }) => {
      probe?.posted.push(msg);
      return webview.postMessage(msg);
    };
    let markReady!: () => void;
    const session: DesignerSession = {
      uri: document.uri, panel, bc: null, post, ready: new Promise<void>(r => { markReady = r; }),
      command: (id, arg) => post({ type: 'command', id, arg }),
      revealAl: async (line, character) => {
        const bc = session.bc;
        if (!bc) return;
        const pos = new vscode.Position(line ?? bc.line, character ?? bc.character);
        await vscode.window.showTextDocument(vscode.Uri.parse(bc.alUri), { selection: new vscode.Range(pos, pos), viewColumn: vscode.ViewColumn.Beside });
      },
    };
    ReportEditorProvider.sessions.set(document.uri.toString(), session);
    const updateActive = () => {
      const S = ReportEditorProvider;
      if (panel.active) S.activeSession = session;
      else if (S.activeSession === session) S.activeSession = undefined;
      else return;
      S.changed.fire(S.activeSession);
    };
    updateActive();
    const sendDocument = () => post({ type: 'load', text: document.getText(), fileName: document.uri.path.split('/').pop() });
    const sendSampleData = async () => post({ type: 'sampleData', data: await this.readSampleData(document.uri) });
    // Business Central: the AL report of this layout and the lint results
    const sendBc = async () => {
      session.bc = await this.service.contextFor(document.uri, document.getText());
      post({ type: 'bcContext', context: session.bc });
      if (ReportEditorProvider.activeSession === session) ReportEditorProvider.changed.fire(session);
      post({ type: 'diagnostics', issues: this.service.issuesFor(document.uri).map(({ item, severity, message, code }) => ({ item, severity, message, code })) });
    };

    const subscriptions = [
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
        if (document.getText() === lastFromWebview) lastFromWebview = undefined;
        else sendDocument(); // undo/redo, XML edited in another editor, git checkout, …
      }),
      webview.onDidReceiveMessage((msg: FromWebview) => handle(msg)),
      this.service.onDidUpdate(uri => { if (!uri || uri.toString() === document.uri.toString()) sendBc(); }),
      panel.onDidChangeViewState(updateActive),
    ];
    const handle = async (msg: FromWebview) => {
        probe?.received.push(msg);
        switch (msg.type) {
          case 'ready':
            post({ type: 'config', config: readConfig() });
            sendDocument();
            await sendSampleData();
            await sendBc();
            break;
          case 'revealAl':
            await session.revealAl(msg.line, msg.character);
            break;
          case 'state':
            session.state = msg.state;
            markReady();
            if (ReportEditorProvider.activeSession === session) ReportEditorProvider.changed.fire(session);
            break;
          case 'run':
            if (msg.command.startsWith('bcReportBuilder.')) await vscode.commands.executeCommand(msg.command, ...(msg.args ?? []));
            break;
          case 'showProblems':
            await vscode.commands.executeCommand('workbench.actions.view.problems');
            break;
          case 'edit':
            if (msg.text === document.getText()) return;
            lastFromWebview = msg.text;
            await this.replaceDocument(document, msg.text);
            break;
          case 'importSampleData':
            if (await this.importSampleData(document.uri, msg.dataSet ?? this.defaultDataSet(document))) await sendSampleData();
            break;
          case 'exportDocument':
            await this.exportDocument(document.uri, msg);
            break;
          case 'exportHtml':
            await this.exportHtml(document.uri, msg.html);
            break;
          case 'print': {
            // the browser prints (or saves as PDF) the paginated preview
            const name = document.uri.path.split('/').pop()!.replace(/\.rdlc?$/i, '');
            const target = vscode.Uri.joinPath(this.context.globalStorageUri, `${name}-Vorschau.html`);
            await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
            await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(msg.html));
            await vscode.env.openExternal(target);
            break;
          }
          case 'openXml':
            await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default', vscode.ViewColumn.Beside);
            break;
          case 'error':
            vscode.window.showErrorMessage(msg.message);
            break;
        }
    };
    // Reload sample data when the sidecar file changes on disk.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), sampleDataUri(document.uri).path.split('/').pop()!));
    watcher.onDidChange(sendSampleData);
    watcher.onDidCreate(sendSampleData);
    watcher.onDidDelete(sendSampleData);
    panel.onDidDispose(() => {
      ReportEditorProvider.sessions.delete(document.uri.toString());
      if (ReportEditorProvider.activeSession === session) {
        ReportEditorProvider.activeSession = undefined;
        ReportEditorProvider.changed.fire(undefined);
      }
      if (probe && probes.get(document.uri.toString()) === probe) probes.delete(document.uri.toString());
      subscriptions.forEach(s => s.dispose());
      watcher.dispose();
    });
  }

  /** Dataset that sample data is imported for when the designer does not say (BC: DataSet_Result). */
  private defaultDataSet(document: vscode.TextDocument): string {
    const names = [...document.getText().matchAll(/<DataSet\s+Name="([^"]+)"/g)].map(m => m[1]);
    return names.find(n => n === 'DataSet_Result') ?? names[0] ?? 'DataSet_Result';
  }

  private async replaceDocument(document: vscode.TextDocument, text: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit);
  }

  private async readSampleData(uri: vscode.Uri): Promise<Record<string, unknown[]>> {
    try {
      const raw = await vscode.workspace.fs.readFile(sampleDataUri(uri));
      return JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return {};
    }
  }

  /** Lets the user pick a JSON or CSV file and stores its rows for `dataSet` in the sidecar file. */
  private async importSampleData(reportUri: vscode.Uri, dataSet: string): Promise<boolean> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Vorschaudaten laden',
      title: `Vorschaudaten für ${dataSet}`,
      filters: { 'Daten': ['xlsx', 'csv', 'json'] },
    });
    if (!picked?.[0]) return false;
    const path = picked[0].path.toLowerCase();
    let rows: unknown;
    try {
      // large Excel exports take a moment: show progress like VS Code does for its own long-running work
      rows = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Vorschaudaten werden gelesen: ${picked[0].path.split('/').pop()}` },
        async () => {
          const bytes = await vscode.workspace.fs.readFile(picked[0]);
          if (path.endsWith('.xlsx')) return parseXlsx(bytes);
          const content = new TextDecoder().decode(bytes);
          return path.endsWith('.csv') ? parseCsv(content) : JSON.parse(content);
        });
    } catch (e) {
      vscode.window.showErrorMessage(`Datei konnte nicht gelesen werden: ${(e as Error).message}`);
      return false;
    }
    if (!Array.isArray(rows)) {
      vscode.window.showErrorMessage('Erwartet wird eine Excel- oder CSV-Datei mit Kopfzeile oder ein JSON-Array von Objekten.');
      return false;
    }
    const data = await this.readSampleData(reportUri);
    data[dataSet] = rows;
    await vscode.workspace.fs.writeFile(sampleDataUri(reportUri), new TextEncoder().encode(JSON.stringify(data, null, 2) + '\n'));
    vscode.window.showInformationMessage(`${rows.length} Zeilen für ${dataSet} in ${sampleDataUri(reportUri).path.split('/').pop()} gespeichert.`);
    return true;
  }

  /** Excel/Word export of the preview (values, texts and tables; not a pixel copy). */
  private async exportDocument(reportUri: vscode.Uri, msg: Extract<FromWebview, { type: 'exportDocument' }>) {
    const xlsx = msg.format === 'xlsx';
    const name = reportUri.path.split('/').pop()!.replace(/\.rdlc?$/i, '');
    const target = await vscode.window.showSaveDialog({
      defaultUri: reportUri.with({ path: reportUri.path.replace(/\.rdlc?$/i, xlsx ? '.xlsx' : '.docx') }),
      filters: xlsx ? { 'Excel-Arbeitsmappe': ['xlsx'] } : { 'Word-Dokument': ['docx'] },
      saveLabel: 'Exportieren',
    });
    if (!target) return;
    const bytes = xlsx ? writeXlsx(msg.blocks, name) : writeDocx(msg.blocks, msg.page);
    await vscode.workspace.fs.writeFile(target, bytes);
    const open = await vscode.window.showInformationMessage(`Exportiert nach ${vscode.workspace.asRelativePath(target)}`, 'Öffnen');
    if (open) await vscode.env.openExternal(target);
  }

  private async exportHtml(reportUri: vscode.Uri, html: string) {
    const target = await vscode.window.showSaveDialog({
      defaultUri: reportUri.with({ path: reportUri.path.replace(/\.rdlc?$/i, '.html') }),
      filters: { HTML: ['html'] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(html));
    const open = await vscode.window.showInformationMessage(`Exportiert nach ${target.fsPath}`, 'Öffnen');
    if (open) await vscode.env.openExternal(target);
  }

  private html(webview: vscode.Webview): string {
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', name));
    const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${asset('codicon.css')}" rel="stylesheet" id="vscode-codicon-stylesheet">
  <link href="${asset('webview.css')}" rel="stylesheet">
  <title>Business Central Report Builder</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
  }
}

/** Sample data lives next to the report: Sales.rdl → Sales.data.json, keyed by dataset name. */
export const sampleDataUri = (reportUri: vscode.Uri) => reportUri.with({ path: reportUri.path.replace(/\.rdlc?$/i, '') + '.data.json' });
