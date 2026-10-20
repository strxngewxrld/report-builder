import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { parseAl, parseAlTables } from '../src/al/parser';
import { applyInsert, columnName, findDataItem, insertAddBlock, insertColumns, insertLabel, labelName } from '../src/al/edit';
import { fieldsOfTable, tablesFromApp } from '../src/al/symbols';

const sample = readFileSync('samples/src/Verkaufsrechnung.Report.al', 'utf8').replace(/\r\n/g, '\n');

for (const newline of ['\n', '\r\n']) {
  test(`AL insertions preserve ${newline === '\n' ? 'LF' : 'CRLF'} line endings`, () => {
    let source = sample.replace(/\n/g, newline);
    const check = () => assert.equal(source.replace(/\r\n/g, '\n').replace(/\n/g, newline), source);
    source = applyInsert(source, insertLabel(source, parseAl(source)[0], 'FirstLbl', 'Änderung'));
    check();
    source = applyInsert(source, insertLabel(source, parseAl(source)[0], 'SecondLbl', 'Zwei'));
    check();
    source = applyInsert(source, insertColumns(source, findDataItem(parseAl(source)[0].dataItems, 'Header')!,
      [{ name: 'DueDate_Header', source: '"Due Date"' }]));
    check();
    assert.equal(parseAl(source)[0].labels.length, 2);
    source = `reportextension 50101 Ext extends Base${newline}{${newline}    dataset${newline}    {${newline}        add(Header) { }${newline}    }${newline}}`;
    source = applyInsert(source, insertAddBlock(source, parseAl(source)[0], 'Line', [{ name: 'Test', source: 'Description' }])!);
    check();
    assert.equal(parseAl(source)[0].additions.length, 2);
    source = applyInsert(source, insertLabel(source, parseAl(source)[0], 'InlineLbl', 'Text'));
    source = source.replace(`        InlineLbl = 'Text';${newline}    }`, "        InlineLbl = 'Text'; }");
    source = applyInsert(source, insertLabel(source, parseAl(source)[0], 'NextLbl', 'Next'));
    check();
    assert.equal(parseAl(source)[0].labels.length, 2);
  });
}

test('Namen nach Base-App-Konvention', () => {
  assert.equal(labelName('Rechnungsnr.'), 'RechnungsnrLbl');
  assert.equal(labelName('Menge gesamt', ['MengeGesamtLbl']), 'MengeGesamt2Lbl');
  assert.equal(labelName('Größe'), 'GroesseLbl');
  assert.equal(columnName('Unit Price', 'Line'), 'UnitPrice_Line');
  assert.equal(columnName('No.', 'Header', ['No_Header']), 'No_Header2');
});

test('Label anlegen: neuer labels-Block nach dataset/requestpage/rendering (AL0926), danach in den Block', () => {
  const [rep] = parseAl(sample);
  const once = applyInsert(sample, insertLabel(sample, rep, 'QuantityLbl', 'Menge'));
  assert.match(once, /    }\n\n    labels\n    {\n        QuantityLbl = 'Menge';\n    }\n/);
  // the AL compiler (BC 29) rejects labels before rendering: "expected section order is: dataset, requestpage, rendering, labels"
  assert.ok(once.indexOf('labels') > once.indexOf('rendering') && once.indexOf('labels') < once.indexOf('    var'), once);
  const withRequestPage = 'report 50101 R\n{\n    dataset\n    {\n    }\n\n    requestpage\n    {\n        layout { }\n    }\n}\n';
  const [rp] = parseAl(withRequestPage);
  const rpOut = applyInsert(withRequestPage, insertLabel(withRequestPage, rp, 'ALbl', 'A'));
  assert.ok(rpOut.indexOf('labels') > rpOut.indexOf('requestpage'), rpOut);
  assert.deepEqual(parseAl(rpOut)[0].labels.map(l => l.name), ['ALbl']);
  const [again] = parseAl(once);
  assert.deepEqual(again.labels.map(l => [l.name, l.text]), [['QuantityLbl', 'Menge']]);
  const twice = applyInsert(once, insertLabel(once, again, 'PriceLbl', "VK-Preis's"));
  assert.deepEqual(parseAl(twice)[0].labels.map(l => [l.name, l.text]), [['QuantityLbl', 'Menge'], ['PriceLbl', "VK-Preis's"]]);
  assert.match(twice, /        PriceLbl = 'VK-Preis''s';\n    }/);
});

