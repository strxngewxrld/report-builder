// Runs inside VS Code (extension host) against the real designer webview. See run.ts.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { EditorProbe } from '../../src/testing';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { parseRdl, serializeRdl, XmlDom } from '../../webview/rdl';
import { allReportItems } from '../../webview/model';

type Api = { probes: Map<string, EditorProbe>; service: { lintAll(): Promise<void> } };

/** Slow machines and CI (or a run right after the corpus test) need longer: BC_RB_TIMEOUT_SCALE=3. */
const SCALE = Math.max(1, Number(process.env.BC_RB_TIMEOUT_SCALE) || 1);

async function until<T>(what: string, fn: () => T | undefined | false | Promise<T | undefined | false>, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout * SCALE;
  for (;;) {
    const v = await fn();
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
  await until(`Designer für ${name} ist bereit`, () => probe.received.find(m => m.type === 'state'));
  return { uri, probe, doc: docOf(uri) };
}

const errorsOf = (p: EditorProbe) => p.received.filter(m => m.type === 'error');

test('Getting Started: Rundgang, unabhängige Beispielkopien und Offline-Handbuch', async api => {
  await vscode.commands.executeCommand('bcReportBuilder.gettingStarted');
  const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'bc-report-builder')!;
  const source = vscode.Uri.joinPath(ext.extensionUri, 'samples', 'Umsatzbericht.rdl');
  const original = await vscode.workspace.fs.readFile(source);
  const openCopy = async () => {
    await vscode.commands.executeCommand('bcReportBuilder.openExample');
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom);
    assert.equal(input.viewType, 'bcReportBuilder.designer');
    assert.notEqual(input.uri.toString(), source.toString());
    const probe = await until('Beispielkopie geladen', () => {
      const p = api.probes.get(input.uri.toString());
      return p?.received.some(m => m.type === 'state') && p;
    });
    return { uri: input.uri, probe };
  };
  const first = await openCopy();
  const data = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(
    vscode.Uri.joinPath(first.uri, '..', 'Umsatzbericht.data.json'))));
  assert.equal(data.Umsaetze.length, 8);
  assert.equal(Math.round(data.Umsaetze.reduce((sum: number, row: { Umsatz: number }) => sum + row.Umsatz, 0) * 100), 3752340);
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', first.uri);
  const preview = await until('Beispielvorschau', () => first.probe.received.find(m => m.type === 'previewReady'));
  assert.equal(preview.errors, 0);

  const doc = docOf(first.uri);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(first.uri, new vscode.Position(0, 0), '<!-- working copy -->\n');
  assert.ok(await vscode.workspace.applyEdit(edit));
  assert.ok(await doc.save());
  const second = await openCopy();
  assert.notEqual(second.uri.toString(), first.uri.toString());
  assert.deepEqual(await vscode.workspace.fs.readFile(second.uri), original);
  assert.deepEqual(await vscode.workspace.fs.readFile(source), original);
  const german = (process.env.BC_RB_TEST_LANGUAGE || vscode.env.language).toLowerCase().startsWith('de');
  for (const [command, english, translated] of [
    ['openUserGuide', 'USER-GUIDE.md', 'ANWENDERHANDBUCH.md'],
    ['openMigrationGuide', 'MIGRATION.md', 'UMSTIEG-REPORT-BUILDER.md'],
    ['openAiToolsGuide', 'AI-TOOLS.md', 'AI-TOOLS.de.md'],
  ]) {
    await vscode.commands.executeCommand(`bcReportBuilder.${command}`);
    const name = german ? translated : english;
    await until('Anleitung öffnet als Markdown-Vorschau', () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      return tab?.label.includes(name) && tab.input instanceof vscode.TabInputWebview;
    });
  }
});

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
  await until('Einfügewerkzeug in der Statusleiste', () => /Textbox|Textfeld/.test(state()?.status ?? ''));

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
  assert.ok(titles.some(t => /Open Verkaufsrechnung\.rdlc in the Designer|Verkaufsrechnung\.rdlc im Designer öffnen/.test(t)), titles.join(' | '));
  const qty = all.find(l => l.command?.command === 'bcReportBuilder.revealInLayout' && l.command.arguments?.[1] === 'Quantity_Line');
  assert.ok(qty, 'Lens an Quantity_Line');
  assert.match(qty!.command!.title, /^\d+× (in the|im) layout$/i);

  await vscode.commands.executeCommand(qty!.command!.command, ...qty!.command!.arguments!);
  const probe = await until('Designer', () => api.probes.get(file('Verkaufsrechnung.rdlc').toString()));
  type State = { status: string };
  await until('Auswahl des Textfelds mit Quantity_Line', () => {
    const s = [...probe.received].reverse().find(m => m.type === 'state')?.state as State | undefined;
    return s && s.status !== '' && /Textbox|Table cell|Item|Textfeld|Tabellenzelle|Element/.test(s.status);
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
  const extension = vscode.extensions.all.find(extension => extension.packageJSON.name === 'bc-report-builder')!;
  const language = process.env.BC_RB_TEST_LANGUAGE || vscode.env.language;
  const translations: Record<string, string> = language.startsWith('de')
    ? JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extension.extensionUri, 'l10n/bundle.l10n.de.json')))) : {};
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
    const wanted = new Set(labels?.flatMap(label => [label, translations[label]].filter(Boolean)));
    const chosen = labels && all.filter(i => wanted.has(i.label));
    return o?.canPickMany ? chosen : chosen?.[0];
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
  const { uri, doc, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  const alUri = file('src/Verkaufsrechnung.Report.al');
  const al = await vscode.workspace.openTextDocument(alUri);
  const [layoutText, alText] = [doc.getText(), al.getText()];
  const item = /<Textbox Name="([^"]+)">(?:(?!<\/Textbox>)[\s\S])*?<Value>Menge<\/Value>/.exec(layoutText)![1];
  try {
    const { asked } = await withAnswers({ input: ['MengeLbl', 'Spaltenüberschrift'], pick: [['Note for translators (Comment)']] },
      () => vscode.commands.executeCommand('bcReportBuilder.createLabel', { item, literalText: 'Menge' }) as Promise<unknown>);
    assert.deepEqual(asked.filter(a => !a.startsWith('info:')).map(a => a.split(':')[0]), ['input', 'pick', 'input']);
    assert.match(al.getText(), /MengeLbl = 'Menge', Comment = 'Spaltenüberschrift';/);
    assert.ok(doc.getText().includes('<Value>=Parameters!MengeLbl.Value</Value>'));
    assert.equal(doc.getText().split('\n').length, layoutText.split('\n').length, 'nur die eine Zeile geändert');
    await until('AL-Label im Designer geladen', () => probe.posted.some(m => m.type === 'load' && String(m.text).includes('Parameters!MengeLbl.Value')));
    await vscode.commands.executeCommand('bcReportBuilder.findExpressions', uri);
    await domAction(api, uri, probe, '.expression-search select', 'input', 'uses');
    await domAction(api, uri, probe, '.expression-search .form-row:nth-child(2) select', 'input', 'Parameters!MengeLbl');
    assert.equal((await domAction(api, uri, probe, '.expression-result')).count, 1);
    assert.ok(String((await domAction(api, uri, probe, '.expression-result')).text).includes(item));
    assert.equal((await domAction(api, uri, probe, '.expression-result button', 'click')).count, 0, 'Navigation schließt den Dialog');
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
    assert.ok(asked.some(a => a.startsWith('info:') && /2 (column\(s\)|Spalte\(n\))/.test(a)), asked.join(' | '));
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
      () => vscode.commands.executeCommand('bcReportBuilder.renameColumn', { column: 'Quantity_Line' }) as Promise<unknown>), /already exists|gibt es bereits/);
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

test('Geteilter Editor: Befehle wirken im fokussierten Designer, auch nachdem der andere geschlossen wurde', async api => {
  const { uri, probe: first } = await open(api, 'Umsatzbericht.rdl');
  const key = uri.toString();
  type State = { mode: string };
  const mode = (p: EditorProbe) => ([...p.received].reverse().find(m => m.type === 'state')?.state as State | undefined)?.mode;
  await vscode.commands.executeCommand('workbench.action.splitEditorRight');
  const second = await until('zweiter Designer', () => { const p = api.probes.get(key); return p !== first ? p : undefined; });
  await until('zweiter Designer bereit', () => second.received.find(m => m.type === 'state'));
  // back to the first one: an editor title command with the file's URI acts there, not in the newer designer
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  await vscode.commands.executeCommand('bcReportBuilder.togglePreview', uri);
  await until('Vorschau im fokussierten Designer', () => mode(first) === 'preview');
  assert.notEqual(mode(second), 'preview');
  // closing the second designer must not unregister the first one
  await vscode.commands.executeCommand('workbench.action.focusSecondEditorGroup');
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await until('zweiter Designer geschlossen', () => api.probes.get(key) !== second);
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  await vscode.commands.executeCommand('bcReportBuilder.togglePreview', uri);
  await until('Entwurf im verbliebenen Designer', () => mode(first) === 'design');
  assert.deepEqual(errorsOf(first), []);
});

test('PDF-Export: alle Seiten der Vorschau in Seitengröße des Berichts', async api => {
  const { uri, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  await until('bcContext', () => probe.posted.find(m => m.type === 'bcContext'));
  await vscode.commands.executeCommand('bcReportBuilder.togglePreview', uri);
  const ready = await until('Vorschau fertig', () => probe.received.find(m => m.type === 'previewReady'), 30000);
  const target = file('Export-Test.pdf');
  const w = vscode.window as unknown as Record<string, unknown>;
  const saved = { showSaveDialog: w.showSaveDialog, showInformationMessage: w.showInformationMessage };
  w.showSaveDialog = async () => target;
  w.showInformationMessage = async () => undefined;
  try {
    await vscode.commands.executeCommand('bcReportBuilder.exportPdf', uri);
    const bytes = await until('PDF geschrieben', () => {
      const msg = probe.received.find(m => m.type === 'savePdf' || m.type === 'error');
      return msg;
    }, 60000).then(async msg => {
      assert.equal(msg.type, 'savePdf', String(msg.message ?? ''));
      for (let i = 0; i < 50; i++) {
        const b = await vscode.workspace.fs.readFile(target).then(x => x, () => undefined);
        if (b?.length) return b;
        await new Promise(r => setTimeout(r, 100));
      }
      throw new Error('PDF-Datei fehlt');
    });
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), ready.pages);
    const size = pdf.getPage(0).getSize();
    // Verkaufsrechnung: A4 (21 × 29.7 cm)
    assert.ok(Math.abs(size.width - 595.3) < 2 && Math.abs(size.height - 841.9) < 2, `${size.width} × ${size.height}`);
    assert.ok(bytes.length > 3000, 'Inhalt vorhanden');
    // the report's fonts are embedded when an installed font file is found (otherwise the standard fonts are used)
    const { FontIndex } = await import('../../src/fonts');
    if (await new FontIndex().find({ families: ['Segoe UI', 'Arial', 'sans-serif'], bold: false, italic: false })) {
      const { PDFDict, PDFName } = await import('pdf-lib');
      const embedded = pdf.context.enumerateIndirectObjects()
        .some(([, o]) => o instanceof PDFDict && (o.has(PDFName.of('FontFile2')) || o.has(PDFName.of('FontFile3'))));
      assert.ok(embedded, 'Schrift eingebettet');
    }
    // to look at the result: BC_RB_KEEP_PDF=/path/file.pdf npm run test:vscode
    if (process.env.BC_RB_KEEP_PDF) await vscode.workspace.fs.writeFile(vscode.Uri.file(process.env.BC_RB_KEEP_PDF), bytes);
  } finally {
    Object.assign(w, saved);
    await vscode.workspace.fs.delete(target).then(undefined, () => undefined);
  }
});

test('Abnahme: PDF bettet die angeforderte Segoe UI Light statt einer Ersatzschrift ein', async api => {
  const { uri, probe } = await open(api, 'Umsatzbericht.rdl');
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await until('Umsatzvorschau', () => probe.received.find(m => m.type === 'previewReady'));
  const windows = vscode.window as unknown as Record<string, unknown>;
  const save = windows.showSaveDialog, info = windows.showInformationMessage;
  const target = file('Font-Acceptance.pdf');
  windows.showSaveDialog = async () => target;
  windows.showInformationMessage = async () => undefined;
  try {
    await vscode.commands.executeCommand('bcReportBuilder.exportPdf', uri);
    const bytes = await until('Schriften-PDF', async () => vscode.workspace.fs.readFile(target).then(b => b.length ? b : undefined, () => undefined), 60000);
    const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    const { FontIndex } = await import('../../src/fonts');
    const face = await new FontIndex().find({ families: ['Segoe UI Light'], bold: false, italic: false });
    if (face?.aliases.some(n => n.toLowerCase() === 'segoe ui light')) {
      assert.ok(pdf.context.enumerateIndirectObjects().some(([, o]) => o instanceof PDFDict &&
        String(o.get(PDFName.of('BaseFont'))).includes('SegoeUI-Light')), 'Segoe UI Light eingebettet');
    }
    if (process.env.BC_RB_KEEP_PDF) await vscode.workspace.fs.writeFile(vscode.Uri.file(process.env.BC_RB_KEEP_PDF.replace(/\.pdf$/i, '-fonts.pdf')), bytes);
    assert.deepEqual(errorsOf(probe), []);
  } finally { windows.showSaveDialog = save; windows.showInformationMessage = info; }
});

