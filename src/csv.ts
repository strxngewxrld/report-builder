/** Parses CSV (comma or semicolon separated, RFC 4180 quoting) into row objects keyed by the header line. Numeric cells become numbers. */
export function parseCsv(text: string): Record<string, string | number | null>[] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records: string[][] = [];
  let field = '', row: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); records.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const [header, ...rest] = records.filter(r => r.some(f => f !== ''));
  if (!header) return [];
  return rest.map(r => Object.fromEntries(header.map((h, i) => {
    const v = r[i] ?? '';
    if (v === '') return [h.trim(), null];
    const n = Number(sep === ';' ? v.replace(',', '.') : v);
    return [h.trim(), Number.isNaN(n) ? v : n];
  })));
}
