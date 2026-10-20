// Business Central workflows that Report Builder and the Visual Studio designer do not have, because they know nothing
// about the AL report behind a layout: editing the AL report from the designer (labels, columns), building, running the
// report in the web client, navigating from AL to the layout, and editing the layout's <Code> block in a VB editor.

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import {
  LabelOptions, applyInsert, columnName, findDataItem, insertAddBlock, insertColumns, insertLabel, labelName, offsetOf, renameIdentifierAt, TextInsert,
} from './al/edit';
import { renameColumnInLayout, textboxValueEdit } from './layoutEdit';
import { AlLaunchConfig, alConfigurations, metadataUrl, reportUrl, webEndpointOf } from './al/launch';
import { mergedDataItems } from './al/context';
import { AlColumn, AlDataItem, AlReport, allColumns, declaredColumns, parseAl } from './al/parser';
import { LayoutService } from './layoutService';
import { DesignerSession, ReportEditorProvider } from './reportEditorProvider';
import { readCodeBlock, writeCodeBlock } from './codeBlock';
import { l10n } from '../webview/l10n';

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
    vscode.commands.registerCommand('bcReportBuilder.renameColumn', (arg?: MenuArg) => renameColumn(service, arg)),
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

/** The AL report of a layout, freshly parsed from its (possibly unsaved) document. */
export async function alReportOf(service: LayoutService, layout: vscode.Uri) {
  const owner = await service.al.ownerOf(layout);
  if (!owner) return undefined;
  const doc = await vscode.workspace.openTextDocument(owner.file.uri);
  const src = doc.getText();
  const report = parseAl(src).find(r => r.kind === owner.report.kind && r.name === owner.report.name);
  if (!report) return undefined;
  return { owner, doc, src, report };
}

/** The AL report of the active designer; warns when there is none. */
async function alTarget(service: LayoutService, session: DesignerSession) {
  const target = await alReportOf(service, session.uri);
  if (!target && !await service.al.ownerOf(session.uri)) vscode.window.showWarningMessage(l10n.t('No AL report in the workspace uses this layout (rendering › LayoutFile).'));
  return target;
}