test('Abnahme: PDF-Export während neuer Vorschaudaten wartet auf die neue Seitenaufteilung', async api => {
  const { uri, probe } = await open(api, 'Umsatzbericht.rdl');
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  const initial = await until('Erste Vorschau vor Datenwechsel', () => probe.received.find(m => m.type === 'previewReady'));
  const windows = vscode.window as unknown as Record<string, unknown>;
  const originalSave = windows.showSaveDialog, originalInfo = windows.showInformationMessage;
  const target = file('ExportDuringMeasurement.pdf');
  windows.showSaveDialog = async () => target;
  windows.showInformationMessage = async () => undefined;
  try {
    const count = probe.received.length;
    const rows = Array.from({ length: 120 }, (_, i) => ({ Region: 'Nord', Kunde: `Neuer Kunde ${i}`, Bestelldatum: '2026-01-01', Menge: i + 1, Umsatz: (i + 1) * 10 }));
    await probe.send({ type: 'sampleData', data: { Umsaetze: rows } });
    // Do not wait for previewReady: this command must survive the measurement reset.
    await vscode.commands.executeCommand('bcReportBuilder.exportPdf', uri);
    const ready = await until('Neue mehrseitige Vorschau', () => probe.received.slice(count).find(m => m.type === 'previewReady' && Number(m.pages) > Number(initial.pages)));
    const bytes = await until('PDF nach Datenwechsel', async () => vscode.workspace.fs.readFile(target).then(b => b.length ? b : undefined, () => undefined), 60000);
    const { PDFDocument } = await import('pdf-lib');
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), ready.pages, 'Export verwendet die neuen Daten statt alter Messwerte');
    assert.deepEqual(errorsOf(probe), []);
  } finally { windows.showSaveDialog = originalSave; windows.showInformationMessage = originalInfo; }
});

test('Tabellenbefehle aus VS Code wirken in der Webview: Spalte, Zeile, Gruppenfuß, Rückgängig', async api => {
  const { uri, probe, doc } = await open(api, 'Verkaufsrechnung.rdlc');
  const original = doc.getText();
  const count = (re: RegExp) => ((vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())?.getText() ?? '').match(re) ?? []).length;
  const columns = () => count(/<TablixColumn>/g), rows = () => count(/<TablixRow>/g), groups = () => count(/<Group Name=/g);
  const [c0, r0, g0] = [columns(), rows(), groups()];
  // select the quantity cell of the line table (as a CodeLens click does)
  await vscode.commands.executeCommand('bcReportBuilder.revealInLayout', uri, 'Quantity_Line');
  await until('Zelle gewählt', () => [...probe.received].reverse().find(m => m.type === 'state' && /Table cell|Tabellenzelle/.test((m.state as { status: string }).status)));
  const run = async (cmd: string, check: () => boolean, what: string) => {
    await vscode.commands.executeCommand(`bcReportBuilder.${cmd}`, uri);
    await until(what, check);
  };
  await run('table.insertColumnRight', () => columns() === c0 + 1, 'Spalte eingefügt');
  await run('table.insertRowBelow', () => rows() === r0 + 1, 'Zeile eingefügt');
  await run('table.addGroupFooter', () => rows() === r0 + 2, 'Gruppenfuß');
  assert.equal(groups(), g0, 'Detailgruppe: Fußzeile außerhalb, keine neue Gruppe');
  for (let i = 0; i < 3; i++) await vscode.commands.executeCommand('undo');
  await until('alles rückgängig', () => (vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString())?.getText() ?? '') === original);
  assert.deepEqual(errorsOf(probe), []);
});

test('Lokalisierung: Extension, Webview und Manifest in der Sprache von VS Code', async api => {
  // BC_RB_TEST_LANGUAGE=de BC_RB_ONLY=Lokalisierung npm run test:vscode checks the German bundle end to end
  const language = process.env.BC_RB_TEST_LANGUAGE || vscode.env.language;
  const german = language.startsWith('de');
  console.log(`      (Sprache: ${language})`);
  // extension host: a message from the bundle
  const al = await vscode.workspace.openTextDocument(file('src/Verkaufsrechnung.Report.al'));
  let titles: string[] = [];
  await until('CodeLens', async () => {
    titles = ((await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', al.uri)) ?? []).map(l => l.command?.title ?? '');
    return titles.length > 0;
  });
  assert.ok(titles.some(t => t.includes(german ? 'im Designer öffnen' : 'in the Designer')), titles.join(' | '));
  // webview: the translations reach it (status of the insert tool)
  const { uri, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  await vscode.commands.executeCommand('bcReportBuilder.insert.textbox', uri);
  const state = await until('Status', () => [...probe.received].reverse().find(m => m.type === 'state' && (m.state as { status: string }).status));
  assert.match((state.state as { status: string }).status, german ? /Textfeld: klicken oder Rahmen ziehen/ : /Textbox: click or drag a frame/);
  // manifest: command title
  const pkg = vscode.extensions.all.find(e => e.packageJSON.name === 'bc-report-builder')!.packageJSON;
  assert.equal(pkg.l10n, './l10n');
});


let domRequest = 0;
async function domAction(api: Api, uri: vscode.Uri, probe: EditorProbe, selector: string, action = 'read', value?: string) {
  const id = ++domRequest;
  await probe.send({ type: 'testDom', id, selector, action, value });
  const reply = await until('DOM: ' + selector, () => probe.received.find(m => m.type === 'testDomResult' && m.id === id));
  assert.ok(!reply.error, String(reply.error));
  return reply;
}

test('Dialoge: Fokus, Tab-Grenzen, Escape und unverändertes Dokument beim Abbrechen', async api => {
  const { uri, doc, probe } = await open(api, 'Umsatzbericht.rdl');
  const original = doc.getText();
  const trigger = '.toolbar .action-group:first-child .action-item:last-child';
  await domAction(api, uri, probe, trigger, 'click');
  assert.equal((await domAction(api, uri, probe, '.modal')).focusInside, true, 'Diagrammdialog übernimmt den Fokus');
  for (const command of ['insert.chart', 'insert.matrix', 'reportProperties']) {
    if (command !== 'insert.chart') await vscode.commands.executeCommand(`bcReportBuilder.${command}`, uri);
    for (const shortcut of ['Meta+v', 'Control+v', 'Meta+c', 'Control+x']) {
      const keyboard = await domAction(api, uri, probe, '.modal-body input', 'keydown', shortcut);
      assert.equal(keyboard.propagated, true, command + ': Zwischenablage-Tastenkürzel erreicht VS Code');
      assert.equal(keyboard.defaultPrevented, false);
    }
    const first = '.modal-title button';
    const last = '.modal-footer button:not(.primary)';
    await domAction(api, uri, probe, last, 'focus');
    assert.equal((await domAction(api, uri, probe, last, 'keydown', 'Tab')).defaultPrevented, true, command);
    assert.equal((await domAction(api, uri, probe, first)).focused, true, command + ': Tab bleibt im Dialog');
    await domAction(api, uri, probe, first, 'keydown', 'Shift+Tab');
    assert.equal((await domAction(api, uri, probe, last)).focused, true, command + ': Shift-Tab bleibt im Dialog');
    const closed = await domAction(api, uri, probe, '.modal', 'keydown', 'Escape');
    assert.equal(closed.count, 0, command + ': Escape schließt');
    assert.equal(doc.getText(), original, command + ': Abbrechen ändert nichts');
  }
  assert.equal((await domAction(api, uri, probe, trigger)).focused, true, 'Fokus kehrt zum Auslöser zurück');
  assert.deepEqual(errorsOf(probe), []);
});

test('Diagramm und Matrix: validierte Dialogeingaben, Einfügen und Vorschau', async api => {
  const { uri, doc, probe } = await open(api, 'Umsatzbericht.rdl');
  await vscode.commands.executeCommand('bcReportBuilder.insert.chart', uri);
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, '.modal-body > .form-row > .expr-prop .field-pick', 'input', 'Region');
  await domAction(api, uri, probe, '.list-editor .list-row .field-pick', 'input', 'Umsatz');
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, false);
  await domAction(api, uri, probe, '.series-name', 'input', 'Umsatz & Erlös');
  await domAction(api, uri, probe, '.series-extra select', 'input', 'MovingAverage');
  await domAction(api, uri, probe, '.series-extra input[type="number"]', 'input', '0');
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, '.series-extra input[type="number"]', 'input', '3');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Diagramm eingefügt', () => doc.getText().includes('<Chart Name='));
  assert.doesNotMatch(String((await domAction(api, uri, probe, '.props-pane .pane-description')).text), /not editable|Nicht editierbares/);
  assert.match(doc.getText(), /Umsatz &amp; Erlös/);
  assert.match(doc.getText(), /MovingAverage/);
  await vscode.commands.executeCommand('bcReportBuilder.insert.matrix', uri);
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(2) .field-pick', 'input', 'Region');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(3) .field-pick', 'input', 'Kunde');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(4) .field-pick', 'input', 'Umsatz');
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, false);
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Matrix eingefügt', () => (doc.getText().match(/<Tablix Name=/g) ?? []).length === 2);
  const previews = probe.received.filter(m => m.type === 'previewReady').length;
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  const preview = await until('Vorschau mit Diagramm und Matrix', () => probe.received.filter(m => m.type === 'previewReady')[previews]);
  assert.ok(Number(preview.pages) > 0);
  assert.equal(preview.errors, 0);
  assert.deepEqual(errorsOf(probe), []);
});

