import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom } from '../webview/rdl';
import { renderReport } from '../webview/render/engine';
import { exportBlocks } from '../webview/render/export';
import { writeDocx, writeXlsx } from '../src/ooxml';
import { parseXlsx, unzip } from '../src/xlsx';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const bc = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');
const doc = (no: string) => ({ CompanyName: 'CRONUS AG', No_SalesInvHdr: no, DocDate_SalesInvHdr: '2026-01-31', Paid: false });
const rows = [
  { ...doc('103001'), LineNo_Line: 0 },
  { ...doc('103001'), LineNo_Line: 10000, Description_Line: 'Tisch', Quantity_Line: 1, UnitPrice_Line: 650, LineAmount_Line: 650 },
  { ...doc('103001'), LineNo_Line: 20000, Description_Line: 'Stuhl', Quantity_Line: 4, UnitPrice_Line: 100, LineAmount_Line: 400 },
];

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
  assert.match(sheet, /<c r="[A-Z]+\d+" s="2"><v>650<\/v><\/c>/, 'Zahl als Zahl in Excel');

  // Word: document with the texts and a table
  const docx = writeDocx(blocks, { width: 8.27, height: 11.69, margins: [0.8, 0.8, 0.8, 0.8] });
  const xml = new TextDecoder().decode(unzip(docx).get('word/document.xml')!);
  assert.match(xml, /<w:t xml:space="preserve">Tisch<\/w:t>/);
  assert.match(xml, /<w:tbl>/);
  mkdirSync('out/test/export', { recursive: true });
  writeFileSync('out/test/export/Verkaufsrechnung.xlsx', xlsx);
  writeFileSync('out/test/export/Verkaufsrechnung.docx', docx);
});
