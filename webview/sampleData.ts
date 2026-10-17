import { DataSet, Field } from './model';
import type { Row } from './expr';

const WORDS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];

/** Field names that are numeric in Business Central datasets (which often carry no type information). */
const NUMERIC_NAME = /(amount|amt|qty|quantity|price|cost|balance|total|number|count|pct|percent|lineno|line_no|entryno|entry_no|_no_$|discount|vat|rate|weight|volume)/i;

/**
 * Fields the layout uses as numbers (aggregates, Code.Blank…, conversions, arithmetic) – for generated data when the
 * dataset has no type information, as in most Business Central layouts.
 */
export function numericFieldsFromLayout(xml: string): Set<string> {
  const out = new Set<string>();
  const fn = /\b(?:Sum|Avg|Min|Max|RunningValue|StDev|Var|BlankZero|BlankPos|BlankNeg|BlankZeroAndPos|BlankNegAndZero|CalcPct|CDec|CDbl|CInt|CLng|CSng|FormatNumber|FormatCurrency|FormatPercent)\s*\(\s*Fields!(\w+)/gi;
  for (const m of xml.matchAll(fn)) out.add(m[1]);
  for (const m of xml.matchAll(/Fields!(\w+)\.Value\s*[-*\/<>]|[-*\/<>]\s*Fields!(\w+)\.Value/g)) out.add(m[1] ?? m[2]);
  return out;
}

function mockValue(f: Field, i: number, numeric?: Set<string>): unknown {
  let t = f.typeName.replace(/^System\./, '').toLowerCase();
  if (!t) t = /format$/i.test(f.name) ? 'string' : numeric?.has(f.name) || NUMERIC_NAME.test(f.name) ? 'decimal' : /date/i.test(f.name) ? 'datetime' : 'string';
  const seed = (i * 7919 + f.name.length * 104729) % 1000;
  if (/^(int|long|short|byte|sbyte|uint|ulong|ushort)/.test(t)) return (seed % 100) + 1;
  if (/^(decimal|double|single|float)/.test(t)) return Math.round(seed * 13.37) / 10;
  if (t === 'datetime' || t === 'datetimeoffset' || t === 'date') {
    const d = new Date(2026, i % 12, (seed % 27) + 1);
    return f.typeName ? d.toISOString() : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  if (t === 'boolean') return i % 2 === 0;
  return `${f.name} ${WORDS[i % WORDS.length]}`;
}

/** Generated rows for a dataset without sample data, so the preview shows something meaningful. */
export function mockRows(ds: DataSet, count = 8, numeric?: Set<string>): Row[] {
  return Array.from({ length: count }, (_, i) => Object.fromEntries(ds.fields.map(f => [f.name, mockValue(f, i, numeric)])));
}

/** Maps sample rows (keyed by column name) to field names via DataField, and turns ISO date strings into Dates. */
/** Column names compared without case and punctuation ("No_Customer" ~ "No. Customer"). */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

export function bindRows(ds: DataSet, rows: Record<string, unknown>[]): Row[] {
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const byNorm = new Map(keys.map(k => [norm(k), k]));
  const column = (f: DataSet['fields'][number]) =>
    [f.dataField, f.name].find(k => k && keys.includes(k)) ?? byNorm.get(norm(f.dataField || f.name)) ?? byNorm.get(norm(f.name));
  const cols = new Map(ds.fields.map(f => [f.name, column(f)]));
  return rows.map(src => {
    const row: Row = {};
    for (const f of ds.fields) {
      const col = cols.get(f.name);
      let v = col !== undefined ? src[col] ?? null : null;
      // dates: typed fields, and ISO dates in untyped fields (Excel imports)
      if (typeof v === 'string' && (/^date/i.test(f.typeName.replace(/^System\./, '')) || (!f.typeName && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v))) && !Number.isNaN(Date.parse(v))) {
        v = new Date(/T/.test(v) ? v : `${v}T00:00:00`);
      }
      row[f.name] = v;
    }
    // Columns without a declared field are still reachable, which helps while fields are being defined.
    for (const [k, v] of Object.entries(src)) if (!(k in row)) row[k] = v;
    return row;
  });
}

/** Infers dataset fields from sample rows (used by "Felder aus Beispieldaten übernehmen"). */
export function inferFields(rows: Record<string, unknown>[]): Field[] {
  const names = [...new Set(rows.slice(0, 50).flatMap(r => Object.keys(r)))];
  return names.map(name => {
    const values = rows.slice(0, 50).map(r => r[name]).filter(v => v !== null && v !== undefined && v !== '');
    let typeName = 'System.String';
    if (values.length && values.every(v => typeof v === 'number')) {
      typeName = values.every(v => Number.isInteger(v)) ? 'System.Int32' : 'System.Decimal';
    } else if (values.length && values.every(v => typeof v === 'boolean')) {
      typeName = 'System.Boolean';
    } else if (values.length && values.every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))) {
      typeName = 'System.DateTime';
    }
    return { name: name.replace(/\W/g, '_'), dataField: name, typeName };
  });
}

export const isNumericType = (typeName: string) =>
  /^(System\.)?(Int|Long|Short|Byte|Decimal|Double|Single|Float|UInt)/i.test(typeName);
