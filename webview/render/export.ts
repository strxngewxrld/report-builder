// Content of a rendered report for export (Excel, Word): paragraphs and tables in reading order. Pure.

import { RenderResult } from './types';
import { RBox, RNode, RTable } from './types';

export type ExportAlign = 'left' | 'center' | 'right';
export type ExportBlock =
  | { kind: 'text'; text: string; bold?: boolean; size?: number; align?: ExportAlign }
  | { kind: 'table'; columns: number[]; rows: ExportCell[][] };
export interface ExportCell { text: string; value?: number | null; bold?: boolean; colSpan?: number; align?: ExportAlign; header?: boolean }

const isText = (n: RNode): n is RBox & { paragraphs: NonNullable<RBox['paragraphs']> } => n.kind === 'box' && !!n.paragraphs;
const textOf = (n: RBox) => (n.paragraphs ?? []).map(p => p.runs.map(r => r.text).join('')).join('\n').replace(/​/g, '');
const boldOf = (n: RBox) => [n.css, ...(n.paragraphs ?? []).flatMap(p => [p.css, ...p.runs.map(r => r.css)])].some(c => /bold|[6-9]00/i.test(String(c?.fontWeight ?? '')));
const alignOf = (n: RBox): ExportAlign | undefined => {
  const a = String(n.paragraphs?.[0]?.css.textAlign ?? n.css.textAlign ?? '');
  return a === 'center' || a === 'right' ? a : undefined;
};
const sizeOf = (n: RBox) => {
  const s = String(n.paragraphs?.[0]?.runs[0]?.css.fontSize ?? n.css.fontSize ?? '');
  const pt = /^([\d.]+)pt$/.exec(s);
  return pt ? Number(pt[1]) : undefined;
};
const numberOf = (n: RBox) => {
  const v = n.values?.[0]?.[1];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const readingOrder = (nodes: RNode[]) => [...nodes].sort((a, b) => a.top - b.top || a.left - b.left);
/** A container cell (list rectangle, nested table) is exported as its own content, not as one cell. */
const isContainer = (n: RNode | null) => !!n && (n.kind === 'table' || (n.kind === 'box' && !n.paragraphs));

export function exportBlocks(result: RenderResult): ExportBlock[] {
  const out: ExportBlock[] = [];
  const visit = (nodes: RNode[]) => {
    for (const n of readingOrder(nodes)) {
      if (n.hidden) continue;
      if (isText(n)) {
        const text = textOf(n).trim();
        if (text) out.push({ kind: 'text', text, bold: boldOf(n) || undefined, size: sizeOf(n), align: alignOf(n) });
      } else if (n.kind === 'box') visit(n.children ?? []);
      else if (n.kind === 'table') table(n);
      else if (n.kind === 'chart' && n.series.length) {
        // a chart's values as a table: categories × series
        out.push({ kind: 'table', columns: [1.5, ...n.series.map(() => 1)], rows: [
          [{ text: '', header: true }, ...n.series.map(s => ({ text: s.name, header: true, bold: true }))],
          ...n.categories.map((c, i) => [{ text: c }, ...n.series.map(s => ({ text: s.values[i] === null ? '' : String(s.values[i]), value: s.values[i] }))]),
        ] });
      }
    }
  };
  const table = (t: RTable) => {
    let current: ExportCell[][] = [];
    const flush = () => {
      if (current.length) out.push({ kind: 'table', columns: t.columns, rows: current });
      current = [];
    };
    for (const row of t.rows) {
      if (row.cells.some(c => isContainer(c.node))) {
        // list row (e.g. one Business Central document): its content in reading order
        flush();
        for (const c of row.cells) if (c.node && !c.node.hidden) visit([{ ...c.node, top: 0, left: 0 }]);
        continue;
      }
      const cells = row.cells.map((c): ExportCell => {
        const n = c.node;
        if (!n || n.hidden || !isText(n)) return { text: '', colSpan: c.colSpan > 1 ? c.colSpan : undefined };
        return { text: textOf(n), value: numberOf(n), bold: boldOf(n) || undefined, align: alignOf(n), colSpan: c.colSpan > 1 ? c.colSpan : undefined };
      });
      if (cells.some(c => c.text)) current.push(cells);
    }
    flush();
  };
  visit(result.body.nodes);
  return out;
}
