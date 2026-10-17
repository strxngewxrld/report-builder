// Mutating helpers on a (cloned) Report draft. Items are addressed by name, which RDL requires to be unique.

import { headerLevels, plainHierarchy, staticColumn } from './tablix';
import {
  ItemType, RawItem, Report, tableHeaders, ReportItem, Section, SectionKind, Style, TableItem, TableRow, TextboxItem, allItems, fingerprint, newId, uniqueName,
  unchanged,
} from './model';

export interface Located {
  item: ReportItem;
  /** Array that holds the item (section items or rectangle children); null for table cells. */
  container: ReportItem[] | null;
  section: SectionKind;
  /** Offset of the container's origin relative to its section (non-zero inside rectangles). */
  originTop: number;
  originLeft: number;
  table?: TableItem;
  cell?: { row: number; col: number };
}

export const sections = (r: Report): [SectionKind, Section][] =>
  ([['header', r.header], ['body', r.body], ['footer', r.footer]] as [SectionKind, Section | null][])
    .filter((e): e is [SectionKind, Section] => !!e[1]);

export function locate(r: Report, name: string): Located | null {
  const walk = (items: ReportItem[], section: SectionKind, top: number, left: number): Located | null => {
    for (const item of items) {
      if (item.name === name) return { item, container: items, section, originTop: top, originLeft: left };
      if (item.type === 'rectangle') {
        const hit = walk(item.items, section, top + item.top, left + item.left);
        if (hit) return hit;
      }
      if (item.type === 'table') {
        let rowTop = top + item.top;
        for (const [ri, row] of item.rows.entries()) {
          let col = 0; // the column a cell starts in (merged cells before it span several columns)
          for (const cell of row.cells) {
            if (cell.name === name) return { item: cell, container: null, section, originTop: top, originLeft: left, table: item, cell: { row: ri, col } };
            // items inside a cell's rectangle (lists): positioned relative to the cell
            if (cell.type === 'rectangle') {
              const hit = walk(cell.items, section, rowTop, left + item.left + item.columns.slice(0, col).reduce((a, b) => a + b, 0));
              if (hit) return hit;
            }
            if (cell.type === 'table') {
              const hit = walk([cell], section, rowTop, left + item.left + item.columns.slice(0, col).reduce((a, b) => a + b, 0));
              if (hit && hit.item !== cell) return hit;
            }
            col += Math.max(1, cell.colSpan ?? 1);
          }
          rowTop += row.height;
        }
        // header and corner cells of a matrix
        const extra = [...tableHeaders(item).map(h => h.cell), ...(item.corner ?? []).flatMap(r => r.flatMap(c => (c.item ? [c.item] : [])))];
        for (const cell of extra) {
          if (cell.name === name) return { item: cell, container: null, section, originTop: top, originLeft: left, table: item };
          if (cell.type === 'rectangle') { const hit = walk(cell.items, section, top + item.top, left + item.left); if (hit) return hit; }
        }
      }
    }
    return null;
  };
  for (const [kind, s] of sections(r)) {
    const hit = walk(s.items, kind, 0, 0);
    if (hit) return hit;
  }
  return null;
}

export const sectionOf = (r: Report, kind: SectionKind): Section => (kind === 'body' ? r.body : kind === 'header' ? r.header! : r.footer!);

export const DEFAULT_TEXT_STYLE: Style = { PaddingLeft: '2pt', PaddingRight: '2pt', PaddingTop: '2pt', PaddingBottom: '2pt' };

export function makeTextbox(r: Report, value = '', taken?: Set<string>, extra: Partial<TextboxItem> = {}): TextboxItem {
  return {
    id: newId(), type: 'textbox', name: uniqueName(r, 'Textbox', taken), value, canGrow: true,
    top: 0, left: 0, width: 1, height: 0.25, style: { ...DEFAULT_TEXT_STYLE }, ...extra,
  };
}

const PREFIX: Record<ItemType, string> = {
  textbox: 'Textbox', rectangle: 'Rectangle', line: 'Line', image: 'Image', table: 'Tablix', raw: 'Item',
};

