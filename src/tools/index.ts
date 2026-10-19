// Language model tools (vscode.lm): let GitHub Copilot's agent mode – or any chat participant – build RDLC layouts
// with the designer's own logic. Read tools give the model what the XML hides (names, line numbers, the AL dataset,
// the rendered result, problems); edit tools cover what is error-prone to write as XML. Simple property changes stay
// direct XML edits by the model – the tool descriptions say so.

import * as vscode from 'vscode';
import { l10n } from '../../webview/l10n';
import { ChartSpec } from '../../webview/charts';
import { BcContext } from '../../webview/bc';
import { expectedDataset } from '../al/parser';
import { mergedDataItems } from '../al/context';
import { columnName, findDataItem, insertLabel, labelName, LabelOptions } from '../al/edit';
import { alReportOf, columnNames, columnRenameEdit, findColumn, insertInto, translationHint } from '../bcCommands';
import { textboxValueEdit } from '../layoutEdit';
import { LayoutService } from '../layoutService';
import { ReportEditorProvider, sampleDataUri } from '../reportEditorProvider';
import { ArrangeOptions, EditResult, NewItem, PageOptions, TableOp, arrangeItems, chartOf, editChart, editTable, insertItems, setPageLayout } from './edit';
import { describeLayout, formatProblems, previewText, validateLayout } from './inspect';

interface FileInput { file?: string }

const isLayout = (uri: vscode.Uri) => /\.rdlc?$/i.test(uri.path);
const name = (uri: vscode.Uri) => uri.path.split('/').pop() ?? '';
const result = (text: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);

/**
 * The layout a tool works on: the given path (absolute, workspace-relative or a unique file name), else the open
 * designer, else the RDLC in the active text editor, else the only layout of the workspace.
 */
async function layoutUri(file: string | undefined): Promise<vscode.Uri> {
  if (file?.trim()) {
    const f = file.trim().replace(/^file:\/\//, '');
    const candidates = /^([a-zA-Z]:)?[\\/]/.test(f)
      ? [vscode.Uri.file(f)]
      : (vscode.workspace.workspaceFolders ?? []).map(w => vscode.Uri.joinPath(w.uri, f));
    for (const uri of candidates) {
      if (await vscode.workspace.fs.stat(uri).then(() => true, () => false)) {
        if (!isLayout(uri)) throw new Error(`${file} is not an RDLC/RDL layout.`);
        return uri;
      }
    }
    const base = f.split(/[\\/]/).pop()!;
    const found = await vscode.workspace.findFiles(`**/${base}`, '**/node_modules/**', 5);
    if (found.length === 1 && isLayout(found[0])) return found[0];
    throw new Error(found.length > 1 ? `"${file}" is ambiguous: ${found.map(u => vscode.workspace.asRelativePath(u)).join(', ')}.` : `Layout "${file}" not found.`);
  }
  const active = ReportEditorProvider.active?.uri ?? vscode.window.activeTextEditor?.document.uri;
  if (active && isLayout(active)) return active;
  const all = await vscode.workspace.findFiles('**/*.{rdlc,rdl}', '{**/node_modules/**,**/.alpackages/**}', 20);
  if (all.length === 1) return all[0];
  throw new Error(all.length
    ? `Pass "file": the workspace has several layouts (${all.map(u => vscode.workspace.asRelativePath(u)).join(', ')}).`
    : 'The workspace has no RDLC/RDL layout. Create one first (an AL report with rendering { layout(...) { Type = RDLC; LayoutFile = ... } } and a build, or the command "Report Builder: New Report").');
}

/**
 * Replaces the layout text with one minimal edit (only the changed middle part), so the designer reloads, undo works
 * and diffs stay small. A layout that had no unsaved changes is saved again, so files on disk stay current.
 */
async function writeLayout(uri: vscode.Uri, before: string, after: string): Promise<boolean> {
  if (before === after) return false;
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.getText() !== before) throw new Error('The layout changed while the tool ran; call it again.');
  const wasDirty = doc.isDirty;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(start), doc.positionAt(before.length - end)), after.slice(start, after.length - end));
  if (!await vscode.workspace.applyEdit(edit)) throw new Error('VS Code refused the edit (is the file read-only?).');
  if (!wasDirty) await doc.save();
  return true;
}

