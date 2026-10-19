// Structural layout edits for language model tools: what is tedious or error-prone to write as RDL XML by hand –
// new items with unique names, Tablix columns/rows/groups (cells, hierarchies and spans must stay consistent),
// charts, alignment and page setup. Each edit parses the layout, changes the model like the designer does and
// serializes it again, so untouched parts keep their original XML. Pure: no VS Code API.

import { ChartAxisSpec, ChartKind, ChartSpec, PALETTES, chartKinds, chartXml, emptyAxis, isShape, patchChart, readChart } from '../../webview/charts';
import { addEmbeddedImage } from '../../webview/images';
import { AlignOp, SizeOp, SpacingOp, alignItems, centerInContainer, distribute, makeSameSize, printsOn, setHidden, setPrintsOn } from '../../webview/layoutTools';
import { BreakLocation, ImageItem, Report, ReportItem, RowMember, Section, SectionKind, Style, StyleKey, TableItem, allReportItems, uniqueName } from '../../webview/model';
import {
  applyFieldFormat, bcFieldConventions, createItem, createTable, deleteItems, fitSections, locate, rawItem, rename, reorder, sectionOf, splitCamel, tableHeight,
} from '../../webview/ops';
import { parseRdl, serializeRdl } from '../../webview/rdl';
import {
  RowPlace, addChildGroup, addColumnGroup, addGroupRow, addParentGroup, cellAt, columnGroupList, createMatrix, deleteColumn, deleteColumnGroup, deleteGroup,
  deleteRow, groupList, insertColumn, insertRow, mergeCells, splitCell, toggleTableRow, uniqueGroupName, usedGroupNames,
} from '../../webview/tablix';
import { fromUnit, parseSize, toUnit } from '../../webview/units';
import { nodeDom } from './inspect';

export interface EditResult { text: string; summary: string[] }

/** A length: a number in the report's unit, or a string with unit ("2.5cm", "1in", "10pt", "5mm"). */
export type Len = number | string;

const lengthIn = (v: Len, unit: 'in' | 'cm', what: string): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return fromUnit(v, unit);
  if (typeof v === 'string' && /^\s*-?[\d.]+\s*$/.test(v)) return fromUnit(Number(v), unit);
  const inches = parseSize(String(v), NaN);
  if (Number.isNaN(inches)) throw new Error(`${what}: "${v}" is not a length (use a number in ${unit} or e.g. "2.5cm", "1in", "10pt").`);
  return inches;
};

const STYLE_KEYS: StyleKey[] = ['FontFamily', 'FontSize', 'FontWeight', 'FontStyle', 'TextDecoration', 'Color', 'Format', 'TextAlign', 'VerticalAlign', 'BackgroundColor',
  'BorderStyle', 'BorderColor', 'BorderWidth', 'PaddingLeft', 'PaddingRight', 'PaddingTop', 'PaddingBottom'];

/** Merges style entries; "" removes one. Unknown keys are refused (they would not be written). */
function applyStyle(style: Style, patch: Record<string, string> | undefined): Style {
  if (!patch) return style;
  const next = { ...style };
  for (const [k, v] of Object.entries(patch)) {
    if (!STYLE_KEYS.includes(k as StyleKey)) throw new Error(`Unknown style "${k}". Supported: ${STYLE_KEYS.join(', ')}. Other style elements can be edited in the XML.`);
    if (v === '' || v === null) delete next[k as StyleKey]; else next[k as StyleKey] = String(v);
  }
  return next;
}

