// Runs inside VS Code (extension host) against the real designer webview. See run.ts.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { EditorProbe } from '../../src/testing';

type Api = { probes: Map<string, EditorProbe>; service: { lintAll(): Promise<void> } };

async function until<T>(what: string, fn: () => T | undefined | false, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout;
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
  for (let i = 0; i < 100 && !all.some(l => l.command?.command === 'bcReportBuilder.revealInLayout'); i++) {
    all = (await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', al.uri, 100)) ?? [];
    if (!all.length) await new Promise(r => setTimeout(r, 100));
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

export async function run(): Promise<void> {
  const ext = vscode.extensions.all.find(e => e.packageJSON.name === 'bc-report-builder')!;
  const api = (await ext.activate()) as Api;
  assert.ok(api?.probes, 'Test-API (BC_REPORT_BUILDER_TEST=1)');
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn(api);
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failures.push(name);
      console.log(`  ✗ ${name}\n      ${(e as Error).stack ?? e}`);
    }
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
  console.log(`\n${tests.length - failures.length}/${tests.length} Integrationstests bestanden`);
  if (failures.length) throw new Error(`${failures.length} Integrationstest(s) fehlgeschlagen`);
}
