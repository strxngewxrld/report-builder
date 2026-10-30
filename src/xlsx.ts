// Minimal .xlsx reader for preview data – e.g. Business Central's "Send to › Microsoft Excel Document (data only)".
// Reads the sheet with the most rows; the first non-empty row holds the column names. Dates (by number format) become
// ISO strings, numbers stay numbers. No dependencies: the zip container is read with Node's zlib.

import { inflateRawSync } from 'node:zlib';
import { l10n } from '../webview/l10n';

/** Bound actual decompression, including when ZIP size metadata is forged. Shared by Excel and AL packages. */
const ZIP_LIMITS = { maxEntryBytes: 128 * 1024 * 1024, maxTotalBytes: 512 * 1024 * 1024, maxEntries: 10_000 };

/** Files of a zip archive by name. Limits may be lowered by callers. */
export function unzip(buf: Uint8Array, limits: Partial<typeof ZIP_LIMITS> = {}): Map<string, Uint8Array> {
  const cap = { ...ZIP_LIMITS, ...limits };
  for (const k of Object.keys(cap) as (keyof typeof cap)[]) {
    if (!Number.isSafeInteger(cap[k]) || cap[k] <= 0 || cap[k] > ZIP_LIMITS[k]) throw new Error('Invalid ZIP limit');
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const damaged = () => new Error(l10n.t('Damaged ZIP directory'));
  const range = (start: number, size: number, end = buf.length) => {
    if (start < 0 || size < 0 || start + size > end) throw damaged();
  };
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(l10n.t('Not a ZIP archive (no valid Excel or .app file)'));
  const count = view.getUint16(eocd + 10, true);
  if (count > cap.maxEntries) throw new Error(l10n.t('ZIP entry limit exceeded'));
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0 || view.getUint16(eocd + 8, true) !== count) throw damaged();
  // archives behind a header (Business Central .app files start with a "NAVX" header): all offsets are shifted
  const shift = eocd - (view.getUint32(eocd + 16, true) + view.getUint32(eocd + 12, true));
  let p = view.getUint32(eocd + 16, true) + shift;
  if (shift < 0) throw damaged();
  const directoryStart = p;
  let total = 0;
  const files = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    range(p, 46, eocd);
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error(l10n.t('Damaged ZIP directory'));
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const unpackedSize = view.getUint32(p + 24, true);
    const budget = Math.min(cap.maxEntryBytes, cap.maxTotalBytes - total);
    if (unpackedSize > budget || budget <= 0) throw new Error(l10n.t('ZIP decompression limit exceeded'));
    if ((view.getUint16(p + 8, true) & 1) !== 0 || (method !== 0 && method !== 8)) throw new Error(l10n.t('Unsupported ZIP compression or encryption'));
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true) + shift;
    range(p + 46, nameLen + extraLen + commentLen, eocd);
    range(local, 30, directoryStart);
    if (view.getUint32(local, true) !== 0x04034b50) throw damaged();
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    range(dataStart, size, directoryStart);
    const raw = buf.subarray(dataStart, dataStart + size);
    if (method === 0 && size > budget) throw new Error(l10n.t('ZIP decompression limit exceeded'));
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw, { maxOutputLength: budget })) : raw;
    if (data.length !== unpackedSize) throw damaged();
    total += data.length; // count duplicates too: Map replacement must not reset the budget
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== eocd) throw damaged();
  return files;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Column letters of a cell reference ("BC12" → 54, 0-based). */
const columnIndex = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;

const MAX_COLUMN = 16383;

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFormat = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/0|#/.test(code.replace(/"[^"]*"/g, ''));

export function parseXlsx(buf: Uint8Array): Record<string, unknown>[] {
  const files = unzip(buf);
  // element prefixes removed: Business Central 29 writes "<x:row><x:c …><x:v>" (namespace prefix x), Excel "<row><c><v>"
  const text = (name: string) => { const f = files.get(name); return f ? new TextDecoder().decode(f).replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1') : ''; };

  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map(m => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));

  // which cell styles are dates
  const styles = text('xl/styles.xml');
  const custom = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map(m => [Number(attr(m[0], 'numFmtId')), decodeXml(attr(m[0], 'formatCode') ?? '')]));
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map(m => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    return DATE_FORMAT_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!));
  });
  const date1904 = /date1904="(1|true)"/.test(text('xl/workbook.xml'));

  const sheets = [...files.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheets.length) throw new Error(l10n.t('The Excel file contains no worksheet'));
  let best: unknown[][] = [];
  for (const name of sheets) {
    const rows: unknown[][] = [];
    for (const r of text(name).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
      const cells: unknown[] = [];
      for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const head = c[1];
        const body = c[2] ?? '';
        const type = attr(head, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value: unknown = null;
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
        else if (type === 'str' || type === 'e') value = v !== undefined ? decodeXml(v) : null;
        else if (type === 'b') value = v === '1';
        else if (v !== undefined) {
          const num = Number(v);
          if (dateStyle[Number(attr(head, 's') ?? 0)]) {
            // Excel serial date (days since 1899-12-30, or 1904-01-01)
            const ms = Math.round((num - (date1904 ? -1462 : 0) - 25569) * 86400000);
            value = new Date(ms).toISOString().replace(/T00:00:00\.000Z$/, '');
          } else value = num;
        }
        // a forged reference ("ZZZZZZ1") must not allocate a huge sparse row: Excel ends at column XFD
        const column = columnIndex(attr(head, 'r') ?? 'A');
        if (column > MAX_COLUMN) throw new Error(l10n.t('Invalid cell reference in the Excel file'));
        cells[column] = value;
      }
      rows.push(cells);
    }
    const filled = rows.filter(r => r.some(v => v !== null && v !== undefined && v !== ''));
    if (filled.length > best.length) best = filled;
  }
  const [header, ...data] = best;
  if (!header) return [];
  const names = header.map((h, i) => (h === null || h === undefined || h === '' ? l10n.t('Column{0}', i + 1) : String(h).trim()));
  return data.map(r => Object.fromEntries(names.map((n, i) => [n, r[i] ?? null])));
}