/** Default size (inches) of newly inserted items, used when the user clicks instead of drawing a frame. */
export const DEFAULT_SIZE: Record<Exclude<ItemType, 'raw'>, { width: number; height: number }> = {
  textbox: { width: 1.5, height: 0.25 },
  rectangle: { width: 2, height: 1 },
  line: { width: 2, height: 0 },
  image: { width: 1, height: 1 },
  table: { width: 3, height: 0.5 },
};

export function createItem(r: Report, type: Exclude<ItemType, 'raw'>, box: { top: number; left: number; width: number; height: number }): ReportItem {
  const base = { id: newId(), name: uniqueName(r, PREFIX[type]), style: {} as Style, ...box };
  switch (type) {
    case 'textbox': return { ...makeTextbox(r), ...box };
    case 'rectangle': return { ...base, type, items: [] };
    case 'line': return { ...base, type, style: { BorderStyle: 'Solid', BorderColor: 'Black', BorderWidth: '1pt' } };
    case 'image': return { ...base, type, source: 'External', value: '', sizing: 'FitProportional' };
    case 'table': return createTable(r, box, 3, '');
  }
}

/**
 * Business Central conventions for a field: the AL compiler adds "<Column>Format" for decimal columns (the number
 * format of the currency/precision at run time) and a "<Column>Caption" parameter for columns with IncludeCaption
 * (the translated field caption). Layouts should use them instead of fixed formats and texts.
 */
export function bcFieldConventions(r: Report, dataSetName: string, field: string) {
  const ds = r.dataSets.find(d => d.name === dataSetName) ?? r.dataSets[0];
  const hasFormat = !!ds?.fields.some(f => f.name === `${field}Format`);
  const hasCaption = r.parameters.some(p => p.name === `${field}Caption`);
  return {
    format: hasFormat ? `=Fields!${field}Format.Value` : undefined,
    caption: hasCaption ? `=Parameters!${field}Caption.Value` : undefined,
    numeric: hasFormat,
  };
}

/** Applies the number format convention to a textbox showing `field`. */
export function applyFieldFormat(r: Report, tb: TextboxItem, dataSetName: string, field: string) {
  const { format } = bcFieldConventions(r, dataSetName, field);
  if (format && !tb.style.Format) {
    tb.style.Format = format;
    tb.style.TextAlign ??= 'Right';
  }
}

/** Fields worth showing: without the generated "<Column>Format" companions. */
export const displayFields = (names: string[]) => names.filter(n => !(n.endsWith('Format') && names.includes(n.slice(0, -6))));

export function createTable(r: Report, box: { top: number; left: number; width: number }, columnCount: number, dataSetName: string, fieldNames: string[] = []): TableItem {
  const taken = new Set<string>();
  const name = uniqueName(r, 'Tablix');
  taken.add(name);
  const cols = Math.max(columnCount, fieldNames.length, 1);
  const colWidth = Math.max(box.width / cols, 0.5);
  const cell = (value: string, bold = false) => {
    const tb = makeTextbox(r, value, taken);
    taken.add(tb.name);
    tb.style = { ...tb.style, BorderStyle: 'Solid', BorderColor: 'LightGrey', BorderWidth: '1pt', ...(bold ? { FontWeight: 'Bold' } : {}) };
    return tb;
  };
  const header: TableRow = { id: newId(), kind: 'header', height: 0.25, cells: [] };
  const detail: TableRow = { id: newId(), kind: 'detail', height: 0.25, cells: [] };
  for (let c = 0; c < cols; c++) {
    const f = fieldNames[c];
    header.cells.push(cell(f ? bcFieldConventions(r, dataSetName, f).caption ?? splitCamel(f) : '', true));
    const d = cell(f ? `=Fields!${f}.Value` : '');
    if (f) applyFieldFormat(r, d, dataSetName, f);
    if (f && d.style.TextAlign === 'Right') header.cells[c].style.TextAlign = 'Right';
    detail.cells.push(d);
  }
  const t: TableItem = {
    id: newId(), type: 'table', name, dataSetName, top: box.top, left: box.left,
    width: colWidth * cols, height: 0.5, style: {}, columns: Array(cols).fill(colWidth), rows: [header, detail], rowMembers: [],
    columnMembers: Array.from({ length: cols }, () => staticColumn()),
  };
  t.rowMembers = plainHierarchy(t);
  return t;
}

