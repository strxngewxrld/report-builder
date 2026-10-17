// Source preservation for Business Central layouts: edits must change only what was edited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { RawItem, Report, TextboxItem } from '../webview/model';
import { fitSections, locate } from '../webview/ops';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const bc = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');

/** Saves like the designer does: parse, mutate a copy, fit sections, serialize. */
function edit(xml: string, mutate: (r: Report) => void): string {
  const r = structuredClone(parseRdl(xml, dom));
  mutate(r);
  fitSections(r);
  return serializeRdl(r, dom);
}

/** Lines that differ between two texts of equal line count. */
function changedLines(a: string, b: string): string[] {
  const A = a.split(/\r?\n/), B = b.split(/\r?\n/);
  assert.equal(A.length, B.length, 'line count changed');
  return B.filter((l, i) => l !== A[i]).map(l => l.trim());
}

test('saving without changes reproduces the file exactly', () => {
  assert.equal(serializeRdl(parseRdl(bc, dom), dom), bc);
});

test('editing one textbox changes exactly that line', () => {
  const out = edit(bc, r => { (locate(r, 'PageHdr_Company')!.item as TextboxItem).value = '=Code.GetData(3,1)'; });
  assert.deepEqual(changedLines(bc, out), ['<Value>=Code.GetData(3,1)</Value>']);
});

test('formatting a textbox keeps its other content and the style order', () => {
  const out = edit(bc, r => { locate(r, 'PageNo')!.item.style.FontWeight = 'Bold'; });
  const added = out.split('\n').filter(l => !bc.includes(l.trim()) || l.includes('FontWeight'));
  assert.ok(added.some(l => l.includes('<FontWeight>Bold</FontWeight>')));
  assert.ok(out.includes('<Value>="Seite " &amp; Globals!PageNumber</Value>'));
});

test('moving a grouped Tablix (raw) patches only its position', () => {
  const out = edit(bc, r => { locate(r, 'Table_Document')!.item.top = 1 / 2.54; });
  // the body grows with the moved Tablix, as in Report Builder
  assert.deepEqual(changedLines(bc, out), ['<Top>1cm</Top>', '<Height>4.65cm</Height>']);
});

test('Business Central specifics are preserved', () => {
  const src = bc
    .replace('<rd:ReportUnitType>Cm</rd:ReportUnitType>', '<rd:ReportUnitType>Invalid</rd:ReportUnitType>')
    .replace('<Value>=Code.GetData(1,1)</Value>', '<Value EvaluationMode="Auto">=Code.GetData(1,1)</Value>')
    .replace(/\n/g, '\r\n');
  const withBom = '﻿' + src;
  const out = edit(withBom, r => { (locate(r, 'PageHdr_DocNo')!.item as TextboxItem).value = '=Code.GetData(4,1)'; });
  assert.ok(out.startsWith('﻿<?xml'), 'BOM');
  assert.ok(!/[^\r]\n/.test(out), 'CRLF line endings');
  assert.ok(out.includes('<rd:ReportUnitType>Invalid</rd:ReportUnitType>'));
  // unit "Invalid": inferred from the body width (cm); new sizes are written in cm
  assert.equal(parseRdl(withBom, dom).unit, 'cm');

  const out2 = edit(withBom, r => { locate(r, 'PageHdr_Company')!.item.style.Color = 'Red'; });
  assert.ok(out2.includes('<Value EvaluationMode="Auto">=Code.GetData(1,1)</Value>'), 'Value attributes');
});