test('Spalten anlegen: nach der letzten Spalte, vor geschachtelten Datenelementen', () => {
  const [rep] = parseAl(sample);
  const header = findDataItem(rep.dataItems, 'header')!;
  const edited = applyInsert(sample, insertColumns(sample, header, [{ name: 'DueDate_Header', source: '"Due Date"' }]));
  const h2 = findDataItem(parseAl(edited)[0].dataItems, 'Header')!;
  assert.deepEqual(h2.columns.at(-1), { ...h2.columns.at(-1)!, name: 'DueDate_Header', source: '"Due Date"' });
  assert.match(edited, /IncludeCaption = true; }\n            column\(DueDate_Header; "Due Date"\) { }\n/);
  assert.deepEqual(h2.children.map(c => c.name), ['Line']);

  const line = findDataItem(parseAl(edited)[0].dataItems, 'Line')!;
  const e2 = applyInsert(edited, insertColumns(edited, line, [{ name: 'VAT_Line', source: '"VAT %"' }, { name: 'Unit_Line', source: '"Unit of Measure"' }]));
  assert.deepEqual(findDataItem(parseAl(e2)[0].dataItems, 'Line')!.columns.slice(-2).map(c => c.name), ['VAT_Line', 'Unit_Line']);
});

test('Spalten in Report-Extensions: in add(...) oder neuer add-Block', () => {
  const src = `reportextension 50101 Ext extends "Contoso Verkaufsrechnung"
{
    dataset
    {
        add(Header)
        {
            column(YourRef; "Your Reference") { }
        }
    }
}`;
  const [ext] = parseAl(src);
  const into = applyInsert(src, insertColumns(src, ext.additions[0], [{ name: 'DueDate_Header', source: '"Due Date"' }]));
  assert.deepEqual(parseAl(into)[0].additions[0].columns.map(c => c.name), ['YourRef', 'DueDate_Header']);
  const block = applyInsert(src, insertAddBlock(src, ext, 'Line', [{ name: 'VAT_Line', source: '"VAT %"' }])!);
  assert.deepEqual(parseAl(block)[0].additions.map(a => [a.target, a.columns.map(c => c.name)]), [['Header', ['YourRef']], ['Line', ['VAT_Line']]]);
});

test('Tabellen und Tabellenerweiterungen aus AL-Quellen', () => {
  const tables = parseAlTables(`
table 50100 "Contoso Setup"
{
    fields
    {
        field(1; "Primary Key"; Code[10]) { }
        field(2; Logo; Media) { Caption = 'Logo'; }
    }
}
tableextension 50100 "Sales Inv. Line Ext" extends "Sales Invoice Line"
{
    fields { field(50100; "Contoso Weight"; Decimal) { } }
}`);
  assert.deepEqual(tables.map(t => [t.kind, t.name, t.extends, t.fields.map(f => [f.id, f.name, f.type])]), [
    ['table', 'Contoso Setup', undefined, [[1, 'Primary Key', 'Code[10]'], [2, 'Logo', 'Media']]],
    ['tableextension', 'Sales Inv. Line Ext', 'Sales Invoice Line', [[50100, 'Contoso Weight', 'Decimal']]],
  ]);
});

/** Minimal zip writer (deflate) behind a 40-byte NAVX header, like a Business Central .app package. */
function appPackage(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(content));
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22); local.writeUInt16LE(n.length, 26);
    locals.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(content.length, 24);
    c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(files).length, 8); eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  const header = Buffer.alloc(40);
  header.write('NAVX', 0);
  return new Uint8Array(Buffer.concat([header, ...locals, cd, eocd]));
}

test('Symbolpaket (.app): Tabellen auch in Namespaces, Erweiterungen zusammengeführt', () => {
  const symbols = {
    Tables: [],
    Namespaces: [{ Name: 'Microsoft', Namespaces: [{ Name: 'Sales', Tables: [{ Id: 113, Name: 'Sales Invoice Line', Fields: [
      { Id: 3, Name: 'Document No.', TypeDefinition: { Name: 'Code', Length: 20 } },
      { Id: 22, Name: 'Unit Price', TypeDefinition: { Name: 'Decimal' } },
    ] }] }] }],
    TableExtensions: [{ Name: 'Ext', TargetObject: 'Sales Invoice Line', Fields: [{ Id: 50000, Name: 'Weight', TypeDefinition: { Name: 'Decimal' } }] }],
  };
  const tables = tablesFromApp(appPackage({ 'NavxManifest.xml': '<Package/>', 'SymbolReference.json': '﻿' + JSON.stringify(symbols) }));
  const { found, fields } = fieldsOfTable(tables, '"Sales Invoice Line"');
  assert.ok(found);
  assert.deepEqual(fields.map(f => [f.name, f.type]), [['Document No.', 'Code[20]'], ['Unit Price', 'Decimal'], ['Weight', 'Decimal']]);
});