async function applyAndOffer(doc: vscode.TextDocument, insert: TextInsert, done: string, edit = new vscode.WorkspaceEdit()) {
  edit.insert(doc.uri, doc.positionAt(insert.offset), insert.text);
  if (!await vscode.workspace.applyEdit(edit)) {
    vscode.window.showErrorMessage(l10n.t('The AL code could not be changed.'));
    return;
  }
  const build = l10n.t('Build Project'), show = l10n.t('Show AL Code');
  const action = await vscode.window.showInformationMessage(
    `${done} ${l10n.t('When the project is built, the AL compiler takes the change into the layout dataset.')}`, build, show);
  if (action === build) await buildAl();
  if (action === show) {
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
  const title = l10n.t('Create as AL Label');
  const name = await vscode.window.showInputBox({
    title: `${title} (1/2)`, prompt: target.report.kind === 'report'
      ? l10n.t('Label for "{0}" in report "{1}"', text, target.report.name)
      : l10n.t('Label for "{0}" in report extension "{1}"', text, target.report.name),
    value: labelName(text, taken), valueSelection: [0, Math.max(0, labelName(text, taken).length - 3)],
    validateInput: v => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? l10n.t('Only letters, digits and _ (starting with a letter)')
      : taken.some(t => t.toLowerCase() === v.toLowerCase()) ? l10n.t('"{0}" already exists', v) : undefined,
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
    await applyAndOffer(target.doc, insert, `${l10n.t('Label "{0}" created, "{1}" uses it.', name, item)}${hint}`);
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(layout.uri, new vscode.Range(layout.positionAt(valueEdit.start), layout.positionAt(valueEdit.end)), valueEdit.text);
  await applyAndOffer(target.doc, insert, `${l10n.t('Label "{0}" created, "{1}" uses it (one undo reverts both).', name, item)}${hint}`, edit);
}

/** Optional label properties for translators, asked after the name; undefined when cancelled. */
async function labelOptions(title: string, text: string): Promise<LabelOptions | undefined> {
  type Pick = vscode.QuickPickItem & { key: keyof LabelOptions };
  const picked = await vscode.window.showQuickPick<Pick>([
    { key: 'comment', label: l10n.t('Note for translators (Comment)'), detail: l10n.t('Appears in the XLIFF file as a note for translators') },
    { key: 'maxLength', label: l10n.t('Maximum length (MaxLength)'), detail: l10n.t('Translations must not be longer – e.g. for narrow textboxes') },
    { key: 'locked', label: l10n.t('Do not translate (Locked)'), detail: l10n.t('Fixed texts such as codes or brand names') },
  ], { title: `${title} (2/2)`, placeHolder: l10n.t('Translation options – Enter without a selection creates the label without options'), canPickMany: true });
  if (!picked) return undefined;
  const keys = new Set(picked.map(p => p.key));
  const options: LabelOptions = { locked: keys.has('locked') || undefined };
  if (keys.has('comment')) {
    const comment = await vscode.window.showInputBox({ title, prompt: l10n.t('Note for translators on "{0}"', text), placeHolder: l10n.t('e.g. heading of the quantity column') });
    if (comment === undefined) return undefined;
    options.comment = comment.trim() || undefined;
  }
  if (keys.has('maxLength')) {
    const max = await vscode.window.showInputBox({
      title, prompt: l10n.t('Maximum length of the translations (characters)'), value: String(Math.max(text.length, 10)),
      validateInput: v => (/^\d+$/.test(v) && Number(v) >= text.length ? undefined : l10n.t('A whole number ≥ {0} (length of the text)', text.length)),
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
export async function translationHint(root: vscode.Uri): Promise<string> {
  let features: string[] = [];
  try {
    const app = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'app.json'))));
    features = Array.isArray(app.features) ? app.features : [];
  } catch { return ''; }
  if (!features.some(f => /^translationfile$/i.test(f))) {
    return ` ${l10n.t('For translations, set "features": ["TranslationFile"] in app.json – the compiler then creates an XLIFF file.')}`;
  }
  const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(root, 'Translations')).then(x => x, () => []);
  const languages = files.map(([n]) => n).filter(n => /\.xlf$/i.test(n) && !/\.g\.xlf$/i.test(n));
  return languages.length
    ? ` ${l10n.t('After building, add the translations to {0}.', languages.join(', '))}`
    : ` ${l10n.t('After building, the label is in Translations/*.g.xlf; create an .xlf file for each language.')}`;
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
    { location: vscode.ProgressLocation.Window, title: l10n.t('Reading the fields of "{0}"', table) },
    () => service.al.fieldsOf(table, owner.file.root));
  if (!found) {
    const pick = await vscode.window.showWarningMessage(
      l10n.t('Table "{0}" was found neither in the workspace nor in the symbols (.alpackages).', table), l10n.t('Download Symbols'));
    if (pick) await vscode.commands.executeCommand('al.downloadSymbols').then(undefined, () => vscode.window.showErrorMessage(l10n.t('The AL Language extension is not installed.')));
    return;
  }
  const norm = (s: string) => s.replace(/"/g, '').replace(/^Rec\./i, '').trim().toLowerCase();
  const used = new Set(dataItem.columns.map(c => norm(c.source)));
  const candidates = fields.filter(f => !used.has(f.name.toLowerCase()) && !/^(blob|mediaset)$/i.test(f.type));
  if (!candidates.length) { vscode.window.showInformationMessage(l10n.t('All fields of "{0}" are columns already.', table)); return; }
  const picked = await vscode.window.showQuickPick(
    candidates.map(f => ({ label: f.name, description: f.type, detail: f.id !== null ? l10n.t('Field {0}', f.id) : undefined, field: f })),
    { title: l10n.t('Add Columns to "{0}" ({1})', dataItem.name, table), placeHolder: l10n.t('Select fields'), canPickMany: true, matchOnDescription: true });
  if (!picked?.length) return;
  const taken = allColumns(items).map(c => c.name);
  const columns = picked.map(p => {
    const name = columnName(p.field.name, dataItem.name, taken);
    taken.push(name);
    return { name, source: /^[A-Za-z_]\w*$/.test(p.field.name) ? p.field.name : `"${p.field.name}"` };
  });
  const insert = insertInto(src, report, dataItem.name, columns);
  if (!insert) { vscode.window.showErrorMessage(l10n.t('"{0}" cannot be extended in "{1}".', dataItem.name, report.name)); return; }
  await applyAndOffer(target.doc, insert, l10n.t('{0} column(s) added to "{1}": {2}.', columns.length, dataItem.name, columns.map(c => c.name).join(', ')));
}

export type ColumnHit = { doc: vscode.TextDocument; report: AlReport; column: AlColumn; start: number };

/** The first column of a document's reports that passes `test`. */
function findInDocument(doc: vscode.TextDocument, test: (c: AlColumn, start: number) => boolean): ColumnHit | undefined {
  const src = doc.getText();
  for (const report of parseAl(src)) {
    for (const column of declaredColumns(report)) {
      const start = offsetOf(src, column.pos.line, column.pos.character);
      if (test(column, start)) return { doc, report, column, start };
    }
  }
  return undefined;
}

/** A column by name in the AL report of a layout or in the report extensions of that report. */
export async function findColumn(service: LayoutService, layout: vscode.Uri, name: string): Promise<ColumnHit | undefined> {
  const owner = await service.al.ownerOf(layout);
  if (!owner) return undefined;
  const family = owner.report.kind === 'report' ? owner.report.name : owner.report.extends ?? owner.report.name;
  for (const uri of await service.al.familyFiles(family)) {
    const hit = findInDocument(await vscode.workspace.openTextDocument(uri), c => c.name.toLowerCase() === name.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

/** The column to rename: picked in the designer (Report data) or under the cursor in an AL editor. */
async function columnToRename(service: LayoutService, wanted: string | undefined) {
  const find = findInDocument;
  if (wanted) {
    const session = ReportEditorProvider.active;
    return session && findColumn(service, session.uri, wanted);
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || !/\.al$/i.test(editor.document.uri.path)) return undefined;
  const at = editor.document.offsetAt(editor.selection.active);
  return find(editor.document, (c, start) => {
    const r = renameIdentifierAt(editor.document.getText(), start, c.name);
    return !!r && at >= r.start && at <= r.end;
  });
}

/**
 * Renames a dataset column in AL and in every RDLC layout of the report and its extensions – field references,
 * caption parameter, dataset declaration, textboxes named after it – in one edit, so one undo reverts everything.
 */
async function renameColumn(service: LayoutService, arg: MenuArg) {
  const hit = await columnToRename(service, str(arg?.column));
  if (!hit) {
    vscode.window.showInformationMessage(l10n.t('Place the cursor on the name of a column: column(Name; Source).'));
    return;
  }
  const { report, column } = hit;
  const taken = await columnNames(service, report);
  const to = await vscode.window.showInputBox({
    title: l10n.t('Rename Column (AL and Layouts)'), value: column.name, valueSelection: [0, column.name.length],
    prompt: l10n.t('New name for "{0}" in "{1}" – also in all RDLC layouts of the report', column.name, report.name),
    validateInput: v => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) ? l10n.t('Only letters, digits and _ (starting with a letter)')
      : v !== column.name && taken.has(v.toLowerCase()) ? l10n.t('A column "{0}" already exists', v) : undefined,
  });
  if (!to || to === column.name) return;

  const { edit, changedLayouts, places, others } = await columnRenameEdit(service, hit, to);
  if (!await vscode.workspace.applyEdit(edit)) {
    vscode.window.showErrorMessage(l10n.t('The rename could not be applied.'));
    return;
  }
  vscode.window.showInformationMessage(
    (changedLayouts
      ? l10n.t('"{0}" is now "{1}": AL and {2} layout(s) with {3} place(s) – one undo reverts everything.', column.name, to, changedLayouts, places)
      : l10n.t('"{0}" is now "{1}" in AL – one undo reverts it.', column.name, to))
    + (others.length ? ` ${l10n.t('Please adapt the Word/Excel layouts ({0}) yourself.', others.join(', '))}` : ''));
}

/** Column names (lower case) of a report and all report extensions of it – a dataset has one namespace. */
export async function columnNames(service: LayoutService, report: AlReport): Promise<Set<string>> {
  const family = report.kind === 'report' ? report.name : report.extends ?? report.name;
  const taken = new Set<string>();
  for (const uri of await service.al.familyFiles(family)) {
    for (const r of parseAl((await vscode.workspace.openTextDocument(uri)).getText())) for (const c of declaredColumns(r)) taken.add(c.name.toLowerCase());
  }
  return taken;
}

/** One edit renaming a column in AL and in every RDLC layout of its report; Word/Excel layouts are listed in `others`. */
export async function columnRenameEdit(service: LayoutService, { doc, report, column, start }: ColumnHit, to: string) {
  const edit = new vscode.WorkspaceEdit();
  const al = renameIdentifierAt(doc.getText(), start, to)!;
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(al.start), doc.positionAt(al.end)), al.text);
  const layouts = await service.al.layoutsOf({ report });
  let changedLayouts = 0, places = 0;
  for (const l of layouts.filter(l => /^rdlc$/i.test(l.type))) {
    const layoutDoc = await vscode.workspace.openTextDocument(l.uri).then(d => d, () => undefined);
    if (!layoutDoc) continue;
    const { text, count } = renameColumnInLayout(layoutDoc.getText(), column.name, to);
    if (!count) continue;
    edit.replace(l.uri, new vscode.Range(layoutDoc.positionAt(0), layoutDoc.positionAt(layoutDoc.getText().length)), text);
    changedLayouts++;
    places += count;
  }
  return { edit, changedLayouts, places, others: layouts.filter(l => !/^rdlc$/i.test(l.type)).map(l => l.name) };
}

/** Where new columns of a data item go: the data item itself, or in a report extension its add(...) block. */
export function insertInto(src: string, report: AlReport, dataItem: string, columns: { name: string; source: string }[]): TextInsert | null {
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
    vscode.window.showErrorMessage(l10n.t('Building needs Microsoft\'s AL Language extension.'));
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
    vscode.window.showWarningMessage(owner ? l10n.t('The ID of the base report is not known (base report not in the workspace).') : l10n.t('No AL report found for this layout.'));
    return;
  }
  const launch = vscode.Uri.joinPath(owner.file.root, '.vscode', 'launch.json');
  let configs;
  try {
    configs = alConfigurations(new TextDecoder().decode(await vscode.workspace.fs.readFile(launch)));
  } catch {
    vscode.window.showErrorMessage(l10n.t('No readable {0} – create it with "AL: Go!" or "AL: Download symbols".', vscode.workspace.asRelativePath(launch)));
    return;
  }
  if (!configs.length) { vscode.window.showErrorMessage(l10n.t('launch.json contains no AL configuration.')); return; }
  const config = configs.length === 1 ? configs[0] : (await vscode.window.showQuickPick(
    configs.map(c => ({ label: c.name ?? l10n.t('(no name)'), description: reportUrl(c, id), config: c })),
    { title: l10n.t('Run Report {0}', id), placeHolder: l10n.t('Choose the environment') }))?.config;
  if (!config) return;
  const endpoint = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: l10n.t('Asking the server for the web client URL…') }, () => webClientEndpoint(config));
  const url = reportUrl(config, id, endpoint);
  const open = l10n.t('Open'), publish = l10n.t('Publish First');
  const pick = await vscode.window.showInformationMessage(
    l10n.t('Open report {0} "{1}" in the web client? The last published version of the app runs.', id, owner.report.kind === 'report' ? owner.report.name : owner.base?.name ?? ''),
    open, publish);
  if (pick === publish) {
    await vscode.commands.executeCommand('workbench.action.files.saveAll');
    await vscode.commands.executeCommand('al.publishNoDebug').then(undefined, () => vscode.window.showErrorMessage(l10n.t('Publishing needs the AL Language extension.')));
  }
  if (pick) await vscode.env.openExternal(vscode.Uri.parse(url));
}

