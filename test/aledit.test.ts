import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { parseAl, parseAlTables } from '../src/al/parser';
import { applyInsert, columnName, findDataItem, insertAddBlock, insertColumns, insertLabel, labelName } from '../src/al/edit';
import { fieldsOfTable, tablesFromApp } from '../src/al/symbols';

const sample = readFileSync('samples/src/Verkaufsrechnung.Report.al', 'utf8');

test('Namen nach Base-App-Konvention', () => {
  assert.equal(labelName('Rechnungsnr.'), 'RechnungsnrLbl');
  assert.equal(labelName('Menge gesamt', ['MengeGesamtLbl']), 'MengeGesamt2Lbl');
  assert.equal(labelName('Größe'), 'GroesseLbl');
  assert.equal(columnName('Unit Price', 'Line'), 'UnitPrice_Line');
  assert.equal(columnName('No.', 'Header', ['No_Header']), 'No_Header2');
});

test('Label anlegen: neuer labels-Block nach dem Dataset, danach in den Block', () => {
  const [rep] = parseAl(sample);
  const once = applyInsert(sample, insertLabel(sample, rep, 'QuantityLbl', 'Menge'));
  assert.match(once, /    }\n\n    labels\n    {\n        QuantityLbl = 'Menge';\n    }\n/);
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
