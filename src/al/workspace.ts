import * as vscode from 'vscode';
import { AlReport, AlTable, parseAl, parseAlTables } from './parser';
import { fieldsOfTable, tablesFromApp } from './symbols';

interface AlFile { uri: vscode.Uri; reports: AlReport[]; root: vscode.Uri; text: string }
export interface LayoutOwner { report: AlReport; base?: AlReport; file: AlFile; layoutType: string }

const EXCLUDE = '{**/node_modules/**,**/.alpackages/**,**/.git/**,**/.snapshots/**}';
const key = (u: vscode.Uri) => (process.platform === 'linux' ? u.fsPath : u.fsPath.toLowerCase());

/**
 * Index of the AL report objects in the workspace: which report (or report extension) a layout file belongs to.
 * Layout paths in AL are relative to the project root (the folder with app.json).
 */
export class AlWorkspace implements vscode.Disposable {
  private files = new Map<string, AlFile>();
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private disposables: vscode.Disposable[] = [this.emitter];
  private ready: Promise<void>;
  private rootCache = new Map<string, vscode.Uri>();
  /** Tables and table extensions declared in the workspace's AL files, by file. */
  private tables = new Map<string, AlTable[]>();
  /** Tables from the symbol packages (.alpackages/*.app), by package file and its modification time. */
  private symbols = new Map<string, { mtime: number; tables: AlTable[] }>();

  constructor() {
    this.ready = this.scan();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.al');
    const update = async (uri: vscode.Uri) => { await this.load(uri); this.emitter.fire(); };
    watcher.onDidChange(update);
    watcher.onDidCreate(update);
    watcher.onDidDelete(uri => { this.files.delete(key(uri)); this.tables.delete(key(uri)); this.emitter.fire(); });
    // unsaved edits in an open AL editor count as well
    let timer: ReturnType<typeof setTimeout> | undefined;
    this.disposables.push(watcher, vscode.workspace.onDidChangeTextDocument(e => {
      if (!e.document.uri.path.toLowerCase().endsWith('.al')) return;
      clearTimeout(timer);
      timer = setTimeout(() => { this.parse(e.document.uri, e.document.getText()).then(() => this.emitter.fire()); }, 400);
    }));
  }

  whenReady() { return this.ready; }

  private async scan() {
    const uris = await vscode.workspace.findFiles('**/*.al', EXCLUDE);
    await Promise.all(uris.map(u => this.load(u)));
  }