test('Ausdruckssuche: echte Dialogeingaben, Vorschau, Ersetzen und Rückgängig', async api => {
  const { uri, doc, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  const original = doc.getText();
  await vscode.commands.executeCommand('bcReportBuilder.findExpressions', uri);
  assert.equal((await domAction(api, uri, probe, '.expression-search input', 'keydown', 'Meta+v')).propagated, true);
  await domAction(api, uri, probe, '.expression-search select', 'input', 'uses');
  await domAction(api, uri, probe, '.expression-search .form-row:nth-child(2) select', 'input', 'Fields!UnitPrice_Line');
  assert.ok(Number((await domAction(api, uri, probe, '.expression-result')).count) > 0);
  await domAction(api, uri, probe, '.expression-search select', 'input', 'search');
  await domAction(api, uri, probe, '.expression-search input', 'input', 'Fields!UnitPrice_Line.Value');
  const found = await domAction(api, uri, probe, '.expression-result');
  assert.ok(Number(found.count) > 0);
  await domAction(api, uri, probe, '.expression-search .form-row:nth-child(3) input', 'input', 'Fields!LineAmount_Line.Value');
  const preview = await domAction(api, uri, probe, '.replacement-preview');
  assert.match(String(preview.text), /Fields!LineAmount_Line.Value/);
  await domAction(api, uri, probe, '.expression-search .modal-footer .primary', 'click');
  await until('Ersetzungen geschrieben', () => !doc.getText().includes('Fields!UnitPrice_Line.Value'));
  await domAction(api, uri, probe, '.expression-search .modal-footer button:last-child', 'click');
  await vscode.commands.executeCommand('undo');
  await until('Sammelersetzung rückgängig', () => doc.getText() === original);
  assert.deepEqual(errorsOf(probe), []);
});

test('Bausteine: Datei laden, echte Dialogbestätigung und gemeinsames Rückgängig', async api => {
  const { uri, doc, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  const original = doc.getText();
  const { parseRdl, serializeRdl } = await import('../../webview/rdl');
  const { createBlock } = await import('../../webview/blocks');
  const { DOMParser, XMLSerializer } = await import('@xmldom/xmldom');
  const dom = {
    parse: (xml: string) => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
    serialize: (node: Node) => new XMLSerializer().serializeToString(node as never),
  };
  const source = parseRdl(original, dom);
  const block = createBlock(source, [source.body.items[0].name], dom);
  const temporary = file('Abnahme-Baustein.rdlc');
  await vscode.workspace.fs.writeFile(temporary, new TextEncoder().encode(serializeRdl(block)));
  const w = vscode.window as unknown as Record<string, unknown>;
  const originalOpen = w.showOpenDialog;
  w.showOpenDialog = async () => [temporary];
  try {
    await withAnswers({ pick: [['Import Block from File…']] }, async () => {
      await probe.deliver({ type: 'pickBlock' });
    });
    await domAction(api, uri, probe, '.block-dialog');
    assert.equal((await domAction(api, uri, probe, '.block-dialog input', 'keydown', 'Meta+v')).propagated, true);
    await domAction(api, uri, probe, '.block-dialog .modal-footer .primary', 'click');
    await until('Baustein eingefügt', () => doc.getText() !== original);
    const result = parseRdl(doc.getText(), dom);
    assert.equal(result.body.items.length, source.body.items.length + 1);
    assert.notEqual(result.body.items.at(-1)!.name, source.body.items[0].name);
    assert.equal(result.dataSets.length, source.dataSets.length);
    await vscode.commands.executeCommand('undo');
    await until('Baustein rückgängig', () => doc.getText() === original);
    assert.deepEqual(errorsOf(probe), []);
  } finally {
    w.showOpenDialog = originalOpen;
    await vscode.workspace.fs.delete(temporary);
  }
});

const uiDom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};

test('Abnahme: Zwischenablage zwischen Berichten mit Bildern, Code, Verweisen und Undo', async api => {
  const { emptyReport } = await import('../../webview/model');
  const { createItem } = await import('../../webview/ops');
  const { addEmbeddedImage, embeddedImages } = await import('../../webview/images');
  const source = emptyReport();
  const group = createItem(source, 'rectangle', { top: 1, left: .5, width: 3, height: 1 });
  assert.equal(group.type, 'rectangle');
  if (group.type !== 'rectangle') return;
  group.name = 'ClipboardGroup';
  const a = createItem(source, 'textbox', { top: 0, left: 0, width: 1, height: .3 });
  const b = createItem(source, 'textbox', { top: .4, left: 0, width: 1, height: .3 });
  assert.equal(a.type, 'textbox'); assert.equal(b.type, 'textbox');
  if (a.type !== 'textbox' || b.type !== 'textbox') return;
  a.name = 'ClipboardA'; a.value = 'Clipboard sample';
  b.name = 'ClipboardB'; b.value = '=Code.Echo(ReportItems!ClipboardA.Value)';
  const image = createItem(source, 'image', { top: 0, left: 1.2, width: .5, height: .5 });
  assert.equal(image.type, 'image');
  if (image.type !== 'image') return;
  image.source = 'Embedded'; image.value = 'ClipboardLogo';
  group.items.push(a, b, image); source.body.items.push(group);
  source.extraXml.push('<Code>Public Function Echo(v As Object) As Object\nReturn v\nEnd Function</Code>');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  addEmbeddedImage(source, 'ClipboardLogo', 'image/png', png);
  await vscode.workspace.fs.writeFile(file('ClipboardSource.rdl'), Buffer.from(serializeRdl(source)));
  await vscode.workspace.fs.writeFile(file('ClipboardTarget.rdl'), Buffer.from(serializeRdl(emptyReport())));
  const target = await open(api, 'ClipboardTarget.rdl');
  await vscode.commands.executeCommand('workbench.action.keepEditor');
  const before = target.doc.getText();
  const from = await open(api, 'ClipboardSource.rdl');
  await selectUi(api, from.uri, from.probe, group.name);
  await vscode.commands.executeCommand('bcReportBuilder.copy', from.uri);
  await until('Zwischenablage an anderen Designer', () => target.probe.posted.some(m => m.type === 'clipboard' && m.value));
  await vscode.commands.executeCommand('vscode.open', target.uri);
  for (let n = 1; n <= 2; n++) {
    await vscode.commands.executeCommand('bcReportBuilder.paste', target.uri);
    await until(`Kopie ${n}`, () => parseRdl(target.doc.getText(), uiDom).body.items.length === n);
  }
  const pasted = parseRdl(target.doc.getText(), uiDom);
  assert.equal(embeddedImages(pasted).length, 1);
  assert.match(target.doc.getText(), /ReportItems!ClipboardA_2\.Value/);
  assert.ok(target.doc.getText().includes('<Code>'));
  assert.equal(pasted.body.items[0].top, 1.125);
  const names = allReportItems(pasted).map(i => i.name);
  assert.equal(new Set(names).size, names.length);
  await vscode.commands.executeCommand('undo');
  await until('Zweite Kopie rückgängig', () => parseRdl(target.doc.getText(), uiDom).body.items.length === 1);
  await vscode.commands.executeCommand('undo');
  await until('Bilder und Code gemeinsam rückgängig', () => target.doc.getText() === before);
  assert.deepEqual(errorsOf(target.probe), []);
  // Newly opened designers receive the clipboard too; conflicts must leave the whole document unchanged.
  const conflict = emptyReport();
  addEmbeddedImage(conflict, 'ClipboardLogo', 'image/png', 'different');
  await vscode.workspace.fs.writeFile(file('ClipboardConflict.rdl'), Buffer.from(serializeRdl(conflict)));
  const conflicting = await open(api, 'ClipboardConflict.rdl');
  const unchanged = conflicting.doc.getText();
  await vscode.commands.executeCommand('bcReportBuilder.paste', conflicting.uri);
  await until('Bildkonflikt gemeldet', () => errorsOf(conflicting.probe).length === 1);
  assert.equal(conflicting.doc.getText(), unchanged);
});

test('Abnahme: Defekte Bilder ablehnen, Größenwarnung abbrechen und bestätigen', async api => {
  const { uri, doc, probe } = await openUi(api);
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const originalOpen = windowApi.showOpenDialog, originalWarning = windowApi.showWarningMessage;
  await vscode.commands.executeCommand('bcReportBuilder.toggleReportData', uri);
  const original = doc.getText();
  try {
    const bad = [
      ['Broken.png', Buffer.from('not a PNG')],
      ['Truncated.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64')],
      ['Broken.svg', Buffer.from('<svg><broken')],
    ] as const;
    for (const [name, bytes] of bad) {
      const image = file(name);
      await vscode.workspace.fs.writeFile(image, bytes);
      windowApi.showOpenDialog = async () => [image];
      const errors = errorsOf(probe).length;
      await domAction(api, uri, probe, '.tree-group:last-child .tree-group-head button', 'click');
      await until(`Fehler für ${name}`, () => errorsOf(probe).length === errors + 1);
      assert.equal(doc.getText(), original, 'ungültiges Bild ändert nichts');
    }
    await assert.rejects(async () => vscode.lm.invokeTool('bcReport_insertItems', {
      input: { file: uri.fsPath, items: [{ type: 'image', name: 'InvalidToolImage', imageFile: file('Broken.png').fsPath }] },
      toolInvocationToken: undefined,
    }));
    assert.equal(doc.getText(), original, 'auch das KI-Werkzeug lehnt defekte Bilder vor der Änderung ab');
    const image = file('Large.svg');
    await vscode.workspace.fs.writeFile(image, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/><!--' + 'x'.repeat(2 * 1024 * 1024) + '--></svg>'));
    windowApi.showOpenDialog = async () => [image];
    let warnings = 0;
    windowApi.showWarningMessage = async () => { warnings++; return undefined; };
    await domAction(api, uri, probe, '.tree-group:last-child .tree-group-head button', 'click');
    await until('Größenwarnung', () => warnings === 1);
    assert.equal(doc.getText(), original);
    windowApi.showWarningMessage = async (_message: string, action: string) => { warnings++; return action; };
    await domAction(api, uri, probe, '.tree-group:last-child .tree-group-head button', 'click');
    await until('Großes Bild eingebettet', () => doc.getText().includes('<EmbeddedImage Name="Large">'));
    assert.equal(warnings, 2);
    await vscode.commands.executeCommand('undo');
    await until('Bildimport rückgängig', () => doc.getText() === original);
  } finally {
    windowApi.showOpenDialog = originalOpen;
    windowApi.showWarningMessage = originalWarning;
  }
});

test('Abnahme: Ausdruckssuche mit Stil und Gruppe, Großschreibung, Einzelersetzung, Sammel-Undo und Navigation', async api => {
  const bytes = await vscode.workspace.fs.readFile(file('Umsatzbericht.rdl'));
  const xml = new TextDecoder().decode(bytes)
    .replace('<Group Name="Details" />', '<Group Name="Details"><GroupExpressions><GroupExpression>=Fields!Umsatz.Value</GroupExpression></GroupExpressions></Group>')
    .replace('<Value>Umsatz</Value>', '<Value>Fields!Umsatz.Value</Value>');
  await vscode.workspace.fs.writeFile(file('SearchAcceptance.rdl'), Buffer.from(xml));
  let { uri, doc, probe } = await open(api, 'SearchAcceptance.rdl');
  const original = doc.getText();
  const dialog = '.expression-search';
  await vscode.commands.executeCommand('bcReportBuilder.findExpressions', uri);
  const query = dialog + ' .form-row:nth-child(2) input';
  const replacement = dialog + ' .form-row:nth-child(3) input';
  await domAction(api, uri, probe, query, 'input', 'fields!umsatz.value');
  const matches = Number((await domAction(api, uri, probe, '.expression-result')).count);
  assert.ok(matches >= 4);
  const rows = String((await domAction(api, uri, probe, '.expression-results')).text);
  assert.match(rows, /GroupExpression/); assert.match(rows, /Color/); assert.match(rows, /Value/);
  await domAction(api, uri, probe, dialog + ' input[type="checkbox"]', 'click');
  assert.equal((await domAction(api, uri, probe, '.expression-results')).text, '');
  await domAction(api, uri, probe, query, 'input', 'Fields!Umsatz.Value');
  await domAction(api, uri, probe, replacement, 'input', 'Fields!');
  assert.equal((await domAction(api, uri, probe, dialog + ' .primary')).disabled, true);
  await domAction(api, uri, probe, replacement, 'input', 'Fields!Menge.Value');
  await domAction(api, uri, probe, '.expression-result button:last-child', 'click');
  await until('Einzelersetzung', async () => Number((await domAction(api, uri, probe, '.expression-result')).count) === matches - 1);
  const one = doc.getText();
  await domAction(api, uri, probe, dialog + ' .primary', 'click');
  await until('Sammelersetzung', () => doc.getText() !== one);
  assert.ok(doc.getText().includes('<Value>Fields!Umsatz.Value</Value>'), 'fester Text bleibt unverändert');
  await domAction(api, uri, probe, dialog, 'keydown', 'Escape');
  await vscode.commands.executeCommand('undo');
  await until('Nur Sammelersetzung rückgängig', () => doc.getText() === one);
  await vscode.commands.executeCommand('redo');
  await until('Sammelersetzung wiederholt', () => doc.getText() !== one);
  await vscode.commands.executeCommand('undo');
  await until('Sammelersetzung erneut rückgängig', () => doc.getText() === one);
  await vscode.commands.executeCommand('undo');
  await until('Einzelersetzung rückgängig', () => doc.getText() === original);
  await doc.save();
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await until('Ausdruckssuche-Designer geschlossen', () => !api.probes.has(uri.toString()));
  ({ uri, doc, probe } = await open(api, 'SearchAcceptance.rdl'));
  assert.equal(doc.getText(), original, 'nach Speichern und erneutem Öffnen unverändert');
  await vscode.commands.executeCommand('bcReportBuilder.findExpressions', uri);
  await domAction(api, uri, probe, dialog + ' select', 'input', 'uses');
  await domAction(api, uri, probe, dialog + ' .form-row:nth-child(2) select', 'input', 'Parameters!Jahr');
  assert.ok(Number((await domAction(api, uri, probe, '.expression-result')).count) > 0);
  await domAction(api, uri, probe, '.expression-result button', 'click');
  await until('Navigation zum Titel', () => [...probe.received].reverse().some(m => m.type === 'state' && String((m.state as { status: string }).status).includes('Titel')));
  assert.deepEqual(errorsOf(probe), []);
});

test('Abnahme: Bausteindialog sperrt fehlende Abhängigkeiten und verwirft Bild-/Codekonflikte atomar', async api => {
  const { emptyReport } = await import('../../webview/model');
  const { createItem } = await import('../../webview/ops');
  const { addEmbeddedImage } = await import('../../webview/images');
  const target = emptyReport();
  addEmbeddedImage(target, 'SharedLogo', 'image/png', 'target');
  target.extraXml.push('<Code>Public Shared Value As Integer = 1</Code>');
  await vscode.workspace.fs.writeFile(file('BlockAcceptance.rdl'), Buffer.from(serializeRdl(target)));
  const { uri, doc, probe } = await open(api, 'BlockAcceptance.rdl');
  const original = doc.getText();
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const originalOpen = windowApi.showOpenDialog, originalPick = windowApi.showQuickPick;
  const blockUri = file('AcceptanceBlock.rdlc');
  const load = async (report: ReturnType<typeof emptyReport>) => {
    await vscode.workspace.fs.writeFile(blockUri, Buffer.from(serializeRdl(report)));
    await vscode.commands.executeCommand('bcReportBuilder.insertBlock', uri);
    await domAction(api, uri, probe, '.block-dialog');
  };
  windowApi.showOpenDialog = async () => [blockUri];
  windowApi.showQuickPick = async (items: unknown[]) => items[0];
  try {
    const source = emptyReport();
    const box = createItem(source, 'textbox', { top: 0, left: 0, width: 1, height: .3 });
    assert.equal(box.type, 'textbox'); if (box.type !== 'textbox') return;
    box.value = '=Fields!Missing.Value & Parameters!MissingLabel.Value';
    source.body.items.push(box);
    await load(source);
    assert.equal((await domAction(api, uri, probe, '.block-dialog .primary')).disabled, true);
    assert.match(String((await domAction(api, uri, probe, '.block-dialog ul')).text), /Fields!Missing.*Parameters!MissingLabel/);
    await domAction(api, uri, probe, '.block-dialog select', 'input', 'header');
    await domAction(api, uri, probe, '.block-dialog input[type="checkbox"]', 'click');
    await domAction(api, uri, probe, '.block-dialog .primary', 'click');
    await until('Neuer Seitenkopf mit Baustein', () => !!parseRdl(doc.getText(), uiDom).header?.items.length);
    await vscode.commands.executeCommand('undo');
    await until('Seitenkopf gemeinsam rückgängig', () => doc.getText() === original);
    for (const kind of ['image', 'code']) {
      const block = emptyReport();
      const item = createItem(block, kind === 'image' ? 'image' : 'textbox', { top: 0, left: 0, width: 1, height: .3 });
      if (item.type === 'image') { item.source = 'Embedded'; item.value = 'SharedLogo'; addEmbeddedImage(block, 'SharedLogo', 'image/png', 'source'); }
      if (item.type === 'textbox') { item.value = '=Code.Value'; block.extraXml.push('<Code>Public Shared Value As Integer = 2</Code>'); }
      block.body.items.push(item);
      await load(block);
      await domAction(api, uri, probe, '.block-dialog .primary', 'click');
      assert.ok(String((await domAction(api, uri, probe, '.block-dialog [role="alert"]')).text).length > 0);
      assert.equal(doc.getText(), original, kind + ': keine Teiländerung');
      await domAction(api, uri, probe, '.block-dialog', 'keydown', 'Escape');
    }
  } finally { windowApi.showOpenDialog = originalOpen; windowApi.showQuickPick = originalPick; }
});

test('Abnahme: Container-Umbrüche, zusammenfallende Umbrüche, stabile Schriften und sofortiger PDF-Export', async api => {
  const { emptyReport } = await import('../../webview/model');
  const { createItem, createTable } = await import('../../webview/ops');
  const { PDFDocument } = await import('pdf-lib');
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const originalSave = windowApi.showSaveDialog, originalInfo = windowApi.showInformationMessage;
  windowApi.showInformationMessage = async () => undefined;
  try {
    for (const [location, expected, nested] of [['Start', 2, false], ['End', 2, false], ['StartAndEnd', 3, false], ['End', 2, true]] as const) {
      const report = emptyReport();
      report.width = 3.5;
      report.page = { width: 4, height: 4, marginTop: .25, marginBottom: .25, marginLeft: .25, marginRight: .25, extra: [] };
      const textbox = (name: string, value: string, top: number, font: string) => {
        const item = createItem(report, 'textbox', { top, left: 0, width: 3, height: .3 });
        assert.equal(item.type, 'textbox');
        if (item.type !== 'textbox') throw new Error('textbox expected');
        item.name = name; item.value = value; item.style.FontFamily = font; item.style.FontSize = '10pt';
        return item;
      };
      report.body.items.push(textbox('BeforeBreak', 'Vor dem Umbruch – ÄÖÜ', 0, 'Arial'));
      const container = createItem(report, 'rectangle', { top: .4, left: 0, width: 3, height: .4 });
      assert.equal(container.type, 'rectangle'); if (container.type !== 'rectangle') return;
      container.name = 'BreakContainer';
      container.extra = [`<PageBreak><BreakLocation>${location}</BreakLocation></PageBreak>`];
      const middle = textbox('InsideBreak', 'Container mit zweiter Schrift', 0, 'Georgia');
      if (nested) {
        const inner = createItem(report, 'rectangle', { top: 0, left: 0, width: 3, height: .4 });
        assert.equal(inner.type, 'rectangle'); if (inner.type !== 'rectangle') return;
        inner.name = 'InnerBreak'; inner.items.push(middle);
        inner.extra = ['<PageBreak><BreakLocation>End</BreakLocation><ResetPageNumber>true</ResetPageNumber></PageBreak>'];
        container.items.push(inner);
      } else container.items.push(middle);
      report.body.items.push(container, textbox('AfterBreak', 'Nach dem Umbruch', .9, 'Arial'));
      report.body.height = 1.2;
      report.footer = { height: .3, style: {}, items: [textbox('PageNumber', '="PAGE " & Globals!PageNumber', 0, 'Consolas')] };
      const name = `BreakAcceptance-${location}-${nested}.rdl`;
      const uri = file(name);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeRdl(report)));
      const opened = await open(api, name);
      const preview = async () => {
        const count = opened.probe.received.length;
        await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
        const ready = await until('Vorschau mit Umbruch ' + name, () => opened.probe.received.slice(count).find(m => m.type === 'previewReady'));
        assert.equal(ready.pages, expected, name);
        assert.equal(ready.errors, 0);
      };
      await preview();
      const pdfUri = file(name + '.pdf');
      windowApi.showSaveDialog = async () => pdfUri;
      await vscode.commands.executeCommand('bcReportBuilder.exportPdf', uri);
      const bytes = await until('PDF mit Umbruch', async () => vscode.workspace.fs.readFile(pdfUri).then(b => b.length ? b : undefined, () => undefined), 60000);
      assert.equal((await PDFDocument.load(bytes)).getPageCount(), expected, 'PDF und Vorschau stimmen überein');
      if (nested) assert.match(String((await domAction(api, uri, opened.probe, '.rv-page:last-child')).text), /PAGE 1/);
      for (let n = 0; n < 2; n++) {
        await vscode.commands.executeCommand('bcReportBuilder.showDesign', uri);
        await preview();
      }
      assert.deepEqual(errorsOf(opened.probe), []);
    }
    for (const location of ['Start', 'End', 'StartAndEnd']) {
      const report = emptyReport();
      report.width = 3;
      report.page = { width: 4, height: 4, marginTop: .25, marginBottom: .25, marginLeft: .25, marginRight: .25, extra: [] };
      report.dataSets.push({ id: 'acceptance', name: 'AcceptanceData', dataSourceName: '', commandText: '', fields: [{ name: 'Text', dataField: 'Text', typeName: 'System.String' }], extra: [], queryExtra: [] });
      for (const [name, top] of [['BeforeTable', 0], ['AfterTable', 1.2]] as const) {
        const item = createItem(report, 'textbox', { top, left: 0, width: 3, height: .3 });
        assert.equal(item.type, 'textbox'); if (item.type !== 'textbox') return;
        item.name = name; item.value = name; report.body.items.push(item);
      }
      const table = createTable(report, { top: .4, left: 0, width: 3 }, 1, 'AcceptanceData', ['Text']);
      table.extra = [`<PageBreak><BreakLocation>${location}</BreakLocation></PageBreak>`];
      report.body.items.push(table); report.body.height = 1.5;
      const name = `TableBreakAcceptance-${location}.rdl`;
      await vscode.workspace.fs.writeFile(file(name), Buffer.from(serializeRdl(report)));
      await vscode.workspace.fs.writeFile(file(name.replace('.rdl', '.data.json')), Buffer.from(JSON.stringify({ AcceptanceData: [{ Text: 'TABELLENINHALT' }] })));
      const opened = await open(api, name);
      await until('Tabellendaten geladen', () => opened.probe.posted.some(m => m.type === 'sampleData' && Object.keys(m.data as object).length > 0));
      await vscode.commands.executeCommand('bcReportBuilder.showPreview', opened.uri);
      const ready = await until('Tabellenumbruch ' + location, () => opened.probe.received.find(m => m.type === 'previewReady'));
      assert.equal(ready.pages, location === 'StartAndEnd' ? 3 : 2);
      assert.equal(ready.errors, 0);
      const pdfUri = file(name + '.pdf');
      windowApi.showSaveDialog = async () => pdfUri;
      await vscode.commands.executeCommand('bcReportBuilder.exportPdf', opened.uri);
      const bytes = await until('PDF mit Tabellenumbruch', async () => vscode.workspace.fs.readFile(pdfUri).then(b => b.length ? b : undefined, () => undefined), 60000);
      assert.equal((await PDFDocument.load(bytes)).getPageCount(), ready.pages);
      assert.deepEqual(errorsOf(opened.probe), []);
    }
    const flowing = emptyReport();
    flowing.width = 3;
    flowing.page = { width: 4, height: 4, marginTop: .25, marginBottom: .25, marginLeft: .25, marginRight: .25, extra: [] };
    for (const [index, font] of ['Arial', 'Georgia'].entries()) {
      const item = createItem(flowing, 'textbox', { top: index * .4, left: 0, width: 3, height: .3 });
      assert.equal(item.type, 'textbox'); if (item.type !== 'textbox') return;
      item.name = `LongText${index}`; item.canGrow = true;
      item.value = 'Langer Text mit Umlauten ÄÖÜ und wechselnden Schriften. '.repeat(50);
      item.style.FontFamily = font; item.style.FontSize = '12pt'; flowing.body.items.push(item);
    }
    flowing.body.height = .8;
    await vscode.workspace.fs.writeFile(file('LongTextAcceptance.rdl'), Buffer.from(serializeRdl(flowing)));
    const long = await open(api, 'LongTextAcceptance.rdl');
    let expectedPages = 0;
    for (let n = 0; n < 3; n++) {
      const count = long.probe.received.length;
      await vscode.commands.executeCommand('bcReportBuilder.showPreview', long.uri);
      const ready = await until('Langer Text nach Laden der Schriften', () => long.probe.received.slice(count).find(m => m.type === 'previewReady'));
      assert.equal(ready.errors, 0);
      if (!n) { expectedPages = Number(ready.pages); assert.ok(expectedPages > 1); }
      else assert.equal(ready.pages, expectedPages, 'Schriftladen verändert die Seitenaufteilung nicht');
      if (n < 2) await vscode.commands.executeCommand('bcReportBuilder.showDesign', long.uri);
    }
    const longPdf = file('LongTextAcceptance.pdf');
    windowApi.showSaveDialog = async () => longPdf;
    await vscode.commands.executeCommand('bcReportBuilder.exportPdf', long.uri);
    const longBytes = await until('PDF mit langen Texten', async () => vscode.workspace.fs.readFile(longPdf).then(b => b.length ? b : undefined, () => undefined), 60000);
    assert.equal((await PDFDocument.load(longBytes)).getPageCount(), expectedPages);
    assert.deepEqual(errorsOf(long.probe), []);
  } finally { windowApi.showSaveDialog = originalSave; windowApi.showInformationMessage = originalInfo; }
});

