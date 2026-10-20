import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom } from '../webview/rdl';
import { renderReport } from '../webview/render/engine';
import { RBox, RNode, RTable } from '../webview/render/types';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const bc = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');

// Business Central flattens data items: one row per header record (line columns empty) plus one per line.
const doc = (no: string, paid: boolean) => ({ CompanyName: 'CRONUS AG', No_SalesInvHdr: no, DocDate_SalesInvHdr: '2026-01-31', Paid: paid });
const rows = [
  { ...doc('103001', false), LineNo_Line: 0 },
  { ...doc('103001', false), LineNo_Line: 20000, Description_Line: 'Stuhl', Quantity_Line: 4, UnitPrice_Line: 100, LineAmount_Line: 400 },
  { ...doc('103001', false), LineNo_Line: 10000, Description_Line: 'Tisch', Quantity_Line: 1, UnitPrice_Line: 650, LineAmount_Line: 650 },
  { ...doc('103002', true), LineNo_Line: 0 },
  { ...doc('103002', true), LineNo_Line: 10000, Description_Line: 'Lampe', Quantity_Line: 2, UnitPrice_Line: 45.5, LineAmount_Line: 91 },
];

const texts = (n: RNode | null): string[] => {
  if (!n) return [];
  if (n.kind === 'box') return [...(n.paragraphs ?? []).map(p => p.runs.map(r => r.text).join('')), ...(n.children ?? []).flatMap(texts)];
  if (n.kind === 'table') return n.rows.flatMap(r => r.cells.flatMap(c => texts(c.node)));
  return [];
};
const find = (n: RNode | null, name: string): RNode[] => {
  if (!n) return [];
  const self = n.name === name ? [n] : [];
  if (n.kind === 'box') return [...self, ...(n.children ?? []).flatMap(c => find(c, name))];
  if (n.kind === 'table') return [...self, ...n.rows.flatMap(r => r.cells.flatMap(c => find(c.node, name)))];
  return self;
};

test('grouped Business Central document: one instance per document, nested lines filtered and sorted', () => {
  const r = renderReport(bc, { dom, mode: 'preview', data: { DataSet_Result: rows }, locale: 'de-DE' });
  assert.deepEqual(r.errors, []);
  const table = r.body.nodes[0] as RTable;
  assert.equal(table.kind, 'table');
  assert.equal(table.rows.length, 4, 'two documents × (header rectangle + lines)');
  assert.equal(table.rows[2].breakBefore, true, 'page break between documents');
  assert.equal(table.rows[2].resetPageNumber, true);

  const lines = find(table, 'Table_Lines') as RTable[];
  assert.equal(lines.length, 2);
  // LineNo 0 rows are filtered out; lines are sorted by line number
  // the description caption field is not in the data: empty
  assert.deepEqual(texts(lines[0]), ['', 'Menge', 'VK-Preis', 'Betrag', 'Tisch', '1', '650,00', '650,00', 'Stuhl', '4', '100,00', '400,00', 'Gesamt', '', '', '1.050,00']);
  assert.deepEqual(texts(lines[1]).slice(4), ['Lampe', '2', '45,50', '91,00', 'Gesamt', '', '', '91,00']);
  // header data per document
  assert.deepEqual(find(table, 'DocumentNo').flatMap(texts), ['103001', '103002']);
});