const validName = (name: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

/** Parses, changes and serializes a layout; adds a warning when the body no longer fits the page. */
function change(text: string, fn: (r: Report) => string[]): EditResult {
  const r = parseRdl(text, nodeDom);
  const summary = fn(r);
  if (!summary.length) return { text, summary: ['nothing changed'] };
  fitSections(r);
  const printable = r.page.width - r.page.marginLeft - r.page.marginRight;
  if (r.width > printable + 1e-4) {
    summary.push(`WARNING: the body is ${toUnit(r.width, r.unit)}${r.unit} wide, the printable page width is ${toUnit(printable, r.unit)}${r.unit}: every page would be followed by a blank page. Narrow columns/items or set smaller margins (bcReport_setPageLayout).`);
  }
  return { text: serializeRdl(r, nodeDom), summary };
}

const tableOf = (r: Report, name: string): TableItem => {
  const loc = locate(r, name);
  if (!loc) throw new Error(`No report item "${name}".`);
  if (loc.item.type !== 'table') {
    throw new Error(loc.item.type === 'raw' && loc.item.kind === 'Tablix'
      ? `"${name}" is a Tablix the designer keeps as XML (structure it does not model); edit it in the XML.`
      : `"${name}" is not a table (${loc.item.type === 'raw' ? loc.item.kind : loc.item.type}).`);
  }
  return loc.item;
};

// ------------------------------------------------------------------------------------------------ tables

export type TableOp =
  | { op: 'insertColumn'; at?: number; width?: Len; field?: string; values?: (string | null)[] }
  | { op: 'deleteColumn'; at: number }
  | { op: 'setColumnWidth'; at: number; width: Len }
  | { op: 'insertRow'; row: number; place?: RowPlace; values?: (string | null)[] }
  | { op: 'deleteRow'; row: number }
  | { op: 'setRowHeight'; row: number; height: Len }
  | { op: 'headerRow' | 'footerRow'; present: boolean }
  | { op: 'addGroup'; row: number; mode?: 'parent' | 'child'; expression: string; name?: string; header?: boolean; footer?: boolean }
  | { op: 'deleteGroup'; group: string; deleteRows?: boolean }
  | { op: 'addGroupRow'; group: string; which: 'header' | 'footer' }
  | { op: 'setGroup'; group: string; expressions?: string[]; sort?: { value: string; descending?: boolean }[]; filters?: { expression: string; operator?: string; values: string[] }[]; pageBreak?: BreakLocation; hidden?: string }
  | { op: 'addColumnGroup'; column: number; expression: string; name?: string }
  | { op: 'deleteColumnGroup'; group: string; deleteColumns?: boolean }
  | { op: 'mergeCells'; cells: string[] }
  | { op: 'splitCell'; cell: string }
  | { op: 'setCell'; row: number; column: number; value?: string; style?: Record<string, string> }
  | { op: 'setDataSet'; dataSet: string };

function member(t: TableItem, name: string): RowMember {
  const m = [...groupList(t), ...columnGroupList(t)].find(g => g.member.group?.name === name)?.member;
  if (!m) throw new Error(`Table "${t.name}" has no group "${name}". Groups: ${[...groupList(t), ...columnGroupList(t)].map(g => g.member.group!.name).join(', ') || '(none)'}.`);
  return m;
}

const rowAt = (t: TableItem, row: number) => {
  const r = t.rows[row];
  if (!r) throw new Error(`Table "${t.name}" has rows 0–${t.rows.length - 1}, not ${row}.`);
  return r;
};
const columnAt = (t: TableItem, col: number, allowEnd = false) => {
  if (!Number.isInteger(col) || col < 0 || col > t.columns.length - (allowEnd ? 0 : 1)) throw new Error(`Table "${t.name}" has columns 0–${t.columns.length - 1}, not ${col}.`);
  return col;
};

function setCellValue(r: Report, t: TableItem, row: number, col: number, value: string | null | undefined, style?: Record<string, string>) {
  const e = cellAt(rowAt(t, row), col);
  if (!e) throw new Error(`Row ${row} has no cell in column ${col}.`);
  if (e.cell.type !== 'textbox') throw new Error(`Cell ${e.cell.name || `${row}/${col}`} is a ${e.cell.type === 'raw' ? e.cell.kind : e.cell.type}, not a simple textbox; edit it in the XML.`);
  if (value !== undefined && value !== null) e.cell.value = value;
  e.cell.style = applyStyle(e.cell.style, style);
  const field = /^=Fields!(\w+)\.Value$/.exec(e.cell.value)?.[1];
  if (field) applyFieldFormat(r, e.cell, t.dataSetName, field);
}

/** Applies table operations in order (row/column numbers refer to the table as left by the previous operation). */
export function editTable(text: string, table: string, ops: TableOp[]): EditResult {
  return change(text, r => {
    const t = tableOf(r, table);
    const done: string[] = [];
    for (const [i, o] of ops.entries()) {
      const fail = (msg: string) => { throw new Error(`Operation ${i} (${o.op}): ${msg}`); };
      try {
        switch (o.op) {
          case 'insertColumn': {
            const at = columnAt(t, o.at ?? t.columns.length, true);
            insertColumn(r, t, at);
            t.columns[at] = o.width !== undefined ? lengthIn(o.width, r.unit, 'width') : t.columns[Math.max(0, at - 1)] ?? 1;
            if (o.field) {
              const caption = bcFieldConventions(r, t.dataSetName, o.field).caption ?? splitCamel(o.field);
              t.rows.forEach((row, ri) => {
                if (row.kind === 'header') setCellValue(r, t, ri, at, caption);
                if (row.kind === 'detail') setCellValue(r, t, ri, at, `=Fields!${o.field}.Value`);
              });
              const detail = t.rows.findIndex(x => x.kind === 'detail');
              const right = detail >= 0 && (cellAt(t.rows[detail], at)?.cell.style.TextAlign === 'Right');
              if (right) t.rows.forEach((row, ri) => { if (row.kind === 'header') setCellValue(r, t, ri, at, undefined, { TextAlign: 'Right' }); });
            }
            o.values?.forEach((v, ri) => { if (v !== null && v !== undefined) setCellValue(r, t, ri, at, v); });
            done.push(`column ${at} inserted`);
            break;
          }
          case 'deleteColumn':
            if (t.columns.length <= 1) fail('the last column cannot be deleted');
            deleteColumn(t, columnAt(t, o.at));
            done.push(`column ${o.at} deleted`);
            break;
          case 'setColumnWidth':
            t.columns[columnAt(t, o.at)] = lengthIn(o.width, r.unit, 'width');
            done.push(`column ${o.at} width set`);
            break;
          case 'insertRow': {
            const row = insertRow(r, t, rowAt(t, o.row).id, o.place ?? 'below') ?? fail('the row cannot be inserted there');
            const index = t.rows.indexOf(row);
            o.values?.forEach((v, c) => { if (v !== null && v !== undefined) setCellValue(r, t, index, c, v); });
            done.push(`row ${index} inserted (${row.kind})`);
            break;
          }
          case 'deleteRow':
            if (!deleteRow(t, rowAt(t, o.row).id)) fail('this row cannot be deleted (the last row, the detail row of a group or the only content of a group – delete the group instead)');
            done.push(`row ${o.row} deleted`);
            break;
          case 'setRowHeight':
            rowAt(t, o.row).height = lengthIn(o.height, r.unit, 'height');
            done.push(`row ${o.row} height set`);
            break;
          case 'headerRow':
          case 'footerRow': {
            const kind = o.op === 'headerRow' ? 'header' : 'footer';
            if (t.rows.some(x => x.kind === kind) !== o.present) toggleTableRow(r, t, kind);
            done.push(`table ${kind} row ${o.present ? 'present' : 'removed'}`);
            break;
          }
          case 'addGroup': {
            if (!o.expression?.trim()) fail('"expression" is required, e.g. =Fields!Region.Value');
            const name = o.name ?? uniqueGroupName(r, `${t.name}_Group`);
            if (!validName(name) || usedGroupNames(r).has(name) || allReportItems(r).some(x => x.name === name)) fail(`the group name "${name}" is invalid or taken`);
            const opts = { name, expression: o.expression, header: o.header ?? true, footer: o.footer ?? false };
            const g = (o.mode === 'child' ? addChildGroup : addParentGroup)(r, t, rowAt(t, o.row).id, opts) ?? fail('no group can be added at this row');
            done.push(`group ${g.group!.name} added`);
            break;
          }
          case 'deleteGroup': {
            const m = member(t, o.group);
            const ok = columnGroupList(t).some(g => g.member === m) ? deleteColumnGroup(r, t, m.id, false) : deleteGroup(t, m.id, o.deleteRows ?? true);
            if (!ok) fail('the group cannot be deleted (the details group is removed together with its parent)');
            done.push(`group ${o.group} deleted`);
            break;
          }
          case 'addGroupRow': {
            const row = addGroupRow(r, t, member(t, o.group).id, o.which) ?? fail('cannot add a row to this group');
            done.push(`group ${o.which} row ${t.rows.indexOf(row)} added`);
            break;
          }
          case 'setGroup': {
            const m = member(t, o.group);
            const g = m.group!;
            if (o.expressions) g.expressions = o.expressions.filter(e => e.trim());
            if (o.sort) m.sort = o.sort.map(s => ({ value: s.value, descending: !!s.descending }));
            if (o.filters) g.filters = o.filters.map(f => ({ expression: f.expression, operator: f.operator ?? 'Equal', values: f.values }));
            if (o.pageBreak !== undefined) g.pageBreak = o.pageBreak;
            if (o.hidden !== undefined) setHidden(m, o.hidden);
            done.push(`group ${o.group} updated`);
            break;
          }
          case 'addColumnGroup': {
            const name = o.name ?? uniqueGroupName(r, `${t.name}_ColumnGroup`);
            if (!validName(name) || usedGroupNames(r).has(name)) fail(`the group name "${name}" is invalid or taken`);
            addColumnGroup(r, t, columnAt(t, o.column), { name, expression: o.expression }) ?? fail('no column group can be added here');
            done.push(`column group ${name} added`);
            break;
          }
          case 'deleteColumnGroup':
            if (!deleteColumnGroup(r, t, member(t, o.group).id, o.deleteColumns ?? false)) fail('the column group cannot be deleted');
            done.push(`column group ${o.group} deleted`);
            break;
          case 'mergeCells': {
            const name = mergeCells(t, o.cells) ?? fail('the cells must be adjacent cells of one row');
            done.push(`cells merged into ${name}`);
            break;
          }
          case 'splitCell':
            if (!splitCell(r, t, o.cell)) fail(`"${o.cell}" is not a merged cell of this table`);
            done.push(`cell ${o.cell} split`);
            break;
          case 'setCell':
            setCellValue(r, t, o.row, columnAt(t, o.column), o.value, o.style);
            done.push(`cell ${o.row}/${o.column} set`);
            break;
          case 'setDataSet':
            if (!r.dataSets.some(d => d.name === o.dataSet)) fail(`no dataset "${o.dataSet}" (${r.dataSets.map(d => d.name).join(', ')})`);
            t.dataSetName = o.dataSet;
            done.push(`dataset set to ${o.dataSet}`);
            break;
          default:
            fail('unknown operation');
        }
      } catch (e) {
        const msg = (e as Error).message;
        throw new Error(msg.startsWith('Operation ') ? msg : `Operation ${i} (${o.op}): ${msg}`);
      }
    }
    return done;
  });
}

// ------------------------------------------------------------------------------------------------ new items

export interface NewItem {
  type: 'textbox' | 'rectangle' | 'line' | 'image' | 'table' | 'matrix' | 'chart';
  section?: SectionKind;
  /** Name of a rectangle to put the item into (position relative to it). */
  parent?: string;
  name?: string;
  top?: Len; left?: Len; width?: Len; height?: Len;
  /** Textbox: text or expression. Image: embedded image name, URL or expression (see `source`). */
  value?: string;
  style?: Record<string, string>;
  /** Visibility: "true" or an expression that hides the item. */
  hidden?: string;
  canGrow?: boolean;
  /** Table, matrix, chart: the dataset (default: the first one). */
  dataSet?: string;
  /** Table: one column per field, with header captions and BC number formats. */
  fields?: string[];
  /** Table without fields: number of empty columns. */
  columns?: number;
  matrix?: { rowGroup: string; columnGroup: string; value: string; rowTotal?: boolean; columnTotal?: boolean };
  chart?: Partial<ChartSpec>;
  source?: ImageItem['source'];
  sizing?: ImageItem['sizing'];
  /** Image file to embed (read by the extension host). */
  embed?: { name: string; mimeType: string; data: string };
}

function containerOf(r: Report, it: NewItem): { items: ReportItem[]; section: Section; width: number } {
  if (it.parent) {
    const loc = locate(r, it.parent);
    if (!loc || loc.item.type !== 'rectangle') throw new Error(`"${it.parent}" is not a rectangle.`);
    return { items: loc.item.items, section: sectionOf(r, loc.section), width: loc.item.width };
  }
  const kind = it.section ?? 'body';
  if (kind === 'header' && !r.header) r.header = { height: 0.25, items: [], style: {} };
  if (kind === 'footer' && !r.footer) r.footer = { height: 0.25, items: [], style: {} };
  return { items: sectionOf(r, kind).items, section: sectionOf(r, kind), width: r.width };
}

const bottomOf = (items: ReportItem[]) => Math.max(0, ...items.map(i => i.top + (i.type === 'table' ? tableHeight(i) : i.height)));

function chartSpec(name: string, c: Partial<ChartSpec> | undefined, dataSet: string): ChartSpec {
  const kinds = chartKinds().map(k => k[0]);
  if (c?.kind && !kinds.includes(c.kind)) throw new Error(`Unknown chart kind "${c.kind}". Kinds: ${kinds.join(', ')}.`);
  if (!c?.series?.length) throw new Error('A chart needs at least one series, e.g. series: [{ name: "Sales", value: "=Sum(Fields!Amount.Value)" }].');
  if (c.palette && !PALETTES.includes(c.palette)) throw new Error(`Unknown palette "${c.palette}". Palettes: ${PALETTES.join(', ')}.`);
  const axis = (a?: Partial<ChartAxisSpec>): ChartAxisSpec => ({ ...emptyAxis(), ...a });
  const kind = (c.kind ?? 'Column') as ChartKind;
  return {
    name, dataSetName: c.dataSetName ?? dataSet, kind, category: c.category ?? '', series: c.series,
    // pie-like charts name their categories in the legend
    title: c.title ?? '', legend: c.legend ?? (isShape(kind) || c.series.length > 1), palette: c.palette ?? 'BrightPastel', dataLabels: !!c.dataLabels,
    categoryAxis: axis(c.categoryAxis), valueAxis: axis(c.valueAxis), secondaryAxis: axis(c.secondaryAxis),
  };
}

/** Inserts new items; returns the names given to them. */
export function insertItems(text: string, items: NewItem[]): EditResult {
  return change(text, r => {
    const done: string[] = [];
    for (const [i, it] of items.entries()) {
      try { done.push(insertOne(r, it)); } catch (e) { throw new Error(`Item ${i} (${it.type}): ${(e as Error).message}`); }
    }
    return done;
  });
}

function insertOne(r: Report, it: NewItem): string {
  const unit = r.unit;
  const { items, width: containerWidth } = containerOf(r, it);
  const len = (v: Len | undefined, what: string) => (v === undefined ? undefined : lengthIn(v, unit, what));
  const top = len(it.top, 'top') ?? (items.length ? bottomOf(items) + 0.1 : 0);
  const left = len(it.left, 'left') ?? 0;
  const dataSet = it.dataSet ?? r.dataSets[0]?.name ?? '';
  if (it.dataSet && !r.dataSets.some(d => d.name === it.dataSet)) throw new Error(`No dataset "${it.dataSet}" (${r.dataSets.map(d => d.name).join(', ') || 'the layout has none'}).`);
  if (it.name && (!validName(it.name) || allReportItems(r).some(x => x.name === it.name) || usedGroupNames(r).has(it.name))) throw new Error(`The name "${it.name}" is invalid or taken.`);
  let item: ReportItem;
  switch (it.type) {
    case 'table': {
      const width = len(it.width, 'width') ?? Math.min(containerWidth - left, Math.max(it.fields?.length ?? it.columns ?? 3, 1) * 1);
      item = createTable(r, { top, left, width }, it.fields?.length ? it.fields.length : it.columns ?? 3, dataSet, it.fields ?? []);
      break;
    }
    case 'matrix': {
      if (!it.matrix) throw new Error('"matrix" is required: { rowGroup, columnGroup, value }.');
      item = createMatrix(r, { top, left }, { dataSetName: dataSet, rowTotal: false, columnTotal: false, ...it.matrix });
      break;
    }
    case 'chart': {
      const name = it.name ?? uniqueName(r, 'Chart');
      const spec = chartSpec(name, it.chart, dataSet);
      const box = { top, left, width: len(it.width, 'width') ?? 4, height: len(it.height, 'height') ?? 2.5 };
      items.push(rawItem('Chart', name, chartXml(spec, box), box));
      return `chart ${name} inserted`;
    }
    default: {
      const defaults = { textbox: [1.5, 0.25], rectangle: [2, 1], line: [2, 0], image: [1, 1] }[it.type];
      if (!defaults) throw new Error(`Unknown item type "${it.type}".`);
      item = createItem(r, it.type, { top, left, width: len(it.width, 'width') ?? defaults[0], height: len(it.height, 'height') ?? defaults[1] });
    }
  }
  if (item.type === 'textbox') {
    item.value = it.value ?? '';
    if (it.canGrow !== undefined) item.canGrow = it.canGrow;
    const field = /^=Fields!(\w+)\.Value$/.exec(item.value)?.[1];
    if (field) applyFieldFormat(r, item, dataSet, field);
  }
  if (item.type === 'image') {
    if (it.embed) {
      item.source = 'Embedded';
      item.value = addEmbeddedImage(r, it.embed.name, it.embed.mimeType, it.embed.data);
    } else {
      item.source = it.source ?? (it.value && /^(https?:|=)/i.test(it.value) ? 'External' : 'Embedded');
      item.value = it.value ?? '';
    }
    if (it.sizing) item.sizing = it.sizing;
  }
  if (item.type !== 'table') {
    item.style = applyStyle(item.style, it.style);
  }
  if (it.hidden) setHidden(item, it.hidden);
  items.push(item);
  if (it.name) rename(r, item.name, it.name);
  return `${it.type} ${it.name ?? item.name} inserted`;
}

// ------------------------------------------------------------------------------------------------ charts

/** Changes a chart; `set` holds the properties to change (series replace the existing list). */
export function editChart(text: string, name: string, set: Partial<ChartSpec>): EditResult {
  return change(text, r => {
    const loc = locate(r, name);
    if (!loc || loc.item.type !== 'raw' || loc.item.kind !== 'Chart') throw new Error(`"${name}" is not a chart.`);
    const current = readChart(loc.item.xml, nodeDom);
    if (!current) throw new Error(`"${name}" cannot be read as a chart.`);
    const merged = chartSpec(name, {
      ...current, ...set,
      categoryAxis: { ...current.categoryAxis, ...set.categoryAxis },
      valueAxis: { ...current.valueAxis, ...set.valueAxis },
      secondaryAxis: { ...current.secondaryAxis, ...set.secondaryAxis },
    }, current.dataSetName);
    loc.item.xml = patchChart(loc.item.xml, merged, nodeDom);
    return [`chart ${name} updated`];
  });
}

/** The editable description of a chart (what bcReport_editChart takes). */
export function chartOf(text: string, name: string): ChartSpec {
  const r = parseRdl(text, nodeDom);
  const loc = locate(r, name);
  if (!loc || loc.item.type !== 'raw' || loc.item.kind !== 'Chart') throw new Error(`"${name}" is not a chart.`);
  const spec = readChart(loc.item.xml, nodeDom);
  if (!spec) throw new Error(`"${name}" cannot be read as a chart.`);
  return spec;
}

// ------------------------------------------------------------------------------------------------ arranging

export interface ArrangeOptions {
  items: string[];
  align?: AlignOp;
  sameSize?: SizeOp;
  distribute?: SpacingOp;
  center?: SpacingOp;
  order?: 'front' | 'back';
  /** Explicit positions/sizes per item. */
  boxes?: { name: string; top?: Len; left?: Len; width?: Len; height?: Len }[];
  delete?: boolean;
}

export function arrangeItems(text: string, o: ArrangeOptions): EditResult {
  return change(text, r => {
    const names = o.items ?? [];
    for (const n of [...names, ...(o.boxes ?? []).map(b => b.name)]) if (!locate(r, n)) throw new Error(`No report item "${n}".`);
    const done: string[] = [];
    for (const b of o.boxes ?? []) {
      const loc = locate(r, b.name)!;
      if (!loc.container) throw new Error(`"${b.name}" is a table cell: set column widths and row heights with bcReport_editTable.`);
      for (const key of ['top', 'left', 'width', 'height'] as const) {
        if (b[key] === undefined) continue;
        if (loc.item.type === 'table' && (key === 'width' || key === 'height')) throw new Error(`The size of table "${b.name}" comes from its columns and rows (bcReport_editTable).`);
        loc.item[key] = lengthIn(b[key]!, r.unit, key);
      }
      done.push(`${b.name} positioned`);
    }
    if (o.align) { if (!alignItems(r, names, o.align)) throw new Error('Aligning needs two or more items in the same container; the first one is the reference.'); done.push(`aligned ${o.align} to ${names[0]}`); }
    if (o.sameSize) { if (!makeSameSize(r, names, o.sameSize)) throw new Error('Needs two or more items in the same container; the first one is the reference.'); done.push(`same ${o.sameSize} as ${names[0]}`); }
    if (o.distribute) { if (!distribute(r, names, o.distribute)) throw new Error('Distributing needs three or more items in the same container.'); done.push(`distributed ${o.distribute}ly`); }
    if (o.center) { if (!centerInContainer(r, names, o.center)) throw new Error('Nothing to center.'); done.push(`centered ${o.center}ly`); }
    if (o.order) for (const n of names) reorder(locate(r, n)!, o.order === 'front');
    if (o.order) done.push(`moved to the ${o.order}`);
    if (o.delete) { deleteItems(r, names); done.push(`deleted ${names.join(', ')} (table cells are cleared instead)`); }
    return done;
  });
}

// ------------------------------------------------------------------------------------------------ page setup

export interface PageOptions {
  pageWidth?: Len; pageHeight?: Len;
  marginTop?: Len; marginBottom?: Len; marginLeft?: Len; marginRight?: Len;
  bodyWidth?: Len; bodyHeight?: Len;
  /** Shrinks the body to the printable width (page width minus left/right margins). */
  fitBodyToPage?: boolean;
  header?: { present?: boolean; height?: Len; printOnFirstPage?: boolean; printOnLastPage?: boolean };
  footer?: { present?: boolean; height?: Len; printOnFirstPage?: boolean; printOnLastPage?: boolean };
  unit?: 'in' | 'cm';
}

export function setPageLayout(text: string, o: PageOptions): EditResult {
  return change(text, r => {
    const len = (v: Len, what: string) => lengthIn(v, r.unit, what);
    const done: string[] = [];
    const page = r.page;
    for (const [key, prop] of [['pageWidth', 'width'], ['pageHeight', 'height'], ['marginTop', 'marginTop'], ['marginBottom', 'marginBottom'], ['marginLeft', 'marginLeft'], ['marginRight', 'marginRight']] as const) {
      if (o[key] !== undefined) { page[prop] = len(o[key]!, key); done.push(`${key} set`); }
    }
    if (o.bodyWidth !== undefined) { r.width = len(o.bodyWidth, 'bodyWidth'); done.push('body width set'); }
    if (o.bodyHeight !== undefined) { r.body.height = len(o.bodyHeight, 'bodyHeight'); done.push('body height set'); }
    for (const kind of ['header', 'footer'] as const) {
      const s = o[kind];
      if (!s) continue;
      if (s.present === false) { r[kind] = null; done.push(`page ${kind} removed`); continue; }
      if (!r[kind]) { r[kind] = { height: 0.5, items: [], style: {} }; done.push(`page ${kind} added`); }
      const sec = r[kind]!;
      if (s.height !== undefined) sec.height = len(s.height, `${kind}.height`);
      if (s.printOnFirstPage !== undefined && s.printOnFirstPage !== printsOn(sec, 'First')) setPrintsOn(sec, 'First', s.printOnFirstPage);
      if (s.printOnLastPage !== undefined && s.printOnLastPage !== printsOn(sec, 'Last')) setPrintsOn(sec, 'Last', s.printOnLastPage);
      done.push(`page ${kind} updated`);
    }
    if (o.fitBodyToPage) {
      const printable = page.width - page.marginLeft - page.marginRight;
      const right = Math.max(0, ...r.body.items.map(i => i.left + (i.type === 'table' ? i.columns.reduce((a, b) => a + b, 0) : i.width)));
      if (right > printable + 1e-4) throw new Error(`Items reach ${toUnit(right, r.unit)}${r.unit}, the printable width is ${toUnit(printable, r.unit)}${r.unit}: make them narrower first.`);
      r.width = printable;
      done.push(`body width set to the printable width ${toUnit(printable, r.unit)}${r.unit}`);
    }
    if (o.unit && o.unit !== r.unit) { r.unit = o.unit; done.push(`unit set to ${o.unit}`); }
    return done;
  });
}

