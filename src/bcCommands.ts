// Business Central workflows that Report Builder and the Visual Studio designer do not have, because they know nothing
// about the AL report behind a layout: editing the AL report from the designer (labels, columns), building, running the
// report in the web client, navigating from AL to the layout, and editing the layout's <Code> block in a VB editor.

import * as vscode from 'vscode';
import { LabelOptions, applyInsert, columnName, findDataItem, insertAddBlock, insertColumns, insertLabel, labelName, TextInsert } from './al/edit';
import { textboxValueEdit } from './layoutEdit';
import { alConfigurations, reportUrl } from './al/launch';
import { mergedDataItems } from './al/context';
import { AlDataItem, AlReport, allColumns, parseAl } from './al/parser';
import { LayoutService } from './layoutService';
import { DesignerSession, ReportEditorProvider } from './reportEditorProvider';
import { readCodeBlock, writeCodeBlock } from './codeBlock';

type MenuArg = { [k: string]: unknown } | undefined;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

export function registerBcCommands(context: vscode.ExtensionContext, service: LayoutService) {
  const codeFs = new LayoutCodeFileSystem();
  const lenses = new AlLayoutLenses(service);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(LayoutCodeFileSystem.scheme, codeFs, { isCaseSensitive: true }),
    codeFs,
    // one registration: with the AL extension installed both selectors match the same document
    vscode.languages.registerCodeLensProvider([{ language: 'al' }, { pattern: '**/*.al' }], lenses),
    lenses,

    vscode.commands.registerCommand('bcReportBuilder.createLabel', (arg?: MenuArg) => createLabel(service, arg)),
    vscode.commands.registerCommand('bcReportBuilder.addColumns', (arg?: MenuArg) => addColumns(service, arg)),
    vscode.commands.registerCommand('bcReportBuilder.buildAl', buildAl),
    vscode.commands.registerCommand('bcReportBuilder.runInBc', () => runInBc(service)),
    vscode.commands.registerCommand('bcReportBuilder.revealInLayout', revealInLayout),
    vscode.commands.registerCommand('bcReportBuilder.editCode', (uri?: vscode.Uri) => {
      const layout = uri instanceof vscode.Uri ? uri : ReportEditorProvider.active?.uri;
      if (layout) return vscode.window.showTextDocument(LayoutCodeFileSystem.uriFor(layout), { viewColumn: vscode.ViewColumn.Beside });
    }),
  );
}

// ------------------------------------------------------------------------------------------------ AL edits

/** The AL report of the active designer, freshly parsed from its (possibly unsaved) document. */
async function alTarget(service: LayoutService, session: DesignerSession) {
  const owner = await service.al.ownerOf(session.uri);
  if (!owner) {
    vscode.window.showWarningMessage('Kein AL-Report im Workspace verwendet dieses Layout (rendering › LayoutFile).');
    return undefined;
  }
  const doc = await vscode.workspace.openTextDocument(owner.file.uri);
  const src = doc.getText();
  const report = parseAl(src).find(r => r.kind === owner.report.kind && r.name === owner.report.name);
  if (!report) return undefined;
  return { owner, doc, src, report };
}

async function applyAndOffer(doc: vscode.TextDocument, insert: TextInsert, done: string, edit = new vscode.WorkspaceEdit()) {
  edit.insert(doc.uri, doc.positionAt(insert.offset), insert.text);
  if (!await vscode.workspace.applyEdit(edit)) {
    vscode.window.showErrorMessage('Der AL-Code konnte nicht geändert werden.');
    return;
  }
  const action = await vscode.window.showInformationMessage(
    `${done} Nach dem Erstellen des Projekts übernimmt der AL-Compiler die Änderung ins Layout-Dataset.`, 'Projekt erstellen', 'AL-Code anzeigen');
  if (action === 'Projekt erstellen') await buildAl();
  if (action === 'AL-Code anzeigen') {
    const at = doc.positionAt(insert.offset + insert.text.length);
    await vscode.window.showTextDocument(doc, { selection: new vscode.Range(at, at), viewColumn: vscode.ViewColumn.Beside });
  }
}