async function readSample(uri: vscode.Uri): Promise<Record<string, unknown[]>> {
  try { return JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(sampleDataUri(uri)))); } catch { return {}; }
}

/** Shared state for the tools: the layout service (AL index, texts, lint). */
class Tools {
  constructor(private service: LayoutService) {}

  private async context(file: string | undefined) {
    const uri = await layoutUri(file);
    const text = await this.service.text(uri);
    if (!text.trim()) throw new Error(`${vscode.workspace.asRelativePath(uri)} is empty.`);
    return { uri, text, path: vscode.workspace.asRelativePath(uri) };
  }

  private async bc(uri: vscode.Uri, text: string): Promise<BcContext | null> {
    try { return await this.service.contextFor(uri, text); } catch { return null; }
  }

  private async al(uri: vscode.Uri) {
    const owner = await this.service.al.ownerOf(uri);
    const exp = owner && expectedDataset(owner.report, owner.base);
    return owner && exp ? { reportName: owner.report.name, fields: exp.fields, parameters: exp.parameters, complete: exp.complete } : null;
  }

  /** Runs a layout edit and reports what changed, plus the problems the edit left. */
  private async edit(file: string | undefined, fn: (text: string) => EditResult | Promise<EditResult>, after?: (text: string) => string) {
    const { uri, text, path } = await this.context(file);
    const res = await fn(text);
    const changed = await writeLayout(uri, text, res.text);
    const problems = validateLayout(res.text, { al: await this.al(uri), sample: await readSample(uri), bc: await this.bc(uri, res.text) });
    const errors = problems.filter(p => p.severity === 'error');
    return result([
      `${changed ? `${path} changed` : `${path} unchanged`}: ${res.summary.join('; ')}.`,
      after ? after(res.text) : '',
      errors.length ? `Problems after the edit:\n${formatProblems(errors)}` : `No errors (${problems.length} warning(s)/hint(s); bcReport_validateLayout lists them).`,
    ].filter(Boolean).join('\n\n'));
  }

  inspect = async (o: FileInput & { item?: string }) => {
    const { uri, text, path } = await this.context(o.file);
    return result(describeLayout(text, { path, item: o.item, bc: await this.bc(uri, text) }));
  };

  validate = async (o: FileInput) => {
    const { uri, text, path } = await this.context(o.file);
    const problems = validateLayout(text, { al: await this.al(uri), sample: await readSample(uri), bc: await this.bc(uri, text), reportName: name(uri).replace(/\.rdlc?$/i, '') });
    return result(`${path}: ${formatProblems(problems)}`);
  };

  preview = async (o: FileInput & { parameters?: Record<string, string>; maxRows?: number }) => {
    const { uri, text } = await this.context(o.file);
    return result(previewText(text, {
      sample: await readSample(uri), bc: await this.bc(uri, text), parameters: o.parameters, maxRows: o.maxRows,
      reportName: name(uri).replace(/\.rdlc?$/i, ''), locale: vscode.env.language,
    }));
  };