/** "OrderDate" → "Order Date", like Report Builder's header captions. */
export const splitCamel = (s: string) => s.replace(/_/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2');

/** Removes items by name; removing a table cell clears its value instead. */
export function deleteItems(r: Report, names: string[]) {
  for (const name of names) {
    const loc = locate(r, name);
    if (!loc) continue;
    if (loc.container) loc.container.splice(loc.container.indexOf(loc.item), 1);
    else if (loc.item.type === 'textbox') loc.item.value = '';
  }
}

/**
 * Grows sections so new or edited items fit (Report Builder does the same when items are dragged past the bottom).
 * Untouched items are ignored, so loading an untidy layout and editing something else does not resize sections.
 */
export function fitSections(r: Report) {
  const touched = (items: ReportItem[]) => items.filter(i => !unchanged(i));
  for (const [, s] of sections(r)) {
    const bottom = Math.max(0, ...touched(s.items).map(i => i.top + (i.type === 'table' ? tableHeight(i) : Math.max(i.height, 0))));
    if (bottom > s.height) s.height = bottom;
  }
  const right = Math.max(0, ...touched(r.body.items).map(i => i.left + (i.type === 'table' ? tableWidth(i) : i.width)));
  if (right > r.width) r.width = right;
}

/** Width/height of a table including matrix header columns/rows. */
export const tableWidth = (t: TableItem) => t.columns.reduce((a, b) => a + b, 0) + headerLevels(t.rowMembers).reduce((a, b) => a + b, 0);
export const tableHeight = (t: TableItem) => t.rows.reduce((a, b) => a + b.height, 0) + headerLevels(t.columnMembers ?? []).reduce((a, b) => a + b, 0);

// table structure (columns, rows, groups, merged cells) lives in tablix.ts
export { deleteColumn, insertColumn, toggleTableRow } from './tablix';

/**
 * A raw item made in the designer from its XML (e.g. a new chart). Its origin records the box as written, so moving
 * or resizing it later patches the XML like for items read from a file.
 */
export function rawItem(kind: string, name: string, xml: string, box: { top: number; left: number; width: number; height: number }): RawItem {
  const inch = (v: number) => `${Math.round(v * 1e5) / 1e5}in`;
  return {
    id: newId(), type: 'raw', kind, name, xml, style: {}, ...box,
    // same key shape as the serializer's check (top, left, width, height)
    origin: { xml, key: fingerprint({ top: box.top, left: box.left, width: box.width, height: box.height }), order: [], sizes: { Top: inch(box.top), Left: inch(box.left), Height: inch(box.height), Width: inch(box.width) } },
  };
}

/** Deep-copies items with fresh ids and names (for paste / duplicate). */
export function cloneItems(r: Report, items: ReportItem[], offset: number): ReportItem[] {
  const taken = new Set<string>();
  const fresh = (it: ReportItem): ReportItem => {
    const copy = structuredClone(it);
    for (const x of allItems([copy])) {
      x.id = newId();
      x.name = uniqueName(r, PREFIX[x.type] ?? 'Item', taken);
      taken.add(x.name);
    }
    if (copy.type === 'raw') copy.xml = copy.xml.replace(/Name="[^"]*"/, `Name="${copy.name}"`);
    return copy;
  };
  return items.map(it => {
    const c = fresh(it);
    c.top += offset;
    c.left += offset;
    return c;
  });
}

/** Moves an item to the front (end of array, rendered last) or back. */
export function reorder(loc: Located, front: boolean) {
  if (!loc.container) return;
  const arr = loc.container;
  arr.splice(arr.indexOf(loc.item), 1);
  if (front) arr.push(loc.item);
  else arr.unshift(loc.item);
}

/** Renames an item; returns false if the name is invalid or taken. */
export function rename(r: Report, from: string, to: string): boolean {
  if (!/^[A-Za-z_][\w]*$/.test(to)) return false;
  if (from === to) return true;
  if (locate(r, to)) return false;
  const loc = locate(r, from);
  if (!loc) return false;
  loc.item.name = to;
  return true;
}
