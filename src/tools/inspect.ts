// Read-only views of a layout for language model tools (Copilot agent mode): a compact overview with the names and
// XML line numbers the model needs to edit the file directly, a validation report, and the preview as plain text.
// Pure: works on the XML text with @xmldom/xmldom, no VS Code API.

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { BcContext, bcMockRows, previewParameters } from '../../webview/bc';
import { Row, validateExpression } from '../../webview/expr';
import { hiddenOf } from '../../webview/layoutTools';
import { embeddedImages } from '../../webview/images';
import { Parameter, Report, ReportItem, RowMember, Section, TableItem, TableRow } from '../../webview/model';
import { XmlDom, elements, parseRdl, textboxText } from '../../webview/rdl';
import { renderReport } from '../../webview/render/engine';
import { RNode, RSection } from '../../webview/render/types';
import { bindRows, mockRows, numericFieldsFromLayout } from '../../webview/sampleData';
import { cellLayout, columnGroupList, groupList, rowsOfMember } from '../../webview/tablix';
import { tableHeight, tableWidth } from '../../webview/ops';
import { toUnit } from '../../webview/units';
import { CodeModule } from '../../webview/vb';
import { AlExpectation, layoutDeclarations, lintLayout } from '../lint';

/** XML DOM for the extension host; parse problems are reported by `checkXml`, not logged. */
export const nodeDom: XmlDom = {
  parse: xml => new DOMParser({ errorHandler: { warning: () => undefined, error: () => undefined } }).parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};

const ITEM_TAGS = ['Textbox', 'Rectangle', 'Line', 'Image', 'Tablix', 'Chart', 'Subreport', 'Map', 'GaugePanel', 'CustomReportItem'];

// ------------------------------------------------------------------------------------------------ positions