/**
 * A textbox with fixed text becomes a translatable label: new label in AL (optionally with translator comment,
 * maximum length or Locked), the textbox shows =Parameters!<Label>.Value. Both files change in one edit, so one
 * undo reverts both.
 */
async function createLabel(service: LayoutService, arg: MenuArg) {
  const session = ReportEditorProvider.active;
  const item = str(arg?.item), text = str(arg?.literalText);
  if (!session || !item || !text) return;
  const target = await alTarget(service, session);
  if (!target) return;
  const taken = [...target.report.labels.map(l => l.name), ...(session.bc?.labels.map(l => l.name) ?? [])];
  const title = 'Als AL-Label anlegen';
  const name = await vscode.window.showInputBox({
    title: `${title} (1/2)`, prompt: `Label für „${text}“ im ${target.report.kind === 'report' ? 'Report' : 'Report-Extension'} „${target.report.name}“`,
    value: labelName(text, taken), valueSelection: [0, Math.max(0, labelName(text, taken).length - 3)],
    validateInput: v => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? 'Nur Buchstaben, Ziffern und _ (beginnend mit einem Buchstaben)'
      : taken.some(t => t.toLowerCase() === v.toLowerCase()) ? `„${v}“ gibt es bereits` : undefined,
  });
  if (!name) return;
  const options = await labelOptions(title, text);
  if (!options) return;

  const layout = await vscode.workspace.openTextDocument(session.uri);
  const valueEdit = textboxValueEdit(layout.getText(), item, `=Parameters!${name}.Value`);
  const insert = insertLabel(target.src, target.report, name, text, options);
  const hint = await translationHint(target.owner.file.root);
  if (!valueEdit) {
    // a textbox the host cannot patch (several parts): the designer changes it, the AL edit is a separate step
    await session.command('setTextboxValue', { name: item, value: `=Parameters!${name}.Value` });
    await applyAndOffer(target.doc, insert, `Label „${name}“ angelegt, „${item}“ verwendet es.${hint}`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(layout.uri, new vscode.Range(layout.positionAt(valueEdit.start), layout.positionAt(valueEdit.end)), valueEdit.text);
  await applyAndOffer(target.doc, insert, `Label „${name}“ angelegt, „${item}“ verwendet es (gemeinsam rückgängig zu machen).${hint}`, edit);
}

/** Optional label properties for translators, asked after the name; undefined when cancelled. */
async function labelOptions(title: string, text: string): Promise<LabelOptions | undefined> {
  type Pick = vscode.QuickPickItem & { key: keyof LabelOptions };
  const picked = await vscode.window.showQuickPick<Pick>([
    { key: 'comment', label: 'Übersetzungshinweis (Comment)', detail: 'Erscheint in der XLIFF-Datei als Hinweis für Übersetzer' },
    { key: 'maxLength', label: 'Höchstlänge (MaxLength)', detail: 'Übersetzungen dürfen nicht länger werden – z. B. bei schmalen Textfeldern' },
    { key: 'locked', label: 'Nicht übersetzen (Locked)', detail: 'Feste Texte wie Codes oder Markennamen' },
  ], { title: `${title} (2/2)`, placeHolder: 'Optionen für die Übersetzung – Eingabe ohne Auswahl legt das Label ohne Optionen an', canPickMany: true });
  if (!picked) return undefined;
  const keys = new Set(picked.map(p => p.key));
  const options: LabelOptions = { locked: keys.has('locked') || undefined };
  if (keys.has('comment')) {
    const comment = await vscode.window.showInputBox({ title, prompt: `Hinweis für Übersetzer zu „${text}“`, placeHolder: 'z. B. Spaltenüberschrift der Mengenspalte' });
    if (comment === undefined) return undefined;
    options.comment = comment.trim() || undefined;
  }
  if (keys.has('maxLength')) {
    const max = await vscode.window.showInputBox({
      title, prompt: 'Höchstlänge der Übersetzungen (Zeichen)', value: String(Math.max(text.length, 10)),
      validateInput: v => (/^\d+$/.test(v) && Number(v) >= text.length ? undefined : `Eine ganze Zahl ≥ ${text.length} (Länge des Textes)`),
    });
    if (max === undefined) return undefined;
    options.maxLength = Number(max);
  }
  return options;
}

/**
 * How the new label gets translated: with the TranslationFile feature the compiler writes it to Translations/*.g.xlf;
 * translations go into the language files there (e.g. with XLIFF Sync).
 */
async function translationHint(root: vscode.Uri): Promise<string> {
  let features: string[] = [];
  try {
    const app = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'app.json'))));
    features = Array.isArray(app.features) ? app.features : [];
  } catch { return ''; }
  if (!features.some(f => /^translationfile$/i.test(f))) {
    return ' Für Übersetzungen in app.json „features“: ["TranslationFile"] setzen – dann erzeugt der Compiler eine XLIFF-Datei.';
  }
  const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, 'Translations')).then(x => x, () => []);
  const languages = files.map(([n]) => n).filter(n => /\.xlf$/i.test(n) && !/\.g\.xlf$/i.test(n));
  return languages.length
    ? ` Nach dem Erstellen die Übersetzungen in ${languages.join(', ')} ergänzen.`
    : ' Nach dem Erstellen steht das Label in Translations/*.g.xlf; für jede Sprache eine eigene .xlf-Datei anlegen.';
}