test('Abnahme: Bookmark springt auf eine andere Seite und fehlendes Ziel meldet einen Hinweis', async api => {
  const { emptyReport } = await import('../../webview/model');
  const { createItem } = await import('../../webview/ops');
  const report = emptyReport();
  report.width = 3; report.page.width = 4; report.page.height = 8;
  report.page.marginTop = report.page.marginBottom = report.page.marginLeft = report.page.marginRight = .25;
  const source = createItem(report, 'textbox', { top: 0, left: 0, width: 2, height: .3 });
  assert.equal(source.type, 'textbox'); if (source.type !== 'textbox') return;
  source.name = 'BookmarkSource'; source.value = 'Go to page two';
  source.extra = ['<ActionInfo><Actions><Action><BookmarkLink>FarTarget</BookmarkLink></Action></Actions></ActionInfo>'];
  report.body.items.push(source);
  const container = createItem(report, 'rectangle', { top: .5, left: 0, width: 3, height: .5 });
  assert.equal(container.type, 'rectangle'); if (container.type !== 'rectangle') return;
  container.extra = ['<PageBreak><BreakLocation>Start</BreakLocation></PageBreak>'];
  const target = createItem(report, 'textbox', { top: 0, left: 0, width: 2, height: .3 });
  assert.equal(target.type, 'textbox'); if (target.type !== 'textbox') return;
  target.name = 'BookmarkTarget'; target.value = 'TARGET PAGE'; target.extra = ['<Bookmark>FarTarget</Bookmark>'];
  container.items.push(target); report.body.items.push(container); report.body.height = 1;
  await vscode.workspace.fs.writeFile(file('BookmarkAcceptance.rdl'), Buffer.from(serializeRdl(report)));
  const { uri, doc, probe } = await open(api, 'BookmarkAcceptance.rdl');
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  const ready = await until('Zwei Bookmark-Seiten', () => probe.received.find(m => m.type === 'previewReady'));
  assert.equal(ready.pages, 2);
  await domAction(api, uri, probe, '.rv-page:first-child [data-action]', 'click');
  await until('Bookmark scrollt zu Seite 2', async () => String((await domAction(api, uri, probe, '.page-indicator')).text).trim() === '2 / 2');
  await vscode.commands.executeCommand('bcReportBuilder.showDesign', uri);
  await selectUi(api, uri, probe, source.name);
  const value = '.props-pane .prop-row:has(select option[value="hyperlink"]) + .prop-row input';
  await domAction(api, uri, probe, value, 'input', 'MissingTarget');
  await domAction(api, uri, probe, value, 'keydown', 'Enter');
  await until('Fehlendes Ziel geschrieben', () => doc.getText().includes('<BookmarkLink>MissingTarget</BookmarkLink>'));
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await domAction(api, uri, probe, '.rv-page:first-child [data-action]', 'click');
  await until('Fehlendes Bookmark gemeldet', () => probe.received.some(m => m.type === 'info' && String(m.message).includes('MissingTarget')));
  assert.deepEqual(errorsOf(probe), []);
});

test('Abnahme: Gruppen-Endumbruch inklusive letzter Gruppe, bedingte Umbrüche und Tabellen-Endumbruch', async api => {
  const { createItem } = await import('../../webview/ops');
  const original = new TextDecoder().decode(await vscode.workspace.fs.readFile(file('Verkaufsrechnung.rdlc')));
  const header = (no: string, paid: boolean) => ({ CompanyName: 'CRONUS AG', No_SalesInvHdr: no, DocDate_SalesInvHdr: '2026-01-31', Paid: paid });
  const data = { DataSet_Result: [
    { ...header('103001', false), LineNo_Line: 0 },
    { ...header('103001', false), LineNo_Line: 10000, Description_Line: 'Tisch', Quantity_Line: 1, UnitPrice_Line: 650, LineAmount_Line: 650 },
    { ...header('103002', true), LineNo_Line: 0 },
    { ...header('103002', true), LineNo_Line: 10000, Description_Line: 'Lampe', Quantity_Line: 2, UnitPrice_Line: 45.5, LineAmount_Line: 91 },
  ] };
  for (const conditional of [false, true]) {
    let xml = original.replace('<BreakLocation>Between</BreakLocation>', '<BreakLocation>End</BreakLocation>' + (conditional ? '<Disabled>=Fields!Paid.Value</Disabled>' : ''))
      .replace('<ResetPageNumber>true</ResetPageNumber>', '<ResetPageNumber>=Not Fields!Paid.Value</ResetPageNumber>');
    if (!conditional) xml = xml.replace('<Tablix Name="Table_Document">', '<Tablix Name="Table_Document"><PageBreak><BreakLocation>End</BreakLocation></PageBreak>');
    const report = parseRdl(xml, uiDom);
    const tail = createItem(report, 'textbox', { top: 2, left: 0, width: 2, height: .3 });
    assert.equal(tail.type, 'textbox'); if (tail.type !== 'textbox') return;
    tail.name = 'AfterLastGroup'; tail.value = '="AFTER LAST GROUP TOTAL " & Sum(Fields!LineAmount_Line.Value, "DataSet_Result")'; report.body.items.push(tail); report.body.height = 2.3;
    const name = `GroupAcceptance-${conditional}.rdlc`;
    await vscode.workspace.fs.writeFile(file(name), Buffer.from(serializeRdl(report)));
    await vscode.workspace.fs.writeFile(file(name.replace('.rdlc', '.data.json')), Buffer.from(JSON.stringify(data)));
    const { uri, probe } = await open(api, name);
    await until('Gruppendaten geladen', () => probe.posted.some(m => m.type === 'sampleData' && Object.keys(m.data as object).length > 0));
    await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
    const ready = await until('Gruppen mit Endumbruch', () => probe.received.find(m => m.type === 'previewReady'));
    assert.equal(ready.pages, conditional ? 2 : 3, 'letzte Gruppe trennt Nachfolgeinhalt ab, zusammenfallender Tabellenumbruch erzeugt keine Leerseite');
    assert.equal(ready.errors, 0);
    assert.match(String((await domAction(api, uri, probe, '.rv-page:first-child')).text), /650,00|650\.00/);
    for (let n = 1; n < Number(ready.pages); n++) {
      await domAction(api, uri, probe, '.preview .toolbar button:has(.codicon-arrow-down)', 'click');
      await until('Gruppenseite ' + (n + 1), async () => String((await domAction(api, uri, probe, '.page-indicator')).text).startsWith(`${n + 1} /`));
    }
    const last = String((await domAction(api, uri, probe, '.rv-page:last-child')).text);
    assert.match(last, /AFTER LAST GROUP TOTAL 741/);
    assert.match(last, conditional ? /Seite 1/ : /Seite 2/, 'Reset-Ausdruck wird pro Gruppe ausgewertet');
    assert.deepEqual(errorsOf(probe), []);
  }
});