test('textboxes with several differently formatted runs stay untouched', () => {
  const xml = bc.replace(/<TextRun>\s*<Value>="Seite " &amp; Globals!PageNumber<\/Value>\s*<Style \/>\s*<\/TextRun>/,
    '<TextRun><Value>Seite </Value><Style /></TextRun><TextRun><Label>PageNumber</Label><Value>=Globals!PageNumber</Value><Style><FontWeight>Bold</FontWeight></Style></TextRun>');
  assert.notEqual(xml, bc);
  const r = parseRdl(xml, dom);
  const it = locate(r, 'PageNo')!.item as RawItem;
  assert.equal(it.type, 'raw');
  assert.equal(it.preview, '="Seite " & (Globals!PageNumber)');
  // written back unchanged (apart from formatting of the hand-made fragment)
  assert.equal(serializeRdl(parseRdl(serializeRdl(r, dom), dom), dom), serializeRdl(r, dom));
  assert.ok(serializeRdl(r, dom).includes('<Label>PageNumber</Label>'));
});

test('visibility, ZIndex and other unmodelled item children survive regeneration', () => {
  const out = edit(bc, r => { (locate(r, 'SetData_Header') ?? locate(r, 'PageHdr_Company'))!.item.left += 0; });
  assert.ok(out.includes('<Hidden>true</Hidden>'));
  const xml = bc.replace('<rd:DefaultName>PageNo</rd:DefaultName>', '<rd:DefaultName>PageNo</rd:DefaultName><ZIndex>2</ZIndex><Visibility><Hidden>=Globals!PageNumber = 1</Hidden></Visibility><DataElementOutput>NoOutput</DataElementOutput>');
  assert.notEqual(xml, bc);
  const out2 = edit(xml, r => { (locate(r, 'PageNo')!.item as TextboxItem).value = '="S. " & Globals!PageNumber'; });
  for (const f of ['<ZIndex>2</ZIndex>', '<Hidden>=Globals!PageNumber = 1</Hidden>', '<DataElementOutput>NoOutput</DataElementOutput>']) {
    assert.ok(out2.includes(f), f);
  }
});

test('untidy layouts are not resized by unrelated edits', () => {
  // an untouched item reaching past the page header must not make the header grow
  const xml = bc.replace(/(<Top>0\.6cm<\/Top>\s*<Left>0cm<\/Left>\s*)<Height>0\.5cm<\/Height>/, '$1<Height>2cm</Height>');
  assert.notEqual(xml, bc);
  const out = edit(xml, r => { (locate(r, 'PageNo')!.item as TextboxItem).value = 'x'; });
  assert.ok(out.includes('<Height>1.2cm</Height>'));
});

test('BC document list (grouped Tablix → rectangle → lines table) is editable; an edit deep inside changes one line', () => {
  const r = structuredClone(parseRdl(bc, dom));
  const list = locate(r, 'Table_Document')!.item;
  assert.equal(list.type, 'table');
  const loc = locate(r, 'Description_Line')!;
  assert.equal(loc.item.type, 'textbox');
  assert.equal(loc.table?.name, 'Table_Lines', 'textbox found in the nested lines table inside the list rectangle');
  (loc.item as TextboxItem).value = '=UCase(Fields!Description_Line.Value)';
  const out = serializeRdl(r, dom);
  assert.deepEqual(changedLines(bc, out), ['<Value>=UCase(Fields!Description_Line.Value)</Value>']);
  // items of the list rectangle (document header) can be moved: they have a container
  assert.ok(locate(r, 'Rect_DocHeader'));
});

test('regions kept verbatim: a textbox inside can be patched without touching the rest', async () => {
  const { patchNestedTextbox, readNestedTextbox } = await import('../webview/nested');
  const xml = /<Tablix Name="Table_Document">[\s\S]*<\/Tablix>/.exec(bc)![0];
  assert.deepEqual(readNestedTextbox(xml, 'Description_Line', dom), {
    value: '=Fields!Description_Line.Value', format: '', bold: false, italic: false, color: '', hidden: '', editableValue: true,
  });
  let raw = patchNestedTextbox(xml, 'Description_Line', { value: '=UCase(Fields!Description_Line.Value)' }, dom);
  assert.ok(raw.includes('<Value>=UCase(Fields!Description_Line.Value)</Value>'));
  raw = patchNestedTextbox(raw, 'Quantity_Line', { bold: true, hidden: '=Fields!Quantity_Line.Value = 0' }, dom);
  const t = readNestedTextbox(raw, 'Quantity_Line', dom)!;
  assert.equal(t.bold, true);
  assert.equal(t.format, 'N0');
  assert.equal(t.hidden, '=Fields!Quantity_Line.Value = 0');
});

