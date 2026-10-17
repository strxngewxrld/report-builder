import { Fragment, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent, DragEvent as RDragEvent, MouseEvent as RMouseEvent } from 'react';
import { DRAG_MIME, DragPayload, currentDrag, useCommand, useEditor } from '../editor';
import { embeddedImages, imageUrl } from '../images';
import { designLabel } from '../expr';
import { Box, ImageItem, Report, ReportItem, SectionKind, TableItem, TextboxItem } from '../model';
import {
  DEFAULT_SIZE, applyFieldFormat, bcFieldConventions, createItem, createTable, deleteColumn, displayFields, insertColumn, locate, makeTextbox, sectionOf, sections,
  splitCamel, tableHeight, tableWidth, toggleTableRow,
} from '../ops';
import { isNumericType } from '../sampleData';
import { styleToCss, textAlign, verticalAlign } from '../styleCss';
import { PX_PER_IN, toUnit } from '../units';
import { Codicon } from './Icon';
import {
  addGroupRow, cellAt, cellLayout, columnGroupBlocker, columnGroupList, columnLeaf, deleteColumnGroup, deleteGroup, leavesOf, matrixLayout, deleteRow, groupList,
  groupOfRow, insertRow, isDetails, leafOfRow, mergeCells, rowsOfMember, splitCell,
} from '../tablix';
import { post, vsContext } from '../vscode';
import { browserDom, serializeRdl } from '../rdl';
import { renderReport } from '../render/engine';
import { NodeView, RenderOptionsProvider } from '../render/RenderView';
import { RNode } from '../render/types';
import { l10n } from '../l10n';

/** Design-mode rendering of all items by name: used for regions the designer keeps verbatim. */
function designNodes(report: Report): Map<string, RNode> {
  const map = new Map<string, RNode>();
  const walk = (nodes: RNode[]) => {
    for (const n of nodes) {
      if (!map.has(n.name)) map.set(n.name, n);
      if (n.kind === 'box') walk(n.children ?? []);
      if (n.kind === 'table') for (const row of n.rows) for (const c of row.cells) if (c.node) walk([c.node]);
    }
  };
  try {
    const r = renderReport(serializeRdl(report), { dom: browserDom, mode: 'design' });
    walk(r.body.nodes);
    for (const kind of ['header', 'footer'] as const) {
      const s = r.renderSection(kind, { number: 1, total: 1, overallNumber: 1, overallTotal: 1, version: 0, reportItems: new Map() });
      if (s) walk(s.nodes);
    }
  } catch {
    // fall back to placeholders
  }
  return map;
}

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Transient state while the mouse is down; committed to the report on pointerup. */
type DragPreview =
  | { kind: 'move'; names: Set<string>; dx: number; dy: number }
  | { kind: 'resize'; name: string; box: Box }
  | { kind: 'frame'; section: SectionKind; box: Box; draw: boolean }
  | { kind: 'sectionHeight'; section: SectionKind; height: number }
  | { kind: 'width'; width: number }
  | { kind: 'column'; table: string; index: number; width: number }
  | { kind: 'row'; table: string; index: number; height: number };

const rowLabel = (kind: string) => ({
  header: l10n.t('Table header'), footer: l10n.t('Table footer'), groupHeader: l10n.t('Group header'), groupFooter: l10n.t('Group footer'), detail: l10n.t('Details'),
} as Record<string, string>)[kind] ?? kind;

const sectionLabel = (kind: SectionKind) => ({ header: l10n.t('Page Header'), body: l10n.t('Body'), footer: l10n.t('Page Footer') })[kind];

/** Fixed text of a textbox in a Business Central layout: offered as a new AL label (context menu). */
const literalText = (ed: { isBc: boolean }, tb: TextboxItem): Record<string, string> =>
  ed.isBc && !tb.value.startsWith('=') && /\p{L}{2,}/u.test(tb.value) ? { literalText: tb.value.trim(), item: tb.name } : {};
const tableContext = (t: TableItem) => ({
  inTable: true, tableHasHeader: t.rows.some(r => r.kind === 'header'), tableHasFooter: t.rows.some(r => r.kind === 'footer'), tableColumns: t.columns.length,
});

const itemType = (type: string): string => ({
  textbox: l10n.t('Textbox'), rectangle: l10n.t('Rectangle'), line: l10n.t('Line'), image: l10n.t('Image'), table: l10n.t('Table'), raw: l10n.t('Item'),
} as Record<string, string>)[type] ?? type;
/** What a screen reader says for an item: type, name and (textboxes) the text or expression. */
function itemLabel(item: ReportItem): string {
  const kind = item.type === 'raw' ? (item.kind === 'Chart' ? l10n.t('Chart') : item.kind === 'Textbox' ? l10n.t('Textbox') : item.kind) : itemType(item.type);
  const text = item.type === 'textbox' ? item.value : item.type === 'raw' ? item.preview ?? '' : item.type === 'image' ? item.value : '';
  return `${kind} ${item.name}${text ? `: ${text}` : ''}`;
}

/** Announcement of the selection with position and size (polite live region). */
function announce(r: Report, names: string[]): string {
  if (!names.length) return '';
  if (names.length > 1) return l10n.t('{0} items selected', names.length);
  const loc = locate(r, names[0]);
  if (!loc) return '';
  const n = (v: number) => toUnit(v, r.unit).toLocaleString(l10n.language, { maximumFractionDigits: 2 });
  const it = loc.item;
  const where = loc.container ? `, ${l10n.t('left {0}, top {1}, {2} × {3} {4}', n(it.left), n(it.top), n(it.width), n(it.height), r.unit)}`
    : loc.cell ? `, ${l10n.t('row {0}, column {1}', loc.cell.row + 1, loc.cell.col + 1)}` : '';
  return `${itemLabel(it)}${where}`;
}

/** Whether column `col` repeats in a column group (context key for "Delete column group"). */
const columnGrouped = (t: TableItem, col: number) => {
  const leaf = columnLeaf(t, col);
  return !!leaf && columnGroupList(t).some(g => leavesOf([g.member]).includes(leaf));
};

const normalize = (x0: number, y0: number, x1: number, y1: number): Box =>
  ({ left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) });

