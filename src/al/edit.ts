// Text edits on AL report objects made from the designer: new labels, new columns. Pure – offsets into the source;
// indentation follows the surrounding code.

import { AlDataItem, AlReport, AlSpan } from './parser';

export interface TextInsert { offset: number; text: string }

const lineStart = (src: string, offset: number) => src.lastIndexOf('\n', offset - 1) + 1;
const indentOf = (src: string, offset: number) => /^[ \t]*/.exec(src.slice(lineStart(src, offset)))![0];
const unit = (src: string) => (/\n\t/.test(src) && !/\n {4}\S/.test(src) ? '\t' : '    ');

/** AL identifier, quoted when needed ("No." → "No.", Description → Description). */
export const alIdentifier = (name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '')}"`);
const alString = (s: string) => `'${s.replace(/'/g, "''")}'`;

const ASCII: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };
const pascal = (s: string) => s.replace(/[äöüÄÖÜß]/g, c => ASCII[c]).split(/[^A-Za-z0-9]+/).filter(Boolean)
  .map(w => w[0].toUpperCase() + w.slice(1)).join('');

/** Label name from its text, like the base app's convention: "Rechnungsnr." → "RechnungsnrLbl". */
export function labelName(text: string, taken: Iterable<string> = []): string {
  const base = `${pascal(text).slice(0, 26) || 'Text'}Lbl`;
  const used = new Set([...taken].map(t => t.toLowerCase()));
  let name = base, n = 2;
  while (used.has(name.toLowerCase())) name = `${base.slice(0, -3)}${n++}Lbl`;
  return name;
}

/** Column name for a table field, like the base app's convention: "Unit Price" in data item Line → "UnitPrice_Line". */
export function columnName(field: string, dataItem: string, taken: Iterable<string> = []): string {
  const base = `${pascal(field) || 'Field'}_${pascal(dataItem) || dataItem}`;
  const used = new Set([...taken].map(t => t.toLowerCase()));
  let name = base, n = 2;
  while (used.has(name.toLowerCase())) name = `${base}${n++}`;
  return name;
}

/** Inserts `line` as the last entry of a block, on its own line before the closing brace. */
function beforeClose(src: string, span: AlSpan, line: string): TextInsert {
  const closeIndent = indentOf(src, span.close);
  const at = lineStart(src, span.close);
  // closing brace on the same line as other code ("{ }"): break the line
  if (src.slice(at, span.close).trim()) return { offset: span.close, text: `\n${closeIndent}${unit(src)}${line}\n${closeIndent}` };
  return { offset: at, text: `${closeIndent}${unit(src)}${line}\n` };
}

export interface LabelOptions { comment?: string; maxLength?: number; locked?: boolean }

/** The label declaration: `Name = 'Text', Comment = '…', MaxLength = 30, Locked = true;` */
export function labelEntry(name: string, text: string, o: LabelOptions = {}): string {
  return [
    `${alIdentifier(name)} = ${alString(text)}`,
    o.comment ? `Comment = ${alString(o.comment)}` : '',
    o.maxLength ? `MaxLength = ${Math.floor(o.maxLength)}` : '',
    o.locked ? 'Locked = true' : '',
  ].filter(Boolean).join(', ') + ';';
}

/** Adds a label to the report's labels block, creating the block after the dataset when there is none. */
export function insertLabel(src: string, report: AlReport, name: string, text: string, options: LabelOptions = {}): TextInsert {
  const entry = labelEntry(name, text, options);
  if (report.labelsSpan) return beforeClose(src, report.labelsSpan, entry);
  const span = report.span!;
  const inner = indentOf(src, span.close) + unit(src);
  const block = `${inner}labels\n${inner}{\n${inner}${unit(src)}${entry}\n${inner}}\n`;
  if (report.datasetSpan) {
    // after the dataset's closing brace
    const end = src.indexOf('\n', report.datasetSpan.close);
    return { offset: end < 0 ? src.length : end + 1, text: `\n${block}` };
  }
  return { offset: lineStart(src, span.close), text: block };
}

/** Adds columns to a data item (after its last column) or to an `add(...)` block of a report extension. */
export function insertColumns(src: string, target: { columnInsert?: number; span?: AlSpan }, columns: { name: string; source: string }[]): TextInsert {
  const at = target.columnInsert ?? target.span!.open + 1;
  const indent = target.span && at <= target.span.open + 1
    ? indentOf(src, target.span.open) + unit(src)
    : indentOf(src, Math.max(0, at - 1));
  return { offset: at, text: columns.map(c => `\n${indent}column(${alIdentifier(c.name)}; ${c.source}) { }`).join('') };
}

/** A new `add(DataItem) { columns }` block in a report extension's dataset. */
export function insertAddBlock(src: string, report: AlReport, dataItem: string, columns: { name: string; source: string }[]): TextInsert | null {
  if (!report.datasetSpan) return null;
  const inner = indentOf(src, report.datasetSpan.close) + unit(src);
  const lines = [`add(${alIdentifier(dataItem)})`, '{', ...columns.map(c => `${unit(src)}column(${alIdentifier(c.name)}; ${c.source}) { }`), '}'];
  const at = lineStart(src, report.datasetSpan.close);
  return { offset: at, text: lines.map(l => `${inner}${l}\n`).join('') };
}

/** The data item of a report by name (case-insensitive), searched depth first. */
export function findDataItem(items: AlDataItem[], name: string): AlDataItem | undefined {
  for (const d of items) {
    if (d.name.toLowerCase() === name.toLowerCase()) return d;
    const hit = findDataItem(d.children, name);
    if (hit) return hit;
  }
  return undefined;
}

export const applyInsert = (src: string, e: TextInsert) => src.slice(0, e.offset) + e.text + src.slice(e.offset);
