// Minimal Office Open XML writers for exporting the preview: .xlsx (one sheet, values) and .docx (paragraphs and
// tables). No dependencies: the zip container is written with Node's zlib.

import { deflateRawSync } from 'node:zlib';

import type { ExportBlock, ExportCell } from '../webview/render/export';
export type { ExportBlock, ExportCell };

// ------------------------------------------------------------------------------------------------ zip

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? enc.encode(content) : content;
    const data = deflateRawSync(raw);
    const n = Buffer.from(name, 'utf8');
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters XML 1.0 does not allow
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

// ------------------------------------------------------------------------------------------------ xlsx

const colName = (i: number) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

/**
 * One worksheet: tables keep their columns (merged cells stay merged), texts take a row of their own; numbers stay
 * numbers. Column widths follow the widest table.
 */
export function writeXlsx(blocks: ExportBlock[], sheetName = 'Bericht'): Uint8Array {
  const rows: string[] = [];
  const merges: string[] = [];
  let r = 0;
  let widths: number[] = [];
  const cellXml = (ref: string, c: ExportCell) => {
    const style = c.header || c.bold ? (typeof c.value === 'number' ? 3 : 1) : typeof c.value === 'number' ? 2 : 0;
    return typeof c.value === 'number' && Number.isFinite(c.value)
      ? `<c r="${ref}" s="${style}"><v>${c.value}</v></c>`
      : c.text ? `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(c.text)}</t></is></c>` : '';
  };
  for (const b of blocks) {
    if (b.kind === 'text') {
      r++;
      rows.push(`<row r="${r}">${cellXml(`A${r}`, { text: b.text, bold: b.bold })}</row>`);
      continue;
    }
    if (b.columns.length > widths.length) widths = b.columns;
    if (rows.length) r++; // a blank row before a table
    for (const row of b.rows) {
      r++;
      let col = 0;
      const cells: string[] = [];
      for (const c of row) {
        const span = c.colSpan ?? 1;
        cells.push(cellXml(`${colName(col)}${r}`, c));
        if (span > 1) merges.push(`${colName(col)}${r}:${colName(col + span - 1)}${r}`);
        col += span;
      }
      rows.push(`<row r="${r}">${cells.join('')}</row>`);
    }
  }
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(6, Math.round(w * 13))}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows.join('')}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.##"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="4"><xf xfId="0"/><xf fontId="1" xfId="0" applyFont="1"/><xf numFmtId="164" xfId="0" applyNumberFormat="1"/><xf fontId="1" numFmtId="164" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheet,
    'xl/styles.xml': styles,
  });
}

// ------------------------------------------------------------------------------------------------ docx

const TWIPS = 1440; // per inch

/** A Word document: paragraphs and tables (merged cells, bold, alignment), A4/Letter from the report page. */
export function writeDocx(blocks: ExportBlock[], page: { width: number; height: number; margins: [number, number, number, number] }): Uint8Array {
  const jc = (a?: string) => (a && a !== 'left' ? `<w:jc w:val="${a === 'center' ? 'center' : 'right'}"/>` : '');
  const run = (t: string, bold?: boolean, size?: number) => {
    const props = `${bold ? '<w:b/>' : ''}${size ? `<w:sz w:val="${Math.round(size * 2)}"/>` : ''}`;
    return t.split('\n').map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
  };
  const body = blocks.map(b => {
    if (b.kind === 'text') return `<w:p><w:pPr>${jc(b.align)}</w:pPr>${run(b.text, b.bold, b.size)}</w:p>`;
    const grid = `<w:tblGrid>${b.columns.map(w => `<w:gridCol w:w="${Math.round(w * TWIPS)}"/>`).join('')}</w:tblGrid>`;
    const rows = b.rows.map(row => `<w:tr>${row.map(c => {
      const span = c.colSpan ?? 1;
      const right = c.align ?? (typeof c.value === 'number' ? 'right' : undefined);
      return `<w:tc><w:tcPr>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}</w:tcPr><w:p><w:pPr>${jc(right)}</w:pPr>${run(c.text, c.bold || c.header)}</w:p></w:tc>`;
    }).join('')}</w:tr>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:insideH w:val="single" w:sz="2" w:color="D0D0D0"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>${grid}${rows}</w:tbl><w:p/>`;
  }).join('');
  const [mt, mr, mb, ml] = page.margins.map(m => Math.round(m * TWIPS));
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="${Math.round(page.width * TWIPS)}" w:h="${Math.round(page.height * TWIPS)}"/><w:pgMar w:top="${mt}" w:right="${mr}" w:bottom="${mb}" w:left="${ml}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'word/document.xml': doc,
    'word/styles.xml': styles,
  });
}