/**
 * On-prem web client URL from the developer endpoint (like the AL extension with "usePublicURLFromServer"). Undefined
 * when the server cannot be asked – then the URL is built from `server` in launch.json.
 */
async function webClientEndpoint(config: AlLaunchConfig): Promise<string | undefined> {
  const url = metadataUrl(config);
  if (!url) return undefined;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return webEndpointOf(await res.text());
    // Windows authentication (Negotiate/NTLM) is not available to fetch: PowerShell sends the signed-in user's credentials
    if (res.status === 401 && process.platform === 'win32' && /negotiate|ntlm/i.test(res.headers.get('www-authenticate') ?? '')) {
      // the URL comes from the workspace's launch.json: passed as data (environment), never as part of the command text
      return webEndpointOf(await new Promise<string>((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Invoke-RestMethod -UseBasicParsing -UseDefaultCredentials -TimeoutSec 10 -Uri $env:BC_RB_METADATA_URL | ConvertTo-Json -Compress'],
        { timeout: 15000, windowsHide: true, env: { ...process.env, BC_RB_METADATA_URL: url } }, (err, stdout) => (err ? reject(err) : resolve(stdout)))));
    }
  } catch { /* server not reachable */ }
  return undefined;
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
          title: `$(layout) ${l10n.t('Open {0} in the Designer', l.path.split('/').pop())}`, command: 'vscode.openWith', arguments: [l, ReportEditorProvider.viewType],
        }));
      }
      const own = rep.kind === 'report' ? allColumns(rep.dataItems) : rep.additions.flatMap(a => [...a.columns, ...allColumns(a.dataItems)]);
      for (const sym of [...own, ...rep.labels]) {
        const uses = texts.map(t => ({ uri: t.uri, count: t.text.match(usagePattern(sym.name))?.length ?? 0 })).filter(u => u.count);
        if (!uses.length) continue; // unused ones are already faded out (hint diagnostic)
        const total = uses.reduce((s, u) => s + u.count, 0);
        lenses.push(new vscode.CodeLens(at(sym.pos), {
          title: l10n.t('{0}× in the layout', total), tooltip: l10n.t('Show in the designer ({0})', uses.map(u => u.uri.path.split('/').pop()).join(', ')),
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
    vscode.window.setStatusBarMessage(`$(check) ${l10n.t('Code taken into {0} (layout not saved yet)', doc.uri.path.split('/').pop())}`, 4000);
  }
  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
  delete() { throw vscode.FileSystemError.NoPermissions(); }
  rename() { throw vscode.FileSystemError.NoPermissions(); }
  dispose() { this.subscription.dispose(); this.emitter.dispose(); }
}