test('Rich-Text-Textfeld: Textteile lesen, einzeln ändern, hinzufügen, entfernen', async () => {
  const { readRichText, editRichText } = await import('../webview/richtext');
  const xml = bc.replace(/<TextRun>\s*<Value>="Seite " &amp; Globals!PageNumber<\/Value>\s*<Style \/>\s*<\/TextRun>/,
    '<TextRun><Value>Seite </Value><Style /></TextRun><TextRun><Label>PageNumber</Label><Value>=Globals!PageNumber</Value><Style><FontWeight>Bold</FontWeight></Style></TextRun>');
  const r = parseRdl(xml, dom);
  const raw = locate(r, 'PageNo')!.item as RawItem;
  assert.equal(raw.type, 'raw');
  assert.deepEqual(readRichText(raw.xml, 'PageNo', dom)!.map(p => p.runs.map(x => [x.value, x.bold])), [[['Seite ', false], ['=Globals!PageNumber', true]]]);

  // change the second part only: the first stays as it was
  let x = editRichText(raw.xml, 'PageNo', { kind: 'run', p: 0, r: 1, patch: { italic: true, color: '#C00000' } }, dom);
  x = editRichText(x, 'PageNo', { kind: 'run', p: 0, r: 0, patch: { value: 'S. ' } }, dom);
  let runs = readRichText(x, 'PageNo', dom)![0].runs;
  assert.deepEqual(runs.map(v => [v.value, v.bold, v.italic, v.color]), [['S. ', false, false, ''], ['=Globals!PageNumber', true, true, '#C00000']]);
  assert.ok(x.includes('<Label>PageNumber</Label>'), 'nicht modellierte Teile bleiben');

  x = editRichText(x, 'PageNo', { kind: 'addRun', p: 0, after: 1 }, dom);
  x = editRichText(x, 'PageNo', { kind: 'run', p: 0, r: 2, patch: { value: ' von ' } }, dom);
  runs = readRichText(x, 'PageNo', dom)![0].runs;
  assert.deepEqual(runs.map(v => [v.value, v.bold]), [['S. ', false], ['=Globals!PageNumber', true], [' von ', true]], 'neuer Teil übernimmt die Formatierung');
  assert.equal((x.match(/<Label>/g) ?? []).length, 1, 'Label nicht kopiert');
  x = editRichText(x, 'PageNo', { kind: 'addParagraph', after: 0 }, dom);
  assert.equal(readRichText(x, 'PageNo', dom)!.length, 2);
  x = editRichText(x, 'PageNo', { kind: 'removeParagraph', p: 1 }, dom);
  x = editRichText(x, 'PageNo', { kind: 'removeRun', p: 0, r: 2 }, dom);
  assert.equal(readRichText(x, 'PageNo', dom)![0].runs.length, 2);

  // written into the layout: stable and re-parsed as the same raw textbox
  raw.xml = x;
  const out = serializeRdl(r, dom);
  assert.equal(serializeRdl(parseRdl(out, dom), dom), out);
  assert.ok(out.includes('<Value>S. </Value>'));
});

test('empty elements written as <X></X> keep that form', () => {
  const xml = bc.replace(/^(\s*)(<rd:DefaultName>PageNo<\/rd:DefaultName>)/m, '$1$2\n$1<Visibility></Visibility>');
  assert.ok(xml !== bc);
  assert.equal(serializeRdl(parseRdl(xml, dom), dom), xml);
  const out = edit(xml, r => { (locate(r, 'PageHdr_Company')!.item as TextboxItem).value = '=1'; });
  assert.ok(out.includes('<Visibility></Visibility>'));
});