test('Report im Web-Client: URL aus launch.json (Cloud und Docker/On-Prem)', async () => {
  const { alConfigurations, reportUrl } = await import('../src/al/launch');
  const configs = alConfigurations(`{
    // AL launch configurations
    "version": "0.2.0",
    "configurations": [
      { "name": "Sandbox", "type": "al", "request": "launch", "environmentType": "Sandbox", "environmentName": "Test", "tenant": "contoso.com", },
      { "name": "Attach", "type": "al", "request": "attach" },
      { "name": "Docker", "type": "al", "request": "launch", "server": "http://bcserver/", "serverInstance": "BC", "authentication": "UserPassword" },
      { "name": "Node", "type": "node", "request": "launch" },
    ]
  }`);
  assert.deepEqual(configs.map(c => c.name), ['Sandbox', 'Docker']);
  assert.equal(reportUrl(configs[0], 50100), 'https://businesscentral.dynamics.com/contoso.com/Test/?report=50100');
  assert.equal(reportUrl(configs[1], 50100), 'http://bcserver/BC/?report=50100');
  assert.equal(reportUrl({ server: 'https://bc.contoso.local', serverInstance: 'BC240', tenant: 'firma' }, 1306), 'https://bc.contoso.local/BC240/?report=1306&tenant=firma');
});

test('Report im Web-Client on-prem: Web-Client-Adresse aus den Metadaten des Servers (BC von der DVD: Port 8080)', async () => {
  const { metadataUrl, reportUrl, webEndpointOf } = await import('../src/al/launch');
  const dvd = { server: 'http://localhost', serverInstance: 'BC290', port: 7049, authentication: 'Windows', tenant: 'default', environmentType: 'OnPrem' };
  assert.equal(metadataUrl(dvd), 'http://localhost:7049/BC290/dev/metadata');
  assert.equal(metadataUrl({ server: 'http://bcserver/', serverInstance: 'BC' }), 'http://bcserver:7049/BC/dev/metadata', 'Standardport 7049');
  assert.equal(metadataUrl({ server: 'https://bc:7149', serverInstance: 'BC', tenant: 'firma' }), 'https://bc:7149/BC/dev/metadata?tenant=firma');
  assert.equal(metadataUrl({ ...dvd, usePublicURLFromServer: false }), undefined);
  assert.equal(metadataUrl({ environmentType: 'Sandbox', environmentName: 'Test' }), undefined);
  // launch.json comes with the workspace: quotes cannot survive into the URL, other schemes are refused
  const hostile = metadataUrl({ server: "http://evil.example/’;calc;’'", serverInstance: 'BC' })!;
  assert.doesNotMatch(hostile, /[’']/);
  assert.equal(new URL(hostile).hostname, 'evil.example');
  assert.equal(metadataUrl({ server: 'file:///C:/x', serverInstance: 'BC' }), undefined);
  assert.equal(metadataUrl({ server: 'not a url', serverInstance: 'BC' }), undefined);
  // response of BC 29 (GET /BC290/dev/metadata)
  const endpoint = webEndpointOf('{"runtimeVersion":"18.0","webApiVersion":"7.0","debuggerVersion":"7.0","webEndpoint":"http://localhost:8080/BC290/","extensionAllowedTargetLevel":"Internal"}');
  assert.equal(endpoint, 'http://localhost:8080/BC290/');
  assert.equal(reportUrl(dvd, 50100, endpoint), 'http://localhost:8080/BC290/?report=50100');
  assert.equal(reportUrl({ ...dvd, tenant: 'firma' }, 50100, 'https://bc.contoso.local/BC290'), 'https://bc.contoso.local/BC290/?report=50100&tenant=firma');
  assert.equal(reportUrl(dvd, 50100), 'http://localhost/BC290/?report=50100', 'ohne Antwort des Servers wie bisher');
  assert.equal(webEndpointOf('<html>'), undefined);
  assert.equal(webEndpointOf('{"webEndpoint":""}'), undefined);
});

test('Label mit Optionen für Übersetzer; Parser liest sie wieder', () => {
  const [rep] = parseAl(sample);
  const out = applyInsert(sample, insertLabel(sample, rep, 'QtyLbl', 'Menge', { comment: "Spalte 'Menge'", maxLength: 12, locked: false }));
  assert.match(out, /QtyLbl = 'Menge', Comment = 'Spalte ''Menge''', MaxLength = 12;/);
  const [again] = parseAl(out);
  assert.deepEqual(again.labels.map(l => [l.name, l.text, l.comment, l.maxLength, l.locked]), [['QtyLbl', 'Menge', "Spalte 'Menge'", 12, undefined]]);
  const locked = applyInsert(out, insertLabel(out, again, 'CodeLbl', 'EUR', { locked: true }));
  assert.equal(parseAl(locked)[0].labels[1].locked, true);
});

test('Layout-Textfeld im Host ändern (für ein gemeinsames Rückgängig mit AL)', async () => {
  const { textboxValueEdit } = await import('../src/layoutEdit');
  const xml = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');
  const name = /<Textbox Name="([^"]+)">(?:(?!<\/Textbox>)[\s\S])*?<Value>Menge<\/Value>/.exec(xml)?.[1];
  const edit = name ? textboxValueEdit(xml, name, '=Parameters!InvoiceLbl.Value') : null;
  assert.ok(edit, 'Textfeld mit festem Text im Beispiel');
  const out = xml.slice(0, edit!.start) + edit!.text + xml.slice(edit!.end);
  assert.equal(out.split('\n').length, xml.split('\n').length);
  assert.ok(out.includes('<Value>=Parameters!InvoiceLbl.Value</Value>'));
  assert.equal(textboxValueEdit(xml, 'GibtEsNicht', 'x'), null);
  assert.equal(textboxValueEdit('<Textbox Name="A"><Paragraphs><Paragraph><TextRuns><TextRun><Value EvaluationMode="Constant">a &amp; b</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>', 'A', '=1 & 2')!.text,
    '<Value>=1 &amp; 2</Value>');
});

