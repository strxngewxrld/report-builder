// Row groups and merged cells of tables: the row hierarchy (<TablixRowHierarchy>) as a member tree whose leaves are
// the rows, and the operations of Report Builder's / Visual Studio's "Add Group", "Insert Row", "Merge Cells".
// Pure helpers on a Report draft; rows are kept in leaf order and their kinds are derived from the tree.

import { Report, ReportItem, RowMember, SortExpression, TableGroup, TableItem, TableRow, TextboxItem, newId, uniqueName } from './model';
import { makeTextbox } from './ops';

// ------------------------------------------------------------------------------------------------ tree basics

export function* walkMembers(members: RowMember[], parents: RowMember[] = []): Generator<{ member: RowMember; parents: RowMember[] }> {
  for (const m of members) {
    yield { member: m, parents };
    yield* walkMembers(m.children, [...parents, m]);
  }
}

export const leavesOf = (members: RowMember[]): RowMember[] => members.flatMap(m => (m.children.length ? leavesOf(m.children) : [m]));

/** A dynamic member: repeats per group instance (row group or details). */
export const isDynamic = (m: RowMember) => !!m.group;
export const isDetails = (m: RowMember) => !!m.group && !m.group.expressions.length && !m.children.length;
const containsDynamic = (m: RowMember): boolean => isDynamic(m) || m.children.some(containsDynamic);

/** A member of the row or column hierarchy by id. */
export function findMember(t: TableItem, id: string) {
  for (const e of walkMembers(t.rowMembers)) if (e.member.id === id) return e;
  for (const e of walkMembers(t.columnMembers ?? [])) if (e.member.id === id) return e;
  return undefined;
}

/** Column groups of a matrix (outermost first). */
export function columnGroupList(t: TableItem): { member: RowMember; depth: number }[] {
  const out: { member: RowMember; depth: number }[] = [];
  for (const { member, parents } of walkMembers(t.columnMembers ?? [])) if (member.group) out.push({ member, depth: parents.filter(p => p.group).length });
  return out;
}
export function leafOfRow(t: TableItem, rowId: string) {
  for (const e of walkMembers(t.rowMembers)) if (e.member.rowId === rowId) return e;
  return undefined;
}

/** The list that holds a member (root list or its parent's children). */
const siblingsOf = (t: TableItem, parents: RowMember[]) => (parents.length ? parents[parents.length - 1].children : t.rowMembers);

/**
 * Brings `rows` into leaf order and derives each row's kind: static rows outside all groups are the table header
 * (before the dynamic part) or footer (after it); static rows inside a group are its header/footer; dynamic leaves
 * are detail rows.
 */
export function syncRows(t: TableItem) {
  const byId = new Map(t.rows.map(r => [r.id, r]));
  const out: TableRow[] = [];
  const visit = (list: RowMember[], inGroup: boolean) => {
    const firstDynamic = list.findIndex(containsDynamic);
    list.forEach((m, i) => {
      if (m.children.length) { visit(m.children, inGroup || isDynamic(m)); return; }
      const row = byId.get(m.rowId!);
      if (!row) return;
      const before = firstDynamic < 0 || i < firstDynamic;
      row.kind = isDynamic(m) ? 'detail' : inGroup ? (before ? 'groupHeader' : 'groupFooter') : before ? 'header' : 'footer';
      out.push(row);
    });
  };
  visit(t.rowMembers, false);
  t.rows = out;
}

/** Row hierarchy of a plain table: header rows, the details group, footer rows. */
export function plainHierarchy(t: Pick<TableItem, 'name' | 'rows'>): RowMember[] {
  return t.rows.map(r => r.kind === 'detail'
    ? detailsMember(`${t.name}_Details`, r.id)
    : staticLeaf(r.id, r.kind === 'header' || r.kind === 'groupHeader' ? 'After' : 'Before'));
}

export const detailsMember = (name: string, rowId: string): RowMember =>
  ({ id: newId(), group: newGroup(name), sort: [], extra: [], children: [], rowId });