async function openUi(api: Api) {
  await vscode.workspace.fs.writeFile(file('UI-Abnahme.rdl'), await vscode.workspace.fs.readFile(file('Umsatzbericht.rdl')));
  return open(api, 'UI-Abnahme.rdl');
}

async function selectUi(api: Api, uri: vscode.Uri, probe: EditorProbe, name: string) {
  await domAction(api, uri, probe, '.left-pane .pane-header [role="tab"]:first-child', 'click');
  await domAction(api, uri, probe, '.outline button:has(.codicon-expand-all)', 'click');
  await domAction(api, uri, probe, `.outline [data-key="item:${name}"]`, 'click');
}

test('UI: Datenquelle anlegen, validieren, umbenennen, Referenzen aktualisieren und löschen', async api => {
  const { uri, doc, probe } = await openUi(api);
  await vscode.commands.executeCommand('bcReportBuilder.toggleReportData', uri);
  await domAction(api, uri, probe, '.tree-group:nth-child(3) .tree-group-head button', 'click');
  await domAction(api, uri, probe, '.modal-body .form-row input', 'input', '1 invalid');
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, '.modal-body .form-row input', 'input', 'TestSource');
  await domAction(api, uri, probe, '.modal-body textarea', 'input', 'Data Source=localhost;Initial Catalog=UI');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Datenquelle gespeichert', () => doc.getText().includes('Name="TestSource"'));
  await vscode.commands.executeCommand('bcReportBuilder.data.edit', { entryKind: 'dataSource', name: 'Vertrieb' });
  await domAction(api, uri, probe, '.modal-body .form-row input', 'input', 'TestSource');
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, '.modal-body .form-row input', 'input', 'SalesSource');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Datenquellenreferenz umbenannt', () => doc.getText().includes('<DataSourceName>SalesSource</DataSourceName>'));
  await vscode.commands.executeCommand('bcReportBuilder.data.delete', { entryKind: 'dataSource', name: 'TestSource' });
  await until('Datenquelle gelöscht', () => !doc.getText().includes('Name="TestSource"'));
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Dataset aus SQL ableiten, Feldtypen und berechnete Felder, Duplikate sperren', async api => {
  const { uri, doc, probe } = await openUi(api);
  await vscode.commands.executeCommand('bcReportBuilder.toggleReportData', uri);
  await domAction(api, uri, probe, '.tree-group:nth-child(4) .tree-group-head button', 'click');
  await domAction(api, uri, probe, '.modal-body .form-row input', 'input', 'UiData');
  await domAction(api, uri, probe, '.modal-body textarea', 'input', 'SELECT Customer, Amount FROM Sales');
  await domAction(api, uri, probe, '.modal-body .button-row button', 'click');
  assert.equal((await domAction(api, uri, probe, 'table.grid tbody tr')).count, 2);
  await domAction(api, uri, probe, 'table.grid tbody tr:nth-child(2) td:first-child input', 'input', 'Customer');
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, 'table.grid tbody tr:nth-child(2) td:first-child input', 'input', 'Amount');
  await domAction(api, uri, probe, 'table.grid tbody tr:nth-child(2) select', 'input', 'System.Decimal');
  await domAction(api, uri, probe, '.modal-body .button-row button:nth-child(2)', 'click');
  await domAction(api, uri, probe, 'table.grid tbody tr:nth-child(3) td:nth-child(2) input', 'input', '=Fields!Amount.Value * 2');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Dataset gespeichert', () => doc.getText().includes('<DataSet Name="UiData">'));
  const dataset = parseRdl(doc.getText(), uiDom).dataSets.find(dataset => dataset.name === 'UiData')!;
  assert.equal(dataset.fields[1].typeName, 'System.Decimal');
  assert.equal(dataset.fields[2].value, '=Fields!Amount.Value * 2');
  await vscode.commands.executeCommand('bcReportBuilder.data.delete', { entryKind: 'dataSet', name: 'UiData' });
  await until('Dataset gelöscht', () => !doc.getText().includes('<DataSet Name="UiData">'));
  await vscode.commands.executeCommand('bcReportBuilder.data.edit', { entryKind: 'dataSet', name: 'Umsaetze' });
  await domAction(api, uri, probe, '.modal-body .form-row input', 'input', 'UiSales');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Dataset umbenannt', () => doc.getText().includes('<DataSet Name="UiSales">'));
  assert.match(doc.getText(), /CountRows\("UiSales"\)/);
  assert.doesNotMatch(doc.getText(), /<DataSetName>Umsaetze<\/DataSetName>/);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Berichtsdaten per Tastatur öffnen und Enter in Auswahlfeldern bestätigt nicht den Dialog', async api => {
  const { uri, doc, probe } = await openUi(api);
  const original = doc.getText();
  await vscode.commands.executeCommand('bcReportBuilder.toggleReportData', uri);
  const header = '.tree-group:nth-child(3) .tree-group-head';
  await domAction(api, uri, probe, header, 'focus');
  assert.equal((await domAction(api, uri, probe, header)).focused, true);
  await domAction(api, uri, probe, `${header} button`, 'focus');
  assert.equal((await domAction(api, uri, probe, `${header} button`)).focused, true, 'Aktion ohne Maus fokussierbar');
  await domAction(api, uri, probe, `${header} button`, 'click');
  const selected = await domAction(api, uri, probe, '.modal-body select', 'keydown', 'Enter');
  assert.equal(selected.count, 1, 'Enter im Auswahlfeld schließt den Dialog nicht');
  await domAction(api, uri, probe, '.modal', 'keydown', 'Escape');
  assert.equal(doc.getText(), original);
});

test('UI: Parameter umbenennen aktualisiert auch Abfrageparameter und weitere Ausdrücke', async api => {
  const { uri, doc, probe } = await openUi(api);
  await vscode.commands.executeCommand('bcReportBuilder.toggleReportData', uri);
  await domAction(api, uri, probe, '.tree-group');
  await vscode.commands.executeCommand('bcReportBuilder.data.edit', { entryKind: 'parameter', name: 'Jahr' });
  await domAction(api, uri, probe, '.modal-body .form-row input', 'input', 'FiscalYear');
  await domAction(api, uri, probe, '.modal-body .form-row:nth-child(4) input', 'input', '2027');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Parameter umbenannt', () => doc.getText().includes('ReportParameter Name="FiscalYear"'));
  assert.doesNotMatch(doc.getText(), /Parameters!Jahr\b/);
  assert.match(doc.getText(), /<QueryParameter[^]*?Parameters!FiscalYear.Value/);
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await until('Parametervorschau', () => probe.received.find(message => message.type === 'previewReady'));
  assert.match(String((await domAction(api, uri, probe, '.rv-page')).text), /2027/);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Ausdruckseditor Syntaxfehler, Live-Ergebnis, Kategorien, Bestätigen und Abbrechen', async api => {
  const { uri, doc, probe } = await openUi(api);
  await selectUi(api, uri, probe, 'Titel');
  await vscode.commands.executeCommand('bcReportBuilder.editExpression', uri);
  await domAction(api, uri, probe, '.expr-editor', 'input', '=1 +');
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, '.expr-editor', 'input', '=1 + 2');
  assert.match(String((await domAction(api, uri, probe, '.expr-result')).text), /3/);
  await domAction(api, uri, probe, '.expr-cats button:nth-child(4)', 'click');
  assert.ok(Number((await domAction(api, uri, probe, '.expr-items button')).count) > 5);
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Ausdruck übernommen', () => allReportItems(parseRdl(doc.getText(), uiDom)).some(item => item.name === 'Titel' && item.type === 'textbox' && item.value === '=1 + 2'));
  const saved = doc.getText();
  await vscode.commands.executeCommand('bcReportBuilder.editExpression', uri);
  await domAction(api, uri, probe, '.expr-editor', 'input', '=999');
  await domAction(api, uri, probe, '.expr-editor', 'keydown', 'Escape');
  assert.equal(doc.getText(), saved);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Direkter Texteditor erlaubt Zwischenablage und übernimmt mit Ctrl-Enter; Escape verwirft', async api => {
  const { uri, doc, probe } = await openUi(api);
  await domAction(api, uri, probe, '.item[data-name="Titel"]', 'doubleClick');
  assert.equal((await domAction(api, uri, probe, '.inline-editor', 'keydown', 'Meta+v')).propagated, true);
  await domAction(api, uri, probe, '.inline-editor', 'input', 'UI & Überprüfung');
  await domAction(api, uri, probe, '.inline-editor', 'keydown', 'Control+Enter');
  await until('Direkttext gespeichert', () => doc.getText().includes('<Value>UI &amp; Überprüfung</Value>'));
  // keyboard users stay on the design surface (Tab/Enter/F2 keep working)
  assert.equal((await domAction(api, uri, probe, '.designer')).focused, true, 'Fokus nach Ctrl+Enter');
  const saved = doc.getText();
  await domAction(api, uri, probe, '.item[data-name="Titel"]', 'doubleClick');
  await domAction(api, uri, probe, '.inline-editor', 'input', 'Verwerfen');
  await domAction(api, uri, probe, '.inline-editor', 'keydown', 'Escape');
  assert.equal(doc.getText(), saved);
  assert.equal((await domAction(api, uri, probe, '.designer')).focused, true, 'Fokus nach Escape');
  // Shift+F10 / context menu key on the surface: handled (the menu of the selected item opens instead)
  assert.equal((await domAction(api, uri, probe, '.designer', 'keydown', 'Shift+F10')).defaultPrevented, true);
  assert.equal((await domAction(api, uri, probe, '.designer', 'keydown', 'ContextMenu')).defaultPrevented, true);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Rich Text aufteilen, Textteil und Absatz hinzufügen, formatieren, zusammenfassen', async api => {
  const { uri, doc, probe } = await openUi(api);
  await selectUi(api, uri, probe, 'hKunde');
  await domAction(api, uri, probe, '.props-pane button:has(.codicon-symbol-text)', 'click');
  await domAction(api, uri, probe, '.rich-run-tools button:has(.codicon-add)', 'click');
  assert.equal((await domAction(api, uri, probe, '.rich-run')).count, 2);
  await domAction(api, uri, probe, '.rich-run:nth-child(3) > input', 'input', 'UI & Überprüfung');
  await domAction(api, uri, probe, '.rich-run:nth-child(3) > input', 'keydown', 'Enter');
  await domAction(api, uri, probe, '.rich-run:nth-child(3) button:has(.codicon-bold)', 'click');
  await domAction(api, uri, probe, '.rich-head button:has(.codicon-add)', 'click');
  assert.equal((await domAction(api, uri, probe, '.rich-paragraph')).count, 2);
  await until('Rich Text gespeichert', () => doc.getText().includes('UI &amp; Überprüfung'));
  assert.match(doc.getText(), /<FontWeight>Bold<\/FontWeight>/);
  await domAction(api, uri, probe, '.props-pane .prop-value > button:has(.codicon-whole-word)', 'click');
  await until('einfaches Textfeld', () => allReportItems(parseRdl(doc.getText(), uiDom)).some(item => item.name === 'hKunde' && item.type === 'textbox'));
  assert.ok(doc.getText().includes('UI &amp; Überprüfung'));
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Eingebettetes Bild laden, auf Fläche ziehen, umbenennen, abbrechen und löschen', async api => {
  const { uri, doc, probe } = await openUi(api);
  const png = file('UiLogo.png');
  await vscode.workspace.fs.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'));
  await vscode.commands.executeCommand('bcReportBuilder.toggleReportData', uri);
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const originalOpen = windowApi.showOpenDialog;
  windowApi.showOpenDialog = async () => [png];
  try {
    await domAction(api, uri, probe, '.tree-group:last-child .tree-group-head button', 'click');
    await until('Bild eingebettet', () => doc.getText().includes('<EmbeddedImage Name="UiLogo">'));
    await domAction(api, uri, probe, '.section-body', 'drop', '.image-entry');
    await until('Bildelement angelegt', () => doc.getText().includes('<Source>Embedded</Source>'));
    await domAction(api, uri, probe, '.image-entry button:first-child', 'click');
    await domAction(api, uri, probe, '.image-entry input', 'input', 'RenamedLogo');
    await domAction(api, uri, probe, '.image-entry input', 'keydown', 'Enter');
    await until('Bildverweise umbenannt', () => doc.getText().includes('<Value>RenamedLogo</Value>'));
    const beforeCancel = doc.getText();
    await domAction(api, uri, probe, '.image-entry button:first-child', 'click');
    await domAction(api, uri, probe, '.image-entry input', 'input', 'CancelledLogo');
    await domAction(api, uri, probe, '.image-entry input', 'keydown', 'Escape');
    assert.equal(doc.getText(), beforeCancel);
    await domAction(api, uri, probe, '.image-entry button:last-child', 'click');
    await until('Bild entfernt', () => !doc.getText().includes('<EmbeddedImage Name="RenamedLogo">'));
    assert.deepEqual(errorsOf(probe), []);
  } finally {
    windowApi.showOpenDialog = originalOpen;
    await vscode.workspace.fs.delete(png);
  }
});