test('Spalte umbenennen: Layout-Verweise, Dataset, Beschriftung, gleichnamige Textfelder', async () => {
  const { renameColumnInLayout } = await import('../src/layoutEdit');
  const xml = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');
  assert.ok(xml.includes('Fields!Quantity_Line.Value'));
  const { text, count } = renameColumnInLayout(xml, 'Quantity_Line', 'Qty_Line');
  assert.ok(count > 0);
  assert.ok(!/Quantity_Line\b/.test(text), 'kein Verweis auf den alten Namen');
  assert.ok(text.includes('Fields!Qty_Line.Value'));
  assert.ok(text.includes('<Field Name="Qty_Line">'));
  assert.ok(text.includes('<DataField>Qty_Line</DataField>'));
  assert.equal(text.split('\n').length, xml.split('\n').length);
  // a prefix of another column is not touched
  assert.equal(renameColumnInLayout('=Fields!No_.Value + Fields!No_Header.Value', 'No_', 'Nr').text, '=Fields!Nr.Value + Fields!No_Header.Value');
  assert.equal(renameColumnInLayout('=Parameters!AmtCaption.Value & Fields!AmtFormat.Value', 'Amt', 'Amount').text, '=Parameters!AmountCaption.Value & Fields!AmountFormat.Value');
  // the textbox keeps its name when the new one is taken
  const both = '<Textbox Name="A"><Value>=Fields!A.Value</Value></Textbox><Textbox Name="B"><Value>=ReportItems!A.Value</Value></Textbox>';
  assert.equal(renameColumnInLayout(both, 'A', 'B').text, '<Textbox Name="A"><Value>=Fields!B.Value</Value></Textbox><Textbox Name="B"><Value>=ReportItems!A.Value</Value></Textbox>');
  assert.equal(renameColumnInLayout(both, 'A', 'C').text, '<Textbox Name="C"><Value>=Fields!C.Value</Value></Textbox><Textbox Name="B"><Value>=ReportItems!C.Value</Value></Textbox>');
});