  reportData = async (o: FileInput & { tableFieldsOf?: string }) => {
    const { uri, text, path } = await this.context(o.file);
    const out: string[] = [];
    const bc = await this.bc(uri, text);
    const sample = await readSample(uri);
    const sidecar = vscode.workspace.asRelativePath(sampleDataUri(uri));
    if (!bc) {
      out.push(`${path} is not used by an AL report in the workspace (no rendering › LayoutFile points to it).`);
    } else {
      out.push(`AL ${bc.kind} ${bc.id ?? ''} "${bc.reportName}" in ${bc.alFile}${bc.complete ? '' : ' (base report not in the workspace: its columns are unknown)'}`);
      out.push('Columns per data item (✓ = in the layout dataset; ✗ = added in AL, the layout gets it with the next build):');
      const walk = (items: BcContext['dataItems'], indent: string) => {
        for (const d of items) {
          out.push(`${indent}dataitem ${d.name} (${d.table}) AL L${d.line + 1}`);
          for (const c of d.columns) out.push(`${indent}  ${c.inLayout ? '✓' : '✗'} ${c.name} = ${c.source}${c.includeCaption ? ` (IncludeCaption → Parameters!${c.name}Caption)` : ''}`);
          walk(d.children, `${indent}  `);
        }
      };
      walk(bc.dataItems, '  ');
      if (bc.labels.length) out.push(`Labels (use as =Parameters!<Name>.Value): ${bc.labels.map(l => `${l.inLayout ? '' : '✗'}${l.name}=${JSON.stringify(l.text)}`).join(', ')}`);
      if (bc.missingInLayout.length) out.push(`Missing in the layout dataset until the project is built (bcReport_buildProject): ${bc.missingInLayout.join(', ')}`);
      if (bc.removedInAl.length) out.push(`In the layout but no longer in AL (references break after the next build): ${bc.removedInAl.join(', ')}`);
      if (bc.layouts && bc.layouts.length > 1) out.push(`Layouts of the report: ${bc.layouts.map(l => `${l.name} (${l.type}${l.current ? ', this one' : ''}) ${l.path}`).join('; ')}`);
      out.push('Business Central conventions: decimal columns come with "<Column>Format" – set the textbox Format to =Fields!<Column>Format.Value; captions/labels are parameters; fixed texts should be AL labels (bcReport_createAlLabel) to be translatable.');
    }
    const sets = Object.entries(sample);
    out.push(sets.length
      ? `Preview data in ${sidecar}: ${sets.map(([ds, rows]) => `${ds} (${Array.isArray(rows) ? rows.length : 0} rows; keys ${Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0] as object).slice(0, 30).join(', ') : '-'})`).join('; ')}`
      : `No preview data yet: create ${sidecar} as {"<DataSet name>": [{"<Field>": value, …}, …]} (one object per dataset row; Business Central flattens data items – each child row repeats its parent's columns). Without it the preview generates placeholder rows.`);

    if (o.tableFieldsOf) {
      const target = await alReportOf(this.service, uri);
      if (!target) throw new Error('No AL report for this layout.');
      const items = mergedDataItems(target.report, target.owner.base);
      const dataItem = findDataItem(items, o.tableFieldsOf);
      if (!dataItem) throw new Error(`No data item "${o.tableFieldsOf}" (${items.map(i => i.name).join(', ')}).`);
      const table = dataItem.table.replace(/"/g, '');
      const { found, fields } = await this.service.al.fieldsOf(table, target.owner.file.root);
      if (!found) out.push(`Fields of "${table}": the table is neither in the workspace nor in .alpackages (download symbols with "AL: Download symbols").`);
      else {
        const used = new Set(dataItem.columns.map(c => c.source.replace(/"/g, '').replace(/^Rec\./i, '').trim().toLowerCase()));
        out.push(`Fields of "${table}" (* = already a column): ${fields.map(f => `${used.has(f.name.toLowerCase()) ? '*' : ''}${f.name}:${f.type}`).join(', ')}`);
      }
    }
    return result(out.join('\n'));
  };

  insert = (o: FileInput & { items: NewItem[] }) => this.edit(o.file, async text => {
    if (!Array.isArray(o.items) || !o.items.length) throw new Error('"items" must list at least one item.');
    const items = await Promise.all(o.items.map(async it => {
      const file = (it as NewItem & { imageFile?: string }).imageFile;
      if (it.type !== 'image' || !file) return it;
      return { ...it, embed: await readImage(file) };
    }));
    return insertItems(text, items);
  }, text => {
    const names = o.items.map(i => i.name).filter(Boolean) as string[];
    return names.length ? names.map(n => safe(() => describeLayout(text, { item: n }))).join('\n') : '';
  });

  table = (o: FileInput & { table: string; operations: TableOp[] }) =>
    this.edit(o.file, text => editTable(text, o.table, o.operations ?? []), text => describeLayout(text, { item: o.table }));

  chart = async (o: FileInput & { chart: string; set?: Partial<ChartSpec> }) => {
    if (!o.set || !Object.keys(o.set).length) {
      const { text } = await this.context(o.file);
      return result(`Chart "${o.chart}":\n${JSON.stringify(chartOf(text, o.chart), null, 1)}`);
    }
    return this.edit(o.file, text => editChart(text, o.chart, o.set!), text => JSON.stringify(chartOf(text, o.chart)));
  };

  arrange = (o: FileInput & ArrangeOptions) => this.edit(o.file, text => arrangeItems(text, o), text =>
    o.delete ? '' : (o.items ?? []).concat((o.boxes ?? []).map(b => b.name)).filter((n, i, a) => a.indexOf(n) === i).map(n => safe(() => describeLayout(text, { item: n }).split('\n')[0])).join('\n'));

  page = (o: FileInput & PageOptions) => this.edit(o.file, text => setPageLayout(text, o), text => describeLayout(text).split('\n').slice(0, 8).join('\n'));

  // ---------------------------------------------------------------------------------------------- AL side

  private async target(file: string | undefined) {
    const { uri, path } = await this.context(file);
    const target = await alReportOf(this.service, uri);
    if (!target) throw new Error(`${path} is not used by an AL report in the workspace (rendering › LayoutFile).`);
    return { uri, path, ...target };
  }

  addColumns = async (o: FileInput & { dataItem: string; columns: { field?: string; source?: string; name?: string }[] }) => {
    const { report, src, owner, doc } = await this.target(o.file);
    const items = mergedDataItems(report, owner.base);
    const dataItem = findDataItem(items, o.dataItem);
    if (!dataItem) throw new Error(`No data item "${o.dataItem}" (${items.map(i => i.name).join(', ')}).`);
    if (!o.columns?.length) throw new Error('"columns" must list at least one column.');
    const table = dataItem.table.replace(/"/g, '');
    const { found, fields } = await this.service.al.fieldsOf(table, owner.file.root);
    const taken = [...await columnNames(this.service, report)];
    const columns = o.columns.map(c => {
      const wanted = c.field?.replace(/^"|"$/g, '');
      if (!wanted && !c.source) throw new Error('Each column needs "field" (a field of the data item\'s table) or "source" (an AL expression).');
      const field = wanted && fields.find(f => f.name.toLowerCase() === wanted.toLowerCase())?.name;
      if (wanted && found && !field) throw new Error(`"${table}" has no field "${wanted}". bcReport_getReportData with tableFieldsOf lists its fields.`);
      const base = field ?? wanted;
      const name = c.name ?? columnName(base ?? c.source!.replace(/\W+/g, ' '), dataItem.name, taken);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || taken.includes(name.toLowerCase())) throw new Error(`The column name "${name}" is invalid or taken.`);
      taken.push(name.toLowerCase());
      return { name, source: c.source ?? (/^[A-Za-z_]\w*$/.test(base!) ? base! : `"${base}"`) };
    });
    const insert = insertInto(src, report, dataItem.name, columns);
    if (!insert) throw new Error(`"${dataItem.name}" cannot be extended in "${report.name}".`);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, doc.positionAt(insert.offset), insert.text);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('The AL file could not be changed.');
    return result(`${columns.length} column(s) added to data item "${dataItem.name}" in ${vscode.workspace.asRelativePath(doc.uri)}: ${columns.map(c => `${c.name} = ${c.source}`).join(', ')}.${found ? '' : ` Warning: "${table}" is not in the symbols, the field names are not checked.`}
Use them as =Fields!<Name>.Value (decimal fields also get <Name>Format; for a translated caption add IncludeCaption = true to the column in AL and use =Parameters!<Name>Caption.Value). The layout dataset gets them with the next build (bcReport_buildProject); until then the references show "stale-field" warnings.`);
  };

  createLabel = async (o: FileInput & { text: string; name?: string; textbox?: string } & LabelOptions) => {
    const t = await this.target(o.file);
    if (!o.text?.trim()) throw new Error('"text" is required.');
    const taken = t.report.labels.map(l => l.name);
    const label = o.name ?? labelName(o.text, taken);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(label) || taken.some(x => x.toLowerCase() === label.toLowerCase())) throw new Error(`The label name "${label}" is invalid or taken.`);
    const insert = insertLabel(t.src, t.report, label, o.text, { comment: o.comment, maxLength: o.maxLength, locked: o.locked });
    const edit = new vscode.WorkspaceEdit();
    edit.insert(t.doc.uri, t.doc.positionAt(insert.offset), insert.text);
    let used = '';
    if (o.textbox) {
      const layout = await vscode.workspace.openTextDocument(t.uri);
      const value = `=Parameters!${label}.Value`;
      const patch = textboxValueEdit(layout.getText(), o.textbox, value);
      if (!patch) throw new Error(`"${o.textbox}" is not a textbox with a single text run; create the label without "textbox" and set the value to ${value} in the XML.`);
      edit.replace(layout.uri, new vscode.Range(layout.positionAt(patch.start), layout.positionAt(patch.end)), patch.text);
      used = ` "${o.textbox}" now shows =Parameters!${label}.Value.`;
    }
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('The files could not be changed.');
    const hint = await translationHint(t.owner.file.root);
    return result(`Label ${label} = ${JSON.stringify(o.text)} added to ${t.report.kind} "${t.report.name}" (${vscode.workspace.asRelativePath(t.doc.uri)}).${used} Use it as =Parameters!${label}.Value; the layout declares the parameter after the next build (bcReport_buildProject).${hint}`);
  };

  renameColumn = async (o: FileInput & { column: string; newName: string }) => {
    const { uri } = await this.context(o.file);
    const hit = await findColumn(this.service, uri, o.column);
    if (!hit) throw new Error(`No column "${o.column}" in the AL report of this layout or its report extensions.`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.newName)) throw new Error(`"${o.newName}" is not a valid column name.`);
    if (o.newName !== hit.column.name && (await columnNames(this.service, hit.report)).has(o.newName.toLowerCase())) throw new Error(`A column "${o.newName}" already exists.`);
    const { edit, changedLayouts, places, others } = await columnRenameEdit(this.service, hit, o.newName);
    if (!await vscode.workspace.applyEdit(edit)) throw new Error('The rename could not be applied.');
    return result(`"${hit.column.name}" renamed to "${o.newName}" in AL and ${changedLayouts} RDLC layout(s) (${places} place(s)); one undo reverts it.${others.length ? ` Word/Excel layouts not changed: ${others.join(', ')}.` : ''}`);
  };

  build = async () => {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('al.package')) throw new Error('Building needs Microsoft\'s AL Language extension (command al.package).');
    await vscode.commands.executeCommand('workbench.action.files.saveAll');
    await vscode.commands.executeCommand('al.package');
    return result('AL: Package ran (all files were saved first). The compiler updates the datasets of the RDLC layouts. Check the Problems panel / bcReport_validateLayout for build errors and stale datasets.');
  };

  show = async (o: FileInput & { item?: string; mode?: 'design' | 'preview' }) => {
    const uri = await layoutUri(o.file);
    await vscode.commands.executeCommand('vscode.openWith', uri, ReportEditorProvider.viewType);
    const session = ReportEditorProvider.sessionFor(uri);
    if (!session) return result('The designer could not be opened.');
    await session.ready;
    if (o.item) await session.command('selectItem', { name: o.item });
    if (o.mode) await session.command('setMode', o.mode);
    return result(`${vscode.workspace.asRelativePath(uri)} is open in the designer${o.item ? `, ${o.item} selected` : ''}${o.mode ? ` (${o.mode})` : ''}.`);
  };
}

