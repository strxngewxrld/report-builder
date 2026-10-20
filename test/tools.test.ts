// Language model tools: overview, validation, text preview and the structural edits (pure functions on the XML).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkXml, describeLayout, formatProblems, itemLines, previewText, validateLayout } from '../src/tools/inspect';
import { arrangeItems, chartOf, editChart, editTable, insertItems, setPageLayout } from '../src/tools/edit';
import { parseAl } from '../src/al/parser';
import { buildBcContext } from '../src/al/context';
import { applyInsert, insertLabel } from '../src/al/edit';
import { bindRows } from '../webview/sampleData';

const sales = readFileSync('samples/Umsatzbericht.rdl', 'utf8');
const sample = JSON.parse(readFileSync('samples/Umsatzbericht.data.json', 'utf8'));
const invoice = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');
const codes = (text: string) => validateLayout(text, { sample }).map(p => p.code);

test('overview: page check, dataset, items with XML line ranges, table rows and groups', () => {
  const d = describeLayout(invoice, { path: 'Verkaufsrechnung.rdlc' });
  assert.match(d, /unit cm/);
  assert.match(d, /Body width 17cm \(printable width 17cm\)/);
  assert.match(d, /Dataset DataSet_Result \(10 fields\): CompanyName, No_SalesInvHdr/);
  assert.match(d, /Code block functions: GetData, SetData/);
  const lines = itemLines(invoice);
  const doc = lines.get('Table_Document')!;
  assert.ok(doc.start < lines.get('Table_Lines')!.start && lines.get('Table_Lines')!.end < doc.end, 'nested ranges');
  assert.match(d, new RegExp(`Tablix Table_Document L${doc.start}-${doc.end} `));
  assert.match(d, /row 1 detail h=0\.45cm: Description_Line="=Fields!Description_Line\.Value"/);
  assert.match(d, /Group_Document by =Fields!No_SalesInvHdr\.Value · pagebreak Between · rows 0-1/);
  assert.match(d, /hidden="=Not Fields!Paid\.Value"/);
  // one item with all details
  assert.match(describeLayout(sales, { item: 'Umsatz' }), /Format: C; Color: =IIf/);
  assert.throws(() => describeLayout(sales, { item: 'Nope' }), /No report item "Nope"/);
});

test('validation: clean samples, then XML errors, duplicates, blank pages, fields in the page header, bad expressions', () => {
  assert.deepEqual(validateLayout(sales, { sample }), []);
  assert.deepEqual(validateLayout(invoice), []);
  assert.deepEqual(checkXml(sales), []);
  // a closing tag dropped while editing: xmldom repairs it silently, the check names the lines
  const broken = sales.replace(/      <\/Body>\r?\n/, '');
  assert.notEqual(broken, sales);
  assert.match(formatProblems(validateLayout(broken)), /error L\d+ \(xml\): <\/ReportSection> does not match <Body> opened in line \d+/);
  assert.match(checkXml('<a><b>x < y</b></a>')[0].message, /Malformed tag/);
  assert.ok(codes(sales.replace('Name="Erstellt"', 'Name="Seite"')).includes('duplicate-name'));
  assert.ok(codes(sales.replace('<LeftMargin>2.5cm</LeftMargin>', '<LeftMargin>4cm</LeftMargin>')).includes('page-width'));
  assert.ok(codes(sales.replace('=Globals!ExecutionTime', '=Fields!Kunde.Value')).includes('fields-in-page-section'));
  assert.ok(!codes(sales.replace('=Globals!ExecutionTime', '=First(Fields!Kunde.Value, "Umsaetze")')).includes('fields-in-page-section'));
  assert.ok(codes(sales.replace('=Sum(Fields!Menge.Value)', '=Sum(Fields!Menge.Value')).includes('expression'));
  assert.ok(codes(sales.replace('=Fields!Kunde.Value', '=Fields!Kundee.Value')).includes('unknown-field'));
});

