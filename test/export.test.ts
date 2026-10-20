import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom } from '../webview/rdl';
import { renderReport } from '../webview/render/engine';
import { exportBlocks } from '../webview/render/export';
import { excelDateFormat, excelNumberFormat, writeDocx, writeXlsx } from '../src/ooxml';
import { parseXlsx, unzip } from '../src/xlsx';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const bc = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');
const doc = (no: string) => ({ CompanyName: 'CRONUS AG', No_SalesInvHdr: no, DocDate_SalesInvHdr: new Date(2026, 0, 31), Paid: false });
const rows = [
  { ...doc('103001'), LineNo_Line: 0 },
  { ...doc('103001'), LineNo_Line: 10000, Description_Line: 'Tisch', Quantity_Line: 1, UnitPrice_Line: 650, LineAmount_Line: 650 },
  { ...doc('103001'), LineNo_Line: 20000, Description_Line: 'Stuhl', Quantity_Line: 4, UnitPrice_Line: 100, LineAmount_Line: 400 },
];

test('Excel-Zahlenformate aus .NET-Formaten', () => {
  assert.equal(excelNumberFormat('N2'), '#,##0.00');
  assert.equal(excelNumberFormat('n0'), '#,##0');
  assert.equal(excelNumberFormat('N'), '#,##0.00');
  assert.equal(excelNumberFormat('F3'), '0.000');
  assert.equal(excelNumberFormat('P1'), '0.0%');
  assert.equal(excelNumberFormat('D5'), '00000');
  assert.equal(excelNumberFormat('#,##0.00;-#,##0.00'), '#,##0.00;-#,##0.00');
  assert.equal(excelNumberFormat('d'), '0'); // for a number "d" is .NET's integer format, as "D"
  // currency ("C"): the symbol and its position as the preview shows the value (Umsatzbericht.rdl, de-DE)
  assert.equal(excelNumberFormat('C', '4.380,50 €'), '#,##0.00 "€"');
  assert.equal(excelNumberFormat('C', '-612,00 €'), '#,##0.00 "€"');
  assert.equal(excelNumberFormat('C0', '$1,235'), '"$"#,##0');
  assert.equal(excelNumberFormat('C', 'CHF 12.50'), '"CHF" #,##0.00');
  assert.equal(excelNumberFormat('C'), '#,##0.00');
  assert.equal(excelNumberFormat(undefined), 'General');
  assert.equal(excelNumberFormat('dd.MM.yyyy'), 'General');
});