const safe = (fn: () => string) => { try { return fn(); } catch (e) { return (e as Error).message; } };

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

async function readImage(file: string): Promise<{ name: string; mimeType: string; data: string }> {
  const uris = /^([a-zA-Z]:)?[\\/]/.test(file) ? [vscode.Uri.file(file)] : (vscode.workspace.workspaceFolders ?? []).map(w => vscode.Uri.joinPath(w.uri, file));
  for (const uri of uris) {
    const bytes = await vscode.workspace.fs.readFile(uri).then(b => b, () => undefined);
    if (!bytes) continue;
    const ext = uri.path.split('.').pop()!.toLowerCase();
    const mimeType = IMAGE_TYPES[ext];
    if (!mimeType) throw new Error(`${file}: image format not supported (PNG, JPEG, GIF, BMP, SVG).`);
    if (bytes.length > 4 * 1024 * 1024) throw new Error(`${file} is ${Math.round(bytes.length / 1024)} KB – too large to embed in a layout.`);
    return { name: name(uri), mimeType, data: Buffer.from(bytes).toString('base64') };
  }
  throw new Error(`Image file "${file}" not found.`);
}

type Handler<T> = (input: T) => Promise<vscode.LanguageModelToolResult>;

/** Registers all tools; `confirm` asks the user before tools that change AL code or run the compiler. */
export function registerTools(context: vscode.ExtensionContext, service: LayoutService) {
  if (!vscode.lm?.registerTool) return; // VS Code without the language model API
  const tools = new Tools(service);
  const file = (o: FileInput) => (o?.file ? o.file.split(/[\\/]/).pop()! : l10n.t('the layout'));
  const register = <T extends FileInput>(id: string, handler: Handler<T>, message: (o: T) => string, confirm?: (o: T) => { title: string; message: string }) =>
    vscode.lm.registerTool<T>(`bcReport_${id}`, {
      prepareInvocation: ({ input }) => ({
        invocationMessage: message(input ?? {} as T),
        confirmationMessages: confirm ? (({ title, message }) => ({ title, message: new vscode.MarkdownString(message) }))(confirm(input ?? {} as T)) : undefined,
      }),
      invoke: async ({ input }) => handler(input ?? {} as T),
    });

  context.subscriptions.push(
    register('inspectLayout', tools.inspect, o => (o.item ? l10n.t('Reading {0} in {1}', o.item, file(o)) : l10n.t('Reading the structure of {0}', file(o)))),
    register('validateLayout', tools.validate, o => l10n.t('Checking {0}', file(o))),
    register('previewReport', tools.preview, o => l10n.t('Rendering the preview of {0}', file(o))),
    register('getReportData', tools.reportData, o => l10n.t('Reading the AL report and preview data of {0}', file(o))),
    register('insertItems', tools.insert, o => l10n.t('Inserting {0} item(s) into {1}', o.items?.length ?? 0, file(o))),
    register('editTable', tools.table, o => l10n.t('Changing table {0} in {1}', o.table, file(o))),
    register('editChart', tools.chart, o => (o.set ? l10n.t('Changing chart {0} in {1}', o.chart, file(o)) : l10n.t('Reading chart {0} in {1}', o.chart, file(o)))),
    register('arrangeItems', tools.arrange, o => l10n.t('Arranging items in {0}', file(o))),
    register('setPageLayout', tools.page, o => l10n.t('Changing the page setup of {0}', file(o))),
    register('addAlColumns', tools.addColumns, o => l10n.t('Adding columns to data item {0}', o.dataItem),
      o => ({ title: l10n.t('Add AL Columns'), message: l10n.t('Add {0} column(s) to data item **{1}** of the AL report?', o.columns?.length ?? 0, o.dataItem) })),
    register('createAlLabel', tools.createLabel, o => l10n.t('Creating the AL label "{0}"', o.text),
      o => ({ title: l10n.t('Create AL Label'), message: l10n.t('Create the label "{0}" in the AL report{1}?', o.text, o.textbox ? l10n.t(' and show it in {0}', o.textbox) : '') })),
    register('renameColumn', tools.renameColumn, o => l10n.t('Renaming column {0} to {1}', o.column, o.newName),
      o => ({ title: l10n.t('Rename Column (AL and Layouts)'), message: l10n.t('Rename column **{0}** to **{1}** in AL and in all RDLC layouts of the report?', o.column, o.newName) })),
    register('buildProject', tools.build, () => l10n.t('Building the AL project'),
      () => ({ title: l10n.t('Build Project'), message: l10n.t('Save all files and build the AL project (AL: Package)?') })),
    register('showInDesigner', tools.show, o => l10n.t('Opening {0} in the designer', file(o))),
  );
}