test('visibility: hidden values only when read (ReportItems), as in Business Central; conditional visibility per instance', () => {
  const r = renderReport(bc, { dom, mode: 'preview', data: { DataSet_Result: rows } });
  const table = r.body.nodes[0];
  // Base App pattern: Code.SetData in the Hidden expression (returns True)
  const setData = find(table, 'SetData_Header') as RBox[];
  assert.ok(setData.every(n => n.hidden));
  assert.deepEqual(setData.map(n => n.values?.[0][1]), [null, null], 'nothing reads the value');
  const read = renderReport(bc.replace('<Value>="Seite " &amp; Globals!PageNumber</Value>', '<Value>=ReportItems!SetData_Header.Value</Value>'), { dom, mode: 'preview', data: { DataSet_Result: rows } });
  assert.deepEqual((find(read.body.nodes[0], 'SetData_Header') as RBox[]).map(n => n.values?.[0][1]), ['CRONUS AG±103001', 'CRONUS AG±103002']);
  // "=Code.SetData(…)" as the value of a textbox with Hidden=true: BC 29 never evaluates it, the page header stays empty
  const valueOnly = bc.replace('<Value>=Fields!CompanyName.Value + Chr(177) + Fields!No_SalesInvHdr.Value</Value>', '<Value>=Code.SetData(Fields!CompanyName.Value + Chr(177) + Fields!No_SalesInvHdr.Value, 1)</Value>')
    .replace('<Hidden>=Code.SetData(Fields!CompanyName.Value + Chr(177) + Fields!No_SalesInvHdr.Value, 1)</Hidden>', '<Hidden>true</Hidden>');
  assert.notEqual(valueOnly, bc);
  const empty = renderReport(valueOnly, { dom, mode: 'preview', data: { DataSet_Result: rows } });
  const page = { number: 1, total: 2, overallNumber: 1, overallTotal: 2, version: Number.MAX_SAFE_INTEGER, reportItems: new Map() };
  assert.deepEqual(empty.renderSection('header', page)!.nodes.flatMap(texts), ['', '', 'Seite 1']);
  // "Bereits bezahlt" only for the paid document
  assert.deepEqual((find(table, 'PaidInfo') as RBox[]).map(n => n.hidden), [true, false]);
});

test('page header per page: Code.GetData reads the state at the end of that page', () => {
  const r = renderReport(bc, { dom, mode: 'preview', data: { DataSet_Result: rows } });
  const table = r.body.nodes[0] as RTable;
  const endOfPage = (rowIndexes: number[]) => Math.max(...rowIndexes.flatMap(i => table.rows[i].cells.flatMap(c => find(c.node, 'SetData_Header').map(n => n.seq))));
  const header = (version: number, number: number) => r.renderSection('header', { number, total: 2, overallNumber: number, overallTotal: 2, version, reportItems: new Map() })!;
  assert.deepEqual(header(endOfPage([0, 1]), 1).nodes.flatMap(texts), ['CRONUS AG', '103001', 'Seite 1']);
  assert.deepEqual(header(endOfPage([2, 3]), 2).nodes.flatMap(texts), ['CRONUS AG', '103002', 'Seite 2']);
});

test('design mode: structure with field labels, every group once', () => {
  const r = renderReport(bc, { dom, mode: 'design' });
  const table = r.body.nodes[0] as RTable;
  assert.equal(table.rows.length, 2);
  assert.ok(texts(table).includes('[Description_Line]'));
  assert.ok(texts(table).includes('[Sum(LineAmount_Line)]'));
  assert.ok((find(table, 'SetData_Header')[0] as RBox).hidden === false, 'hidden items are shown in design mode');
});

test('simple table report with parameters, aggregates and alternating colors', () => {
  const xml = readFileSync('samples/Umsatzbericht.rdl', 'utf8');
  const data = JSON.parse(readFileSync('samples/Umsatzbericht.data.json', 'utf8'));
  const r = renderReport(xml, { dom, mode: 'preview', data, parameters: { Jahr: 2026 }, locale: 'de-DE' });
  assert.deepEqual(r.errors.filter(([w]) => w !== 'Kundendetails'), []);
  const table = r.body.nodes.find(n => n.name === 'Bestellungen') as RTable;
  assert.equal(table.rows.length, 10); // header + 8 rows + footer
  assert.deepEqual(texts(table.rows[9].cells[4].node).map(t => t.replace(/\s/g, ' ')), ['37.523,40 €']);
  const bg = (i: number) => table.rows[i].cells[0].node!.css.backgroundColor;
  assert.equal(bg(1), 'White');
  assert.equal(bg(2), '#F2F6FA');
  assert.deepEqual(r.body.nodes.filter(n => n.name === 'Titel').flatMap(texts), ['Umsatzbericht 2026']);
});