test('UI: Dataset und Feld ziehen erzeugt Tabelle bzw. Zellbindung, Formatierung und Aktionen', async api => {
  const { uri, doc, probe } = await openUi(api);
  await vscode.commands.executeCommand('bcReportBuilder.toggleReportData', uri);
  await domAction(api, uri, probe, '.tree-node[draggable="true"]');
  await domAction(api, uri, probe, '.section-body', 'drop', '.tree-node[draggable="true"]');
  await until('Tabelle erzeugt', () => (doc.getText().match(/<Tablix Name=/g) ?? []).length === 2);
  await domAction(api, uri, probe, '[data-name="Kunde"].cell', 'drop', '.tree-leaf.field:nth-child(5)');
  await until('Zellbindung geändert', () => allReportItems(parseRdl(doc.getText(), uiDom)).some(item => item.name === 'Kunde' && item.type === 'textbox' && item.value === '=Fields!Umsatz.Value'));
  await selectUi(api, uri, probe, 'Titel');
  await domAction(api, uri, probe, '.toolbar button:has(.codicon-bold)', 'click');
  await domAction(api, uri, probe, '.toolbar .font-size', 'input', '18pt');
  await domAction(api, uri, probe, '.props-pane select:has(option[value="hyperlink"])', 'input', 'hyperlink');
  const url = '.props-pane .prop-row:has(select option[value="hyperlink"]) + .prop-row input';
  await domAction(api, uri, probe, url, 'input', 'https://example.com/report');
  await domAction(api, uri, probe, url, 'keydown', 'Enter');
  await until('Aktion geschrieben', () => doc.getText().includes('<Hyperlink>https://example.com/report</Hyperlink>'));
  const title = allReportItems(parseRdl(doc.getText(), uiDom)).find(item => item.name === 'Titel')!;
  assert.equal(title.style.FontSize, '18pt');
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await until('Vorschau', () => probe.received.find(message => message.type === 'previewReady'));
  assert.ok(Number((await domAction(api, uri, probe, '.rv-page [data-action]')).count) > 0);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Gliederung filtern, Tastaturnavigation und Zoom ohne Dokumentänderung', async api => {
  const { uri, doc, probe } = await openUi(api);
  const original = doc.getText();
  await domAction(api, uri, probe, '.outline .filter-input input', 'input', 'fUmsatz');
  assert.match(String((await domAction(api, uri, probe, '.outline-tree')).text), /fUmsatz/);
  assert.doesNotMatch(String((await domAction(api, uri, probe, '.outline-tree')).text), /Untertitel/);
  await domAction(api, uri, probe, '.outline .filter-input input', 'input', '');
  await selectUi(api, uri, probe, 'Titel');
  await domAction(api, uri, probe, '.outline-tree', 'focus');
  await domAction(api, uri, probe, '.outline-tree', 'keydown', 'ArrowDown');
  assert.match(String((await domAction(api, uri, probe, '.props-pane .pane-description')).text), /Untertitel/);
  await vscode.commands.executeCommand('bcReportBuilder.zoomIn', uri);
  await until('Zoom erhöht', () => [...probe.received].reverse().find(message => message.type === 'state' && Number((message.state as { zoom: number }).zoom) > 1));
  await vscode.commands.executeCommand('bcReportBuilder.zoomReset', uri);
  await until('Zoom zurückgesetzt', () => (probe.received.filter(message => message.type === 'state').at(-1)?.state as { zoom: number })?.zoom === 1);
  assert.equal(doc.getText(), original);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Neuer Bericht über Speicherdialog, Eigenschaften und Seitenkopf/-fuß', async api => {
  const target = file('UI-NeuerBericht.rdlc');
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const originalSave = windowApi.showSaveDialog;
  windowApi.showSaveDialog = async () => target;
  try {
    await vscode.commands.executeCommand('bcReportBuilder.newReport');
    const { uri, doc, probe } = await open(api, 'UI-NeuerBericht.rdlc');
    const original = parseRdl(doc.getText(), uiDom);
    await vscode.commands.executeCommand('bcReportBuilder.toggleHeader', uri);
    await until('Seitenkopf umgeschaltet', () => !!parseRdl(doc.getText(), uiDom).header !== !!original.header);
    await vscode.commands.executeCommand('bcReportBuilder.toggleFooter', uri);
    await until('Seitenfuß umgeschaltet', () => !!parseRdl(doc.getText(), uiDom).footer !== !!original.footer);
    await vscode.commands.executeCommand('bcReportBuilder.reportProperties', uri);
    await domAction(api, uri, probe, '.modal select', 'input', 'cm');
    const width = '.modal .with-unit input';
    await domAction(api, uri, probe, width, 'input', '18.5');
    await domAction(api, uri, probe, width, 'keydown', 'Enter');
    await domAction(api, uri, probe, '.modal', 'keydown', 'Escape');
    await until('Maße übernommen', () => Math.abs(parseRdl(doc.getText(), uiDom).width * 2.54 - 18.5) < 0.01);
    assert.ok(await doc.save());
    assert.equal(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)), doc.getText());
    assert.deepEqual(errorsOf(probe), []);
  } finally {
    windowApi.showSaveDialog = originalSave;
  }
});

test('UI: Bausteinbibliothek speichern, auswählen und zweimal mit eindeutigen Namen einfügen', async api => {
  const { uri, doc, probe } = await openUi(api);
  const { createBlock } = await import('../../webview/blocks');
  const source = parseRdl(doc.getText(), uiDom);
  const block = serializeRdl(createBlock(source, ['Titel'], uiDom));
  const saved = await withAnswers({ pick: [['Save to Block Library']], input: ['UiHeader'] }, () => probe.deliver({ type: 'saveBlock', text: block }));
  assert.ok(saved.asked.some(message => message.startsWith('input:')));
  for (let index = 0; index < 2; index++) {
    await withAnswers({ pick: [['UiHeader']] }, () => probe.deliver({ type: 'pickBlock' }));
    await domAction(api, uri, probe, '.block-dialog');
    await domAction(api, uri, probe, '.block-dialog .modal-footer .primary', 'click');
    await until('Baustein eingefügt', () => parseRdl(doc.getText(), uiDom).body.items.length === source.body.items.length + index + 1);
  }
  const names = allReportItems(parseRdl(doc.getText(), uiDom)).map(item => item.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Alle Diagrammtypen einfügen, Bereichswerte validieren und gemeinsam in Vorschau rendern', async api => {
  const { uri, doc, probe } = await openUi(api);
  await vscode.commands.executeCommand('bcReportBuilder.insert.chart', uri);
  const types = Number((await domAction(api, uri, probe, '.chart-kind')).count);
  assert.ok(types >= 19);
  for (let index = 0; index < types; index++) {
    if (index > 0) await vscode.commands.executeCommand('bcReportBuilder.insert.chart', uri);
    await domAction(api, uri, probe, `.chart-kind:nth-child(${index + 1})`, 'click');
    await domAction(api, uri, probe, '.modal-body > .form-row > .expr-prop .field-pick', 'input', 'Region');
    await domAction(api, uri, probe, '.list-editor .list-row .field-pick', 'input', 'Umsatz');
    if ([14, 15, 16].includes(index)) {
      assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true, 'Bereich braucht Untergrenze');
      await domAction(api, uri, probe, '.series-extra .field-pick', 'input', 'Menge');
    }
    if (index === 0) {
      await domAction(api, uri, probe, '.modal input[placeholder^="Minimum"]', 'input', 'invalid');
      assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
      await domAction(api, uri, probe, '.modal input[placeholder^="Minimum"]', 'input', '0');
      await domAction(api, uri, probe, '.list-editor .list-row > select', 'input', 'Line');
      await domAction(api, uri, probe, '.list-editor .list-row .check input', 'click');
    }
    assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, false, `Diagrammtyp ${index}`);
    await domAction(api, uri, probe, '.modal-footer .primary', 'click');
    await until(`Diagramm ${index + 1}`, () => (doc.getText().match(/<Chart Name=/g) ?? []).length === index + 1);
  }
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  const preview = await until('Diagrammtypen in Vorschau', () => probe.received.find(message => message.type === 'previewReady'), 60000);
  assert.equal(preview.errors, 0);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Berechnete Diagrammreihen, Periodenvalidierung und Punktfarben', async api => {
  const { uri, doc, probe } = await openUi(api);
  const formulas = ['MovingAverage', 'ExponentialMovingAverage', 'WeightedMovingAverage', 'TriangularMovingAverage', 'Mean', 'Median'];
  for (const formula of formulas) {
    await vscode.commands.executeCommand('bcReportBuilder.insert.chart', uri);
    await domAction(api, uri, probe, '.modal-body > .form-row > .expr-prop .field-pick', 'input', 'Region');
    await domAction(api, uri, probe, '.list-editor .list-row .field-pick', 'input', 'Umsatz');
    await domAction(api, uri, probe, '.series-extra select:has(option[value="Mean"])', 'input', formula);
    if (formula.endsWith('MovingAverage')) {
      await domAction(api, uri, probe, '.series-extra input[type="number"]', 'input', '0');
      assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
      await domAction(api, uri, probe, '.series-extra input[type="number"]', 'input', '3');
    }
    await domAction(api, uri, probe, '.series-extra .expr-prop input', 'input', '=IIf(Fields!Umsatz.Value > 100, "Green", "Red")');
    await domAction(api, uri, probe, '.modal-footer .primary', 'click');
    await until(`Berechnete Reihe ${formula}`, () => doc.getText().includes(`<DerivedSeriesFormula>${formula}</DerivedSeriesFormula>`));
  }
  assert.equal((doc.getText().match(/<DerivedSeriesFormula>/g) ?? []).length, formulas.length);
  assert.match(doc.getText(), /&quot;Green&quot;|"Green"/);
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  const preview = await until('Berechnete Reihen in Vorschau', () => probe.received.find(message => message.type === 'previewReady'), 60000);
  assert.equal(preview.errors, 0);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Bookmark und Drillthrough eingeben und in der Vorschau anklicken', async api => {
  const { uri, doc, probe } = await openUi(api);
  await selectUi(api, uri, probe, 'Titel');
  const kind = '.props-pane select:has(option[value="hyperlink"])';
  const value = '.props-pane .prop-row:has(select option[value="hyperlink"]) + .prop-row input';
  await domAction(api, uri, probe, kind, 'input', 'bookmarkLink');
  await domAction(api, uri, probe, value, 'input', 'QaTarget');
  await domAction(api, uri, probe, value, 'keydown', 'Enter');
  const target = '.props-pane .prop-row:has(select option[value="hyperlink"]) + .prop-row + .prop-row input';
  await domAction(api, uri, probe, target, 'input', 'QaTarget');
  await domAction(api, uri, probe, target, 'keydown', 'Enter');
  await until('Bookmark gespeichert', () => doc.getText().includes('<Bookmark>QaTarget</Bookmark>'));
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await until('Bookmark-Vorschau', () => probe.received.find(message => message.type === 'previewReady'));
  const before = probe.received.length;
  await domAction(api, uri, probe, '.rv-page [data-action]', 'click');
  assert.ok(!probe.received.slice(before).some(message => message.type === 'info'), 'vorhandenes Bookmark ohne Fehlermeldung');
  await vscode.commands.executeCommand('bcReportBuilder.showDesign', uri);
  await selectUi(api, uri, probe, 'Titel');
  await domAction(api, uri, probe, kind, 'input', 'drillthrough');
  await domAction(api, uri, probe, value, 'input', 'QaDetailReport');
  await domAction(api, uri, probe, value, 'keydown', 'Enter');
  await until('Drillthrough gespeichert', () => doc.getText().includes('<ReportName>QaDetailReport</ReportName>'));
  await domAction(api, uri, probe, '.props-pane .prop-row button:has(.codicon-add)', 'click');
  await domAction(api, uri, probe, '.action-param > input:first-of-type', 'input', 'DocumentNo');
  await domAction(api, uri, probe, '.action-param > input:first-of-type', 'keydown', 'Enter');
  await domAction(api, uri, probe, '.action-param > input:nth-of-type(2)', 'input', '=21*2');
  await domAction(api, uri, probe, '.action-param > input:nth-of-type(2)', 'keydown', 'Enter');
  await until('Drillthrough-Parameter gespeichert', () => /<Parameter Name="DocumentNo">[\s\S]*?<Value>=21\*2<\/Value>/.test(doc.getText()));
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await domAction(api, uri, probe, '.rv-page [data-action]', 'click');
  await until('Drillthrough-Hinweis', () => probe.received.some(message => message.type === 'info' && /QaDetailReport.*DocumentNo = 42/.test(String(message.message))));
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Gruppen verschachteln, Sortierung, Filter, Umbruch und Spaltengruppe', async api => {
  const { uri, doc, probe } = await openUi(api);
  await selectUi(api, uri, probe, 'Kunde');
  await vscode.commands.executeCommand('bcReportBuilder.table.addParentGroup', uri);
  await domAction(api, uri, probe, '.modal-body > .form-row:first-child input', 'input', 'UiRegion');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(2) .field-pick', 'input', 'Region');
  await domAction(api, uri, probe, '.modal-body > .check:nth-child(4) input', 'click');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(5) .list-editor > button', 'click');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(5) .list-row > select', 'input', 'd');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(6) .list-editor > button', 'click');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(6) .field-pick', 'input', 'Region');
  await domAction(api, uri, probe, '.modal-body .filter-value', 'input', 'Nord');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(7) select', 'input', 'Between');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(7) input', 'click');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Gruppe geschrieben', () => doc.getText().includes('<Group Name="UiRegion">'));
  assert.match(doc.getText(), /<Direction>Descending<\/Direction>/);
  assert.match(doc.getText(), /<FilterValue>Nord<\/FilterValue>/);
  assert.match(doc.getText(), /<ResetPageNumber>true<\/ResetPageNumber>/);
  await selectUi(api, uri, probe, 'Kunde');
  await vscode.commands.executeCommand('bcReportBuilder.table.addChildGroup', uri);
  await domAction(api, uri, probe, '.modal-body > .form-row:first-child input', 'input', 'UiCustomer');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(2) .field-pick', 'input', 'Kunde');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Untergruppe geschrieben', () => doc.getText().includes('<Group Name="UiCustomer">'));
  await selectUi(api, uri, probe, 'Kunde');
  await vscode.commands.executeCommand('bcReportBuilder.table.addColumnGroup', uri);
  await domAction(api, uri, probe, '.modal-body > .form-row:first-child input', 'input', 'UiColumns');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(2) .field-pick', 'input', 'Region');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Spaltengruppe geschrieben', () => doc.getText().includes('<Group Name="UiColumns">'));
  await selectUi(api, uri, probe, 'Kunde');
  await vscode.commands.executeCommand('bcReportBuilder.table.addColumnGroup', uri);
  await domAction(api, uri, probe, '.modal-body > .form-row:first-child input', 'input', 'UiOuterColumns');
  await domAction(api, uri, probe, '.modal-body > .form-row:nth-child(2) .field-pick', 'input', 'Kunde');
  await domAction(api, uri, probe, '.modal-footer .primary', 'click');
  await until('Zweite Spaltengruppe geschrieben', () => doc.getText().includes('<Group Name="UiOuterColumns">'));
  assert.ok(doc.getText().includes('<Group Name="UiColumns">'), 'bestehende Spaltengruppe bleibt erhalten');
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  const preview = await until('Gruppenvorschau', () => probe.received.find(message => message.type === 'previewReady'));
  assert.equal(preview.errors, 0);
  assert.deepEqual(errorsOf(probe), []);
});