const intersects = (a: Box, b: Box) =>
  a.left < b.left + Math.max(b.width, 0.01) && b.left < a.left + a.width && a.top < b.top + Math.max(b.height, 0.01) && b.top < a.top + a.height;

function resizeBox(b: Box, h: Handle, dx: number, dy: number, isLine: boolean): Box {
  let { top, left, width, height } = b;
  const min = isLine ? 0 : 0.05;
  if (h.includes('e')) width = Math.max(min, width + dx);
  if (h.includes('w')) { const w = Math.max(min, width - dx); left += width - w; width = w; }
  if (h.includes('s')) height = Math.max(min, height + dy);
  if (h.includes('n')) { const nh = Math.max(min, height - dy); top += height - nh; height = nh; }
  return { top, left, width, height };
}

export function Designer() {
  const ed = useEditor();
  const { report, view } = ed;
  const S = PX_PER_IN * view.zoom;
  const gridSize = report.unit === 'in' ? 0.125 : 0.25 / 2.54;
  const [drag, setDrag] = useState<DragPreview | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const snap = (v: number, ev?: { altKey: boolean }) => (view.snap && !ev?.altKey ? Math.round(v / gridSize) * gridSize : v);

  /** Tracks the pointer until release; deltas are reported in inches. */
  const beginDrag = (
    e: RPointerEvent,
    onMove: (dx: number, dy: number, ev: PointerEvent) => void,
    onEnd: (dx: number, dy: number, ev: PointerEvent, moved: boolean) => void,
  ) => {
    const x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const delta = (ev: PointerEvent) => [(ev.clientX - x0) / S, (ev.clientY - y0) / S] as const;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      onMove(...delta(ev), ev);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      onEnd(...delta(ev), ev, moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const sectionPoint = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / S, y: (e.clientY - rect.top) / S };
  };

  // ------------------------------------------------------------------------------------------------ section events

  const onSectionPointerDown = (e: RPointerEvent<HTMLDivElement>, kind: SectionKind) => {
    if (e.button !== 0) return;
    const { x, y } = sectionPoint(e);
    const tool = ed.tool;
    if (!tool && !e.shiftKey) ed.select([]);
    beginDrag(e,
      (dx, dy, ev) => setDrag({ kind: 'frame', section: kind, draw: !!tool, box: normalize(snap(x, ev), snap(y, ev), snap(x + dx, ev), snap(y + dy, ev)) }),
      (dx, dy, ev, moved) => {
        if (tool) {
          let box = moved ? normalize(snap(x, ev), snap(y, ev), snap(x + dx, ev), snap(y + dy, ev)) : { left: snap(x), top: snap(y), ...DEFAULT_SIZE[tool] };
          if (tool === 'line' && moved) {
            // Lines snap to horizontal/vertical when drawn roughly that way.
            if (Math.abs(dy) < Math.abs(dx) / 4) box = { ...box, height: 0 };
            else if (Math.abs(dx) < Math.abs(dy) / 4) box = { ...box, width: 0 };
          } else if (moved && (box.width < 0.1 || box.height < 0.1)) {
            box = { ...box, ...DEFAULT_SIZE[tool] };
          }
          let created = '';
          ed.commit(r => {
            const item = createItem(r, tool, box);
            created = item.name;
            sectionOf(r, kind).items.push(item);
          });
          ed.select([created]);
          ed.setTool(null);
        } else if (moved) {
          const frame = normalize(x, y, x + dx, y + dy);
          const hits = sectionOf(report, kind).items.filter(i => intersects(frame, boxOf(i)));
          ed.select([...new Set([...(ev.shiftKey ? ed.selection : []), ...hits.map(i => i.name)])]);
        }
      });
  };

  const onSectionResize = (e: RPointerEvent, kind: SectionKind) => {
    e.stopPropagation();
    const h0 = sectionOf(report, kind).height;
    const minH = Math.max(0, ...sectionOf(report, kind).items.map(i => i.top + (i.type === 'table' ? tableHeight(i) : i.height)));
    const h = (dy: number, ev: PointerEvent) => Math.max(minH, snap(h0 + dy, ev), 0.1);
    beginDrag(e,
      (_dx, dy, ev) => setDrag({ kind: 'sectionHeight', section: kind, height: h(dy, ev) }),
      (_dx, dy, ev, moved) => moved && ed.commit(r => { sectionOf(r, kind).height = h(dy, ev); }));
  };

  const onWidthResize = (e: RPointerEvent) => {
    e.stopPropagation();
    const w0 = report.width;
    const minW = Math.max(0.5, ...sections(report).flatMap(([, s]) => s.items.map(i => i.left + (i.type === 'table' ? tableWidth(i) : i.width))));
    const w = (dx: number, ev: PointerEvent) => Math.max(minW, snap(w0 + dx, ev));
    beginDrag(e,
      (dx, _dy, ev) => setDrag({ kind: 'width', width: w(dx, ev) }),
      (dx, _dy, ev, moved) => moved && ed.commit(r => { r.width = w(dx, ev); }));
  };

  // ------------------------------------------------------------------------------------------------ item events

  const onItemPointerDown = (e: RPointerEvent, item: ReportItem) => {
    if (e.button !== 0 || ed.tool) return; // with an insert tool active the section handles the click
    e.stopPropagation();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ed.select(ed.selection.includes(item.name) ? ed.selection.filter(n => n !== item.name) : [...ed.selection, item.name]);
      return;
    }
    let names = ed.selection;
    if (!names.includes(item.name)) {
      names = [item.name];
      ed.select(names);
    }
    const movable = names.filter(n => locate(report, n)?.container);
    if (!movable.length) return;
    beginDrag(e,
      (dx, dy, ev) => setDrag({ kind: 'move', names: new Set(movable), dx: snap(dx, ev), dy: snap(dy, ev) }),
      (dx, dy, ev, moved) => {
        if (!moved) return;
        ed.commit(r => {
          for (const n of movable) {
            const loc = locate(r, n);
            if (!loc) continue;
            loc.item.left = Math.max(0, loc.item.left + snap(dx, ev));
            loc.item.top = Math.max(0, loc.item.top + snap(dy, ev));
          }
        });
      });
  };

  const onHandlePointerDown = (e: RPointerEvent, item: ReportItem, h: Handle) => {
    e.stopPropagation();
    const b0 = boxOf(item);
    const box = (dx: number, dy: number, ev: PointerEvent) => resizeBox(b0, h, snap(dx, ev), snap(dy, ev), item.type === 'line');
    beginDrag(e,
      (dx, dy, ev) => setDrag({ kind: 'resize', name: item.name, box: box(dx, dy, ev) }),
      (dx, dy, ev, moved) => moved && ed.commit(r => {
        const loc = locate(r, item.name);
        if (loc) Object.assign(loc.item, box(dx, dy, ev));
      }));
  };

  const onColumnResize = (e: RPointerEvent, t: TableItem, index: number) => {
    e.stopPropagation();
    const w0 = t.columns[index];
    const w = (dx: number, ev: PointerEvent) => Math.max(0.1, snap(w0 + dx, ev));
    beginDrag(e,
      (dx, _dy, ev) => setDrag({ kind: 'column', table: t.name, index, width: w(dx, ev) }),
      (dx, _dy, ev, moved) => moved && ed.commit(r => {
        const tt = locate(r, t.name)?.item as TableItem;
        tt.columns[index] = w(dx, ev);
      }));
  };

  const onRowResize = (e: RPointerEvent, t: TableItem, index: number) => {
    e.stopPropagation();
    const h0 = t.rows[index].height;
    const h = (dy: number, ev: PointerEvent) => Math.max(0.1, snap(h0 + dy, ev));
    beginDrag(e,
      (_dx, dy, ev) => setDrag({ kind: 'row', table: t.name, index, height: h(dy, ev) }),
      (_dx, dy, ev, moved) => moved && ed.commit(r => {
        const tt = locate(r, t.name)?.item as TableItem;
        tt.rows[index].height = h(dy, ev);
      }));
  };

  /** Pointer down on the table's corner handle: select the whole table and drag it. */
  const onTableCornerDown = (e: RPointerEvent, t: TableItem) => {
    e.stopPropagation();
    ed.select([t.name]);
    beginDrag(e,
      (dx, dy, ev) => setDrag({ kind: 'move', names: new Set([t.name]), dx: snap(dx, ev), dy: snap(dy, ev) }),
      (dx, dy, ev, moved) => moved && ed.commit(r => {
        const it = locate(r, t.name)!.item;
        it.left = Math.max(0, it.left + snap(dx, ev));
        it.top = Math.max(0, it.top + snap(dy, ev));
      }));
  };

  // ------------------------------------------------------------------------------------------------ drag & drop from the data pane

  const payloadOf = (e: RDragEvent): DragPayload | null => {
    try { return currentDrag ?? JSON.parse(e.dataTransfer.getData(DRAG_MIME)); } catch { return null; }
  };
  const allowDrop = (e: RDragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onSectionDrop = (e: RDragEvent<HTMLDivElement>, kind: SectionKind) => {
    const p = payloadOf(e);
    if (!p) return;
    e.preventDefault();
    const { x, y } = sectionPoint(e);
    const at = { left: snap(x), top: snap(y) };
    let created = '';
    ed.commit(r => {
      const items = sectionOf(r, kind).items;
      if (p.kind === 'dataSet' || p.kind === 'dataItem') {
        const ds = r.dataSets.find(d => d.name === p.dataSet);
        if (!ds) return false;
        // a BC data item becomes a table of its columns (those already in the layout dataset)
        const names = p.kind === 'dataItem'
          ? p.columns.filter(c => ds.fields.some(f => f.name === c))
          : displayFields(ds.fields.map(f => f.name));
        const t = createTable(r, { ...at, width: Math.min(names.length || 3, 6) }, names.length || 3, ds.name, names);
        // Wide datasets get narrower columns so the table fits the page.
        const avail = Math.max(r.width - at.left, 3);
        if (tableWidth(t) > avail) t.columns = t.columns.map(() => Math.max(avail / t.columns.length, 0.6));
        items.push(t);
        created = t.name;
        return;
      }
      if (p.kind === 'image') {
        const img = createItem(r, 'image', { ...at, width: 1.5, height: 0.75 }) as ImageItem;
        Object.assign(img, { source: 'Embedded', value: p.name, sizing: 'FitProportional' });
        items.push(img);
        created = img.name;
        return;
      }
      const value = p.kind === 'field' ? `=First(Fields!${p.field}.Value, "${p.dataSet}")`
        : p.kind === 'parameter' ? `=Parameters!${p.name}.Value`
        : `=Globals!${p.name}`;
      const tb = makeTextbox(r, value, undefined, { ...at, width: 1.5, height: 0.25 });
      if (p.kind === 'field') applyFieldFormat(r, tb, p.dataSet, p.field);
      items.push(tb);
      created = tb.name;
    });
    if (created) ed.select([created]);
  };

  const onCellDrop = (e: RDragEvent, t: TableItem, row: number, col: number) => {
    const p = payloadOf(e);
    if (!p || p.kind === 'dataSet' || p.kind === 'dataItem' || p.kind === 'image') return;
    e.preventDefault();
    e.stopPropagation();
    const target = cellAt(t.rows[row], col)?.cell;
    if (target?.type === 'rectangle') {
      // a list's rectangle (BC document header): a new textbox where the field was dropped
      const rect = e.currentTarget.getBoundingClientRect();
      const at = { left: snap((e.clientX - rect.left) / S), top: snap((e.clientY - rect.top) / S) };
      let created = '';
      ed.commit(r => {
        const tt = locate(r, t.name)!.item as TableItem;
        const cellRect = cellAt(tt.rows[row], col)!.cell;
        if (cellRect.type !== 'rectangle') return false;
        const value = p.kind === 'field' ? `=Fields!${p.field}.Value` : p.kind === 'parameter' ? `=Parameters!${p.name}.Value` : `=Globals!${p.name}`;
        const tb = makeTextbox(r, value, undefined, { ...at, width: 1.5, height: 0.25 });
        if (p.kind === 'field') applyFieldFormat(r, tb, tt.dataSetName || p.dataSet, p.field);
        cellRect.items.push(tb);
        created = tb.name;
      });
      if (created) ed.select([created]);
      return;
    }
    if (target?.type !== 'textbox') return;
    ed.commit(r => {
      const tt = locate(r, t.name)!.item as TableItem;
      const cell = cellAt(tt.rows[row], col)!.cell as TextboxItem;
      const kind = tt.rows[row].kind;
      if (p.kind === 'field') {
        if (!tt.dataSetName) tt.dataSetName = p.dataSet;
        const bc = bcFieldConventions(r, tt.dataSetName, p.field);
        cell.value = kind === 'footer' && (bc.numeric || isNumericType(p.typeName)) ? `=Sum(Fields!${p.field}.Value)` : `=Fields!${p.field}.Value`;
        applyFieldFormat(r, cell, tt.dataSetName, p.field);
        // Like Report Builder: dropping into the detail row also fills an empty header caption –
        // in Business Central with the translated caption (IncludeCaption) when there is one.
        const header = tt.rows.find(x => x.kind === 'header');
        const headerCell = header && cellAt(header, col)?.cell;
        if (kind === 'detail' && headerCell?.type === 'textbox' && !headerCell.value) {
          headerCell.value = bc.caption ?? splitCamel(p.field);
          if (cell.style.TextAlign === 'Right') headerCell.style.TextAlign = 'Right';
        }
      } else {
        cell.value = p.kind === 'parameter' ? `=Parameters!${p.name}.Value` : `=Globals!${p.name}`;
      }
    });
    ed.select([cellAt(t.rows[row], col)!.cell.name]);
  };

  // ------------------------------------------------------------------------------------------------ context menu

  /**
   * Right click: selects the item (unless it is part of the selection) and lets the event through to VS Code, which
   * shows the native context menu. The commands then act on the selection.
   */
  const onContext = (e: RMouseEvent, item: ReportItem | null) => {
    const native = e.nativeEvent as MouseEvent & { handled?: boolean };
    if (native.handled) return;
    native.handled = true;
    if (!item) { if (!e.shiftKey) ed.select([]); return; }
    if (!ed.selection.includes(item.name)) ed.select([item.name]);
  };

  /** The table a command applies to and the column: the selected cell's, the selected column, else the last one. */
  const tableTarget = () => {
    const loc = ed.selection[0] ? locate(report, ed.selection[0]) : null;
    const table = loc?.table ?? (loc?.item.type === 'table' ? loc.item : undefined);
    if (!table) return null;
    const col = loc?.cell?.col ?? (ed.tablePart?.table === table.name && ed.tablePart.kind === 'column' ? ed.tablePart.index : table.columns.length - 1);
    return { table, col };
  };
  const withTable = (fn: (r: Report, t: TableItem, col: number) => void) => () => {
    const target = tableTarget();
    if (target) ed.commit(r => fn(r, locate(r, target.table.name)!.item as TableItem, target.col));
  };
  const textbox = () => {
    const loc = ed.selection.length === 1 ? locate(report, ed.selection[0]) : null;
    return loc?.item.type === 'textbox' ? { tb: loc.item, dataSetName: loc.table?.dataSetName } : null;
  };

  useCommand('editText', () => { const t = textbox(); if (t) setEditing(t.tb.name); });
  useCommand('editExpression', () => {
    const t = textbox();
    if (t) ed.setDialog({
      kind: 'expression', title: l10n.t('Expression for {0}', t.tb.name), value: t.tb.value, dataSetName: t.dataSetName,
      onOk: v => ed.commit(r => { (locate(r, t.tb.name)!.item as TextboxItem).value = v; }),
    });
  });
  useCommand('table.insertColumnLeft', withTable((r, t, col) => insertColumn(r, t, col)));
  useCommand('table.insertColumnRight', withTable((r, t, col) => insertColumn(r, t, col + 1)));
  useCommand('table.deleteColumn', withTable((_r, t, col) => { if (t.columns.length > 1) deleteColumn(t, col); }));
  useCommand('table.toggleHeaderRow', withTable((r, t) => toggleTableRow(r, t, 'header')));
  useCommand('table.toggleFooterRow', withTable((r, t) => toggleTableRow(r, t, 'footer')));
  useCommand('table.select', () => { const target = tableTarget(); if (target) ed.select([target.table.name]); });
  useCommand('table.addColumnGroup', () => {
    const target = tableTarget();
    if (!target) return;
    const blocker = columnGroupBlocker(target.table, target.col);
    if (blocker) post({ type: 'info', message: blocker });
    else ed.setDialog({ kind: 'group', table: target.table.name, create: { column: target.col, mode: 'column' } });
  });
  /** The column group a command applies to: given by id (grouping pane) or the innermost one around the column. */
  const columnGroupTarget = (arg?: unknown) => {
    const target = tableTarget();
    if (!target) return null;
    const id = (arg as { member?: string } | undefined)?.member;
    const groups = columnGroupList(target.table).map(g => g.member);
    const leaf = columnLeaf(target.table, target.col);
    const around = groups.filter(g => leavesOf([g]).includes(leaf!)).pop();
    const member = id ? groups.find(g => g.id === id) : around;
    return member ? { table: target.table, member } : null;
  };
  const removeColumnGroup = (columns: boolean) => (arg?: unknown) => {
    const x = columnGroupTarget(arg);
    if (x) ed.commit(r => deleteColumnGroup(r, locate(r, x.table.name)!.item as TableItem, x.member.id, columns));
  };
  useCommand('table.deleteColumnGroup', removeColumnGroup(true));
  useCommand('table.deleteColumnGroupOnly', removeColumnGroup(false));

  /** Table and row a row command applies to: the row of the context menu, of the selected cell or the selected row. */
  const rowTarget = (arg?: unknown) => {
    const ctxRow = (arg as { rowId?: string } | undefined)?.rowId;
    const target = tableTarget();
    if (!target) return null;
    const { table } = target;
    const loc = ed.selection[0] ? locate(report, ed.selection[0]) : null;
    const rowId = ctxRow && table.rows.some(x => x.id === ctxRow) ? ctxRow
      : loc?.cell ? table.rows[loc.cell.row].id
      : ed.tablePart?.table === table.name && ed.tablePart.kind === 'row' ? table.rows[ed.tablePart.index]?.id
      : table.rows.find(x => x.kind === 'detail')?.id;
    return rowId ? { table, rowId } : null;
  };
  const withRow = (fn: (r: Report, t: TableItem, rowId: string) => unknown) => (arg?: unknown) => {
    const target = rowTarget(arg);
    if (target) ed.commit(r => fn(r, locate(r, target.table.name)!.item as TableItem, target.rowId) !== false);
  };
  useCommand('table.addParentGroup', arg => { const x = rowTarget(arg); if (x) ed.setDialog({ kind: 'group', table: x.table.name, create: { rowId: x.rowId, mode: 'parent' } }); });
  useCommand('table.addChildGroup', arg => { const x = rowTarget(arg); if (x) ed.setDialog({ kind: 'group', table: x.table.name, create: { rowId: x.rowId, mode: 'child' } }); });
  useCommand('table.groupProperties', arg => {
    const x = rowTarget(arg);
    const g = x && groupOfRow(x.table, x.rowId);
    if (x && g) ed.setDialog({ kind: 'group', table: x.table.name, member: g.id });
  });
  const outerGroupOf = (t: TableItem, rowId: string) => {
    const g = groupOfRow(t, rowId);
    // a detail row: its details group cannot be deleted, the group around it is meant
    if (g && isDetails(g)) return leafOfRow(t, rowId)?.parents.slice().reverse().find(p => p.group);
    return g;
  };
  useCommand('table.deleteGroup', withRow((_r, t, rowId) => { const g = outerGroupOf(t, rowId); return g ? deleteGroup(t, g.id, true) : false; }));
  useCommand('table.deleteGroupOnly', withRow((_r, t, rowId) => { const g = outerGroupOf(t, rowId); return g ? deleteGroup(t, g.id, false) : false; }));
  useCommand('table.addGroupHeader', withRow((r, t, rowId) => { const g = outerGroupOf(t, rowId) ?? groupOfRow(t, rowId); return g ? !!addGroupRow(r, t, g.id, 'header') : false; }));
  useCommand('table.addGroupFooter', withRow((r, t, rowId) => { const g = outerGroupOf(t, rowId) ?? groupOfRow(t, rowId); return g ? !!addGroupRow(r, t, g.id, 'footer') : false; }));
  useCommand('table.insertRowAbove', withRow((r, t, rowId) => !!insertRow(r, t, rowId, 'above')));
  useCommand('table.insertRowBelow', withRow((r, t, rowId) => !!insertRow(r, t, rowId, 'below')));
  useCommand('table.insertRowOutsideAbove', withRow((r, t, rowId) => !!insertRow(r, t, rowId, 'outsideAbove')));
  useCommand('table.insertRowOutsideBelow', withRow((r, t, rowId) => !!insertRow(r, t, rowId, 'outsideBelow')));
  useCommand('table.deleteRow', withRow((_r, t, rowId) => deleteRow(t, rowId)));
  useCommand('table.mergeCells', () => {
    const target = tableTarget();
    if (!target) return;
    const names = ed.selection;
    let merged: string | null = null;
    ed.commit(r => !!(merged = mergeCells(locate(r, target.table.name)!.item as TableItem, names)));
    if (merged) ed.select([merged]);
  });
  useCommand('table.splitCell', () => {
    const target = tableTarget();
    const name = ed.selection[0];
    if (target && name) ed.commit(r => splitCell(r, locate(r, target.table.name)!.item as TableItem, name));
  });

  // ------------------------------------------------------------------------------------------------ rendering

  const reportWidth = drag?.kind === 'width' ? drag.width : report.width;
  const gridPx = gridSize * S;
  const gridStyle: CSSProperties | undefined = view.grid ? {
    backgroundImage: `radial-gradient(circle, var(--grid-dot) 0.8px, transparent 0.8px)`,
    backgroundSize: `${gridPx}px ${gridPx}px`,
  } : undefined;

  const rendered = useMemo(() => (report.body.items.concat(report.header?.items ?? [], report.footer?.items ?? []).some(function hasRaw(i): boolean {
    return i.type === 'raw' || (i.type === 'rectangle' && i.items.some(hasRaw)) || (i.type === 'table' && i.rows.some(row => row.cells.some(hasRaw)));
  }) ? designNodes(report) : new Map<string, RNode>()), [report]);
  const render = { S, drag, editing, setEditing, onItemPointerDown, onHandlePointerDown, onColumnResize, onRowResize, onTableCornerDown, onCellDrop, allowDrop, onContext, rendered };

  return (
    <div className={`designer ${ed.tool ? 'tool-active' : ''}`} {...vsContext({ preventDefaultContextMenuItems: true, selectionCount: ed.selection.length })}
      tabIndex={0} role="application" aria-roledescription={l10n.t('design surface')} aria-describedby="designer-help"
      aria-label={l10n.t('Design surface of the report')}>
      <div id="designer-help" className="sr-only">
        {l10n.t('Tab and Shift+Tab select the next or previous item, the arrow keys move, Alt+arrow keys resize, with Shift in small steps. Enter or F2 edits the text, Delete deletes, Escape clears the selection. Shift+F10 opens the context menu.')}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announce(report, ed.selection)}</div>
      {view.ruler && <Ruler width={reportWidth} S={S} unit={report.unit} />}
      <div className="page" style={{ width: reportWidth * S }}>
        {sections(report).map(([kind, section]) => {
          const height = drag?.kind === 'sectionHeight' && drag.section === kind ? drag.height : section.height;
          return (
            <Fragment key={kind}>
              {kind !== 'body' && <div className="section-label"><Codicon name={kind === 'header' ? 'layout-menubar' : 'layout-panel'} /> {sectionLabel(kind)}</div>}
              <div
                className={`section section-${kind}`}
                style={{ height: height * S, ...gridStyle, ...styleToCss(section.style), border: undefined }}
                onPointerDown={e => onSectionPointerDown(e, kind)}
                onDragOver={allowDrop}
                onDrop={e => onSectionDrop(e, kind)}
                onContextMenu={e => onContext(e, null)}
                {...vsContext({ webviewSection: 'section', section: kind })}
              >
                {section.items.map(it => <ItemView key={it.id} item={it} r={render} />)}
                {drag?.kind === 'frame' && drag.section === kind && (
                  <div className={drag.draw ? 'draw-frame' : 'marquee'} style={px(drag.box, S)} />
                )}
                <div className="section-resizer" onPointerDown={e => onSectionResize(e, kind)} title={l10n.t('Change Height')} />
                {kind === 'body' && <div className="width-resizer" onPointerDown={onWidthResize} title={l10n.t('Change Width')} />}
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const boxOf = (i: ReportItem): Box =>
  i.type === 'table' ? { top: i.top, left: i.left, width: tableWidth(i), height: tableHeight(i) } : { top: i.top, left: i.left, width: i.width, height: i.height };

const px = (b: Box, S: number): CSSProperties => ({ left: b.left * S, top: b.top * S, width: b.width * S, height: b.height * S });

// ---------------------------------------------------------------------------------------------------------------

function Ruler({ width, S, unit }: { width: number; S: number; unit: 'in' | 'cm' }) {
  const step = unit === 'in' ? 1 : 1 / 2.54; // one major tick per inch / cm
  const minor = unit === 'in' ? 8 : 2;
  const ticks = [];
  for (let i = 0; i * step <= width + 1e-9; i++) {
    const x = i * step * S;
    ticks.push(<line key={`M${i}`} x1={x} x2={x} y1={8} y2={18} />);
    if (i > 0) ticks.push(<text key={`T${i}`} x={x + 2} y={10}>{i}</text>);
    for (let m = 1; m < minor; m++) {
      const mx = x + (m * step * S) / minor;
      if (mx > width * S) break;
      ticks.push(<line key={`m${i}-${m}`} x1={mx} x2={mx} y1={m === minor / 2 ? 12 : 15} y2={18} />);
    }
  }
  return <svg className="ruler" width={width * S} height={18}>{ticks}</svg>;
}

// ---------------------------------------------------------------------------------------------------------------

interface RenderProps {
  S: number;
  drag: DragPreview | null;
  editing: string | null;
  setEditing: (n: string | null) => void;
  onItemPointerDown: (e: RPointerEvent, item: ReportItem) => void;
  onHandlePointerDown: (e: RPointerEvent, item: ReportItem, h: Handle) => void;
  onColumnResize: (e: RPointerEvent, t: TableItem, i: number) => void;
  onRowResize: (e: RPointerEvent, t: TableItem, i: number) => void;
  onTableCornerDown: (e: RPointerEvent, t: TableItem) => void;
  onCellDrop: (e: RDragEvent, t: TableItem, row: number, col: number) => void;
  allowDrop: (e: RDragEvent) => void;
  onContext: (e: RMouseEvent, item: ReportItem | null) => void;
  /** Design rendering of verbatim regions, by item name. */
  rendered: Map<string, RNode>;
}

/** An item; `fill`: it fills a table cell of that size (its own position does not apply, no resize handles). */
function ItemView({ item, r, fill }: { item: ReportItem; r: RenderProps; fill?: { width: number; height: number } }) {
  const ed = useEditor();
  const { S, drag } = r;
  const selected = ed.selection.includes(item.name);
  let box = fill ? { top: 0, left: 0, ...fill } : boxOf(item);
  if (drag?.kind === 'move' && drag.names.has(item.name)) box = { ...box, left: box.left + drag.dx, top: box.top + drag.dy };
  if (drag?.kind === 'resize' && drag.name === item.name) box = drag.box;

  const common = {
    'data-name': item.name,
    'aria-label': itemLabel(item),
    onPointerDown: (e: RPointerEvent) => r.onItemPointerDown(e, item),
    onContextMenu: (e: RMouseEvent) => r.onContext(e, item),
    ...vsContext({
      webviewSection: 'item', itemType: item.type, positioned: !!locate(ed.report, item.name)?.container, inTable: false, item: item.name,
      ...(item.type === 'raw' ? { rawKind: item.kind } : {}),
      ...(item.type === 'textbox' ? literalText(ed, item) : {}),
    }),
  };
  const handles = selected && !fill && ed.selection.length === 1 && item.type !== 'table' && (
    (item.type === 'line' ? (['nw', 'se'] as Handle[]) : HANDLES).map(h => (
      <div key={h} className={`handle handle-${h}`} onPointerDown={e => r.onHandlePointerDown(e, item, h)} />
    ))
  );

  switch (item.type) {
    case 'textbox':
      return (
        <div className={`item textbox ${selected ? 'selected' : ''}`} style={{ ...px(box, S), ...textboxCss(item) }} {...common}
          onDoubleClick={e => { e.stopPropagation(); r.setEditing(item.name); }}>
          <TextContent tb={item} r={r} />
          {handles}
        </div>
      );
    case 'rectangle':
      return (
        <div className={`item rectangle ${selected ? 'selected' : ''}`} style={{ ...px(box, S), ...styleToCss(item.style) }} {...common}>
          {item.items.map(c => <ItemView key={c.id} item={c} r={r} />)}
          {handles}
        </div>
      );
    case 'line': {
      const css = styleToCss(item.style);
      const stroke = String(css.border ?? '1pt solid Black').split(' ');
      return (
        <div className={`item line ${selected ? 'selected' : ''}`} style={{ ...px(box, S), minWidth: 1, minHeight: 1 }} {...common}>
          <svg width="100%" height="100%" style={{ overflow: 'visible', position: 'absolute', inset: 0 }}>
            <line x1={0} y1={0} x2={box.width * S} y2={box.height * S} stroke={stroke[2] ?? 'Black'} strokeWidth={stroke[0]}
              strokeDasharray={stroke[1] === 'dashed' ? '6 3' : stroke[1] === 'dotted' ? '1 2' : undefined} />
            {/* wide invisible hit area */}
            <line x1={0} y1={0} x2={box.width * S} y2={box.height * S} stroke="transparent" strokeWidth={8} />
          </svg>
          {handles}
        </div>
      );
    }
    case 'image': {
      const embedded = item.source === 'Embedded' ? embeddedImages(ed.report).find(i => i.name === item.value) : undefined;
      const src = embedded ? imageUrl(embedded) : item.source === 'External' && /^(https?:|data:)/.test(item.value) ? item.value : '';
      return (
        <div className={`item image ${selected ? 'selected' : ''}`} style={{ ...px(box, S), ...styleToCss(item.style) }} {...common}>
          {src
            ? <img src={src} alt="" style={imageFit(item.sizing)} draggable={false} />
            : <div className="placeholder" title={item.value}><Codicon name="file-media" /> {item.source === 'Database' ? l10n.t('Database image') : item.source === 'Embedded' ? item.value || l10n.t('Image') : l10n.t('Image')}</div>}
          {handles}
        </div>
      );
    }
    case 'raw': {
      // an empty table cell
      if (item.kind === 'Empty') return <div className="item empty-cell" style={px(box, S)} {...common} />;
      // regions kept verbatim (grouped Tablix, mixed-format textboxes, …) are drawn by the render engine;
      // their inner items can be picked and edited in the document outline
      const node = r.rendered.get(item.name);
      if (!node) {
        return (
          <div className={`item raw ${selected ? 'selected' : ''}`} style={px(box, S)} {...common} title={l10n.t('This item is saved unchanged.')}>
            <div className="placeholder"><Codicon name={RAW_ICON[item.kind] ?? 'symbol-misc'} /> {rawLabel(item.kind) ?? item.kind}<small>{item.name}</small></div>
            {handles}
          </div>
        );
      }
      return (
        <div className={`item raw-rendered ${selected ? 'selected' : ''}`} style={{ ...px(box, S), overflow: 'visible' }} {...common}
          title={item.kind === 'Chart' ? l10n.t('Chart – double-click: chart properties') : l10n.t('Region saved unchanged – click the items inside, edit them in the document outline')}
          onDoubleClick={item.kind === 'Chart' ? e => { e.stopPropagation(); ed.setDialog({ kind: 'chart', name: item.name }); } : undefined}>
          <RenderOptionsProvider value={{
            S, showHidden: true, selected: ed.nested,
            onPick: name => { if (!ed.selection.includes(item.name)) ed.select([item.name]); ed.setNested(name === item.name ? null : name); },
          }}>
            <NodeView node={{ ...node, top: 0, left: 0 }} />
          </RenderOptionsProvider>
          {handles}
        </div>
      );
    }
    case 'table':
      return <TableView t={item} box={box} r={r} />;
  }
}

const rawLabel = (kind: string): string | undefined => ({
  Chart: l10n.t('Chart'), Tablix: l10n.t('Matrix / grouped table'), Subreport: l10n.t('Subreport'), Map: l10n.t('Map'),
  GaugePanel: l10n.t('Gauge'), CustomReportItem: l10n.t('Custom report item'),
} as Record<string, string>)[kind];
const RAW_ICON: Record<string, string> = {
  Chart: 'graph', Tablix: 'table', Subreport: 'references', Map: 'globe', GaugePanel: 'dashboard', CustomReportItem: 'extensions',
};

export const imageFit = (sizing: string): CSSProperties => ({
  width: '100%', height: '100%', objectPosition: 'left top', pointerEvents: 'none',
  objectFit: sizing === 'Fit' ? 'fill' : sizing === 'FitProportional' ? 'contain' : sizing === 'Clip' ? 'none' : 'contain',
});

function textboxCss(tb: TextboxItem): CSSProperties {
  return {
    ...styleToCss(tb.style),
    textAlign: textAlign(tb.style),
    display: 'flex',
    flexDirection: 'column',
    justifyContent: verticalAlign(tb.style),
  };
}

function TextContent({ tb, r }: { tb: TextboxItem; r: RenderProps }) {
  const ed = useEditor();
  if (r.editing === tb.name) {
    const done = (value: string | null) => {
      r.setEditing(null);
      if (value !== null && value !== tb.value) ed.commit(rep => { (locate(rep, tb.name)!.item as TextboxItem).value = value; });
    };
    return (
      <textarea
        className="inline-editor"
        autoFocus
        defaultValue={tb.value}
        onFocus={e => e.currentTarget.select()}
        onPointerDown={e => e.stopPropagation()}
        onBlur={e => done(e.currentTarget.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') done(null);
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        }}
      />
    );
  }
  const label = designLabel(tb.value);
  return <span className={`text ${tb.value.startsWith('=') ? 'expr' : ''}`}>{label}</span>;
}

function TableView({ t, box, r }: { t: TableItem; box: Box; r: RenderProps }) {
  const ed = useEditor();
  const { S, drag } = r;
  const columns = t.columns.map((w, i) => (drag?.kind === 'column' && drag.table === t.name && drag.index === i ? drag.width : w));
  const heights = t.rows.map((row, i) => (drag?.kind === 'row' && drag.table === t.name && drag.index === i ? drag.height : row.height));
  const cellNames = new Set(t.rows.flatMap(row => row.cells.map(c => c.name)));
  const tableSelected = ed.selection.includes(t.name);
  const active = tableSelected || ed.selection.some(n => cellNames.has(n)) || ed.tablePart?.table === t.name;
  const part = ed.tablePart?.table === t.name ? ed.tablePart : null;
  // matrix: header columns left, header rows above the body
  const mx = matrixLayout(t, columns, heights);
  const colX = columns.reduce<number[]>((acc, w) => [...acc, acc[acc.length - 1] + w], [mx.offsetX]);
  const rowY = heights.reduce<number[]>((acc, h) => [...acc, acc[acc.length - 1] + h], [mx.offsetY]);
  const width = colX[colX.length - 1], height = rowY[rowY.length - 1];
  // several cells of one row selected: they can be merged
  const selectedCells = t.rows.map(row => row.cells.filter(c => ed.selection.includes(c.name)).length);
  const mergeable = ed.selection.length > 1 && selectedCells.filter(n => n > 0).length === 1 && Math.max(...selectedCells) === ed.selection.length;
  // brackets of the row groups (outermost left), like the row handles of the Visual Studio designer
  const groups = groupList(t).filter(g => !g.details).map(g => {
    const ids = rowsOfMember(g.member);
    const idx = t.rows.map((row, i) => (ids.includes(row.id) ? i : -1)).filter(i => i >= 0);
    return { g, first: Math.min(...idx), last: Math.max(...idx) };
  });
  const depth = Math.max(0, ...groups.map(x => x.g.depth + 1));

  return (
    <div data-name={t.name} className={`item table ${tableSelected ? 'selected' : ''} ${active ? 'active' : ''}`}
      style={{ left: box.left * S, top: box.top * S, width: width * S, height: height * S }}
      onContextMenu={e => r.onContext(e, t)}
      {...vsContext({ webviewSection: 'item', itemType: 'table', positioned: true, ...tableContext(t) })}>
      {mx.cells.map(pc => {
        const sel = ed.selection.includes(pc.item.name);
        const box = { left: pc.x * S, top: pc.y * S, width: pc.w * S, height: pc.h * S };
        const label = pc.axis === 'corner' ? l10n.t('Corner') : pc.axis === 'row' ? l10n.t('Row header {0}', pc.member?.group?.name ?? '') : l10n.t('Column header {0}', pc.member?.group?.name ?? '');
        if (pc.item.type !== 'textbox') {
          return (
            <div key={pc.item.id} className={`cell cell-container header-cell ${sel ? 'selected' : ''}`} style={{ position: 'absolute', ...box }} title={label}>
              <ItemView item={pc.item} r={r} fill={{ width: pc.w, height: pc.h }} />
            </div>
          );
        }
        const tb = pc.item;
        return (
          <div key={tb.id} data-name={tb.name} title={label}
            className={`item textbox cell header-cell ${sel ? 'selected' : ''}`} style={{ ...box, ...textboxCss(tb) }}
            onPointerDown={e => { if (e.button !== 0 || ed.tool) return; e.stopPropagation(); ed.select([tb.name]); }}
            onDoubleClick={e => { e.stopPropagation(); r.setEditing(tb.name); }}
            onContextMenu={e => r.onContext(e, tb)}
            {...vsContext({ webviewSection: 'item', itemType: 'textbox', positioned: false, item: tb.name, ...tableContext(t), ...literalText(ed, tb) })}>
            <TextContent tb={tb} r={r} />
          </div>
        );
      })}
      {t.rows.map((row, ri) => cellLayout(row).map(({ cell, col: ci, span }) => {
        const sel = ed.selection.includes(cell.name)
          || (part?.kind === 'column' && part.index >= ci && part.index < ci + span) || (part?.kind === 'row' && part.index === ri);
        const rowCtx = {
          rowId: row.id, inGroup: row.kind !== 'header' && row.kind !== 'footer', merged: span > 1, canMerge: mergeable && ed.selection.includes(cell.name),
          inColumnGroup: columnGrouped(t, ci),
        };
        const cellBox = { left: colX[ci] * S, top: rowY[ri] * S, width: (colX[ci + span] - colX[ci]) * S, height: heights[ri] * S };
        if (cell.type !== 'textbox') {
          // a list cell: rectangle with items (BC document header, nested lines table), image, nested table …
          return (
            <div key={cell.id} className={`cell cell-container ${sel ? 'selected' : ''}`} style={{ position: 'absolute', ...cellBox }}
              {...vsContext({ webviewSection: 'item', itemType: cell.type, positioned: false, item: cell.name, ...tableContext(t), ...rowCtx })}
              onDragOver={r.allowDrop} onDrop={e => r.onCellDrop(e, t, ri, ci)}>
              <ItemView item={cell} r={r} fill={{ width: cellBox.width / S, height: cellBox.height / S }} />
            </div>
          );
        }
        return (
          <div key={cell.id} data-name={cell.name}
            className={`item textbox cell ${sel ? 'selected' : ''} ${row.kind === 'groupHeader' || row.kind === 'groupFooter' ? 'group-row' : ''}`}
            style={{ ...cellBox, ...textboxCss(cell) }}
            onPointerDown={e => {
              if (e.button !== 0 || ed.tool) return;
              e.stopPropagation();
              ed.select(e.shiftKey || e.metaKey || e.ctrlKey ? [...ed.selection.filter(n => cellNames.has(n)), cell.name] : [cell.name]);
            }}
            onDoubleClick={e => { e.stopPropagation(); r.setEditing(cell.name); }}
            onContextMenu={e => r.onContext(e, cell)}
            {...vsContext({ webviewSection: 'item', itemType: 'textbox', positioned: false, item: cell.name, ...tableContext(t), ...rowCtx, ...literalText(ed, cell) })}
            onDragOver={r.allowDrop}
            onDrop={e => r.onCellDrop(e, t, ri, ci)}
          >
            <TextContent tb={cell} r={r} />
          </div>
        );
      }))}
      {active && (
        <>
          <div className="tbl-corner" title={l10n.t('Select / Move Table')} onPointerDown={e => r.onTableCornerDown(e, t)} />
          <div className="tbl-colbar" style={{ width: width * S }}>
            {columns.map((w, ci) => (
              <div key={ci} className={`tbl-seg ${part?.kind === 'column' && part.index === ci ? 'on' : ''}`}
                style={{ left: colX[ci] * S, width: w * S }}
                onPointerDown={e => { e.stopPropagation(); ed.select([t.name], { table: t.name, kind: 'column', index: ci }); }}>
                <div className="col-resizer" onPointerDown={e => r.onColumnResize(e, t, ci)} />
              </div>
            ))}
          </div>
          <div className="tbl-rowbar" style={{ height: height * S }}>
            {t.rows.map((row, ri) => (
              <div key={row.id} className={`tbl-seg ${part?.kind === 'row' && part.index === ri ? 'on' : ''}`}
                style={{ top: rowY[ri] * S, height: heights[ri] * S }}
                title={rowLabel(row.kind)}
                {...vsContext({ webviewSection: 'item', itemType: 'tableRow', rowId: row.id, inGroup: row.kind !== 'header' && row.kind !== 'footer', ...tableContext(t) })}
                onPointerDown={e => { e.stopPropagation(); ed.select([t.name], { table: t.name, kind: 'row', index: ri }); }}>
                {row.kind === 'detail' && <Codicon name="menu" className="detail-glyph" />}
                <div className="row-resizer" onPointerDown={e => r.onRowResize(e, t, ri)} />
              </div>
            ))}
          </div>
          {groups.map(({ g, first, last }) => (
            <div key={g.member.id} className="tbl-group" title={l10n.t('Group {0}: {1} – double-click: properties', g.member.group!.name, g.member.group!.expressions.join(', ') || l10n.t('(no grouping)'))}
              style={{ top: rowY[first] * S + 2, height: (rowY[last + 1] - rowY[first]) * S - 4, left: -16 - (depth - g.depth) * 6 }}
              onPointerDown={e => e.stopPropagation()}
              onDoubleClick={() => ed.setDialog({ kind: 'group', table: t.name, member: g.member.id })} />
          ))}
        </>
      )}
    </div>
  );
}