/** A static row that stays with the group next to it (KeepWithGroup), as the designers create them. */
export const staticLeaf = (rowId: string, keepWith?: 'Before' | 'After'): RowMember =>
  ({ id: newId(), sort: [], extra: keepWith ? [`<KeepWithGroup>${keepWith}</KeepWithGroup>`] : [], children: [], rowId });

/** A static column (<TablixMember />). */
export const staticColumn = (): RowMember => ({ id: newId(), sort: [], extra: [], children: [] });

/**
 * Sizes of the header levels of a hierarchy (matrix): level k is the k-th header met on a path from the root;
 * a level is as large as its largest header.
 */
export function headerLevels(members: RowMember[]): number[] {
  const levels: number[] = [];
  const walk = (ms: RowMember[], level: number) => ms.forEach(m => {
    if (m.header) levels[level] = Math.max(levels[level] ?? 0, m.header.size);
    walk(m.children, m.header ? level + 1 : level);
  });
  walk(members, 0);
  return levels.map(v => v ?? 0);
}

/** Inserts a static column leaf next to column `at` (before it, or after the last one). */
function insertColumnLeaf(t: TableItem, at: number) {
  const leaves = leavesOf(t.columnMembers);
  const before = at < leaves.length;
  const ref = leaves[before ? at : leaves.length - 1];
  if (!ref) { t.columnMembers.push(staticColumn()); return; }
  for (const { member, parents } of walkMembers(t.columnMembers)) {
    if (member !== ref) continue;
    const list = siblingsOfMember(t.columnMembers, parents);
    list.splice(list.indexOf(member) + (before ? 0 : 1), 0, staticColumn());
    return;
  }
}

/** Removes column leaf `at`; members left without children are removed too. */
function deleteColumnLeaf(t: TableItem, at: number) {
  const ref = leavesOf(t.columnMembers)[at];
  if (!ref) return;
  for (const { member, parents } of walkMembers(t.columnMembers)) {
    if (member !== ref) continue;
    let target = member;
    let chain = parents;
    // an emptied parent goes as well
    while (chain.length && chain[chain.length - 1].children.length === 1) { target = chain[chain.length - 1]; chain = chain.slice(0, -1); }
    const list = siblingsOfMember(t.columnMembers, chain);
    list.splice(list.indexOf(target), 1);
    return;
  }
}
const siblingsOfMember = (root: RowMember[], parents: RowMember[]) => (parents.length ? parents[parents.length - 1].children : root);

export const newGroup = (name: string, expressions: string[] = []): TableGroup =>
  ({ name, expressions, filters: [], pageBreak: '', pageBreakExtra: [], extra: [] });

// ------------------------------------------------------------------------------------------------ cells and columns

/** Cells of a row with the column each starts in and spans. */
export function cellLayout(row: TableRow): { cell: ReportItem; col: number; span: number }[] {
  let col = 0;
  return row.cells.map(cell => {
    const span = Math.max(1, cell.colSpan ?? 1);
    const e = { cell, col, span };
    col += span;
    return e;
  });
}

/** The cell covering a column. */
export const cellAt = (row: TableRow, col: number) => cellLayout(row).find(e => col >= e.col && col < e.col + e.span);

/** A new row of textboxes, formatted like the cells of `template`. */
export function emptyRow(r: Report, t: TableItem, kind: TableRow['kind'], template?: TableRow): TableRow & { cells: TextboxItem[] } {
  const taken = new Set<string>();
  const cells = t.columns.map((_, c) => {
    const tb = makeTextbox(r, '', taken);
    taken.add(tb.name);
    const like = template && cellAt(template, c)?.cell;
    tb.style = like ? { ...like.style } : { ...tb.style, BorderStyle: 'Solid', BorderColor: 'LightGrey', BorderWidth: '1pt' };
    if (kind !== 'detail' && !like) tb.style.FontWeight = 'Bold';
    return tb;
  });
  return { id: newId(), kind, height: template?.height ?? 0.25, cells };
}