test('preview as text: sample rows, totals, formats, page footer', () => {
  const p = previewText(sales, { sample, locale: 'de-DE' });
  assert.match(p, /Umsaetze: 8 sample rows/);
  assert.match(p, /Titel: "Umsatzbericht 2026"/);
  assert.match(p, /\| Nord \| Hansa Logistik GmbH \| 14\.01\.2026 \| 12 \| 4\.380,50 € \|/);
  assert.match(p, /\| Summe \|  \|  \| 116 \| 37\.523,40 € \|/);
  assert.match(p, /Seite: "Seite 1 von 1"/);
  // Business Central: generated rows, nested document tables
  assert.match(previewText(invoice, { maxRows: 5 }), /DataSet_Result: 8 generated rows[\s\S]*Table_Lines \(table, 3 rows\)/);
});

test('preview with the AL data items: line columns missing on the header row still reach the line table', () => {
  const rep = parseAl(readFileSync('samples/src/Verkaufsrechnung.Report.al', 'utf8'))[0];
  const fields = [...invoice.matchAll(/<Field Name="([^"]+)"/g)].map(m => m[1]);
  const bc = buildBcContext(rep, undefined, { fields, parameters: [] }, 'file:///r.al', 'r.al');
  const p = previewText(invoice, { bc, locale: 'de-DE' });
  assert.match(p, /Table_Lines \(table, 5 rows\):\s*\|[^\n]*\|\s*\| Line 1 \| \d+ \|[^\n]*\|\s*\| Line 2 \|/);
  assert.doesNotMatch(p, /\| Gesamt \|  \|  \| 0,00 \|/);
  // a label just created in AL (not yet compiled into the layout's parameters): its text, not #Error
  let al = readFileSync('samples/src/Verkaufsrechnung.Report.al', 'utf8');
  al = applyInsert(al, insertLabel(al, parseAl(al)[0], 'TotalLbl', 'Gesamtbetrag'));
  const withLabel = buildBcContext(parseAl(al)[0], undefined, { fields, parameters: [] }, 'file:///r.al', 'r.al');
  const labelled = previewText(invoice.replace('<Value>Gesamt</Value>', '<Value>=Parameters!TotalLbl.Value</Value>'), { bc: withLabel, locale: 'de-DE' });
  assert.match(labelled, /\| Gesamtbetrag \|/);
  assert.doesNotMatch(labelled, /#Error/);
  // the same for sample rows: columns only from later rows
  assert.deepEqual(bindRows({ name: 'D', fields: [{ name: 'A', dataField: 'A', typeName: '' }, { name: 'B', dataField: 'B', typeName: '' }] } as never,
    [{ A: 1 }, { A: 2, B: 'x' }]), [{ A: 1, B: null }, { A: 2, B: 'x' }]);
});

test('editTable: group, column from a field, cell, sort – structure stays consistent', () => {
  const r = editTable(sales, 'Bestellungen', [
    { op: 'addGroup', row: 1, mode: 'parent', expression: '=Fields!Region.Value', name: 'RegionGroup', footer: true },
    { op: 'insertColumn', at: 4, field: 'Durchschnittspreis', width: '2cm' },
    { op: 'setCell', row: 3, column: 5, value: '=Sum(Fields!Umsatz.Value)' },
    { op: 'setGroup', group: 'RegionGroup', sort: [{ value: '=Fields!Region.Value', descending: true }] },
    { op: 'deleteColumn', at: 2 },
  ]);
  assert.deepEqual(r.summary.slice(0, 5), ['group RegionGroup added', 'column 4 inserted', 'cell 3/5 set', 'group RegionGroup updated', 'column 2 deleted']);
  assert.deepEqual(validateLayout(r.text, { sample }).filter(p => p.severity === 'error'), []);
  const d = describeLayout(r.text, { item: 'Bestellungen' });
  assert.match(d, /columns: 0=3cm, 1=5cm, 2=2cm, 3=2cm, 4=3cm/);
  assert.match(d, /RegionGroup by =Fields!Region\.Value · sort =Fields!Region\.Value desc · rows 1-3/);
  const p = previewText(r.text, { sample });
  assert.match(p, /\| West \|  \|  \|  \|  \|[\s\S]*\| Ost \|/, 'groups sorted descending');
  assert.throws(() => editTable(sales, 'Bestellungen', [{ op: 'deleteRow', row: 9 }]), /Operation 0 \(deleteRow\): Table "Bestellungen" has rows 0–2, not 9/);
  assert.throws(() => editTable(sales, 'Titel', []), /not a table/);
});

test('insertItems: BC table with formats and captions, chart, header textbox, embedded image', () => {
  const r = insertItems(invoice, [
    { type: 'table', fields: ['Description_Line', 'LineAmount_Line'], name: 'Summary', width: '8cm' },
    { type: 'chart', name: 'Revenue', chart: { kind: 'Pie', category: '=Fields!Description_Line.Value', series: [{ name: 'Amount', value: '=Sum(Fields!LineAmount_Line.Value)' }] } },
    { type: 'textbox', section: 'footer', value: '="Page " & Globals!PageNumber', width: '4cm', style: { TextAlign: 'Right' } },
    { type: 'image', embed: { name: 'logo.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' }, section: 'header', left: '14cm' },
  ]);
  assert.deepEqual(r.summary, ['table Summary inserted', 'chart Revenue inserted', 'textbox Textbox5 inserted', 'image Image1 inserted']);
  assert.deepEqual(validateLayout(r.text).filter(p => p.severity === 'error'), []);
  const d = describeLayout(r.text);
  assert.match(d, /Tablix Summary .* at \(0cm, 3\.\d+cm\)/, 'below the existing items');
  assert.match(d, /Page footer: height/);
  assert.match(d, /Embedded images: logo \(image\/png\)/);
  assert.equal(chartOf(r.text, 'Revenue').legend, true, 'pie charts show their categories');
  assert.throws(() => insertItems(invoice, [{ type: 'textbox', name: 'PageNo' }]), /Item 0 \(textbox\): The name "PageNo" is invalid or taken/);
  assert.throws(() => insertItems(invoice, [{ type: 'chart', chart: {} }]), /at least one series/);
});

test('editChart, arrangeItems, setPageLayout; no-op edits keep the text', () => {
  let { text } = insertItems(sales, [{ type: 'chart', name: 'C', chart: { category: '=Fields!Region.Value', series: [{ name: 'Umsatz', value: '=Sum(Fields!Umsatz.Value)' }] } }]);
  text = editChart(text, 'C', { kind: 'Line', series: [{ name: 'Umsatz', value: '=Sum(Fields!Umsatz.Value)' }, { name: 'Menge', value: '=Sum(Fields!Menge.Value)', secondary: true }] }).text;
  const spec = chartOf(text, 'C');
  assert.equal(spec.kind, 'Line');
  assert.deepEqual(spec.series.map(s => [s.name, !!s.secondary]), [['Umsatz', false], ['Menge', true]]);
  assert.match(previewText(text, { sample }), /C \(chart\): categories \["Nord","Ost","Süd","West"\]/);

  text = arrangeItems(text, { items: ['Titel', 'Hinweis'], boxes: [{ name: 'Hinweis', left: 2, width: '10cm' }], align: 'left' }).text;
  assert.match(describeLayout(text, { item: 'Hinweis' }), /at \(0cm, 4\.6cm\) 10cm×0\.6cm/);
  assert.throws(() => arrangeItems(text, { items: ['Region'], boxes: [{ name: 'Region', top: 1 }] }), /table cell/);

  const wide = setPageLayout(sales, { marginLeft: '4cm' });
  assert.match(wide.summary.join(), /blank page/);
  const fixed = setPageLayout(wide.text, { fitBodyToPage: false, marginRight: '1cm', pageWidth: '21cm' });
  assert.deepEqual(validateLayout(fixed.text, { sample }).map(p => p.code), []);
  const landscape = setPageLayout(sales, { pageWidth: '29.7cm', pageHeight: '21cm', footer: { present: false }, header: { height: '1.5cm' } });
  assert.match(describeLayout(landscape.text), /Page 29\.7cm × 21cm[\s\S]*Page header: height 1\.5cm/);
  assert.doesNotMatch(describeLayout(landscape.text), /Page footer/);
  assert.equal(setPageLayout(sales, {}).text, sales);
});
