import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { RawItem, Report, TableItem, TextboxItem } from '../webview/model';
import { newReportTemplate } from '../webview/templates';
import { createTable, insertColumn, locate, toggleTableRow } from '../webview/ops';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const sample = readFileSync('samples/Umsatzbericht.rdl', 'utf8');

/** Report without generated ids, for structural comparison. */
// ids (and row references by id) are generated per parse
const strip = (r: Report) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'id' || k === 'rowId' ? undefined : v)));

test('parses the sample report', () => {
  const r = parseRdl(sample, dom);
  assert.equal(r.unit, 'cm');
  assert.ok(Math.abs(r.width - 16 / 2.54) < 1e-9);
  assert.equal(r.dataSources[0].name, 'Vertrieb');
  assert.equal(r.dataSets[0].fields.length, 6);
  assert.equal(r.dataSets[0].fields[5].value, '=Fields!Umsatz.Value / Fields!Menge.Value');
  assert.equal(r.parameters[0].dataType, 'Integer');
  assert.equal(r.parameters[0].defaultValue, '2026');
  assert.equal(r.header, null);
  assert.equal(r.footer?.items.length, 2);

  const types = r.body.items.map(i => i.type);
  // the subtitle has two text runs: kept verbatim instead of being merged
  assert.deepEqual(types, ['textbox', 'raw', 'table', 'textbox', 'raw']);
  const t = r.body.items[2] as TableItem;
  assert.deepEqual(t.rows.map(x => x.kind), ['header', 'detail', 'footer']);
  assert.equal(t.columns.length, 5);
  assert.equal(t.rows[1].cells[2].style.Format, 'dd.MM.yyyy');
  // for display, two text runs with an expression are folded into one expression
  assert.equal((r.body.items[1] as RawItem).preview, '="Bestellungen nach Kunde – " & (CountRows("Umsaetze") & " Positionen")');
});

test('round trip keeps the model and is stable', () => {
  const r1 = parseRdl(sample, dom);
  const xml1 = serializeRdl(r1);
  const r2 = parseRdl(xml1, dom);
  assert.deepEqual(strip(r2), strip(r1));
  assert.equal(serializeRdl(r2), xml1);
});

test('unmodelled XML survives the round trip', () => {
  const xml = serializeRdl(parseRdl(sample, dom));
  for (const fragment of ['<QueryParameter Name="@Jahr"', '<IntegratedSecurity>true</IntegratedSecurity>', 'rd:SecurityType',
    '<ValidValues', '<Subreport Name="Kundendetails"', '<Language', 'DefaultFontFamily', '<ColumnSpacing']) {
    assert.ok(xml.includes(fragment), `missing ${fragment}`);
  }
  // exactly one parameter layout, regenerated from the parameters
  assert.equal(xml.match(/<ReportParametersLayout>/g)?.length, 1);
});

test('new report template serializes to valid RDL', () => {
  const xml = serializeRdl(newReportTemplate());
  const doc = dom.parse(xml);
  assert.equal(doc.documentElement.localName, 'Report');
  const r = parseRdl(xml, dom);
  assert.equal(r.body.items.length, 1);
  assert.equal(r.footer?.items[0].name, 'ExecutionTime');
});

test('table editing operations produce consistent tables', () => {
  const r = newReportTemplate();
  const t = createTable(r, { top: 1, left: 0, width: 4 }, 2, 'DS', ['OrderDate', 'Amount']);
  r.body.items.push(t);
  insertColumn(r, t, 1);
  toggleTableRow(r, t, 'footer');
  const names = t.rows.flatMap(row => row.cells.map(c => c.name));
  assert.equal(new Set(names).size, names.length, 'cell names must be unique');
  assert.equal((t.rows[0].cells[0] as TextboxItem).value, 'Order Date');

  const r2 = parseRdl(serializeRdl(r), dom);
  const t2 = locate(r2, t.name)!.item as TableItem;
  assert.equal(t2.columns.length, 3);
  assert.deepEqual(t2.rows.map(x => x.kind), ['header', 'detail', 'footer']);
  assert.equal(t2.dataSetName, 'DS');
});

test('tables with row groups are editable and written back unchanged', () => {
  const grouped = sample.replace('<Group Name="Details" />', '<Group Name="ByRegion"><GroupExpressions><GroupExpression>=Fields!Region.Value</GroupExpression></GroupExpressions></Group>');
  const r = parseRdl(grouped, dom);
  const t = r.body.items[2] as TableItem;
  assert.equal(t.type, 'table');
  assert.deepEqual(t.rowMembers.map(m => m.group?.expressions), [undefined, ['=Fields!Region.Value'], undefined]);
  // untouched: byte-identical
  assert.equal(serializeRdl(r), serializeRdl(parseRdl(grouped, dom)));
  assert.match(serializeRdl(r), /<Group Name="ByRegion">\s*<GroupExpressions>\s*<GroupExpression>=Fields!Region.Value<\/GroupExpression>/);
  // edited group: only the group is regenerated
  t.rowMembers[1].group!.expressions = ['=Fields!Kunde.Value'];
  const out = serializeRdl(r);
  assert.ok(out.includes('<GroupExpression>=Fields!Kunde.Value</GroupExpression>'));
  assert.equal(out.replace('Kunde.Value</GroupExpression>', 'Region.Value</GroupExpression>'), serializeRdl(parseRdl(grouped, dom)));
});

test('reads RDL 2008 layout (Body directly under Report)', () => {
  const xml2008 = `<?xml version="1.0"?><Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2008/01/reportdefinition">
    <Body><ReportItems><Textbox Name="T"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Hallo</Value></TextRun></TextRuns></Paragraph></Paragraphs>
    <Top>1in</Top><Left>0.5in</Left><Height>0.25in</Height><Width>2in</Width></Textbox></ReportItems><Height>2in</Height></Body>
    <Width>6.5in</Width><Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth></Page></Report>`;
  const r = parseRdl(xml2008, dom);
  assert.equal((r.body.items[0] as TextboxItem).value, 'Hallo');
  assert.equal(r.body.items[0].left, 0.5);
  assert.ok(serializeRdl(r).includes('<ReportSections>'));
});

test('rejects non-RDL XML', () => {
  assert.throws(() => parseRdl('<foo/>', dom), /Report/);
});