export function insertColumn(r: Report, t: TableItem, at: number) {
  const taken = new Set<string>();
  insertColumnLeaf(t, at);
  t.columns.splice(at, 0, 1);
  t.columnSrc?.splice(at, 0, undefined);
  for (const row of t.rows) {
    const inside = cellLayout(row).find(e => at > e.col && at < e.col + e.span);
    if (inside) { inside.cell.colSpan = inside.span + 1; continue; } // a merged cell grows
    const tb = makeTextbox(r, '', taken);
    taken.add(tb.name);
    const layout = cellLayout(row);
    const index = layout.findIndex(e => e.col >= at);
    const neighbour = layout[index < 0 ? layout.length - 1 : Math.max(0, index - 1)]?.cell;
    if (neighbour) tb.style = { ...neighbour.style };
    row.cells.splice(index < 0 ? row.cells.length : index, 0, tb);
  }
}

export function deleteColumn(t: TableItem, at: number) {
  if (t.columns.length <= 1) return;
  deleteColumnLeaf(t, at);
  t.columns.splice(at, 1);
  t.columnSrc?.splice(at, 1);
  for (const row of t.rows) {
    const e = cellAt(row, at);
    if (!e) continue;
    if (e.span > 1) e.cell.colSpan = e.span - 1 > 1 ? e.span - 1 : undefined;
    else row.cells.splice(row.cells.indexOf(e.cell), 1);
  }
}

/** Merges adjacent cells of one row; the leftmost keeps its content (like the designers). Returns its name. */
export function mergeCells(t: TableItem, names: string[]): string | null {
  const row = t.rows.find(r => r.cells.some(c => names.includes(c.name)));
  if (!row) return null;
  const sel = cellLayout(row).filter(e => names.includes(e.cell.name));
  if (sel.length < 2 || sel.length !== names.length) return null;
  for (let i = 1; i < sel.length; i++) if (sel[i].col !== sel[i - 1].col + sel[i - 1].span) return null; // not adjacent
  const first = sel[0];
  first.cell.colSpan = sel.reduce((s, e) => s + e.span, 0);
  const rest = sel.slice(1).map(e => e.cell);
  // texts of the other cells are appended, so nothing is silently lost
  const texts = rest.flatMap(c => (c.type === 'textbox' && c.value ? [c.value] : []));
  if (texts.length && first.cell.type === 'textbox' && !first.cell.value) first.cell.value = texts.shift()!;
  row.cells = row.cells.filter(c => !rest.includes(c));
  return first.cell.name;
}

