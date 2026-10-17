// Minimal .xlsx reader for preview data – e.g. Business Central's "Send to › Microsoft Excel Document (data only)".
// Reads the sheet with the most rows; the first non-empty row holds the column names. Dates (by number format) become
// ISO strings, numbers stay numbers. No dependencies: the zip container is read with Node's zlib.

import { inflateRawSync } from 'node:zlib';
import { l10n } from '../webview/l10n';

/** Files of a zip archive by name. */
export function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(l10n.t('Not a ZIP archive (no valid Excel or .app file)'));
  const count = view.getUint16(eocd + 10, true);
  // archives behind a header (Business Central .app files start with a "NAVX" header): all offsets are shifted
  const shift = eocd - (view.getUint32(eocd + 16, true) + view.getUint32(eocd + 12, true));
  let p = view.getUint32(eocd + 16, true) + shift;
  const files = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error(l10n.t('Damaged ZIP directory'));
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true), extraLen = view.getUint16(p + 30, true), commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true) + shift;
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** Column letters of a cell reference ("BC12" → 54, 0-based). */
const columnIndex = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;

const DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateFormat = (code: string) => /[dmyhs]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/0|#/.test(code.replace(/"[^"]*"/g, ''));

export function parseXlsx(buf: Uint8Array): Record<string, unknown>[] {
  const files = unzip(buf);
  const text = (name: string) => { const f = files.get(name); return f ? new TextDecoder().decode(f) : ''; };

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
        cells[columnIndex(attr(head, 'r') ?? 'A')] = value;
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
