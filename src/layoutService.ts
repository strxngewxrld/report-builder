import * as vscode from 'vscode';
import { BcContext } from '../webview/bc';
import { buildBcContext } from './al/context';
import { expectedDataset } from './al/parser';
import { AlWorkspace } from './al/workspace';
import { LintIssue, layoutDeclarations, lintAlUsage, lintLayout } from './lint';

const isLayout = (uri: vscode.Uri) => /\.rdlc?$/i.test(uri.path);
const EXCLUDE = '{**/node_modules/**,**/.alpackages/**,**/.git/**,**/out/**}';
const SEVERITY: Record<LintIssue['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information, hint: vscode.DiagnosticSeverity.Hint,
};

function rangeAt(text: string, offset: number, length: number): vscode.Range {
  const before = text.slice(0, offset);
  const line = (before.match(/\n/g) ?? []).length;
  const character = offset - (before.lastIndexOf('\n') + 1);
  return new vscode.Range(line, character, line, character + length);
}

/**
 * Business Central services for layouts: the AL context of a layout and linting (Problems panel, and the issues per
 * layout for the designer). Keeps itself up to date with layout and AL edits.
 */
export class LayoutService implements vscode.Disposable {
  readonly al = new AlWorkspace();
  private collection = vscode.languages.createDiagnosticCollection('bcReportBuilder');
  private issues = new Map<string, LintIssue[]>();
  private emitter = new vscode.EventEmitter<vscode.Uri | undefined>();
  /** Fires with a layout URI after it was linted, or undefined after AL changes (contexts may have changed). */
  readonly onDidUpdate = this.emitter.event;
  private disposables: vscode.Disposable[];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.disposables = [
      this.al, this.collection, this.emitter,
      vscode.workspace.onDidChangeTextDocument(e => {
        if (!isLayout(e.document.uri) || !e.contentChanges.length) return;
        const k = e.document.uri.toString();
        clearTimeout(this.timers.get(k));
        this.timers.set(k, setTimeout(() => this.lint(e.document.uri), 300));
      }),
      vscode.workspace.onDidSaveTextDocument(d => { if (isLayout(d.uri)) this.lintAlUsage(); }),
      this.al.onDidChange(() => { this.lintAll(); this.emitter.fire(undefined); }),
    ];
    this.lintAll();
  }

  async text(uri: vscode.Uri): Promise<string> {
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    if (open) return open.getText();
    try { return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)); } catch { return ''; }
  }

  async contextFor(uri: vscode.Uri, text?: string): Promise<BcContext | null> {
    const owner = await this.al.ownerOf(uri);
    if (!owner) return null;
    const decl = layoutDeclarations(text ?? await this.text(uri));
    const context = buildBcContext(owner.report, owner.base, decl, owner.file.uri.toString(), vscode.workspace.asRelativePath(owner.file.uri));
    const same = (a: vscode.Uri, b: vscode.Uri) => (process.platform === 'linux' ? a.fsPath === b.fsPath : a.fsPath.toLowerCase() === b.fsPath.toLowerCase());
    context.layouts = await Promise.all((await this.al.layoutsOf(owner)).map(async l => ({
      name: l.name, type: l.type, uri: l.uri.toString(), path: vscode.workspace.asRelativePath(l.uri), owner: l.owner,
      current: same(l.uri, uri),
      exists: await vscode.workspace.fs.stat(l.uri).then(() => true, () => false),
    })));
    return context;
  }

  issuesFor(uri: vscode.Uri): LintIssue[] { return this.issues.get(uri.toString()) ?? []; }

  async lint(uri: vscode.Uri) {
    const text = await this.text(uri);
    const owner = await this.al.ownerOf(uri);
    const exp = owner && expectedDataset(owner.report, owner.base);
    const issues = text ? lintLayout(text, exp ? { reportName: owner!.report.name, fields: exp.fields, parameters: exp.parameters, complete: exp.complete } : null) : [];
    this.issues.set(uri.toString(), issues);
    this.collection.set(uri, issues.map(i => {
      const d = new vscode.Diagnostic(rangeAt(text, i.offset, i.length), i.message, SEVERITY[i.severity]);
      d.source = 'BC Report Builder';
      d.code = i.code;
      return d;
    }));
    this.emitter.fire(uri);
  }

  async lintAll() {
    const layouts = await vscode.workspace.findFiles('**/*.{rdlc,rdl}', EXCLUDE);
    await Promise.all(layouts.map(u => this.lint(u)));
    await this.lintAlUsage();
  }

  /** Unused columns/labels of reports whose layouts are all RDLC (Word/Excel layouts use the dataset differently). */
  private async lintAlUsage() {
    const byFile = new Map<string, { uri: vscode.Uri; diags: vscode.Diagnostic[] }>();
    for (const { report, file, layouts, onlyRdlc } of await this.al.reportsWithLayouts()) {
      const entry = byFile.get(file.uri.toString()) ?? { uri: file.uri, diags: [] };
      byFile.set(file.uri.toString(), entry);
      if (!onlyRdlc || !layouts.length) continue;
      const texts = (await Promise.all(layouts.map(u => this.text(u)))).filter(Boolean);
      if (texts.length !== layouts.length) continue; // a layout file is missing: no reliable usage information
      for (const u of lintAlUsage(report, texts)) {
        const d = new vscode.Diagnostic(new vscode.Range(u.line, u.character, u.line, u.character + u.length), u.message, vscode.DiagnosticSeverity.Hint);
        d.tags = [vscode.DiagnosticTag.Unnecessary];
        d.source = 'BC Report Builder';
        d.code = 'unused';
        entry.diags.push(d);
      }
    }
    for (const { uri, diags } of byFile.values()) this.collection.set(uri, diags);
  }

  dispose() { this.disposables.forEach(d => d.dispose()); }
}