/** 1-based line of each offset. */
export function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return offset => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Line range of every report item and group in the XML, by name. */
export function itemLines(text: string): Map<string, { start: number; end: number }> {
  const line = lineIndex(text);
  const out = new Map<string, { start: number; end: number }>();
  const stack: { name: string; tag: string; start: number }[] = [];
  const tags = [...ITEM_TAGS, 'Group'].join('|');
  for (const m of text.matchAll(new RegExp(`<(${tags})\\s[^>]*?\\bName="([^"]+)"[^>]*?(/?)>|</(${tags})>`, 'g'))) {
    if (m[1]) {
      if (m[3]) out.set(m[2], { start: line(m.index!), end: line(m.index!) });
      else stack.push({ name: m[2], tag: m[1], start: m.index! });
    } else {
      const i = stack.map(s => s.tag).lastIndexOf(m[4]);
      if (i < 0) continue;
      const [open] = stack.splice(i);
      out.set(open.name, { start: line(open.start), end: line(m.index!) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ overview

export interface Unit { unit: 'in' | 'cm' }
const size = (inches: number, unit: 'in' | 'cm') => `${toUnit(inches, unit)}${unit}`;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s);
const quote = (s: string, max = 100) => JSON.stringify(clip(s.replace(/\r?\n/g, '\n'), max));

/** Fields of a dataset, with the Business Central "<Column>Format" companions folded in: "Amount(+Format)". */
function fieldList(names: string[]): string {
  const set = new Set(names);
  return names.filter(n => !(n.endsWith('Format') && set.has(n.slice(0, -6))))
    .map(n => (set.has(`${n}Format`) ? `${n}(+Format)` : n)).join(', ');
}

interface DescribeContext {
  r: Report;
  unit: 'in' | 'cm';
  lines: Map<string, { start: number; end: number }>;
  out: string[];
  full: boolean;
}

const at = (c: DescribeContext, name: string) => {
  const l = c.lines.get(name);
  return l ? (l.start === l.end ? ` L${l.start}` : ` L${l.start}-${l.end}`) : '';
};
const boxOf = (c: DescribeContext, it: { top: number; left: number; width: number; height: number }) =>
  ` at (${size(it.left, c.unit)}, ${size(it.top, c.unit)}) ${size(it.width, c.unit)}×${size(it.height, c.unit)}`;

function styleText(style: Record<string, string | undefined>): string {
  const entries = Object.entries(style).filter(([, v]) => v);
  return entries.length ? ` style{${entries.map(([k, v]) => `${k}: ${v}`).join('; ')}}` : '';
}

function itemLine(c: DescribeContext, it: ReportItem, positioned: boolean): string {
  const hidden = hiddenOf(it);
  const vis = hidden ? ` hidden=${quote(hidden, 60)}` : '';
  const pos = positioned ? boxOf(c, it) : '';
  const style = c.full ? styleText(it.style) : '';
  switch (it.type) {
    case 'textbox': return `Textbox ${it.name}${at(c, it.name)}${pos} ${quote(it.value, c.full ? 2000 : 100)}${it.style.Format ? ` format=${quote(it.style.Format, 40)}` : ''}${vis}${style}`;
    case 'rectangle': return `Rectangle ${it.name}${at(c, it.name)}${pos}${vis}${style}`;
    case 'line': return `Line ${it.name}${at(c, it.name)}${pos}`;
    case 'image': return `Image ${it.name}${at(c, it.name)}${pos} source=${it.source} value=${quote(it.value, 60)} sizing=${it.sizing}${vis}`;
    case 'table': return `Tablix ${it.name}${at(c, it.name)}${positioned ? ` at (${size(it.left, c.unit)}, ${size(it.top, c.unit)}) ${size(tableWidth(it), c.unit)}×${size(tableHeight(it), c.unit)}` : ''} dataset=${it.dataSetName || (positioned ? '(none)' : '(of the outer table)')}${vis} – structure editable with bcReport_editTable`;
    case 'raw': {
      const text = it.kind === 'Textbox' ? ` ${quote(it.preview ?? '', c.full ? 2000 : 100)} (rich text: several runs/paragraphs)` : '';
      return `${it.kind} ${it.name}${at(c, it.name)}${pos}${text}${it.kind === 'Chart' ? ' – edit with bcReport_editChart' : ''}`;
    }
  }
}

function describeItems(c: DescribeContext, items: ReportItem[], indent: string) {
  for (const it of items) describeItem(c, it, indent, true);
}

function describeItem(c: DescribeContext, it: ReportItem, indent: string, positioned: boolean) {
  c.out.push(`${indent}${itemLine(c, it, positioned)}`);
  if (it.type === 'rectangle') describeItems(c, it.items, `${indent}  `);
  if (it.type === 'table') describeTable(c, it, `${indent}  `);
  if (it.type === 'raw' && it.kind !== 'Textbox') describeRaw(c, it.xml, `${indent}  `);
}

/** Report items inside an item kept as XML (grouped Tablix regions of BC layouts, charts…): names and texts. */
function describeRaw(c: DescribeContext, xml: string, indent: string) {
  let root: Element;
  try { root = nodeDom.parse(`<w>${xml}</w>`).documentElement; } catch { return; }
  const walk = (el: Element, depth: number) => {
    for (const e of elements(el)) {
      if (ITEM_TAGS.includes(e.localName) && e.getAttribute('Name')) {
        const name = e.getAttribute('Name')!;
        const text = e.localName === 'Textbox' ? ` ${quote(textboxText(e), c.full ? 2000 : 80)}` : '';
        c.out.push(`${indent}${'  '.repeat(depth)}${e.localName} ${name}${at(c, name)}${text}`);
        walk(e, depth + 1);
      } else if (e.localName === 'Group' && e.getAttribute('Name')) {
        const exprs = Array.from(e.getElementsByTagName('GroupExpression') as ArrayLike<Element>, g => g.textContent ?? '');
        c.out.push(`${indent}${'  '.repeat(depth)}Group ${e.getAttribute('Name')}${at(c, e.getAttribute('Name')!)} ${exprs.length ? exprs.join(', ') : '(details)'}`);
        walk(e, depth);
      } else walk(e, depth);
    }
  };
  const top = elements(root)[0];
  if (top) walk(top, 0);
}

function memberText(m: RowMember, rows: TableRow[]): string {
  const g = m.group!;
  const index = (id: string) => rows.findIndex(r => r.id === id);
  const own = rowsOfMember(m).map(index).filter(i => i >= 0);
  const parts = [
    g.expressions.length ? `by ${g.expressions.join(', ')}` : '(details)',
    m.sort.length ? `sort ${m.sort.map(s => `${s.value}${s.descending ? ' desc' : ''}`).join(', ')}` : '',
    g.filters.length ? `filter ${g.filters.map(f => `${f.expression} ${f.operator} ${f.values.join('|')}`).join('; ')}` : '',
    g.pageBreak ? `pagebreak ${g.pageBreak}` : '',
    own.length ? `rows ${own[0]}${own.length > 1 ? `-${own[own.length - 1]}` : ''}` : '',
  ];
  return `${g.name} ${parts.filter(Boolean).join(' · ')}`;
}

function describeTable(c: DescribeContext, t: TableItem, indent: string) {
  c.out.push(`${indent}columns: ${t.columns.map((w, i) => `${i}=${size(w, c.unit)}`).join(', ')}`);
  for (const [i, row] of t.rows.entries()) {
    const cells = cellLayout(row).map(({ cell, span }) => {
      const value = cell.type === 'textbox' ? quote(cell.value, c.full ? 500 : 60) : cell.type === 'raw' ? `${cell.kind}${cell.preview !== undefined ? ` ${quote(cell.preview, 60)}` : ''}` : cell.type;
      return `${cell.name || '(empty)'}${span > 1 ? `(span ${span})` : ''}=${value}`;
    });
    c.out.push(`${indent}row ${i} ${row.kind} h=${size(row.height, c.unit)}: ${cells.join(' | ')}`);
    for (const cell of row.cells) {
      if (cell.type === 'rectangle') describeItems(c, cell.items, `${indent}    `);
      if (cell.type === 'table') describeItem(c, cell, `${indent}    `, false);
      if (cell.type === 'raw' && cell.kind !== 'Textbox') describeRaw(c, cell.xml, `${indent}    `);
      if (c.full && cell.type === 'textbox' && Object.keys(cell.style).length) c.out.push(`${indent}    ${cell.name}${styleText(cell.style)}`);
    }
  }
  const groups = groupList(t);
  if (groups.length) {
    c.out.push(`${indent}row groups (outermost first):`);
    for (const g of groups) c.out.push(`${indent}  ${'  '.repeat(g.depth)}${memberText(g.member, t.rows)}${at(c, g.member.group!.name)}`);
  }
  const headers = [...walkHeaders(t.rowMembers), ...walkHeaders(t.columnMembers)];
  if (headers.length) c.out.push(`${indent}header cells: ${headers.map(h => `${h.name}=${h.type === 'textbox' ? quote(h.value, 40) : h.type}`).join(' | ')}`);
  const cols = columnGroupList(t);
  if (cols.length) c.out.push(`${indent}column groups: ${cols.map(g => `${g.member.group!.name} by ${g.member.group!.expressions.join(', ') || '(none)'}`).join('; ')}`);
}

function walkHeaders(members: RowMember[]): ReportItem[] {
  return members.flatMap(m => [...(m.header ? [m.header.cell] : []), ...walkHeaders(m.children)]);
}

function sectionLine(name: string, s: Section, unit: 'in' | 'cm', extra = '') {
  return `${name}: height ${size(s.height, unit)}${extra}, ${s.items.length} item(s)`;
}

/**
 * Compact overview of a layout: page setup (with the classic blank-page check), datasets and parameters, code
 * functions, embedded images and the item tree with XML line ranges. `item` narrows it to one item with all details.
 */
export function describeLayout(text: string, opts: { path?: string; item?: string; bc?: BcContext | null } = {}): string {
  const r = parseRdl(text, nodeDom);
  const unit = r.unit;
  const c: DescribeContext = { r, unit, lines: itemLines(text), out: [], full: !!opts.item };
  if (opts.item) {
    const found = findItem(r, opts.item);
    if (!found) throw new Error(`No report item "${opts.item}". Call without "item" to list all items.`);
    describeItem(c, found.item, '', found.positioned);
    return c.out.join('\n');
  }
  const out = c.out;
  const ns = r.namespace.includes('2016') ? '2016' : r.namespace.includes('2010') ? '2010' : r.namespace;
  const bc = r.dataSets.some(d => d.name === 'DataSet_Result');
  out.push(`Layout ${opts.path ?? ''} · RDL ${ns} · unit ${unit} (write sizes like "2.5${unit}")${bc ? ' · Business Central layout' : ''}`);
  if (opts.bc) out.push(`AL ${opts.bc.kind} ${opts.bc.id ?? ''} "${opts.bc.reportName}" (${opts.bc.alFile}) – bcReport_getReportData shows its columns and labels`);
  const p = r.page;
  const printable = p.width - p.marginLeft - p.marginRight;
  out.push(`Page ${size(p.width, unit)} × ${size(p.height, unit)}, margins top ${size(p.marginTop, unit)} bottom ${size(p.marginBottom, unit)} left ${size(p.marginLeft, unit)} right ${size(p.marginRight, unit)}`);
  out.push(r.width > printable + 1e-4
    ? `WARNING body width ${size(r.width, unit)} > printable width ${size(printable, unit)} (page width minus left/right margins): PDF/print output gets a blank page after every page`
    : `Body width ${size(r.width, unit)} (printable width ${size(printable, unit)})`);
  if (r.header) out.push(sectionLine('Page header', r.header, unit));
  out.push(sectionLine('Body', r.body, unit));
  if (r.footer) out.push(sectionLine('Page footer', r.footer, unit));
  for (const ds of r.dataSets) out.push(`Dataset ${ds.name} (${ds.fields.length} fields): ${fieldList(ds.fields.map(f => f.name))}`);
  if (r.parameters.length) out.push(`Parameters (${r.parameters.length}): ${r.parameters.map(paramText).join(', ')}`);
  const code = layoutDeclarations(text).code;
  if (code) {
    try { out.push(`Code block functions: ${new CodeModule(code.text).functionNames.join(', ') || '(none)'}`); } catch { out.push('Code block: cannot be read'); }
  }
  const images = embeddedImages(r);
  if (images.length) out.push(`Embedded images: ${images.map(i => `${i.name} (${i.mimeType})`).join(', ')}`);
  out.push('', 'Items (Lx-y = lines in the XML file; positions are relative to the section or containing rectangle):');
  for (const [name, s] of [['Page header', r.header], ['Body', r.body], ['Page footer', r.footer]] as const) {
    if (!s) continue;
    out.push(`${name}:`);
    describeItems(c, s.items, '  ');
  }
  return out.join('\n');
}

const paramText = (p: Parameter) => (p.dataType === 'String' ? p.name : `${p.name}:${p.dataType}`);

/** An item by name anywhere in the report, and whether it has a position of its own (not a table cell). */
export function findItem(r: Report, name: string): { item: ReportItem; positioned: boolean } | null {
  const walk = (items: ReportItem[], positioned: boolean): { item: ReportItem; positioned: boolean } | null => {
    for (const it of items) {
      if (it.name === name) return { item: it, positioned };
      if (it.type === 'rectangle') { const hit = walk(it.items, true); if (hit) return hit; }
      if (it.type === 'table') {
        const hit = walk([...it.rows.flatMap(row => row.cells), ...walkHeaders(it.rowMembers), ...walkHeaders(it.columnMembers), ...(it.corner ?? []).flatMap(row => row.flatMap(x => (x.item ? [x.item] : [])))], false);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const s of [r.header, r.body, r.footer]) {
    const hit = s && walk(s.items, true);
    if (hit) return hit;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ validation

export interface Problem { severity: 'error' | 'warning' | 'info'; message: string; line?: number; item?: string; code: string }

/** Well-formedness of the XML (with line numbers from the parser). */
export function checkXml(text: string): Problem[] {
  const problems: Problem[] = [];
  const add = (severity: Problem['severity']) => (msg: string) => {
    const m = /line:(\d+)/.exec(msg);
    problems.push({ severity, code: 'xml', message: msg.replace(/^\[xmldom \w+\]\s*/, '').replace(/\s*@#\[line:\d+,col:\d+\]\s*$/, '').trim(), line: m ? Number(m[1]) : undefined });
  };
  new DOMParser({ locator: {}, errorHandler: { warning: () => undefined, error: add('error'), fatalError: add('error') } }).parseFromString(text, 'application/xml');
  return [...tagBalance(text), ...problems].slice(0, 20);
}

/** Start/end tags that do not match (xmldom silently repairs those, the report server does not). */
function tagBalance(text: string): Problem[] {
  const line = lineIndex(text);
  const problems: Problem[] = [];
  const stack: { name: string; at: number }[] = [];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/?)>|</g;
  for (const m of text.matchAll(re)) {
    if (m[0] === '<') { problems.push({ severity: 'error', code: 'xml', line: line(m.index!), message: 'Malformed tag ("<" must be written as &lt; in text and attribute values must be quoted).' }); continue; }
    if (!m[2]) continue;
    if (m[3]) continue; // <Empty />
    if (!m[1]) { stack.push({ name: m[2], at: m.index! }); continue; }
    const open = stack.pop();
    if (!open) { problems.push({ severity: 'error', code: 'xml', line: line(m.index!), message: `</${m[2]}> closes an element that was never opened.` }); continue; }
    if (open.name !== m[2]) {
      problems.push({ severity: 'error', code: 'xml', line: line(m.index!), message: `</${m[2]}> does not match <${open.name}> opened in line ${line(open.at)}.` });
      // resynchronize: the closing tag probably belongs further up
      const i = stack.map(s => s.name).lastIndexOf(m[2]);
      if (i >= 0) stack.splice(i);
      else stack.push(open);
    }
  }
  for (const open of stack.reverse()) problems.push({ severity: 'error', code: 'xml', line: line(open.at), message: `<${open.name}> is never closed.` });
  return problems;
}

/** Sample rows per dataset: the sidecar's data, else generated rows (Business Central: shaped like the AL data items). */
export function previewData(r: Report, xml: string, sample: Record<string, unknown[]>, bc: BcContext | null): { data: Record<string, Row[]>; generated: string[] } {
  const data: Record<string, Row[]> = {};
  const generated: string[] = [];
  const numeric = numericFieldsFromLayout(xml);
  for (const ds of r.dataSets) {
    const rows = sample[ds.name];
    if (Array.isArray(rows)) data[ds.name] = bindRows(ds, rows as Record<string, unknown>[]);
    else {
      generated.push(ds.name);
      data[ds.name] = bindRows(ds, bc && ds.name === 'DataSet_Result' ? bcMockRows(bc, ds.fields, numeric) : mockRows(ds, 8, numeric));
    }
  }
  return { data, generated };
}

function convertParam(p: Parameter, v: string): unknown {
  if (v === '') return p.nullable ? null : '';
  switch (p.dataType) {
    case 'Integer': return parseInt(v, 10);
    case 'Float': return parseFloat(v.replace(',', '.'));
    case 'Boolean': return v.toLowerCase() === 'true';
    case 'DateTime': { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d; }
    default: return v;
  }
}

function render(text: string, r: Report, opts: PreviewOptions) {
  const { data, generated } = previewData(r, text, opts.sample ?? {}, opts.bc ?? null);
  const defaults = previewParameters(r, opts.bc ?? null);
  const result = renderReport(text, {
    dom: nodeDom, mode: 'preview', data, reportName: opts.reportName, locale: opts.locale,
    parameters: Object.fromEntries(r.parameters.map(p => [p.name, convertParam(p, opts.parameters?.[p.name] ?? defaults[p.name] ?? '')])),
  });
  return { result, data, generated };
}

/**
 * Everything wrong with a layout that can be found without Business Central: XML errors, references the dataset
 * does not have (and AL-side drift), duplicate names, the blank-page problem, items outside their section,
 * expressions the evaluator cannot read, and errors while evaluating the preview with sample data.
 */
export function validateLayout(text: string, opts: { al?: AlExpectation | null } & PreviewOptions = {}): Problem[] {
  const xml = checkXml(text);
  if (xml.length) return xml;
  let r: Report;
  try { r = parseRdl(text, nodeDom); } catch (e) {
    return [{ severity: 'error', code: 'rdl', message: `Not a readable RDL report: ${(e as Error).message}` }];
  }
  const line = lineIndex(text);
  const lines = itemLines(text);
  const itemAt = (offset: number) => [...lines].filter(([, l]) => l.start <= line(offset) && line(offset) <= l.end).sort((a, b) => (a[1].end - a[1].start) - (b[1].end - b[1].start))[0]?.[0];
  const problems: Problem[] = lintLayout(text, opts.al ?? null).map(i => ({
    severity: i.severity === 'hint' ? 'info' : i.severity, code: i.code, message: i.message, line: line(i.offset), item: i.item,
  }));

  // names of report items and groups share one scope in RDL
  const seen = new Map<string, number>();
  for (const m of text.matchAll(new RegExp(`<(?:${ITEM_TAGS.join('|')}|Group)\\s[^>]*?\\bName="([^"]+)"`, 'g'))) {
    const first = seen.get(m[1]);
    if (first !== undefined) problems.push({ severity: 'error', code: 'duplicate-name', item: m[1], line: line(m.index!), message: `The name "${m[1]}" is used more than once (first in line ${first}); report item and group names must be unique.` });
    else seen.set(m[1], line(m.index!));
  }

  const unit = r.unit;
  const p = r.page;
  const printable = p.width - p.marginLeft - p.marginRight;
  if (r.width > printable + 1e-4) {
    problems.push({ severity: 'warning', code: 'page-width', message: `Body width ${size(r.width, unit)} exceeds the printable page width ${size(printable, unit)} (page ${size(p.width, unit)} minus margins ${size(p.marginLeft, unit)} + ${size(p.marginRight, unit)}): PDF and print get a blank page after every page. Make the body narrower or the margins smaller.` });
  }
  const outside = (s: Section | null, name: string, checkHeight: boolean) => {
    if (!s) return;
    for (const it of s.items) {
      const w = it.type === 'table' ? tableWidth(it) : it.width;
      const h = it.type === 'table' ? tableHeight(it) : it.height;
      if (it.left + w > r.width + 1e-3) problems.push({ severity: 'warning', code: 'outside', item: it.name, line: lines.get(it.name)?.start, message: `"${it.name}" ends at ${size(it.left + w, unit)}, beyond the body width ${size(r.width, unit)} (${name}).` });
      if (checkHeight && it.top + h > s.height + 1e-3) problems.push({ severity: 'warning', code: 'outside', item: it.name, line: lines.get(it.name)?.start, message: `"${it.name}" ends at ${size(it.top + h, unit)}, below the ${name} height ${size(s.height, unit)}: it is cut off.` });
    }
  };
  outside(r.header, 'page header', true);
  outside(r.body, 'body', false);
  outside(r.footer, 'page footer', true);

  // expressions the evaluator cannot read (outside the <Code> block)
  const code = layoutDeclarations(text).code;
  for (const m of text.matchAll(/>(=[^<]+)</g)) {
    if (code && m.index! >= code.start && m.index! < code.end) continue;
    const value = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    const error = validateExpression(value);
    if (error) problems.push({ severity: 'warning', code: 'expression', line: line(m.index!), message: `Expression ${quote(value, 80)} cannot be read: ${error}` });
  }

  // page header/footer: fields only inside an aggregate with a dataset scope (the report server refuses the layout)
  for (const sec of text.matchAll(/<(PageHeader|PageFooter)>[\s\S]*?<\/\1>/g)) {
    for (const m of sec[0].matchAll(/>(=[^<]*\bFields![^<]*)</g)) {
      const value = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
      const bare = value.replace(/\b\w+\s*\(\s*Fields!\w+\.Value\s*,\s*"[^"]+"\s*\)/gi, '');
      if (!/\bFields!/i.test(bare)) continue;
      const offset = sec.index! + m.index!;
      problems.push({ severity: 'error', code: 'fields-in-page-section', line: line(offset), item: itemAt(offset), message: `${sec[1] === 'PageHeader' ? 'Page header' : 'Page footer'} uses ${quote(value, 80)}: fields are only allowed there inside an aggregate with dataset scope, e.g. =First(Fields!X.Value, "${r.dataSets[0]?.name ?? 'DataSet_Result'}"). Business Central layouts usually pass body values with ReportItems!<Textbox>.Value or Code.SetData/GetData.` });
    }
  }

  try {
    const { result } = render(text, r, opts);
    for (const [item, message] of result.errors) problems.push({ severity: 'warning', code: 'evaluation', item, line: lines.get(item)?.start, message: `Preview evaluation of "${item}": ${message}` });
  } catch (e) {
    problems.push({ severity: 'warning', code: 'evaluation', message: `The preview could not be evaluated: ${(e as Error).message}` });
  }
  return problems;
}

export function formatProblems(problems: Problem[]): string {
  if (!problems.length) return 'No problems found.';
  const order = { error: 0, warning: 1, info: 2 };
  const counts = (['error', 'warning', 'info'] as const).map(s => [s, problems.filter(p => p.severity === s).length] as const).filter(([, n]) => n);
  return [
    counts.map(([s, n]) => `${n} ${s}${n > 1 ? 's' : ''}`).join(', '),
    ...[...problems].sort((a, b) => order[a.severity] - order[b.severity] || (a.line ?? 0) - (b.line ?? 0))
      .map(p => `- ${p.severity}${p.line ? ` L${p.line}` : ''}${p.item ? ` [${p.item}]` : ''} (${p.code}): ${p.message}`),
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------ preview as text

export interface PreviewOptions {
  /** Rows per dataset from the sidecar file (<layout>.data.json). */
  sample?: Record<string, unknown[]>;
  bc?: BcContext | null;
  parameters?: Record<string, string>;
  reportName?: string;
  locale?: string;
}

const nodeText = (n: RNode | null): string => {
  if (!n) return '';
  // number formats use (narrow) no-break spaces: plain spaces read and match better
  if (n.kind === 'box') return [...(n.paragraphs ?? []).map(p => p.runs.map(r => r.text.replace(/[  ]/g, ' ')).join('')), ...(n.children ?? []).filter(x => !x.hidden).map(nodeText)].filter(Boolean).join(' ');
  if (n.kind === 'table') return n.rows.map(r => r.cells.map(c => nodeText(c.node)).join(' ')).join(' ');
  if (n.kind === 'placeholder') return `[${n.label}]`;
  if (n.kind === 'image') return '[image]';
  return '';
};
const simple = (n: RNode | null) => !n || (n.kind === 'box' && !(n.children ?? []).length) || n.kind === 'image' || n.kind === 'line' || n.kind === 'placeholder';

function renderNodes(nodes: RNode[], indent: string, out: string[], budget: { rows: number }) {
  for (const n of [...nodes].sort((a, b) => a.top - b.top || a.left - b.left)) {
    if (n.hidden) continue;
    switch (n.kind) {
      case 'box':
        if (n.paragraphs) { out.push(`${indent}${n.name}: ${quote(nodeText({ ...n, children: [] }), 300)}`); break; }
        out.push(`${indent}${n.name} (rectangle):`);
        renderNodes(n.children ?? [], `${indent}  `, out, budget);
        break;
      case 'table': {
        out.push(`${indent}${n.name} (table, ${n.rows.length} rows):`);
        for (const row of n.rows) {
          if (budget.rows-- <= 0) { out.push(`${indent}  … (row limit reached)`); break; }
          const cells = row.cells.filter(c => c.node || c.colSpan);
          if (cells.every(c => simple(c.node) && !(c.node?.hidden))) out.push(`${indent}  |${row.breakBefore ? ' ⤓pagebreak |' : ''} ${cells.map(c => nodeText(c.node).replace(/\|/g, '\\|')).join(' | ')} |`);
          else {
            out.push(`${indent}  row${row.breakBefore ? ' (page break before)' : ''}:`);
            renderNodes(cells.flatMap(c => (c.node ? [c.node] : [])), `${indent}    `, out, budget);
          }
        }
        break;
      }
      case 'chart':
        out.push(`${indent}${n.name} (chart${n.title ? ` "${n.title}"` : ''}): categories ${JSON.stringify(n.categories.slice(0, 20))}`);
        for (const s of n.series) out.push(`${indent}  ${s.name} (${s.type}${s.derived ? ', calculated' : ''}): ${JSON.stringify(s.values.slice(0, 20))}`);
        break;
      case 'gauge': out.push(`${indent}${n.name} (gauge): ${n.value} of ${n.min}–${n.max}`); break;
      case 'image': out.push(`${indent}${n.name} (image)`); break;
      case 'placeholder': out.push(`${indent}${n.name}: [${n.label}]`); break;
      case 'line': break;
    }
  }
}

/** The preview as text: values of textboxes, tables as rows, charts as series – what the user would see. */
export function previewText(text: string, opts: PreviewOptions & { maxRows?: number } = {}): string {
  const r = parseRdl(text, nodeDom);
  const { result, data, generated } = render(text, r, opts);
  const out: string[] = [];
  const source = Object.entries(data).map(([ds, rows]) => `${ds}: ${rows.length} ${generated.includes(ds) ? 'generated' : 'sample'} rows`).join(', ');
  out.push(`Preview data – ${source || 'no datasets'}${generated.length ? ' (generated values are placeholders; put real rows into the <layout>.data.json sidecar to test with real data)' : ''}`);
  const page = { number: 1, total: 1, overallNumber: 1, overallTotal: 1, version: Number.MAX_SAFE_INTEGER, reportItems: new Map<string, unknown[]>() };
  const section = (title: string, s: RSection | null) => {
    if (!s) return;
    out.push(`${title}:`);
    renderNodes(s.nodes, '  ', out, budget);
  };
  const budget = { rows: opts.maxRows ?? 60 };
  if (result.header) section('Page header (as on page 1)', result.renderSection('header', page));
  section('Body', result.body);
  if (result.footer) section('Page footer (as on page 1)', result.renderSection('footer', page));
  if (result.errors.length) out.push('Evaluation errors:', ...result.errors.map(([item, message]) => `- ${item}: ${message}`));
  out.push('Page breaks are only applied in the designer preview (they depend on measured text heights).');
  return out.join('\n');
}