test('rectangle and data-region page breaks evaluate Disabled and ResetPageNumber expressions', () => {
  // Use an explicit rectangle independent of the BC hierarchy to exercise item-level page breaks.
  const report = `<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"><ReportSections><ReportSection><Body><Height>2in</Height><ReportItems>
    <Rectangle Name="Section"><Top>0in</Top><Left>0in</Left><Width>1in</Width><Height>1in</Height><PageBreak><BreakLocation>StartAndEnd</BreakLocation><Disabled>=Parameters!Disabled.Value</Disabled><ResetPageNumber>=Not Parameters!Disabled.Value</ResetPageNumber></PageBreak></Rectangle>
  </ReportItems></Body><Width>2in</Width><Page><PageWidth>8in</PageWidth><PageHeight>10in</PageHeight></Page></ReportSection></ReportSections></Report>`;
  const enabled = renderReport(report, { dom, mode: 'preview', parameters: { Disabled: false } });
  assert.deepEqual(enabled.errors, []);
  assert.equal(enabled.body.nodes[0].pageBreakBefore, true);
  assert.equal(enabled.body.nodes[0].pageBreakAfter, true);
  assert.equal(enabled.body.nodes[0].resetPageNumber, true);
  const disabled = renderReport(report, { dom, mode: 'preview', parameters: { Disabled: true } });
  assert.equal(disabled.body.nodes[0].pageBreakBefore, false);
  assert.equal(disabled.body.nodes[0].pageBreakAfter, false);
  const design = renderReport(report, { dom, mode: 'design' });
  assert.equal(design.body.nodes[0].pageBreakAfter, false);
});

test('group End breaks include the last instance and conditional disabling is evaluated per group', () => {
  const xml = bc.replace('<BreakLocation>Between</BreakLocation>', '<BreakLocation>End</BreakLocation><Disabled>=Fields!Paid.Value</Disabled>');
  const result = renderReport(xml, { dom, mode: 'preview', data: { DataSet_Result: rows } });
  const table = result.body.nodes[0] as RTable;
  assert.equal(table.rows[1].breakAfter, true);
  assert.equal(table.rows[1].resetPageNumberAfter, true);
  assert.ok(!table.rows[3].breakAfter, 'the paid group disables its page break');
  const allEnabled = renderReport(xml.replace('<Disabled>=Fields!Paid.Value</Disabled>', ''), { dom, mode: 'preview', data: { DataSet_Result: rows } });
  assert.equal((allEnabled.body.nodes[0] as RTable).rows[3].breakAfter, true, 'End applies after the final group too');
});

test('generated preview data for a layout written by the AL compiler (no rd:TypeName): texts stay texts', async () => {
  const { mockRows, numericFieldsFromLayout } = await import('../webview/sampleData');
  const { parseRdl } = await import('../webview/rdl');
  // alc removes the type names; "=Fields!CompanyName.Value</Value>" must not count as a comparison
  const compiled = bc.replace(/\s*<rd:TypeName>[^<]*<\/rd:TypeName>/g, '');
  const numeric = numericFieldsFromLayout(compiled);
  for (const f of ['CompanyName', 'No_SalesInvHdr', 'DocDate_SalesInvHdr', 'Description_Line']) assert.ok(!numeric.has(f), `${f} ist kein Zahlenfeld`);
  assert.ok(numeric.has('LineAmount_Line'), 'Sum(Fields!LineAmount_Line.Value)');
  assert.ok(numericFieldsFromLayout('<Value>=IIf(Fields!Qty.Value &gt; 0, 1, 2)</Value><Value>=2 * Fields!Price.Value</Value>').has('Qty'));
  assert.ok(numericFieldsFromLayout('<Value>=2 * Fields!Price.Value</Value>').has('Price'));
  const [row] = mockRows(parseRdl(compiled, dom).dataSets[0], 1, numeric);
  assert.equal(typeof row.CompanyName, 'string');
  assert.equal(typeof row.Description_Line, 'string');
  // "<Column>Format" next to a column: a decimal in Business Central, also when the layout only shows it in IIf(…)
  const [netChange] = mockRows({ name: 'D', fields: [{ name: 'NetChange', dataField: 'NetChange', typeName: '' }, { name: 'NetChangeFormat', dataField: 'NetChangeFormat', typeName: '' }] } as never, 1);
  assert.equal(typeof netChange.NetChange, 'number');
  assert.equal(typeof netChange.NetChangeFormat, 'string');
});