/** Fields of the data item's table that are no column yet, picked in a quick pick, become new columns. */
async function addColumns(service: LayoutService, arg: MenuArg) {
  const session = ReportEditorProvider.active;
  const dataItemName = str(arg?.dataItem);
  if (!session || !dataItemName) return;
  const target = await alTarget(service, session);
  if (!target) return;
  const { report, src, owner } = target;
  const items = mergedDataItems(report, owner.base);
  const dataItem = findDataItem(items, dataItemName);
  const table = dataItem?.table.replace(/"/g, '');
  if (!dataItem || !table) return;
  const { found, fields } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Felder von „${table}“ werden gelesen` },
    () => service.al.fieldsOf(table, owner.file.root));
  if (!found) {
    const pick = await vscode.window.showWarningMessage(
      `Tabelle „${table}“ wurde weder im Workspace noch in den Symbolen (.alpackages) gefunden.`, 'Symbole herunterladen');
    if (pick) await vscode.commands.executeCommand('al.downloadSymbols').then(undefined, () => vscode.window.showErrorMessage('Die AL Language-Erweiterung ist nicht installiert.'));
    return;
  }
  const norm = (s: string) => s.replace(/"/g, '').replace(/^Rec\./i, '').trim().toLowerCase();
  const used = new Set(dataItem.columns.map(c => norm(c.source)));
  const candidates = fields.filter(f => !used.has(f.name.toLowerCase()) && !/^(blob|mediaset)$/i.test(f.type));
  if (!candidates.length) { vscode.window.showInformationMessage(`Alle Felder von „${table}“ sind bereits Spalten.`); return; }
  const picked = await vscode.window.showQuickPick(
    candidates.map(f => ({ label: f.name, description: f.type, detail: f.id !== null ? `Feld ${f.id}` : undefined, field: f })),
    { title: `Spalten zu „${dataItem.name}“ (${table}) hinzufügen`, placeHolder: 'Felder auswählen', canPickMany: true, matchOnDescription: true });
  if (!picked?.length) return;
  const taken = allColumns(items).map(c => c.name);
  const columns = picked.map(p => {
    const name = columnName(p.field.name, dataItem.name, taken);
    taken.push(name);
    return { name, source: /^[A-Za-z_]\w*$/.test(p.field.name) ? p.field.name : `"${p.field.name}"` };
  });
  const insert = insertInto(src, report, dataItem.name, columns);
  if (!insert) { vscode.window.showErrorMessage(`„${dataItem.name}“ lässt sich in „${report.name}“ nicht erweitern.`); return; }
  await applyAndOffer(target.doc, insert, `${columns.length} Spalte(n) zu „${dataItem.name}“ hinzugefügt: ${columns.map(c => c.name).join(', ')}.`);
}

/** Where new columns of a data item go: the data item itself, or in a report extension its add(...) block. */
function insertInto(src: string, report: AlReport, dataItem: string, columns: { name: string; source: string }[]): TextInsert | null {
  if (report.kind === 'report') {
    const d = findDataItem(report.dataItems, dataItem);
    return d ? insertColumns(src, d, columns) : null;
  }
  const own: AlDataItem | undefined = findDataItem(report.additions.flatMap(a => a.dataItems), dataItem);
  if (own) return insertColumns(src, own, columns);
  const add = report.additions.find(a => a.target.toLowerCase() === dataItem.toLowerCase() && a.span);
  return add ? insertColumns(src, add, columns) : insertAddBlock(src, report, dataItem, columns);
}

// ------------------------------------------------------------------------------------------------ build and run

async function buildAl() {
  await vscode.commands.executeCommand('workbench.action.files.saveAll');
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes('al.package')) {
    vscode.window.showErrorMessage('Zum Erstellen wird die AL Language-Erweiterung von Microsoft benötigt.');
    return;
  }
  await vscode.commands.executeCommand('al.package');
}

async function runInBc(service: LayoutService) {
  const session = ReportEditorProvider.active;
  if (!session) return;
  const owner = await service.al.ownerOf(session.uri);
  const id = owner?.report.kind === 'report' ? owner.report.id : owner?.base?.id;
  if (!owner || !id) {
    vscode.window.showWarningMessage(owner ? 'Die Report-ID des Basis-Reports ist nicht bekannt (Basis-Report nicht im Workspace).' : 'Kein AL-Report für dieses Layout gefunden.');
    return;
  }
  const launch = vscode.Uri.joinPath(owner.file.root, '.vscode', 'launch.json');
  let configs;
  try {
    configs = alConfigurations(new TextDecoder().decode(await vscode.workspace.fs.readFile(launch)));
  } catch {
    vscode.window.showErrorMessage(`Keine lesbare ${vscode.workspace.asRelativePath(launch)} – mit „AL: Go!“ bzw. „AL: Download symbols“ anlegen.`);
    return;
  }
  if (!configs.length) { vscode.window.showErrorMessage('launch.json enthält keine AL-Konfiguration.'); return; }
  const config = configs.length === 1 ? configs[0] : (await vscode.window.showQuickPick(
    configs.map(c => ({ label: c.name ?? '(ohne Namen)', description: reportUrl(c, id), config: c })),
    { title: `Report ${id} ausführen`, placeHolder: 'Umgebung wählen' }))?.config;
  if (!config) return;
  const url = reportUrl(config, id);
  const pick = await vscode.window.showInformationMessage(
    `Report ${id} „${owner.report.kind === 'report' ? owner.report.name : owner.base?.name}“ im Web-Client öffnen? Zuletzt veröffentlichte Version der App wird ausgeführt.`,
    'Öffnen', 'Erst veröffentlichen');
  if (pick === 'Erst veröffentlichen') {
    await vscode.commands.executeCommand('workbench.action.files.saveAll');
    await vscode.commands.executeCommand('al.publishNoDebug').then(undefined, () => vscode.window.showErrorMessage('Veröffentlichen erfordert die AL Language-Erweiterung.'));
  }
  if (pick) await vscode.env.openExternal(vscode.Uri.parse(url));
}

// ------------------------------------------------------------------------------------------------ AL → layout

/** Opens a layout in the designer and selects the first textbox using a column or label. */
async function revealInLayout(layout: vscode.Uri, name: string) {
  await vscode.commands.executeCommand('vscode.openWith', layout, ReportEditorProvider.viewType);
  const session = ReportEditorProvider.sessionFor(layout);
  if (!session) return;
  await session.ready;
  await session.command('revealReference', { name });
}

const usagePattern = (name: string) => new RegExp(`\\b(?:Fields|Parameters)!${name}(?:Format|Caption)?\\b`, 'g');

/** CodeLens on AL report columns and labels: how often the RDLC layouts use them, click selects the use in the designer. */
class AlLayoutLenses implements vscode.CodeLensProvider, vscode.Disposable {
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private subscription: vscode.Disposable;

  constructor(private service: LayoutService) {
    this.subscription = service.onDidUpdate(() => this.changed.fire());
  }

  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const reports = parseAl(doc.getText());
    if (!reports.length) return [];
    const withLayouts = await this.service.al.reportsWithLayouts();
    const lenses: vscode.CodeLens[] = [];
    for (const rep of reports) {
      const entry = withLayouts.find(e => e.report.name.toLowerCase() === (rep.kind === 'report' ? rep.name : rep.extends ?? '').toLowerCase());
      if (!entry?.layouts.length) continue;
      const texts = await Promise.all(entry.layouts.map(async u => ({ uri: u, text: await this.service.text(u) })));
      const at = (p: { line: number; character: number }) => new vscode.Range(p.line, p.character, p.line, p.character);
      for (const l of entry.layouts) {
        lenses.push(new vscode.CodeLens(at(rep.pos), {
          title: `$(layout) ${l.path.split('/').pop()} im Designer öffnen`, command: 'vscode.openWith', arguments: [l, ReportEditorProvider.viewType],
        }));
      }
      const own = rep.kind === 'report' ? allColumns(rep.dataItems) : rep.additions.flatMap(a => [...a.columns, ...allColumns(a.dataItems)]);
      for (const sym of [...own, ...rep.labels]) {
        const uses = texts.map(t => ({ uri: t.uri, count: t.text.match(usagePattern(sym.name))?.length ?? 0 })).filter(u => u.count);
        if (!uses.length) continue; // unused ones are already faded out (hint diagnostic)
        const total = uses.reduce((s, u) => s + u.count, 0);
        lenses.push(new vscode.CodeLens(at(sym.pos), {
          title: `${total}× im Layout`, tooltip: `Im Designer anzeigen (${uses.map(u => u.uri.path.split('/').pop()).join(', ')})`,
          command: 'bcReportBuilder.revealInLayout', arguments: [uses[0].uri, sym.name],
        }));
      }
    }
    return lenses;
  }

  dispose() { this.subscription.dispose(); this.changed.dispose(); }
}

// ------------------------------------------------------------------------------------------------ <Code> block

/**
 * The layout's <Code> block as a VB file (bcreport-code:/…/Layout.rdlc.vb?<layout uri>): VS Code's editor with
 * Visual Basic highlighting instead of Report Builder's plain text box. Saving writes the block into the layout
 * document (unsaved, like an edit in the designer – undo works there too).
 */
class LayoutCodeFileSystem implements vscode.FileSystemProvider, vscode.Disposable {
  static readonly scheme = 'bcreport-code';
  static uriFor(layout: vscode.Uri) {
    return vscode.Uri.from({ scheme: this.scheme, path: `${layout.path}.vb`, query: layout.toString() });
  }
  private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.emitter.event;
  private open = new Set<string>();
  private subscription = vscode.workspace.onDidChangeTextDocument(e => {
    if (!this.open.has(e.document.uri.toString())) return;
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri: LayoutCodeFileSystem.uriFor(e.document.uri) }]);
  });

  private layoutOf(uri: vscode.Uri) { return vscode.Uri.parse(uri.query); }
  private async layoutDoc(uri: vscode.Uri) { return vscode.workspace.openTextDocument(this.layoutOf(uri)); }

  watch(uri: vscode.Uri): vscode.Disposable {
    const key = this.layoutOf(uri).toString();
    this.open.add(key);
    return new vscode.Disposable(() => this.open.delete(key));
  }
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    // only <layout>.vb is a file; the folders above it exist virtually (writeFile checks them first)
    if (uri.path !== `${this.layoutOf(uri).path}.vb`) return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    const doc = await this.layoutDoc(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: doc.version, size: readCodeBlock(doc.getText()).length };
  }
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return new TextEncoder().encode(readCodeBlock((await this.layoutDoc(uri)).getText()));
  }
  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const doc = await this.layoutDoc(uri);
    const text = doc.getText();
    const next = writeCodeBlock(text, new TextDecoder().decode(content).replace(/\r\n/g, text.includes('\r\n') ? '\r\n' : '\n'));
    if (next === text) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), next);
    await vscode.workspace.applyEdit(edit);
    vscode.window.setStatusBarMessage(`$(check) Code in ${doc.uri.path.split('/').pop()} übernommen (Layout noch nicht gespeichert)`, 4000);
  }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
  delete() { throw vscode.FileSystemError.NoPermissions(); }
  rename() { throw vscode.FileSystemError.NoPermissions(); }
  dispose() { this.subscription.dispose(); this.emitter.dispose(); }
}