test('UI: Vorschaudaten aus CSV laden und ungültige JSON-Zeilen ohne Datenverlust ablehnen', async api => {
  const { uri, probe } = await openUi(api);
  const csv = file('UiData.csv');
  const invalid = file('UiInvalid.json');
  const sidecar = file('UI-Abnahme.data.json');
  await vscode.workspace.fs.writeFile(csv, new TextEncoder().encode('Region;Kunde;Bestelldatum;Menge;Umsatz\nNord;Müller;2026-10-18;2;1234,50\n'));
  await vscode.workspace.fs.writeFile(invalid, new TextEncoder().encode('[null, 42, "kein Objekt"]'));
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const originalOpen = windowApi.showOpenDialog;
  try {
    windowApi.showOpenDialog = async () => [csv];
    await withAnswers({}, () => probe.deliver({ type: 'importSampleData', dataSet: 'Umsaetze' }));
    const original = await vscode.workspace.fs.readFile(sidecar);
    const data = JSON.parse(new TextDecoder().decode(original));
    assert.equal(data.Umsaetze[0].Kunde, 'Müller');
    assert.equal(data.Umsaetze[0].Umsatz, 1234.5);
    windowApi.showOpenDialog = async () => [invalid];
    const rejected = await withAnswers({}, () => probe.deliver({ type: 'importSampleData', dataSet: 'Umsaetze' }));
    assert.ok(rejected.asked.some(message => message.startsWith('error:')), 'JSON muss aus Objekten bestehen');
    assert.deepEqual(await vscode.workspace.fs.readFile(sidecar), original, 'vorhandene Daten bleiben erhalten');
    await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
    await until('Datenvorschau', () => probe.received.find(message => message.type === 'previewReady'));
    await until('Vorschaudaten sichtbar', async () => /Müller/.test(String((await domAction(api, uri, probe, '.rv-page')).text)));
    assert.deepEqual(errorsOf(probe), []);
  } finally {
    windowApi.showOpenDialog = originalOpen;
    for (const target of [csv, invalid, sidecar]) await vscode.workspace.fs.delete(target).then(undefined, () => undefined);
  }
});

test('UI: Vorschau exportiert Excel und Word über die echten Befehle und den Speicherdialog', async api => {
  const { uri, probe } = await openUi(api);
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await until('Exportvorschau', () => probe.received.find(message => message.type === 'previewReady'));
  const windowApi = vscode.window as unknown as Record<string, unknown>;
  const originalSave = windowApi.showSaveDialog;
  try {
    for (const [command, extension, entry] of [['exportExcel', 'xlsx', 'xl/worksheets/sheet1.xml'], ['exportWord', 'docx', 'word/document.xml']]) {
      const target = file(`UiExport.${extension}`);
      windowApi.showSaveDialog = async () => target;
      await withAnswers({}, async () => {
        await vscode.commands.executeCommand(`bcReportBuilder.${command}`, uri);
        await until('Exportanforderung', () => probe.received.find(message => message.type === 'exportDocument' && message.format === extension));
        let bytes: Uint8Array | undefined;
        for (let attempt = 0; attempt < 100; attempt++) {
          bytes = await vscode.workspace.fs.readFile(target).then(value => value, () => undefined);
          if (bytes?.length) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(bytes?.length, `${extension} geschrieben`);
        const { unzip } = await import('../../src/xlsx');
        const xml = new TextDecoder().decode(unzip(bytes!).get(entry));
        assert.match(xml, /Umsatzbericht/);
        await vscode.workspace.fs.delete(target);
      });
    }
    assert.deepEqual(errorsOf(probe), []);
  } finally {
    windowApi.showSaveDialog = originalSave;
  }
});

test('Absichern: Diagrammtypen per Pfeil/Home/End, ein Tabstopp und angesagte Validierung', async api => {
  const { uri, probe, doc } = await openUi(api);
  const before = doc.getText();
  await vscode.commands.executeCommand('bcReportBuilder.insert.chart', uri);
  const radio = '.chart-kind[aria-checked="true"]';
  assert.equal((await domAction(api, uri, probe, '.chart-kind[tabindex="0"]')).count, 1);
  await domAction(api, uri, probe, radio, 'focus');
  await domAction(api, uri, probe, radio, 'keydown', 'ArrowRight');
  assert.equal((await domAction(api, uri, probe, '.chart-kind:nth-child(2)')).focused, true);
  await domAction(api, uri, probe, radio, 'keydown', 'ArrowLeft');
  assert.equal((await domAction(api, uri, probe, '.chart-kind:first-child')).focused, true);
  await domAction(api, uri, probe, radio, 'keydown', 'ArrowUp');
  assert.equal((await domAction(api, uri, probe, '.chart-kind:last-child')).focused, true);
  await domAction(api, uri, probe, radio, 'keydown', 'Home');
  assert.equal((await domAction(api, uri, probe, '.chart-kind:first-child')).focused, true);
  await domAction(api, uri, probe, radio, 'keydown', 'End');
  assert.equal((await domAction(api, uri, probe, '.chart-kind:last-child')).focused, true);
  assert.equal((await domAction(api, uri, probe, '.chart-kind[tabindex="0"]')).count, 1);
  await domAction(api, uri, probe, '.modal-body > .form-row input', 'input', '');
  assert.ok(String((await domAction(api, uri, probe, '.modal-error[role="alert"]')).text).length > 0);
  assert.equal((await domAction(api, uri, probe, '.modal-footer .primary')).disabled, true);
  await domAction(api, uri, probe, '.modal', 'keydown', 'Escape');
  assert.equal(doc.getText(), before);
  assert.deepEqual(errorsOf(probe), []);
});

test('Absichern: kombinierte Zeilenfilter und TopN, Drilldown je Beleg und wiederholtes Aufklappen', async api => {
  const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(file('Verkaufsrechnung.rdlc')));
  const filter = (expression: string, operator: string, value: string) => `<Filter><FilterExpression>${expression}</FilterExpression><Operator>${operator}</Operator><FilterValues><FilterValue>${value}</FilterValue></FilterValues></Filter>`;
  const xml = source.replace('<Tablix Name="Table_Lines">', `<Tablix Name="Table_Lines"><Visibility><Hidden>true</Hidden><ToggleItem>DocumentNo</ToggleItem></Visibility><Filters>${
    filter('=Fields!LineAmount_Line.Value', 'GreaterThanOrEqual', '=100') +
    filter('=Fields!Description_Line.Value', 'Like', 'Keep*') +
    filter('=Fields!LineAmount_Line.Value', 'TopN', '=1')}</Filters>`)
    .replace('<Textbox Name="DocumentNo">', '<Textbox Name="DocumentNo"><UserSort><SortExpression>=Fields!No_SalesInvHdr.Value</SortExpression><SortExpressionScope>Group_Document</SortExpressionScope></UserSort>');
  await vscode.workspace.fs.writeFile(file('Filter-Drilldown.rdlc'), Buffer.from(xml));
  const { uri, probe, doc } = await open(api, 'Filter-Drilldown.rdlc');
  const data = ['A', 'B'].flatMap((no, index) => [
    { LineNo_Line: 0 },
    { LineNo_Line: 10000, Description_Line: `Keep low ${no}`, LineAmount_Line: 10 },
    { LineNo_Line: 20000, Description_Line: `Keep middle ${no}`, LineAmount_Line: 150 },
    { LineNo_Line: 30000, Description_Line: `Keep high ${no}`, LineAmount_Line: 300 + index * 100 },
    { LineNo_Line: 40000, Description_Line: `Excluded ${no}`, LineAmount_Line: 9999 },
  ].map(line => ({ CompanyName: 'QA', No_SalesInvHdr: no, Paid: false, DocDate_SalesInvHdr: '2026-10-21', ...line })));
  await probe.send({ type: 'sampleData', data: { DataSet_Result: data } });
  await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
  await until('Drilldown-Vorschau', () => probe.received.find(m => m.type === 'previewReady'));
  const visible = async () => String((await domAction(api, uri, probe, '.rv-page:first-child', 'readVisible')).text);
  assert.doesNotMatch(await visible(), /Keep high/);
  const first = '.rv-page:nth-child(1) .rv-interactive';
  const second = '.rv-page:first-child table[data-table] > tbody > tr:nth-child(3) .rv-interactive';
  await domAction(api, uri, probe, first, 'focus');
  await domAction(api, uri, probe, first, 'keydown', 'Enter');
  await until('Nur Beleg A aufgeklappt', async () => /Keep high A/.test(await visible()));
  assert.doesNotMatch(await visible(), /Keep high B|Keep middle|Keep low|Excluded/);
  await domAction(api, uri, probe, second, 'click');
  await until('Beide Belege aufgeklappt', async () => /Keep high B/.test(await visible()));
  assert.match(await visible(), /Keep high A/);
  await domAction(api, uri, probe, first, 'keydown', ' ');
  await until('A wieder eingeklappt', async () => !/Keep high A/.test(await visible()));
  assert.match(await visible(), /Keep high B/);
  const sort = '.rv-page:first-child .rv-interactive:not([aria-expanded])';
  await domAction(api, uri, probe, sort, 'focus');
  await domAction(api, uri, probe, sort, 'keydown', 'Enter');
  await domAction(api, uri, probe, sort, 'keydown', ' ');
  assert.equal((await domAction(api, uri, probe, sort)).text, '▼');
  assert.match(await visible(), /Keep high B/);
  assert.doesNotMatch(await visible(), /Keep high A/, 'Sortierung erhält den aufgeklappten Beleg');
  assert.equal(doc.getText(), xml, 'Vorschauinteraktion verändert das Layout nicht');
  assert.deepEqual(errorsOf(probe), []);
});

