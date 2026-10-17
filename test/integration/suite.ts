// Runs inside VS Code (extension host) against the real designer webview. See run.ts.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { EditorProbe } from '../../src/testing';

type Api = { probes: Map<string, EditorProbe>; service: { lintAll(): Promise<void> } };

/** Slow machines and CI (or a run right after the corpus test) need longer: BC_RB_TIMEOUT_SCALE=3. */
const SCALE = Math.max(1, Number(process.env.BC_RB_TIMEOUT_SCALE) || 1);

async function until<T>(what: string, fn: () => T | undefined | false, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout * SCALE;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Zeitüberschreitung: ${what}`);
    await new Promise(r => setTimeout(r, 50));
  }
}

const tests: [string, (api: Api) => Promise<void>][] = [];
const test = (name: string, fn: (api: Api) => Promise<void>) => tests.push([name, fn]);

const folder = () => vscode.workspace.workspaceFolders![0].uri;
const file = (name: string) => vscode.Uri.joinPath(folder(), name);
const docOf = (uri: vscode.Uri) => vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())!;

/** Opens a layout like a double click in the explorer and waits until the real webview has parsed it. */
async function open(api: Api, name: string) {
  const uri = file(name);
  await vscode.commands.executeCommand('vscode.open', uri);
  const probe = await until(`Designer für ${name}`, () => api.probes.get(uri.toString()));
  await until(`Webview hat ${name} geladen`, () => probe.received.find(m => m.type === 'loaded'));
  return { uri, probe, doc: docOf(uri) };
}

const errorsOf = (p: EditorProbe) => p.received.filter(m => m.type === 'error');

test('.rdlc öffnet standardmäßig im Designer', async api => {
  const { uri, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom, 'Custom-Editor-Tab');
  assert.equal(input.viewType, 'bcReportBuilder.designer');
  assert.equal(input.uri.toString(), uri.toString());
  const loaded = probe.received.find(m => m.type === 'loaded')!;
  assert.ok((loaded.items as number) > 0);
  assert.deepEqual(errorsOf(probe), []);
});

test('Bearbeitung aus der Webview ändert das Dokument; Rückgängig/Wiederholen', async api => {
  const { probe, doc } = await open(api, 'Verkaufsrechnung.rdlc');
  const original = doc.getText();
  const edited = original.replace('=Code.GetData(1,1)', '=Code.GetData(9,1)');
  assert.notEqual(edited, original);

  await probe.deliver({ type: 'edit', text: edited });
  assert.equal(doc.getText(), edited);
  assert.ok(doc.isDirty);
  const loads = probe.posted.filter(m => m.type === 'load').length;

  await vscode.commands.executeCommand('undo');
  await until('Rückgängig', () => doc.getText() === original);
  // the webview is told to reload the reverted state
  await until('Neu laden nach Rückgängig', () => probe.posted.filter(m => m.type === 'load').length > loads);

  await vscode.commands.executeCommand('redo');
  await until('Wiederholen', () => doc.getText() === edited);
  await vscode.commands.executeCommand('undo');
  await until('Rückgängig 2', () => doc.getText() === original);
  assert.deepEqual(errorsOf(probe), []);
});

test('Speichern schreibt die Datei', async api => {
  const { uri, probe, doc } = await open(api, 'Umsatzbericht.rdl');
  const edited = doc.getText().replace('<Value>Region</Value>', '<Value>Gebiet</Value>');
  await probe.deliver({ type: 'edit', text: edited });
  assert.ok(await doc.save());
  const onDisk = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  assert.equal(onDisk, edited);
  assert.ok(!doc.isDirty);
});

test('Änderungen von außen werden in die Webview übernommen', async api => {
  const { probe, doc } = await open(api, 'Umsatzbericht.rdl');
  const loadedBefore = probe.received.filter(m => m.type === 'loaded').length;
  const e = new vscode.WorkspaceEdit();
  const text = doc.getText();
  const at = text.indexOf('<Value>Kunde</Value>');
  e.replace(doc.uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + '<Value>Kunde</Value>'.length)), '<Value>Kundin</Value>');
  assert.ok(await vscode.workspace.applyEdit(e));
  // the real webview re-parses the changed text and reports back
  await until('Webview lädt externe Änderung', () => probe.received.filter(m => m.type === 'loaded').length > loadedBefore);
  assert.deepEqual(errorsOf(probe), []);
});

test('Ungültiges XML bricht den Designer nicht', async api => {
  const { probe, doc } = await open(api, 'Verkaufsrechnung.rdlc');
  const e = new vscode.WorkspaceEdit();
  e.insert(doc.uri, doc.positionAt(doc.getText().indexOf('<Report')), '<<kaputt');
  await vscode.workspace.applyEdit(e);
  await new Promise(r => setTimeout(r, 1000));
  assert.deepEqual(errorsOf(probe), [], 'keine Laufzeitfehler, nur die Fehlerseite');
  await vscode.commands.executeCommand('undo');
});

test('Business Central: AL-Report wird gefunden und an die Webview gesendet', async api => {
  const { probe } = await open(api, 'Verkaufsrechnung.rdlc');
  const msg = await until('bcContext', () => probe.posted.find(m => m.type === 'bcContext' && m.context));
  const ctx = msg.context as { reportName: string; alFile: string; dataItems: { name: string; children: { name: string }[] }[]; missingInLayout: string[] };
  assert.equal(ctx.reportName, 'Contoso Verkaufsrechnung');
  assert.equal(ctx.alFile.replace(/\\/g, '/'), 'src/Verkaufsrechnung.Report.al');
  assert.deepEqual(ctx.dataItems.map(d => [d.name, d.children.map(c => c.name)]), [['Header', ['Line']]]);
  assert.deepEqual(ctx.missingInLayout, ['YourReference', 'YourReferenceCaption']);
});

test('Lint: Problembereich für Layout und AL-Datei', async api => {
  const { uri, probe, doc } = await open(api, 'Verkaufsrechnung.rdlc');
  // the layout dataset is behind the AL report; the new column is unused
  await until('Hinweis veraltetes Dataset', () => vscode.languages.getDiagnostics(uri).some(d => d.code === 'stale-dataset'));
  const alUri = file('src/Verkaufsrechnung.Report.al');
  await until('ungenutzte AL-Spalte', () => vscode.languages.getDiagnostics(alUri).some(d => d.message.includes('YourReference') && d.tags?.includes(vscode.DiagnosticTag.Unnecessary)));

  // an unknown field reference appears as an error with the exact position, and in the designer
  await probe.deliver({ type: 'edit', text: doc.getText().replace('=Fields!Description_Line.Value', '=Fields!Descripton_Line.Value') });
  const err = await until('Fehler unbekanntes Feld', () => vscode.languages.getDiagnostics(uri).find(d => d.code === 'unknown-field'));
  assert.equal(doc.getText(err.range), 'Descripton_Line');
  assert.equal(err.severity, vscode.DiagnosticSeverity.Error);
  await until('Fund an die Webview', () => probe.posted.some(m => m.type === 'diagnostics' && (m.issues as { item?: string }[]).some(i => i.item === 'Description_Line')));
  await vscode.commands.executeCommand('undo');
  await until('Fehler wieder weg', () => !vscode.languages.getDiagnostics(uri).some(d => d.code === 'unknown-field'));
});

test('Doppelklick auf AL-Spalte öffnet die Definition', async api => {
  const { probe } = await open(api, 'Verkaufsrechnung.rdlc');
  await until('bcContext', () => probe.posted.find(m => m.type === 'bcContext' && m.context));
  await probe.deliver({ type: 'revealAl', line: 11, character: 19 });
  const editor = await until('AL-Editor', () => vscode.window.visibleTextEditors.find(e => e.document.uri.path.endsWith('Verkaufsrechnung.Report.al')));
  assert.equal(editor.selection.active.line, 11);
});

test('Vorschau rendert in der echten Webview mit Seitenumbruch', async api => {
  const { uri, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  await until('bcContext', () => probe.posted.find(m => m.type === 'bcContext'));
  await vscode.commands.executeCommand('bcReportBuilder.togglePreview', uri);
  const ready = await until('Vorschau fertig', () => probe.received.find(m => m.type === 'previewReady'), 30000);
  // generated BC data: two invoices with a page break between them
  assert.equal(ready.pages, 2);
  assert.deepEqual(errorsOf(probe), []);
});

test('VS-Code-Befehle steuern den Designer, sein Zustand kommt zurück (Statusleiste, Kontextschlüssel)', async api => {
  const { probe } = await open(api, 'Verkaufsrechnung.rdlc');
  type State = { zoom: number; status: string; mode: string; panes: { properties: boolean } };
  const state = () => [...probe.received].reverse().find(m => m.type === 'state')?.state as State | undefined;
  await until('Zustand der Webview', () => state());

  await vscode.commands.executeCommand('bcReportBuilder.zoomReset');
  await vscode.commands.executeCommand('bcReportBuilder.zoomIn');
  await until('Zoom 125 %', () => state()?.zoom === 1.25);
  await vscode.commands.executeCommand('bcReportBuilder.zoomReset');
  await until('Zoom 100 %', () => state()?.zoom === 1);

  await vscode.commands.executeCommand('bcReportBuilder.toggleProperties');
  await until('Eigenschaften ausgeblendet', () => state()?.panes.properties === false);
  await vscode.commands.executeCommand('bcReportBuilder.toggleProperties');
  await until('Eigenschaften eingeblendet', () => state()?.panes.properties === true);

  await vscode.commands.executeCommand('bcReportBuilder.insert.textbox');
  await until('Einfügewerkzeug in der Statusleiste', () => state()?.status.includes('Textfeld'));

  await vscode.commands.executeCommand('bcReportBuilder.showPreview');
  await until('Vorschau', () => state()?.mode === 'preview');
  await vscode.commands.executeCommand('bcReportBuilder.showDesign');
  await until('Entwurf', () => state()?.mode === 'design');

  // view options are settings, pushed to every open designer
  const config = vscode.workspace.getConfiguration('bcReportBuilder.designer');
  await vscode.commands.executeCommand('bcReportBuilder.toggleGrid');
  await until('Einstellung an die Webview', () => probe.posted.some(m => m.type === 'config' && (m.config as { grid: boolean }).grid === false));
  await config.update('showGrid', undefined, vscode.ConfigurationTarget.Global);
  assert.deepEqual(errorsOf(probe), []);
});

test('AL-Code: CodeLens zählt Verwendungen im Layout, Klick wählt das Textfeld im Designer', async api => {
  await api.service.lintAll();
  const al = await vscode.workspace.openTextDocument(file('src/Verkaufsrechnung.Report.al'));
  // the AL index loads in the background: ask until the lenses are there
  let all: vscode.CodeLens[] = [];
  const end = Date.now() + 30000 * SCALE;
  while (!all.some(l => l.command?.command === 'bcReportBuilder.revealInLayout') && Date.now() < end) {
    all = (await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', al.uri, 100)) ?? [];
    if (!all.some(l => l.command?.command === 'bcReportBuilder.revealInLayout')) await new Promise(r => setTimeout(r, 200));
  }
  const titles = all.map(l => l.command?.title ?? '');
  assert.ok(titles.some(t => t.includes('Verkaufsrechnung.rdlc im Designer öffnen')), titles.join(' | '));
  const qty = all.find(l => l.command?.command === 'bcReportBuilder.revealInLayout' && l.command.arguments?.[1] === 'Quantity_Line');
  assert.ok(qty, 'Lens an Quantity_Line');
  assert.match(qty!.command!.title, /^\d+× im Layout$/);

  await vscode.commands.executeCommand(qty!.command!.command, ...qty!.command!.arguments!);
  const probe = await until('Designer', () => api.probes.get(file('Verkaufsrechnung.rdlc').toString()));
  type State = { status: string };
  await until('Auswahl des Textfelds mit Quantity_Line', () => {
    const s = [...probe.received].reverse().find(m => m.type === 'state')?.state as State | undefined;
    return s && s.status !== '' && /Textfeld|Tabellenzelle|Element/.test(s.status);
  });
  assert.deepEqual(errorsOf(probe), []);
});

test('<Code>-Block als VB-Dokument: lesen und zurückschreiben ins Layout', async api => {
  const { doc } = await open(api, 'Verkaufsrechnung.rdlc');
  const uri = vscode.Uri.from({ scheme: 'bcreport-code', path: `${doc.uri.path}.vb`, query: doc.uri.toString() });
  const code = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  assert.match(code, /Function GetData/);
  const original = doc.getText();
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(code + "\nPublic Function Neu() As String\n  Return \"a < b\"\nEnd Function\n"));
  await until('Layout geändert', () => doc.getText() !== original);
  assert.match(doc.getText(), /Return "a &lt; b"/);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await until('zurückgesetzt', () => doc.getText() === original);
});

test('Layouts des Reports: auch aus Report-Extensions, RDLC wechseln im Designer', async api => {
  const ext = file('src/VerkaufsrechnungExt.ReportExt.al');
  const second = file('VerkaufsrechnungKurz.rdlc');
  await vscode.workspace.fs.copy(file('Verkaufsrechnung.rdlc'), second, { overwrite: true });
  await vscode.workspace.fs.writeFile(ext, new TextEncoder().encode(`reportextension 50100 "Verkaufsrechnung Ext" extends "Contoso Verkaufsrechnung"
{
    rendering
    {
        layout(Kurz) { Type = RDLC; LayoutFile = './VerkaufsrechnungKurz.rdlc'; }
        layout(WordLayout) { Type = Word; LayoutFile = './Verkaufsrechnung.docx'; }
    }
}
`));
  try {
    const { probe } = await open(api, 'Verkaufsrechnung.rdlc');
    type Layout = { name: string; type: string; uri: string; current: boolean; exists: boolean; owner: string };
    const layouts = await until('Layouts im bcContext', () => {
      const ctx = [...probe.posted].reverse().find(m => m.type === 'bcContext' && m.context)?.context as { layouts?: Layout[] } | undefined;
      return ctx?.layouts && ctx.layouts.length === 3 ? ctx.layouts : undefined;
    }, 30000);
    const byName = (a: unknown[], b: unknown[]) => String(a[0]).localeCompare(String(b[0]));
    assert.deepEqual(layouts.map(l => [l.name, l.type, l.current, l.exists]).sort(byName), [
      ['Kurz', 'RDLC', false, true], ['RDLCLayout', 'RDLC', true, true], ['WordLayout', 'Word', false, false],
    ]);
    assert.equal(layouts.find(l => l.name === 'Kurz')!.owner, 'Verkaufsrechnung Ext');

    await probe.deliver({ type: 'openLayout', uri: layouts.find(l => l.name === 'Kurz')!.uri });
    await until('Designer für das zweite Layout', () => api.probes.get(second.toString()));
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace.fs.delete(ext);
    await vscode.workspace.fs.delete(second);
  }
});

/**
 * Answers VS Code's input box, quick pick and notifications with fixed values while `fn` runs (the commands under test
 * ask the user); the quick pick answer picks items by label.
 */
async function withAnswers<T>(answers: { input?: string[]; pick?: string[][] }, fn: () => Promise<T>): Promise<{ result: T; asked: string[] }> {
  const w = vscode.window as unknown as Record<string, unknown>;
  const saved = {
    showInputBox: w.showInputBox, showQuickPick: w.showQuickPick,
    showInformationMessage: w.showInformationMessage, showWarningMessage: w.showWarningMessage, showErrorMessage: w.showErrorMessage,
  };
  const inputs = [...(answers.input ?? [])], picks = [...(answers.pick ?? [])];
  const asked: string[] = [];
  w.showInputBox = async (o: vscode.InputBoxOptions) => {
    asked.push(`input:${o.title ?? o.prompt}`);
    const v = inputs.shift();
    const invalid = v !== undefined && await o.validateInput?.(v);
    if (invalid) throw new Error(`Eingabe „${v}“ abgelehnt: ${invalid}`);
    return v;
  };
  w.showQuickPick = async (items: readonly vscode.QuickPickItem[] | Thenable<readonly vscode.QuickPickItem[]>, o?: vscode.QuickPickOptions) => {
    asked.push(`pick:${o?.title ?? ''}`);
    const labels = picks.shift();
    const all = await items;
    return labels && all.filter(i => labels.includes(i.label));
  };
  w.showInformationMessage = async (message: string) => { asked.push(`info:${message}`); return undefined; };
  w.showWarningMessage = async (message: string) => { asked.push(`warning:${message}`); return undefined; };
  w.showErrorMessage = async (message: string) => { asked.push(`error:${message}`); return undefined; };
  try {
    return { result: await fn(), asked };
  } finally {
    Object.assign(w, saved);
  }
}

/** Puts a document back to the given text (the tests change files of the shared temporary workspace). */
async function restore(uri: vscode.Uri, text: string) {
  const doc = await vscode.workspace.openTextDocument(uri);
  if (doc.getText() === text) return;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

test('Als AL-Label anlegen: Name und Optionen abfragen, Label in AL, Textfeld im Layout – ein Bearbeitungsschritt', async api => {
  const { doc } = await open(api, 'Verkaufsrechnung.rdlc');
  const alUri = file('src/Verkaufsrechnung.Report.al');
  const al = await vscode.workspace.openTextDocument(alUri);
  const [layoutText, alText] = [doc.getText(), al.getText()];
  const item = /<Textbox Name="([^"]+)">(?:(?!<\/Textbox>)[\s\S])*?<Value>Menge<\/Value>/.exec(layoutText)![1];
  try {
    const { asked } = await withAnswers({ input: ['MengeLbl', 'Spaltenüberschrift'], pick: [['Übersetzungshinweis (Comment)']] },
      () => vscode.commands.executeCommand('bcReportBuilder.createLabel', { item, literalText: 'Menge' }) as Promise<unknown>);
    assert.deepEqual(asked.filter(a => !a.startsWith('info:')).map(a => a.split(':')[0]), ['input', 'pick', 'input']);
    assert.match(al.getText(), /MengeLbl = 'Menge', Comment = 'Spaltenüberschrift';/);
    assert.ok(doc.getText().includes('<Value>=Parameters!MengeLbl.Value</Value>'));
    assert.equal(doc.getText().split('\n').length, layoutText.split('\n').length, 'nur die eine Zeile geändert');
  } finally {
    await restore(doc.uri, layoutText);
    await restore(alUri, alText);
  }
});

test('Felder als Spalten hinzufügen: Auswahl aus den Tabellenfeldern', async api => {
  await open(api, 'Verkaufsrechnung.rdlc');
  const table = file('src/SalesInvoiceLine.Table.al');
  const alUri = file('src/Verkaufsrechnung.Report.al');
  const alText = (await vscode.workspace.openTextDocument(alUri)).getText();
  await vscode.workspace.fs.writeFile(table, new TextEncoder().encode(`table 50101 "Sales Invoice Line"
{
    fields
    {
        field(1; "Document No."; Code[20]) { }
        field(11; Description; Text[100]) { }
        field(12; "Description 2"; Text[50]) { }
        field(15; Quantity; Decimal) { }
        field(22; "Unit Price"; Decimal) { }
        field(30; "Shipment Date"; Date) { }
    }
}
`));
  try {
    let offered: string[] = [];
    const { asked } = await withAnswers({ pick: [['Description 2', 'Shipment Date']] }, async () => {
      const w = vscode.window as unknown as { showQuickPick: (items: vscode.QuickPickItem[], o: unknown) => unknown };
      const pick = w.showQuickPick;
      w.showQuickPick = async (items, o) => { offered = (await items).map(i => i.label); return pick(items, o); };
      // the AL index picks the new table up from the file watcher
      for (let i = 0; i < 50 && !offered.length; i++) {
        await vscode.commands.executeCommand('bcReportBuilder.addColumns', { dataItem: 'Line' });
        if (!offered.length) await new Promise(r => setTimeout(r, 200));
      }
    });
    assert.ok(offered.includes('Description 2') && !offered.includes('Quantity'), `angeboten: ${offered.join(', ')} (vorhandene Spalten nicht)`);
    assert.ok(asked.some(a => a.startsWith('info:') && a.includes('2 Spalte(n)')), asked.join(' | '));
    const text = (await vscode.workspace.openTextDocument(alUri)).getText();
    assert.match(text, /column\(Description2_Line; "Description 2"\) \{ \}\s*column\(ShipmentDate_Line; "Shipment Date"\) \{ \}/);
  } finally {
    await restore(alUri, alText);
    await vscode.workspace.fs.delete(table);
  }
});

test('Spalte umbenennen: AL und Layout in einem Schritt', async api => {
  const { doc } = await open(api, 'Verkaufsrechnung.rdlc');
  const alUri = file('src/Verkaufsrechnung.Report.al');
  const al = await vscode.workspace.openTextDocument(alUri);
  const [layoutText, alText] = [doc.getText(), al.getText()];
  try {
    // refused: an existing column name
    await assert.rejects(withAnswers({ input: ['UnitPrice_Line'] },
      () => vscode.commands.executeCommand('bcReportBuilder.renameColumn', { column: 'Quantity_Line' }) as Promise<unknown>), /bereits/);
    // from the AL editor: cursor on the column name
    const editor = await vscode.window.showTextDocument(al);
    const at = al.positionAt(al.getText().indexOf('Quantity_Line') + 3);
    editor.selection = new vscode.Selection(at, at);
    const { asked } = await withAnswers({ input: ['Menge_Line'] }, () => vscode.commands.executeCommand('bcReportBuilder.renameColumn') as Promise<unknown>);
    assert.match(al.getText(), /column\(Menge_Line; Quantity\)/);
    // read the layout again: the document object from before the AL editor was shown may be a stale one
    const layout = (await vscode.workspace.openTextDocument(doc.uri)).getText();
    assert.ok(!layout.includes('Quantity_Line'), asked.join(' | '));
    assert.ok(layout.includes('=Fields!Menge_Line.Value'));
  } finally {
    await restore(doc.uri, layoutText);
    await restore(alUri, alText);
  }
});

export async function run(): Promise<void> {
  const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'bc-report-builder')!;
  const api = (await ext.activate()) as Api;
  assert.ok(api?.probes, 'Test-API (BC_REPORT_BUILDER_TEST=1)');
  const failures: string[] = [];
  const cleanUp = async () => {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // closed webviews dispose asynchronously; open() must not pick up the stale probe of the previous test
    await until('Designer geschlossen', () => api.probes.size === 0, 5000).catch(() => api.probes.clear());
  };
  for (const [name, fn] of tests) {
    // a test that fails (e.g. a timeout on a busy machine) gets one more attempt; both errors are reported
    let error: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await fn(api);
        error = undefined;
        console.log(`  ✓ ${name}${attempt > 1 ? ' (im 2. Versuch)' : ''}`);
        break;
      } catch (e) {
        error = e;
        console.log(`  ${attempt === 1 ? '↻' : '✗'} ${name}\n      ${(e as Error).stack ?? e}`);
      } finally {
        await cleanUp();
      }
    }
    if (error) failures.push(name);
  }
  console.log(`\n${tests.length - failures.length}/${tests.length} Integrationstests bestanden`);
  if (failures.length) throw new Error(`${failures.length} Integrationstest(s) fehlgeschlagen`);
}
