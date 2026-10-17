import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseXlsx, unzip } from '../src/xlsx';

/** Writes a zip archive (deflated entries) – enough to build test workbooks. */
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = new Uint8Array(deflateRawSync(enc.encode(content)));
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(18, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30); local.set(data, 30 + nameBytes.length);
    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(20, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    locals.push(local); central.push(cen);
    offset += local.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
  ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cenSize + 22);
  let p = 0;
  for (const b of [...locals, ...central, end]) { out.set(b, p); p += b.length; }
  return out;
}

const workbook = zip({
  'xl/workbook.xml': '<workbook><sheets><sheet name="Data" sheetId="1"/></sheets></workbook>',
  'xl/sharedStrings.xml': '<sst><si><t>No_Customer</t></si><si><t>Name_Customer</t></si><si><t>Balance</t></si><si><t>Due_Date</t></si><si><r><t>Contoso </t></r><r><t>AG &amp; Co</t></r></si></sst>',
  'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>',
  'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
    <row r="2"><c r="A2" t="str"><v>10000</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" s="2"><v>1234.5</v></c><c r="D2" s="1"><v>46037</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>20000</t></is></c><c r="C3"><v>-7</v></c><c r="D3" t="b"><v>1</v></c></row>
  </sheetData></worksheet>`,
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>',
});

test('unzip reads deflated entries', () => {
  assert.ok(unzip(workbook).has('xl/workbook.xml'));
  assert.throws(() => unzip(new Uint8Array(100)), /ZIP/);
});

test('rows by header: shared/inline strings, numbers, dates, booleans, gaps', () => {
  assert.deepEqual(parseXlsx(workbook), [
    { No_Customer: '10000', Name_Customer: 'Contoso AG & Co', Balance: 1234.5, Due_Date: '2026-01-15' },
    { No_Customer: '20000', Name_Customer: null, Balance: -7, Due_Date: true },
  ]);
});