  private async load(uri: vscode.Uri) {
    const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
    const text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(uri).then(x => x, () => new Uint8Array()));
    await this.parse(uri, text);
  }

  private async parse(uri: vscode.Uri, text: string) {
    if (/\btable(?:extension)?\s+\d+/i.test(text)) this.tables.set(key(uri), parseAlTables(text));
    else this.tables.delete(key(uri));
    // cheap pre-filter: only files declaring a report or report extension
    if (!/\breport(?:extension)?\s+\d+/i.test(text)) { this.files.delete(key(uri)); return; }
    this.files.set(key(uri), { uri, reports: parseAl(text), root: await this.projectRoot(uri), text });
  }

  /** Folder containing app.json above the file (within its workspace folder). */
  private async projectRoot(uri: vscode.Uri): Promise<vscode.Uri> {
    const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri;
    let dir = vscode.Uri.joinPath(uri, '..');
    for (;;) {
      const cached = this.rootCache.get(key(dir));
      if (cached) return cached;
      const exists = await vscode.workspace.fs.stat(vscode.Uri.joinPath(dir, 'app.json')).then(() => true, () => false);
      if (exists) { this.rootCache.set(key(dir), dir); return dir; }
      const parent = vscode.Uri.joinPath(dir, '..');
      if (!folder || parent.path === dir.path || !parent.path.startsWith(folder.path)) return folder ?? dir;
      dir = parent;
    }
  }

  private resolve(file: AlFile, layoutPath: string): vscode.Uri {
    return vscode.Uri.joinPath(file.root, layoutPath.replace(/\\/g, '/').replace(/^\.\//, ''));
  }

  /** The report (with its base report, for extensions) whose layout is `layout`. */
  async ownerOf(layout: vscode.Uri): Promise<LayoutOwner | undefined> {
    await this.ready;
    const target = key(layout);
    let byName: LayoutOwner | undefined;
    for (const file of this.files.values()) {
      for (const report of file.reports) {
        for (const l of report.layouts) {
          const owner = { report, file, layoutType: l.type, base: this.baseOf(report) };
          if (key(this.resolve(file, l.file)) === target) return owner;
          if (l.file.split(/[\\/]/).pop()?.toLowerCase() === layout.path.split('/').pop()?.toLowerCase()) byName ??= owner;
        }
      }
    }
    return byName;
  }

  /**
   * All layouts of the report a layout belongs to – of the report itself and of the report extensions extending it
   * (BC lets users choose among them), with the resolved file.
   */
  async layoutsOf(owner: LayoutOwner): Promise<{ name: string; type: string; uri: vscode.Uri; owner: string }[]> {
    await this.ready;
    const target = owner.report.kind === 'report' ? owner.report : owner.base;
    const out: { name: string; type: string; uri: vscode.Uri; owner: string }[] = [];
    for (const file of this.files.values()) {
      for (const report of file.reports) {
        const isOwn = target ? report === target || (report.kind === 'reportextension' && this.baseOf(report) === target) : report === owner.report;
        if (!isOwn) continue;
        for (const l of report.layouts) {
          if (!l.file) continue;
          const ext = l.file.split('.').pop()?.toLowerCase();
          const type = l.type || (ext === 'docx' ? 'Word' : ext === 'xlsx' ? 'Excel' : 'RDLC');
          out.push({ name: l.name, type, uri: this.resolve(file, l.file), owner: report.name });
        }
      }
    }
    return out;
  }

  private baseOf(report: AlReport): AlReport | undefined {
    if (report.kind !== 'reportextension' || !report.extends) return undefined;
    const name = report.extends.toLowerCase();
    for (const f of this.files.values()) for (const r of f.reports) if (r.kind === 'report' && r.name.toLowerCase() === name) return r;
    return undefined;
  }

  /** All reports with their RDLC layout files (including layouts of report extensions extending them). */
  async reportsWithLayouts(): Promise<{ report: AlReport; file: AlFile; layouts: vscode.Uri[]; onlyRdlc: boolean }[]> {
    await this.ready;
    const out = new Map<AlReport, { report: AlReport; file: AlFile; layouts: vscode.Uri[]; onlyRdlc: boolean }>();
    for (const file of this.files.values()) {
      for (const report of file.reports) {
        const target = report.kind === 'report' ? report : this.baseOf(report);
        if (!target) continue;
        const targetFile = [...this.files.values()].find(f => f.reports.includes(target))!;
        const entry = out.get(target) ?? { report: target, file: targetFile, layouts: [], onlyRdlc: true };
        for (const l of report.layouts) {
          if (/^rdlc$/i.test(l.type) || /\.rdlc?$/i.test(l.file)) entry.layouts.push(this.resolve(file, l.file));
          else entry.onlyRdlc = false;
        }
        out.set(target, entry);
      }
    }
    return [...out.values()];
  }

  /**
   * Fields of a table for a project: tables and table extensions in the workspace plus those in the project's symbol
   * packages (Base Application …). `found` is false when the table is in neither (symbols not downloaded).
   */
  async fieldsOf(tableName: string, projectRoot: vscode.Uri) {
    await this.ready;
    const all: AlTable[] = [...this.tables.values()].flat();
    const packages = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(projectRoot, '.alpackages')).then(x => x, () => []);
    for (const [name] of packages.filter(([n, t]) => t === vscode.FileType.File && n.toLowerCase().endsWith('.app'))) {
      const uri = vscode.Uri.joinPath(projectRoot, '.alpackages', name);
      const stat = await vscode.workspace.fs.stat(uri);
      let cached = this.symbols.get(key(uri));
      if (!cached || cached.mtime !== stat.mtime) {
        let tables: AlTable[] = [];
        try { tables = tablesFromApp(await vscode.workspace.fs.readFile(uri)); } catch { /* not a readable package */ }
        cached = { mtime: stat.mtime, tables };
        this.symbols.set(key(uri), cached);
      }
      all.push(...cached.tables);
    }
    return fieldsOfTable(all, tableName);
  }

  dispose() { this.disposables.forEach(d => d.dispose()); }
}