test('Absichern: Ziehrichtungen, Zoom, Raster, Alt und verschachtelte Container', async api => {
  const { emptyReport } = await import('../../webview/model');
  const { createItem } = await import('../../webview/ops');
  const report = emptyReport();
  report.unit = 'in'; report.width = 8; report.body.height = 6;
  report.extraXml.push('<Language>de-DE</Language>');
  const container = createItem(report, 'rectangle', { left: 3, top: 1, width: 3, height: 3 });
  if (container.type !== 'rectangle') throw new Error('Rechteck erwartet');
  const child = createItem(report, 'textbox', { left: .25, top: .25, width: 2, height: .3 });
  if (child.type !== 'textbox') throw new Error('Textfeld erwartet');
  child.value = '=1234.5';
  child.style = { FontFamily: 'Georgia', FontSize: '14pt', FontWeight: 'Bold', FontStyle: 'Italic', Format: 'N2', BorderStyle: 'Dashed', BorderColor: 'Navy', BorderWidth: '1pt' };
  container.items.push(child); report.body.items.push(container);
  for (const [top, value, format, font, border] of [[.8, '=1234.5', 'C2', 'Consolas', 'Dotted'], [1.3, '=0.125', 'P1', 'Arial', 'Solid']] as const) {
    const item = createItem(report, 'textbox', { left: .25, top, width: 2, height: .3 });
    if (item.type !== 'textbox') throw new Error('Textfeld erwartet');
    item.value = value; item.style = { FontFamily: font, Format: format, BorderStyle: border, BorderWidth: '1pt', BorderColor: 'Navy' };
    container.items.push(item);
  }
  await vscode.workspace.fs.writeFile(file('Gesture-Acceptance.rdl'), Buffer.from(serializeRdl(report)));
  const { uri, probe, doc } = await open(api, 'Gesture-Acceptance.rdl');
  const original = doc.getText();
  const settings = vscode.workspace.getConfiguration('bcReportBuilder.designer');
  const savedSnap = settings.inspect<boolean>('snapToGrid')?.workspaceValue;
  const items = () => parseRdl(doc.getText(), uiDom).body.items;
  try {
    await settings.update('snapToGrid', true, vscode.ConfigurationTarget.Workspace);
    for (const zoom of [.5, 1, 2]) {
      await probe.send({ type: 'command', id: 'setZoom', arg: zoom });
      await until('Zoom gesetzt', () => (probe.received.filter(m => m.type === 'state').at(-1)?.state as { zoom: number })?.zoom === zoom);
      for (const [dx, dy] of [[96, 48], [-96, 48], [96, -48], [-96, -48]]) {
        await vscode.commands.executeCommand('bcReportBuilder.insert.rectangle', uri);
        await domAction(api, uri, probe, '.section-body', 'pointerDrag', JSON.stringify({ from: [192 * zoom, 192 * zoom], delta: [dx * zoom, dy * zoom] }));
        await until('Rechteck gezeichnet', () => items().length === 2);
        const box = items()[1];
        assert.equal(box.width, 1); assert.equal(box.height, .5);
        assert.equal(box.left, dx < 0 ? 1 : 2); assert.equal(box.top, dy < 0 ? 1.5 : 2);
        await vscode.commands.executeCommand('undo');
        await until('Zeichnen rückgängig', () => doc.getText() === original);
      }
    }
    await probe.send({ type: 'command', id: 'setZoom', arg: 1 });
    await until('Zoom 100', () => (probe.received.filter(m => m.type === 'state').at(-1)?.state as { zoom: number })?.zoom === 1);
    const target = `.item[data-name="${child.name}"]`;
    await domAction(api, uri, probe, target, 'pointerDrag', JSON.stringify({ delta: [17, 11] }));
    const moved = () => (items()[0] as typeof container).items[0];
    await until('Kind am Raster verschoben', () => moved().left !== .25);
    assert.equal(moved().left, .375); assert.equal(moved().top, .375);
    assert.equal(items()[0].left, 3, 'Container bleibt stehen');
    await vscode.commands.executeCommand('undo');
    await until('Kind zurück', () => doc.getText() === original);
    await domAction(api, uri, probe, target, 'pointerDrag', JSON.stringify({ delta: [17, 11], altKey: true }));
    await until('Alt ohne Raster', () => Math.abs(moved().left - (.25 + 17 / 96)) < .001);
    assert.ok(Math.abs(moved().top - (.25 + 11 / 96)) < .001);
    assert.equal(moved().style.FontFamily, 'Georgia'); assert.equal(moved().style.Format, 'N2');
    await vscode.commands.executeCommand('undo');
    await until('Alt zurück', () => doc.getText() === original);
    await settings.update('snapToGrid', false, vscode.ConfigurationTarget.Workspace);
    await domAction(api, uri, probe, target, 'pointerDrag', JSON.stringify({ delta: [17, 11] }));
    await until('Raster ausgeschaltet', () => Math.abs(moved().left - (.25 + 17 / 96)) < .001);
    await vscode.commands.executeCommand('undo');
    await until('Alles rückgängig', () => doc.getText() === original);
    await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
    await until('Gestaltungsvorschau', () => probe.received.find(m => m.type === 'previewReady'));
    const shown = String((await domAction(api, uri, probe, '.rv-page', 'readVisible')).text).replace(/\s/g, ' ');
    assert.match(shown, /1\.234,50/); assert.match(shown, /1\.234,50 €/); assert.match(shown, /12,5 %/);
    const css = JSON.parse(String((await domAction(api, uri, probe, '.rv-page [data-leaf] span', 'readStyle')).text));
    assert.match(css.fontFamily, /Georgia/); assert.equal(css.fontWeight, '700'); assert.equal(css.fontStyle, 'italic');
    assert.ok(Math.abs(parseFloat(css.fontSize) - 14 * 96 / 72) < .1);
    const border = JSON.parse(String((await domAction(api, uri, probe, '.rv-page [data-leaf]', 'readStyle')).text));
    assert.equal(border.borderTopStyle, 'dashed');
    assert.ok(parseFloat(border.borderTopWidth) >= 1 && parseFloat(border.borderTopWidth) <= 1.34, '1pt-Rahmen, ggf. auf Gerätepixel gerundet');
    assert.deepEqual(errorsOf(probe), []);
  } finally { await settings.update('snapToGrid', savedSnap, vscode.ConfigurationTarget.Workspace); }
});

test('Copilot E2E Regression: Textvorschau verwendet die Berichtssprache statt der VS-Code-Sprache', async api => {
  const { emptyReport } = await import('../../webview/model');
  const { createItem } = await import('../../webview/ops');
  const report = emptyReport();
  report.extraXml.push('<Language>de-DE</Language>');
  const item = createItem(report, 'textbox', { top: 0, left: 0, width: 3, height: .4 });
  if (item.type !== 'textbox') throw new Error('Textfeld erwartet');
  item.value = '=1234.5'; item.style.Format = 'N2'; report.body.items.push(item);
  const uri = file('Copilot-Language.rdl');
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeRdl(report)));
  const output = await vscode.lm.invokeTool('bcReport_previewReport', { input: { file: uri.fsPath }, toolInvocationToken: undefined });
  const text = output.content.map(p => p instanceof vscode.LanguageModelTextPart ? p.value : '').join('\n');
  assert.match(text, /1\.234,50/);
  assert.doesNotMatch(text, /1,234\.50/);
});

test('Copilot E2E Regression: Projektwurzel über app.json auch ohne Workspace-Zuordnung einer AL-URI', async api => {
  const { AlWorkspace } = await import('../../src/al/workspace');
  const ws = vscode.workspace as unknown as Record<string, unknown>;
  const previous = ws.getWorkspaceFolder;
  ws.getWorkspaceFolder = () => undefined;
  const index = new AlWorkspace();
  try {
    await index.whenReady();
    const owner = await index.ownerOf(file('Verkaufsrechnung.rdlc'));
    assert.ok(owner);
    assert.equal(owner.file.root.fsPath.toLowerCase(), folder().fsPath.toLowerCase());
    const layouts = await index.layoutsOf(owner);
    assert.ok(layouts.some(l => l.uri.fsPath.toLowerCase() === file('Verkaufsrechnung.rdlc').fsPath.toLowerCase()));
  } finally { ws.getWorkspaceFolder = previous; index.dispose(); }
});

test('Copilot E2E Regression: Build speichert unsichtbare AL-/Layout-Änderungen vor dem Compiler und bricht bei Speicherfehler ab', async api => {
  const { uri, doc, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  const alUri = file('src/Verkaufsrechnung.Report.al');
  const al = await vscode.workspace.openTextDocument(alUri);
  const beforeAl = al.getText(), beforeLayout = doc.getText();
  await vscode.lm.invokeTool('bcReport_createAlLabel', { input: { file: uri.fsPath, name: 'CopilotSaveLbl', text: 'KI Menge', textbox: 'Quantity_Lbl' }, toolInvocationToken: undefined });
  assert.ok(al.isDirty && doc.isDirty);
  let calls = 0;
  const compiler = vscode.commands.registerCommand('al.package', async () => {
    calls++;
    const a = new TextDecoder().decode(await vscode.workspace.fs.readFile(alUri));
    const l = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    assert.ok(a.includes("CopilotSaveLbl = 'KI Menge'"), `Compiler liest das neue Label von der Platte (dirty=${al.isDirty}): ${a.slice(-800)}`);
    assert.ok(l.includes('=Parameters!CopilotSaveLbl.Value'), 'Compiler liest die neue Layout-Bindung von der Platte');
  });
  const ws = vscode.workspace as unknown as Record<string, unknown>;
  const originalSave = ws.saveAll;
  try {
    await vscode.lm.invokeTool('bcReport_buildProject', { input: {}, toolInvocationToken: undefined });
    assert.equal(calls, 1);
    assert.ok(!al.isDirty && !doc.isDirty);
    ws.saveAll = async () => false;
    await assert.rejects(async () => vscode.lm.invokeTool('bcReport_buildProject', { input: {}, toolInvocationToken: undefined }));
    assert.equal(calls, 1, 'kein Compiler-Aufruf nach fehlgeschlagenem Speichern');
    assert.deepEqual(errorsOf(probe), []);
  } finally {
    ws.saveAll = originalSave; compiler.dispose();
    await restore(alUri, beforeAl); await restore(uri, beforeLayout);
  }
});

test('Sprachmodell-Tools: registriert, lesen den AL-Kontext, ändern das Layout im offenen Designer, Rückgängig', async api => {
  const { uri, probe, doc } = await open(api, 'Verkaufsrechnung.rdlc');
  const original = doc.getText();
  const contributed = (vscode.extensions.all.find(e => e.packageJSON.name === 'bc-report-builder')!.packageJSON.contributes.languageModelTools as { name: string }[]).map(t => t.name);
  await until('Tools registriert', () => contributed.every(n => vscode.lm.tools.some(t => t.name === n)));
  const invoke = async (name: string, input: object) => {
    const res = await vscode.lm.invokeTool(`bcReport_${name}`, { input, toolInvocationToken: undefined });
    return res.content.map(p => (p instanceof vscode.LanguageModelTextPart ? p.value : '')).join('');
  };
  try {
    assert.match(await invoke('inspectLayout', {}), /Tablix Table_Lines L\d+-\d+/);
    assert.match(await invoke('getReportData', {}), /AL report 50100 "Contoso Verkaufsrechnung"[\s\S]*dataitem Line/);
    const out = await invoke('editTable', { table: 'Table_Lines', operations: [{ op: 'insertColumn', at: 1, values: [null, '=Fields!LineNo_Line.Value'], width: '1cm' }] });
    assert.match(out, /Verkaufsrechnung\.rdlc changed: column 1 inserted/);
    assert.match(out, /row 1 detail .*\| Textbox\d+="=Fields!LineNo_Line\.Value" \|/);
    assert.ok(doc.getText().includes('=Fields!LineNo_Line.Value'));
    assert.equal(doc.isDirty, false, 'a layout without unsaved changes is saved again');
    // the designer reloads the changed document
    await until('Designer lädt neu', () => probe.posted.filter(m => m.type === 'load').length >= 2);
    await invoke('showInDesigner', { item: 'Quantity_Line' });
    await until('Element ausgewählt', () => ([...probe.received].reverse().find(m => m.type === 'state')?.state as { hasSelection: boolean } | undefined)?.hasSelection);
    // errors are reported to the model, not thrown at the user
    await assert.rejects(invoke('editTable', { table: 'Table_Lines', operations: [{ op: 'deleteRow', row: 7 }] }), /has rows 0–2, not 7/);
    await vscode.commands.executeCommand('undo');
    await until('Rückgängig', () => doc.getText() === original);
    assert.deepEqual(errorsOf(probe), []);
  } finally {
    await restore(uri, original);
  }
});

if (process.env.BC_RB_UNTRUSTED === '1') test('Abnahme: Eingeschränkter Modus sperrt AL und Serverzugriff, Entwurf und Vorschau bleiben verfügbar', async api => {
  assert.equal(vscode.workspace.isTrusted, false, 'echter eingeschränkter Workspace');
  const { uri, doc, probe } = await open(api, 'Verkaufsrechnung.rdlc');
  await until('AL-Kontext geladen', () => probe.posted.some(m => m.type === 'bcContext' && m.context));
  const before = doc.getText();
  await probe.deliver({ type: 'edit', text: before.replace('Rechnungsnr.', 'QA trust') });
  assert.ok(doc.isDirty);
  const windows = vscode.window as unknown as Record<string, unknown>;
  const originalWarning = windows.showWarningMessage;
  let warnings = 0, alCalls = 0, requests = 0;
  const originalFetch = globalThis.fetch;
  const stubs = ['al.package', 'al.publishNoDebug', 'al.downloadSymbols'].map(command =>
    vscode.commands.registerCommand(command, () => { alCalls++; }));
  windows.showWarningMessage = async () => { warnings++; return undefined; };
  globalThis.fetch = (async () => { requests++; throw new Error('Unexpected network request'); }) as typeof fetch;
  try {
    await vscode.commands.executeCommand('bcReportBuilder.buildAl');
    await vscode.commands.executeCommand('bcReportBuilder.runInBc');
    assert.equal(warnings, 2);
    assert.ok(doc.isDirty, 'kein implizites Speichern im eingeschränkten Modus');
    await assert.rejects(async () => vscode.lm.invokeTool('bcReport_buildProject', {
      input: {}, toolInvocationToken: undefined,
    }));
    assert.equal(alCalls, 0);
    assert.equal(requests, 0);
    await vscode.commands.executeCommand('bcReportBuilder.showPreview', uri);
    const preview = await until('Vorschau im eingeschränkten Modus', () => probe.received.find(m => m.type === 'previewReady'));
    assert.equal(preview.errors, 0);
  } finally {
    windows.showWarningMessage = originalWarning;
    globalThis.fetch = originalFetch;
    stubs.forEach(s => s.dispose());
    await restore(uri, before);
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
  const only = process.env.BC_RB_ONLY ? new RegExp(process.env.BC_RB_ONLY) : null;
  for (const [name, fn] of tests.filter(([n]) => !only || only.test(n))) {
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
  const ran = only ? tests.filter(([n]) => only.test(n)).length : tests.length;
  console.log(`\n${ran - failures.length}/${ran} Integrationstests bestanden`);
  if (failures.length) throw new Error(`${failures.length} Integrationstest(s) fehlgeschlagen`);
}