test('Export: BC-Beleg (Liste) wird zu Kopftexten und Positionstabelle', () => {
  const result = renderReport(bc, { dom, mode: 'preview', data: { DataSet_Result: rows }, locale: 'de-DE' });
  const blocks = exportBlocks(result);
  const tables = blocks.filter(b => b.kind === 'table');
  assert.ok(blocks.some(b => b.kind === 'text' && b.text === 'CRONUS AG'), 'Kopfdaten als Text');
  const lines = tables.find(t => t.kind === 'table' && t.rows.some(r => r.some(c => c.text === 'Tisch')))!;
  assert.ok(lines, 'Positionstabelle');
  const tisch = lines.kind === 'table' ? lines.rows.find(r => r.some(c => c.text === 'Tisch'))! : [];
  assert.ok(tisch.some(c => c.value === 650), 'Beträge bleiben Zahlen');

  // Excel: read back with the importer
  const xlsx = writeXlsx(blocks, 'Verkaufsrechnung');
  assert.ok(parseXlsx(xlsx).length > 0, 'lesbar');
  const sheet = new TextDecoder().decode(unzip(xlsx).get('xl/worksheets/sheet1.xml')!);
  assert.match(sheet, /<t xml:space="preserve">Tisch<\/t>/);
  // numbers keep the report's formats (Menge N0, Preise/Beträge N2) instead of one general format
  const styles = new TextDecoder().decode(unzip(xlsx).get('xl/styles.xml')!);
  const fmtId = (code: string) => new RegExp(`<numFmt numFmtId="(\\d+)" formatCode="${code.replace(/[.#]/g, '\\$&')}"/>`).exec(styles)?.[1];
  const xfs = [...styles.matchAll(/<xf[^>]*\/>/g)].map(m => m[0]).slice(1); // after the cellStyleXfs entry
  const styleFor = (value: number) => Number(new RegExp(`s="(\\d+)"><v>${value}</v>`).exec(sheet)?.[1]);
  assert.ok(fmtId('#,##0.00') && fmtId('#,##0'), styles);
  assert.match(xfs[styleFor(650)], new RegExp(`numFmtId="${fmtId('#,##0.00')}"`), 'Betrag N2');
  assert.match(xfs[styleFor(4)], new RegExp(`numFmtId="${fmtId('#,##0')}"`), 'Menge N0');
  // the document date (header text, Format "d"): an Excel date in the reader's short date format, not text
  assert.match(xfs[styleFor(46053)], /numFmtId="14"/, 'Belegdatum als Datum');
  assert.equal(excelDateFormat('dd.MM.yyyy'), 'dd.mm.yyyy');
  assert.equal(excelDateFormat('g', 46053.5), 22);

  // Word: document with the texts and a table
  const docx = writeDocx(blocks, { width: 8.27, height: 11.69, margins: [0.8, 0.8, 0.8, 0.8] });
  const xml = new TextDecoder().decode(unzip(docx).get('word/document.xml')!);
  assert.match(xml, /<w:t xml:space="preserve">Tisch<\/w:t>/);
  assert.match(xml, /<w:tbl>/);
  // Word opens it as a current document (not in compatibility mode)
  assert.match(new TextDecoder().decode(unzip(docx).get('word/settings.xml')!), /w:name="compatibilityMode"[^>]*w:val="15"/);
  assert.match(new TextDecoder().decode(unzip(docx).get('[Content_Types].xml')!), /\/word\/settings\.xml/);
  mkdirSync('out/test/export', { recursive: true });
  writeFileSync('out/test/export/Verkaufsrechnung.xlsx', xlsx);
  writeFileSync('out/test/export/Verkaufsrechnung.docx', docx);
});

test('Export: Seitenumbruch je Beleg wie in Business Central (Word), Excel ein Blatt ohne Lücken', () => {
  const two = [...rows, { ...doc('103002'), LineNo_Line: 10000, Description_Line: 'Lampe', Quantity_Line: 2, UnitPrice_Line: 30, LineAmount_Line: 60 }];
  const blocks = exportBlocks(renderReport(bc, { dom, mode: 'preview', data: { DataSet_Result: two }, locale: 'de-DE' }));
  const kinds = blocks.map(b => b.kind);
  assert.equal(kinds.filter(k => k === 'break').length, 1, kinds.join());
  assert.notEqual(kinds[0], 'break');
  assert.notEqual(kinds[kinds.length - 1], 'break');
  const at = kinds.indexOf('break');
  const texts = (bs: typeof blocks) => bs.flatMap(b => (b.kind === 'text' ? [b.text] : b.kind === 'table' ? b.rows.flat().map(c => c.text) : []));
  assert.ok(texts(blocks.slice(0, at)).includes('Tisch') && !texts(blocks.slice(0, at)).includes('Lampe'), 'Beleg 103001 vor dem Umbruch');
  assert.ok(texts(blocks.slice(at)).includes('Lampe'), 'Beleg 103002 danach');
  // the document date in the text as Business Central prints it (Format "d": four-digit year)
  assert.ok(texts(blocks).includes('31.01.2026'), texts(blocks).join('|'));
  const xml = new TextDecoder().decode(unzip(writeDocx(blocks, { width: 8.27, height: 11.69, margins: [0.8, 0.8, 0.8, 0.8] })).get('word/document.xml')!);
  assert.equal(xml.match(/<w:br w:type="page"\/>/g)?.length, 1);
  const sheet = new TextDecoder().decode(unzip(writeXlsx(blocks)).get('xl/worksheets/sheet1.xml')!);
  assert.match(sheet, /Lampe/);
});