/** Splits a merged cell back into single cells. */
export function splitCell(r: Report, t: TableItem, name: string): boolean {
  for (const row of t.rows) {
    const i = row.cells.findIndex(c => c.name === name);
    if (i < 0) continue;
    const cell = row.cells[i];
    const span = cell.colSpan ?? 1;
    if (span <= 1) return false;
    cell.colSpan = undefined;
    const taken = new Set<string>();
    const fresh = Array.from({ length: span - 1 }, () => {
      const tb = makeTextbox(r, '', taken);
      taken.add(tb.name);
      tb.style = { ...cell.style };
      return tb;
    });
    row.cells.splice(i + 1, 0, ...fresh);
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ rows

export type RowPlace = 'above' | 'below' | 'outsideAbove' | 'outsideBelow';

/**
 * Inserts an empty row next to a row: within its group (above/below) or outside the innermost group containing it.
 * Returns the new row.
 */
export function insertRow(r: Report, t: TableItem, rowId: string, place: RowPlace): TableRow | null {
  const at = leafOfRow(t, rowId);
  if (!at) return null;
  let anchor = at.member;
  let parents = at.parents;
  if (place === 'outsideAbove' || place === 'outsideBelow') {
    // the innermost group around the row (the details group itself for a detail row)
    const chain = [...parents, at.member];
    let gi = chain.length - 1;
    while (gi >= 0 && !isDynamic(chain[gi])) gi--;
    if (gi < 0) return insertRow(r, t, rowId, place === 'outsideAbove' ? 'above' : 'below');
    anchor = chain[gi];
    parents = chain.slice(0, gi);
  }
  const above = place === 'above' || place === 'outsideAbove';
  const list = siblingsOf(t, parents);
  const index = list.indexOf(anchor) + (above ? 0 : 1);
  // rows above a group stay with it, rows below too (KeepWithGroup), as the designers create them
  const nearDynamic = containsDynamic(anchor) || (above ? list.slice(index).some(containsDynamic) : list.slice(0, index).some(containsDynamic));
  const row = emptyRow(r, t, 'header', t.rows.find(x => x.id === rowId));
  for (const c of row.cells) c.value = '';
  t.rows.push(row);
  list.splice(index, 0, staticLeaf(row.id, nearDynamic ? (above ? 'After' : 'Before') : undefined));
  syncRows(t);
  return row;
}

/** Deletes a row; the last detail row of a table and rows that are a group's only content stay. */
export function deleteRow(t: TableItem, rowId: string): boolean {
  const at = leafOfRow(t, rowId);
  if (!at || t.rows.length <= 1) return false;
  if (isDynamic(at.member)) return false; // the details group: delete the group instead
  const list = siblingsOf(t, at.parents);
  if (list.length === 1 && at.parents.length) return false;
  list.splice(list.indexOf(at.member), 1);
  t.rows = t.rows.filter(x => x.id !== rowId);
  syncRows(t);
  return true;
}

/** Adds or removes the table header/footer row (outside all groups). */
export function toggleTableRow(r: Report, t: TableItem, kind: 'header' | 'footer') {
  const existing = t.rows.find(x => x.kind === kind);
  if (existing) {
    const at = leafOfRow(t, existing.id)!;
    siblingsOf(t, at.parents).splice(siblingsOf(t, at.parents).indexOf(at.member), 1);
    t.rows = t.rows.filter(x => x !== existing);
    syncRows(t);
    return;
  }
  const row = emptyRow(r, t, kind);
  t.rows.push(row);
  const leaf = staticLeaf(row.id, kind === 'header' ? 'After' : 'Before');
  if (kind === 'header') t.rowMembers.unshift(leaf); else t.rowMembers.push(leaf);
  syncRows(t);
}

// ------------------------------------------------------------------------------------------------ groups

export interface GroupOptions { name: string; expression: string; header: boolean; footer: boolean }

/** The innermost dynamic member around a row (its group; for a detail row the details group). */
export function groupOfRow(t: TableItem, rowId: string): RowMember | undefined {
  const at = leafOfRow(t, rowId);
  if (!at) return undefined;
  return [...at.parents, at.member].reverse().find(isDynamic);
}

/** The details member of a table (or of a group). */
export function detailsOf(members: RowMember[]): RowMember | undefined {
  for (const { member } of walkMembers(members)) if (isDetails(member)) return member;
  return undefined;
}

function wrap(r: Report, t: TableItem, target: RowMember, opts: GroupOptions): RowMember {
  const where = findMember(t, target.id)!;
  const list = siblingsOf(t, where.parents);
  const template = t.rows.find(x => x.id === leavesOf([target])[0]?.rowId);
  const children: RowMember[] = [target];
  if (opts.header) {
    const row = emptyRow(r, t, 'groupHeader', template);
    row.cells[0].value = opts.expression;
    t.rows.push(row);
    children.unshift(staticLeaf(row.id, 'After'));
  }
  if (opts.footer) {
    const row = emptyRow(r, t, 'groupFooter', template);
    t.rows.push(row);
    children.push(staticLeaf(row.id, 'Before'));
  }
  const group: RowMember = {
    id: newId(), group: newGroup(opts.name, opts.expression ? [opts.expression] : []), sort: opts.expression ? [{ value: opts.expression, descending: false }] : [],
    extra: [], children,
  };
  list.splice(list.indexOf(target), 1, group);
  syncRows(t);
  return group;
}

/** Adds a group around the group containing a row (Report Builder: Add Group › Parent Group). */
export function addParentGroup(r: Report, t: TableItem, rowId: string, opts: GroupOptions): RowMember | null {
  const target = groupOfRow(t, rowId) ?? detailsOf(t.rowMembers);
  return target ? wrap(r, t, target, opts) : null;
}

/** Adds a group inside the group containing a row, around its details (Add Group › Child Group). */
export function addChildGroup(r: Report, t: TableItem, rowId: string, opts: GroupOptions): RowMember | null {
  const outer = groupOfRow(t, rowId);
  const details = outer && !isDetails(outer) ? detailsOf(outer.children) : detailsOf(t.rowMembers);
  return details ? wrap(r, t, details, opts) : null;
}

/** Removes a row group; with `rows` also its own header and footer rows (the designers ask the same). */
export function deleteGroup(t: TableItem, memberId: string, rows: boolean): boolean {
  const at = findMember(t, memberId);
  if (!at || isDetails(at.member) || !at.member.group) return false;
  const list = siblingsOf(t, at.parents);
  const keep = at.member.children.filter(c => !rows || c.children.length || isDynamic(c));
  const removed = new Set(leavesOf(at.member.children.filter(c => !keep.includes(c))).map(l => l.rowId));
  // the children of a removed group lose their KeepWithGroup only if nothing dynamic is left beside them
  list.splice(list.indexOf(at.member), 1, ...keep);
  t.rows = t.rows.filter(x => !removed.has(x.id));
  syncRows(t);
  return true;
}

/** Adds a header or footer row to a group (inside it, before/after its content). */
export function addGroupRow(r: Report, t: TableItem, memberId: string, which: 'header' | 'footer'): TableRow | null {
  const at = findMember(t, memberId);
  if (!at?.member.group) return null;
  if (isDetails(at.member)) {
    // the details group has no rows of its own: the row goes outside it
    return insertRow(r, t, at.member.rowId!, which === 'header' ? 'above' : 'below');
  }
  const kids = at.member.children;
  const template = t.rows.find(x => x.id === leavesOf(kids)[0]?.rowId);
  const row = emptyRow(r, t, which === 'header' ? 'groupHeader' : 'groupFooter', template);
  t.rows.push(row);
  const leaf = staticLeaf(row.id, which === 'header' ? 'After' : 'Before');
  if (which === 'header') kids.splice(kids.findIndex(containsDynamic) < 0 ? 0 : kids.findIndex(containsDynamic), 0, leaf);
  else kids.push(leaf);
  syncRows(t);
  return row;
}

/** All groups of a table, outermost first, with depth (for the grouping pane). */
export function groupList(t: TableItem): { member: RowMember; depth: number; details: boolean }[] {
  const out: { member: RowMember; depth: number; details: boolean }[] = [];
  for (const { member, parents } of walkMembers(t.rowMembers)) {
    if (member.group) out.push({ member, depth: parents.filter(p => p.group).length, details: isDetails(member) });
  }
  return out;
}

/** Rows of a group (all leaves below it) – for highlighting and the rows bar. */
export const rowsOfMember = (m: RowMember) => leavesOf([m]).map(l => l.rowId!);

export function setSort(m: RowMember, sort: SortExpression[]) { m.sort = sort; }

/** Unique group name ("Group1", …): RDL requires unique names across the report. */
export function uniqueGroupName(r: Report, base = 'Group'): string {
  const used = usedGroupNames(r);
  let n = 1;
  while (used.has(`${base}${n}`.toLowerCase())) n++;
  return `${base}${n}`;
}

/** Names of all groups in the report (lower case), including those in regions kept verbatim. */
export function usedGroupNames(r: Report): Set<string> {
  const used = new Set<string>();
  for (const s of [r.header, r.body, r.footer]) {
    if (!s) continue;
    const visit = (items: typeof s.items) => items.forEach(i => {
      if (i.type === 'table') for (const { member } of walkMembers(i.rowMembers)) if (member.group) used.add(member.group.name.toLowerCase());
      if (i.type === 'raw') for (const m of i.xml.matchAll(/<Group Name="([^"]+)"/g)) used.add(m[1].toLowerCase());
      if (i.type === 'rectangle') visit(i.items);
    });
    visit(s.items);
  }
  return used;
}

// ------------------------------------------------------------------------------------------------ member properties

const tagRe = (tag: string) => new RegExp(`^<${tag}[\\s/>]`);

/** A simple child of <TablixMember> kept in `extra` (RepeatOnNewPage, KeepWithGroup, KeepTogether …). */
export function memberProp(m: RowMember, tag: string): string | undefined {
  const x = m.extra.find(e => tagRe(tag).test(e));
  return x ? /^<[^>]*>([^<]*)</.exec(x)?.[1] ?? '' : undefined;
}

export function setMemberProp(m: RowMember, tag: string, value: string | undefined) {
  const i = m.extra.findIndex(e => tagRe(tag).test(e));
  const el = value === undefined ? undefined : `<${tag}>${value}</${tag}>`;
  if (i >= 0) {
    if (el) m.extra[i] = el; else m.extra.splice(i, 1);
  } else if (el) m.extra.unshift(el);
}

// ------------------------------------------------------------------------------------------------ column groups

const headerTextbox = (r: Report, value: string, taken: Set<string>, bold: boolean): TextboxItem => {
  const tb = makeTextbox(r, value, taken);
  taken.add(tb.name);
  tb.style = { ...tb.style, BorderStyle: 'Solid', BorderColor: 'LightGrey', BorderWidth: '1pt', ...(bold ? { FontWeight: 'Bold' } : {}) };
  return tb;
};

/** Why a column group cannot be added to column `col` (null: it can). */
export function columnGroupBlocker(t: TableItem, col: number): string | null {
  const leaf = leavesOf(t.columnMembers)[col];
  if (!leaf) return 'Keine Spalte gewählt';
  if (headerLevels(t.columnMembers).length) return 'Die Tabelle hat schon Spaltenköpfe – für Kreuztabellen „Matrix einfügen“ verwenden';
  if (!t.columnMembers.includes(leaf) || leaf.group) return 'Die Spalte gehört schon zu einer Spaltengruppe';
  return null;
}

/**
 * Adds a column group around column `col` (Report Builder: Add Group › Column Group › Parent Group): the column
 * repeats per group instance, a header row above the table shows the group value. The other columns get an empty
 * header cell, so every column has the same header levels. Works on tables without column headers.
 */
export function addColumnGroup(r: Report, t: TableItem, col: number, opts: { name: string; expression: string }): RowMember | null {
  if (columnGroupBlocker(t, col)) return null;
  const leaf = leavesOf(t.columnMembers)[col];
  const taken = new Set<string>();
  const size = 0.25;
  for (const m of t.columnMembers) if (m !== leaf) m.header = { size, cell: headerTextbox(r, '', taken, true) };
  const group: RowMember = {
    id: newId(), group: newGroup(opts.name, opts.expression ? [opts.expression] : []),
    header: { size, cell: headerTextbox(r, opts.expression, taken, true) },
    sort: opts.expression ? [{ value: opts.expression, descending: false }] : [], extra: [], children: [leaf],
  };
  t.columnMembers.splice(t.columnMembers.indexOf(leaf), 1, group);
  syncCorner(r, t);
  return group;
}

/**
 * Removes a column group. With `columns` its columns go too (not all columns of the table); otherwise the member
 * stays as a static column member and its header keeps showing (the group value is cleared). A header row left with
 * only empty static cells is removed.
 */
export function deleteColumnGroup(r: Report, t: TableItem, memberId: string, columns: boolean): boolean {
  const m = [...walkMembers(t.columnMembers)].find(e => e.member.id === memberId)?.member;
  if (!m?.group) return false;
  if (columns) {
    const leaves = leavesOf(t.columnMembers);
    const mine = leavesOf([m]).map(l => leaves.indexOf(l)).filter(i => i >= 0).sort((a, b) => b - a);
    if (mine.length >= t.columns.length) return false;
    for (const i of mine) deleteColumn(t, i);
  } else {
    const exprs = m.group!.expressions;
    m.group = undefined;
    m.sort = [];
    const cell = m.header?.cell;
    if (cell?.type === 'textbox' && exprs.includes(cell.value)) cell.value = '';
  }
  dropEmptyHeaderLevel(t);
  syncCorner(r, t);
  return true;
}

/** Removes the top column header level when all its cells are empty textboxes of static members. */
function dropEmptyHeaderLevel(t: TableItem) {
  const top = t.columnMembers;
  if (!top.length || !top.every(m => !m.group && m.header?.cell.type === 'textbox' && !m.header.cell.value)) return;
  for (const m of top) m.header = undefined;
}

/**
 * Keeps the corner in step with the header levels: it exists when the table has row and column headers (one cell
 * spanning the row header columns for a new corner).
 */
export function syncCorner(r: Report, t: TableItem) {
  const rowLevels = headerLevels(t.rowMembers).length, colLevels = headerLevels(t.columnMembers).length;
  if (!rowLevels || !colLevels) { t.corner = undefined; return; }
  if (t.corner?.length) return;
  const cell = headerTextbox(r, '', new Set(), true);
  if (rowLevels > 1) cell.colSpan = rowLevels;
  t.corner = Array.from({ length: colLevels }, (_, i) => Array.from({ length: rowLevels }, (_, k) =>
    i === 0 && k === 0 ? { item: cell, rowSpan: colLevels > 1 ? colLevels : undefined } : { item: null }));
}

/** The leaf member of column `col` (its properties: visibility, toggle). */
export const columnLeaf = (t: TableItem, col: number) => leavesOf(t.columnMembers)[col];

// ------------------------------------------------------------------------------------------------ matrix layout

export interface PlacedCell { item: ReportItem; x: number; y: number; w: number; h: number; member?: RowMember; axis: 'row' | 'column' | 'corner' }

/**
 * Where a matrix's header and corner cells go (inches, relative to the table): column headers above the body, row
 * headers left of it, the corner top left. `columns`/`heights` are the (possibly dragged) body sizes.
 */
export function matrixLayout(t: TableItem, columns: number[], heights: number[]) {
  const rowLevels = headerLevels(t.rowMembers);
  const colLevels = headerLevels(t.columnMembers);
  const sum = (a: number[], n = a.length) => a.slice(0, n).reduce((x, y) => x + y, 0);
  const offsetX = sum(rowLevels), offsetY = sum(colLevels);
  const colX = columns.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [0]);
  const rowY = heights.reduce<number[]>((acc, h) => [...acc, acc[acc.length - 1] + h], [0]);
  const rowIndex = new Map(t.rows.map((r, i) => [r.id, i]));
  const cells: PlacedCell[] = [];

  let col = 0;
  const walkColumns = (ms: RowMember[], level: number) => ms.forEach(m => {
    const first = col;
    if (m.children.length) walkColumns(m.children, m.header ? level + 1 : level); else col++;
    if (m.header) cells.push({ item: m.header.cell, member: m, axis: 'column', x: offsetX + colX[first], w: colX[col] - colX[first], y: sum(colLevels, level), h: m.header.size });
  });
  walkColumns(t.columnMembers, 0);

  const walkRows = (ms: RowMember[], level: number) => ms.forEach(m => {
    const idx = leavesOf([m]).map(l => rowIndex.get(l.rowId!) ?? 0);
    if (m.children.length) walkRows(m.children, m.header ? level + 1 : level);
    if (m.header && idx.length) {
      const a = Math.min(...idx), b = Math.max(...idx);
      cells.push({ item: m.header.cell, member: m, axis: 'row', x: sum(rowLevels, level), w: m.header.size, y: offsetY + rowY[a], h: rowY[b + 1] - rowY[a] });
    }
  });
  walkRows(t.rowMembers, 0);

  (t.corner ?? []).forEach((row, ri) => {
    let c = 0;
    for (const cell of row) {
      if (cell.item) {
        const span = Math.max(1, cell.item.colSpan ?? 1), rs = Math.max(1, cell.rowSpan ?? 1);
        cells.push({ item: cell.item, axis: 'corner', x: sum(rowLevels, c), w: sum(rowLevels, c + span) - sum(rowLevels, c), y: sum(colLevels, ri), h: sum(colLevels, ri + rs) - sum(colLevels, ri) });
        c += span;
      } else c++;
    }
  });
  return { offsetX, offsetY, cells };
}

// ------------------------------------------------------------------------------------------------ new matrix

export interface MatrixOptions { dataSetName: string; rowGroup: string; columnGroup: string; value: string; rowTotal: boolean; columnTotal: boolean }

/**
 * A matrix like Report Builder creates it: a row group with header column, a column group with header row, the
 * corner, one value cell per group intersection – optionally a total row/column ("Gesamt").
 */
export function createMatrix(r: Report, box: { top: number; left: number }, o: MatrixOptions): TableItem {
  const taken = new Set<string>();
  const tb = (value: string, bold = false): TextboxItem => {
    const t = makeTextbox(r, value, taken);
    taken.add(t.name);
    t.style = { ...t.style, BorderStyle: 'Solid', BorderColor: 'LightGrey', BorderWidth: '1pt', ...(bold ? { FontWeight: 'Bold' } : {}) };
    return t;
  };
  const header = (value: string, size: number, bold = true) => ({ size, cell: tb(value, bold) });
  const name = uniqueName(r, 'Matrix', taken);
  taken.add(name);
  const rowName = uniqueGroupName(r, `${name}_RowGroup`), colName = uniqueGroupName(r, `${name}_ColumnGroup`);
  const valueCell = () => { const c = tb(o.value); c.style.TextAlign = 'Right'; return c; };

  const columnMembers: RowMember[] = [{
    id: newId(), group: newGroup(colName, [o.columnGroup]), header: header(o.columnGroup, 0.25),
    sort: [{ value: o.columnGroup, descending: false }], extra: [], children: [],
  }];
  if (o.columnTotal) columnMembers.push({ id: newId(), header: header('Gesamt', 0.25), sort: [], extra: [], children: [] });
  const cols = columnMembers.length;

  const rows: TableRow[] = [{ id: newId(), kind: 'detail', height: 0.25, cells: Array.from({ length: cols }, valueCell) }];
  const rowMembers: RowMember[] = [{
    id: newId(), group: newGroup(rowName, [o.rowGroup]), header: header(o.rowGroup, 1.25, false),
    sort: [{ value: o.rowGroup, descending: false }], extra: [], children: [], rowId: rows[0].id,
  }];
  if (o.rowTotal) {
    const total: TableRow = { id: newId(), kind: 'footer', height: 0.25, cells: Array.from({ length: cols }, () => { const c = valueCell(); c.style.FontWeight = 'Bold'; return c; }) };
    rows.push(total);
    rowMembers.push({ id: newId(), header: header('Gesamt', 1.25), sort: [], extra: ['<KeepWithGroup>Before</KeepWithGroup>'], children: [], rowId: total.id });
  }
  const t: TableItem = {
    id: newId(), type: 'table', name, dataSetName: o.dataSetName, top: box.top, left: box.left, width: 0, height: 0, style: {},
    columns: Array(cols).fill(1), rows, rowMembers, columnMembers,
    corner: [[{ item: tb('', true) }]],
  };
  syncRows(t);
  return t;
}
