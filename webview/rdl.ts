// RDL (Report Definition Language) <-> Report model.
//
// Reading accepts the 2008/2010/2016 schemas. Writing is source-preserving, which matters for Business Central layouts
// that live in Git:
//  - objects whose modelled content is unchanged are written as their original XML,
//  - regenerated objects keep unknown child elements, the original element order and the original size notation,
//  - the file keeps its schema version (2008 is upgraded to 2016), root attributes, unit, line endings and BOM,
//  - textboxes and tables the model cannot represent exactly are kept verbatim as raw items.

import {
  DataSet, DataSource, Field, ImageItem, NS_2010, NS_2016, Origin, Parameter, ParameterType, RawItem, Report,
  ReportItem, Section, SourceFormat, Style, StyleKey, StyleLevel, TableItem, TableRow, TextboxItem, emptyReport,
  fingerprint, guid, newId, unchanged, BreakLocation, CornerCell, RowMember, TableGroup, TablixHeaderCell,
} from './model';
import { formatSize, parseSize } from './units';
import { leavesOf, syncRows } from './tablix';
import { tableHeight, tableWidth } from './ops';

export { NS_2010, NS_2016 };
export const NS_RD = 'http://schemas.microsoft.com/SQLServer/reporting/reportdesigner';

/** DOM implementation to use – the browser's in the webview, @xmldom/xmldom in tests. */
export interface XmlDom {
  parse(xml: string): Document;
  serialize(node: Node): string;
}

export const browserDom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml'),
  serialize: node => new XMLSerializer().serializeToString(node),
};

// ---------------------------------------------------------------------------------------------------------------
// DOM helpers

export const elements = (el: Element | undefined, name?: string): Element[] =>
  el ? (Array.from(el.childNodes) as Node[]).filter((n): n is Element => n.nodeType === 1 && (!name || (n as Element).localName === name)) : [];

export const child = (el: Element | undefined, ...path: string[]): Element | undefined => {
  let cur = el;
  for (const p of path) cur = elements(cur, p)[0];
  return cur;
};

export const text = (el: Element | undefined, ...path: string[]): string | undefined => {
  const c = child(el, ...path);
  return c ? c.textContent ?? '' : undefined;
};

const bool = (s: string | undefined, fallback: boolean) => (s === undefined ? fallback : s.trim().toLowerCase() === 'true');

const STYLE_KEYS: StyleKey[] = [
  'FontStyle', 'FontFamily', 'FontSize', 'FontWeight', 'Format', 'TextDecoration', 'Color', 'TextAlign',
  'VerticalAlign', 'BackgroundColor', 'PaddingLeft', 'PaddingRight', 'PaddingTop', 'PaddingBottom',
];
const BORDER_KEYS = ['Color', 'Style', 'Width'];

/** Splits a <Style> into the modelled keys and verbatim XML of everything else (per-side borders, LineHeight, …). */
function parseStyle(p: Parser, styleEl: Element | undefined): { style: Style; extra: string[] } {
  const style: Style = {};
  const extra: string[] = [];
  for (const c of elements(styleEl)) {
    if (c.localName === 'Border' && elements(c).length > 0 && elements(c).every(b => BORDER_KEYS.includes(b.localName))) {
      const s = text(c, 'Style'), col = text(c, 'Color'), w = text(c, 'Width');
      if (s !== undefined) style.BorderStyle = s;
      if (col !== undefined) style.BorderColor = col;
      if (w !== undefined) style.BorderWidth = w;
    } else if (STYLE_KEYS.includes(c.localName as StyleKey) && elements(c).length === 0 && style[c.localName as StyleKey] === undefined) {
      style[c.localName as StyleKey] = c.textContent ?? '';
    } else {
      extra.push(p.xml(c));
    }
  }
  return { style, extra };
}

const SIZE_NAMES = ['Top', 'Left', 'Height', 'Width'];

// ---------------------------------------------------------------------------------------------------------------
// Parsing

class Parser {
  constructor(private dom: XmlDom) {}

  /**
   * Verbatim XML of an element: RDL/designer namespace declarations are dropped (the fragment inherits them from
   * <Report>), indentation between tags is removed and empty elements are written as `<a />` like Visual Studio does.
   */
  xml = (el: Element) => normalizeFragment(this.dom.serialize(el));

  extras = (el: Element | undefined, known: string[]) =>
    elements(el).filter(c => !known.includes(c.localName)).map(this.xml);

  sizes(el: Element, names: string[]): Record<string, string> {
    const sizes: Record<string, string> = {};
    for (const n of names) {
      const v = text(el, n);
      if (v !== undefined) sizes[n] = v;
    }
    return sizes;
  }

  origin(el: Element, obj: object, sizeNames: string[] = [], inner: Record<string, Element | undefined> = {}): Origin {
    const orders: Record<string, string[]> = {};
    for (const [k, e] of Object.entries({ Style: child(el, 'Style'), 'Style/Border': child(el, 'Style', 'Border'), ...inner })) {
      if (e) orders[k] = elements(e).map(c => c.nodeName);
    }
    return { xml: this.xml(el), key: fingerprint(obj), order: elements(el).map(c => c.nodeName), sizes: this.sizes(el, sizeNames), inner: orders };
  }

  /** Common item fields; `known` lists the children the specific parser handles (everything else is kept as extra). */
  base(el: Element, known: string[]) {
    const { style, extra: styleExtra } = parseStyle(this, child(el, 'Style'));
    return {
      id: newId(),
      name: el.getAttribute('Name') ?? '',
      top: parseSize(text(el, 'Top')),
      left: parseSize(text(el, 'Left')),
      width: parseSize(text(el, 'Width')),
      height: parseSize(text(el, 'Height')),
      style,
      styleExtra,
      extra: this.extras(el, [...known, ...SIZE_NAMES, 'Style']),
    };
  }

  /** Attaches the origin after the object is complete (the fingerprint covers all modelled fields). */
  withOrigin<T extends object>(el: Element, obj: T, inner: Record<string, Element | undefined> = {}): T & { origin: Origin } {
    return Object.assign(obj, { origin: this.origin(el, obj, SIZE_NAMES, inner) });
  }

  items(container: Element | undefined): ReportItem[] {
    return elements(container).map(el => this.item(el));
  }

  item(el: Element): ReportItem {
    switch (el.localName) {
      case 'Textbox': return this.textbox(el, true) ?? this.raw(el);
      case 'Rectangle':
        return this.withOrigin(el, { ...this.base(el, ['ReportItems']), type: 'rectangle' as const, items: this.items(child(el, 'ReportItems')) });
      case 'Line': return this.withOrigin(el, { ...this.base(el, []), type: 'line' as const });
      case 'Image': return this.withOrigin(el, {
        ...this.base(el, ['Source', 'Value', 'Sizing']),
        type: 'image' as const,
        source: (text(el, 'Source') ?? 'External') as ImageItem['source'],
        value: text(el, 'Value') ?? '',
        sizing: (text(el, 'Sizing') ?? 'AutoSize') as ImageItem['sizing'],
      });
      case 'Tablix': return this.tablix(el) ?? this.raw(el);
      default: return this.raw(el);
    }
  }

  raw(el: Element): RawItem {
    const b = this.base(el, []);
    const box = { top: b.top, left: b.left, width: b.width, height: b.height };
    const item: RawItem = {
      id: b.id, name: b.name, ...box, style: b.style, type: 'raw', kind: el.localName, xml: this.xml(el),
      preview: el.localName === 'Textbox' ? textboxText(el) : undefined,
    };
    // For raw items only the box is editable (moving); its fingerprint decides whether the XML is patched.
    item.origin = { xml: '', key: fingerprint(box), order: [], sizes: this.sizes(el, SIZE_NAMES) };
    return item;
  }

  /**
   * A textbox is editable when the model represents it exactly: one text run per paragraph, identical formatting in
   * all paragraphs, and expressions only in single-paragraph textboxes. Otherwise it is kept as a raw item.
   */
  textbox(el: Element, positioned: boolean): TextboxItem | null {
    const paragraphs = elements(child(el, 'Paragraphs'), 'Paragraph');
    const runs = paragraphs.map(p => elements(child(p, 'TextRuns'), 'TextRun'));
    if (runs.some(r => r.length !== 1)) return null;
    const values = runs.map(r => text(r[0], 'Value') ?? '');
    if (paragraphs.length > 1) {
      if (values.some(v => v.startsWith('='))) return null;
      // all paragraphs must be identical apart from their text
      const shape = (p: Element) => this.xml(p).replace(/<Value>[\s\S]*?<\/Value>|<Value\s*\/>/, '');
      if (paragraphs.some(p => shape(p) !== shape(paragraphs[0]))) return null;
    }
    const paragraph = paragraphs[0];
    const run = runs[0]?.[0];

    const b = this.base(el, ['Paragraphs', 'CanGrow']);
    const box = { style: b.style, extra: b.styleExtra };
    const para = parseStyle(this, child(paragraph, 'Style'));
    const rs = parseStyle(this, child(run, 'Style'));
    const tb: TextboxItem = {
      ...b,
      type: 'textbox',
      value: values.join('\n'),
      canGrow: bool(text(el, 'CanGrow'), false),
      // effective style: the run overrides the paragraph overrides the textbox
      style: { ...box.style, ...para.style, ...rs.style },
      styleLevels: { box: box.style, paragraph: para.style, run: rs.style },
      paragraphExtra: this.extras(paragraph, ['TextRuns', 'Style']),
      paragraphStyleExtra: para.extra,
      runExtra: this.extras(run, ['Value', 'Style']),
      runStyleExtra: rs.extra,
    };
    const valueEl = child(run, 'Value');
    const attrs = valueEl ? Array.from(valueEl.attributes as ArrayLike<Attr>).map((a): [string, string] => [a.name, a.value]) : [];
    if (attrs.length) {
      // attributes must be the same on every paragraph's value, since they are written to each
      const sig = (v: Element | undefined) => JSON.stringify(Array.from((v?.attributes ?? []) as ArrayLike<Attr>).map(a => [a.name, a.value]));
      if (runs.some(r => sig(child(r[0], 'Value')) !== sig(valueEl))) return null;
      tb.valueAttrs = attrs;
    }
    if (!positioned) {
      // cell textboxes have no position; keep any that are there anyway
      tb.extra = [...(tb.extra ?? []), ...elements(el).filter(c => SIZE_NAMES.includes(c.localName)).map(this.xml)];
    }
    return this.withOrigin(el, tb, {
      Paragraph: paragraph, 'Paragraph/Style': child(paragraph, 'Style'),
      TextRun: run, 'TextRun/Style': child(run, 'Style'),
    });
  }

  /**
   * Tables with static columns and any nesting of row groups (group header/footer rows, details, sorting, filters,
   * page breaks), merged cells (ColSpan), any item as cell content (lists) and matrices (column groups, header
   * cells, corner). Row spans in the body are kept as raw items and shown in the document outline.
   */
  tablix(el: Element): TableItem | null {
    const body = child(el, 'TablixBody');
    const columnEls = elements(child(body, 'TablixColumns'), 'TablixColumn');
    const rowEls = elements(child(body, 'TablixRows'), 'TablixRow');
    if (elements(body).some(c => !['TablixColumns', 'TablixRows'].includes(c.localName))) return null;
    if (elements(child(el, 'TablixColumnHierarchy')).length > 1 || elements(child(el, 'TablixRowHierarchy')).length > 1) return null;

    if (columnEls.some(c => elements(c).some(x => x.localName !== 'Width'))) return null;

    const rows: TableRow[] = [];
    for (const rowEl of rowEls) {
      if (elements(rowEl).some(c => !['Height', 'TablixCells'].includes(c.localName))) return null;
      const cells = elements(child(rowEl, 'TablixCells'), 'TablixCell');
      const textboxes: ReportItem[] = [];
      let covered = 0, columns = 0;
      for (const cell of cells) {
        const contents = child(cell, 'CellContents');
        if (!contents) {
          // a column covered by the merged cell before it
          if (covered <= 0 || elements(cell).length) return null;
          covered--;
          continue;
        }
        if (covered > 0) return null;
        const itemEls = elements(contents).filter(c => ITEM_NAMES.has(c.localName));
        const colSpan = Number(text(contents, 'ColSpan') ?? 1);
        if (itemEls.length > 1 || Number(text(contents, 'RowSpan') ?? 1) > 1 || !(colSpan >= 1)) return null;
        const itemEl = itemEls[0];
        // a textbox the designer cannot model (several formatted runs …) stays verbatim inside the editable table;
        // an empty cell (<CellContents /> without item) stays empty
        const tb: ReportItem = !itemEl ? emptyCell()
          : itemEl.localName === 'Textbox' ? this.textbox(itemEl, false) ?? this.raw(itemEl) : this.item(itemEl);
        tb.cellExtra = this.extras(cell, ['CellContents']);
        tb.contentsExtra = this.extras(contents, [...(itemEl ? [itemEl.localName] : []), 'ColSpan']);
        if (colSpan > 1) tb.colSpan = colSpan;
        const order = elements(contents).map(c => c.nodeName);
        if (itemEl && order[0] !== itemEl.nodeName) tb.contentsOrder = order;
        if (tb.type !== 'raw') tb.origin!.key = fingerprint(tb);
        textboxes.push(tb);
        covered = colSpan - 1;
        columns += colSpan;
      }
      if (covered > 0 || columns !== columnEls.length) return null;
      rows.push({ id: newId(), kind: 'detail', height: parseSize(text(rowEl, 'Height'), 0.25), heightSrc: text(rowEl, 'Height'), cells: textboxes });
    }

    // hierarchies: the row hierarchy's leaves in document order are the rows, the column hierarchy's the columns
    let leaf = 0;
    let ok = true;
    const member = (m: Element, axis: 'row' | 'column'): RowMember => {
      const headerEl = child(m, 'TablixHeader');
      let header: TablixHeaderCell | undefined;
      if (headerEl) {
        const item = this.cellItem(child(headerEl, 'CellContents'), headerEl);
        if (!item || elements(headerEl).some(c => !['Size', 'CellContents'].includes(c.localName))) ok = false;
        else header = { size: parseSize(text(headerEl, 'Size'), 1), sizeSrc: text(headerEl, 'Size'), cell: item, order: elements(headerEl).map(c => c.nodeName) };
      }
      const groupEl = child(m, 'Group');
      const childEls = elements(child(m, 'TablixMembers'), 'TablixMember');
      const sortEl = child(m, 'SortExpressions');
      const sort = elements(sortEl, 'SortExpression').map(e => {
        if (elements(e).some(c => !['Value', 'Direction'].includes(c.localName))) ok = false;
        return { value: text(e, 'Value') ?? '', descending: text(e, 'Direction') === 'Descending' };
      });
      if (sortEl && elements(sortEl).some(c => c.localName !== 'SortExpression')) ok = false;
      const rm: RowMember = {
        id: newId(), group: groupEl ? this.group(groupEl) : undefined, header, sort,
        extra: this.extras(m, ['Group', 'SortExpressions', 'TablixMembers', 'TablixHeader']),
        children: childEls.map(c => member(c, axis)),
      };
      if (!header) delete rm.header;
      if (!childEls.length) {
        if (child(m, 'TablixMembers')) ok = false; // empty <TablixMembers> would not round-trip
        if (axis === 'row') {
          rm.rowId = rows[leaf++]?.id;
          if (!rm.rowId) ok = false;
        }
      }
      return this.withMemberOrigin(m, rm);
    };
    const rowMembers = elements(child(el, 'TablixRowHierarchy', 'TablixMembers'), 'TablixMember').map(m => member(m, 'row'));
    if (!ok || leaf !== rows.length || !rowMembers.length) return null;
    const columnMembers = elements(child(el, 'TablixColumnHierarchy', 'TablixMembers'), 'TablixMember').map(m => member(m, 'column'));
    if (!ok || leavesOf(columnMembers).length !== columnEls.length) return null;

    // corner of a matrix: rows × cells, covered cells are empty
    let corner: CornerCell[][] | undefined;
    const cornerEl = child(el, 'TablixCorner');
    if (cornerEl) {
      if (elements(cornerEl).some(c => c.localName !== 'TablixCornerRows')) return null;
      corner = [];
      for (const rowEl of elements(child(cornerEl, 'TablixCornerRows'), 'TablixCornerRow')) {
        const cells: CornerCell[] = [];
        for (const c of elements(rowEl, 'TablixCornerCell')) {
          const contents = child(c, 'CellContents');
          if (!contents) { if (elements(c).length) return null; cells.push({ item: null }); continue; }
          const item = this.cellItem(contents, c);
          if (!item) return null;
          const rowSpan = Number(text(contents, 'RowSpan') ?? 1);
          cells.push(rowSpan > 1 ? { item, rowSpan } : { item });
        }
        corner.push(cells);
      }
    }

    const t: TableItem = {
      ...this.base(el, ['TablixBody', 'TablixColumnHierarchy', 'TablixRowHierarchy', 'TablixCorner', 'DataSetName']),
      type: 'table',
      dataSetName: text(el, 'DataSetName') ?? '',
      columns: columnEls.map(c => parseSize(text(c, 'Width'), 1)),
      columnSrc: columnEls.map(c => text(c, 'Width')),
      rows,
      rowMembers,
      columnMembers,
      ...(corner ? { corner } : {}),
    };
    syncRows(t);
    t.parsedSums = { width: tableWidth(t), height: tableHeight(t) };
    return this.withOrigin(el, t);
  }

  /** The single item of a <CellContents> (header and corner cells), with its cell details; null if not one item. */
  cellItem(contents: Element | undefined, cell: Element): ReportItem | null {
    if (!contents) return null;
    const itemEls = elements(contents).filter(c => ITEM_NAMES.has(c.localName));
    if (itemEls.length !== 1) return null;
    const itemEl = itemEls[0];
    const it: ReportItem = itemEl.localName === 'Textbox' ? this.textbox(itemEl, false) ?? this.raw(itemEl) : this.item(itemEl);
    it.contentsExtra = this.extras(contents, [itemEl.localName, 'ColSpan', 'RowSpan']);
    const colSpan = Number(text(contents, 'ColSpan') ?? 1);
    if (colSpan > 1) it.colSpan = colSpan;
    const order = elements(contents).map(c => c.nodeName);
    if (order[0] !== itemEl.nodeName) it.contentsOrder = order;
    if (cell.localName !== 'TablixHeader' && elements(cell).some(c => c.localName !== 'CellContents')) it.cellExtra = this.extras(cell, ['CellContents']);
    if (it.type !== 'raw') it.origin!.key = fingerprint(it);
    return it;
  }

  withMemberOrigin(el: Element, m: RowMember): RowMember {
    m.origin = { xml: this.xml(el), key: fingerprint(m), order: elements(el).map(c => c.nodeName), sizes: {} };
    return m;
  }

  group(el: Element): TableGroup {
    const pb = child(el, 'PageBreak');
    const filtersEl = child(el, 'Filters');
    // filters with anything beyond expression/operator/values are kept verbatim (not edited)
    const simpleFilters = !!filtersEl && elements(filtersEl).every(f => f.localName === 'Filter'
      && elements(f).every(c => ['FilterExpression', 'Operator', 'FilterValues'].includes(c.localName))
      && elements(child(f, 'FilterValues')).every(v => v.localName === 'FilterValue' && !v.attributes.length));
    const g: TableGroup = {
      name: el.getAttribute('Name') ?? '',
      expressions: elements(child(el, 'GroupExpressions'), 'GroupExpression').map(e => e.textContent ?? ''),
      filters: simpleFilters ? elements(filtersEl, 'Filter').map(f => ({
        expression: text(f, 'FilterExpression') ?? '', operator: text(f, 'Operator') ?? 'Equal',
        values: elements(child(f, 'FilterValues'), 'FilterValue').map(v => v.textContent ?? ''),
      })) : [],
      pageBreak: (text(pb, 'BreakLocation') ?? '') as BreakLocation,
      pageBreakExtra: pb ? this.extras(pb, ['BreakLocation']) : [],
      extra: this.extras(el, ['GroupExpressions', 'PageBreak', ...(simpleFilters ? ['Filters'] : [])]),
    };
    g.origin = { xml: this.xml(el), key: fingerprint(g), order: elements(el).map(c => c.nodeName), sizes: {}, inner: pb ? { PageBreak: elements(pb).map(c => c.nodeName) } : {} };
    return g;
  }

  section(el: Element | undefined): Section | null {
    if (!el) return null;
    const { style, extra: styleExtra } = parseStyle(this, child(el, 'Style'));
    const s: Section = {
      height: parseSize(text(el, 'Height'), 1), items: this.items(child(el, 'ReportItems')), style, styleExtra,
      extra: this.extras(el, ['ReportItems', 'Height', 'Style']),
    };
    s.origin = this.origin(el, s, ['Height']);
    return s;
  }

  dataSource(el: Element): DataSource {
    const conn = child(el, 'ConnectionProperties');
    const d: DataSource = {
      id: text(el, 'DataSourceID') ?? guid(),
      name: el.getAttribute('Name') ?? '',
      provider: text(conn, 'DataProvider') ?? 'SQL',
      connectString: text(conn, 'ConnectString') ?? '',
      sharedReference: text(el, 'DataSourceReference'),
      extra: this.extras(el, ['ConnectionProperties', 'DataSourceReference', 'DataSourceID']),
      connExtra: this.extras(conn, ['DataProvider', 'ConnectString']),
    };
    d.origin = this.origin(el, d);
    return d;
  }

  dataSet(el: Element): DataSet {
    const query = child(el, 'Query');
    const d: DataSet = {
      id: newId(),
      name: el.getAttribute('Name') ?? '',
      dataSourceName: text(query, 'DataSourceName') ?? '',
      commandText: text(query, 'CommandText') ?? '',
      fields: elements(child(el, 'Fields'), 'Field').map((f): Field => ({
        name: f.getAttribute('Name') ?? '',
        dataField: text(f, 'DataField') ?? '',
        typeName: text(f, 'TypeName') ?? '',
        value: text(f, 'Value'),
        extra: this.extras(f, ['DataField', 'Value', 'TypeName']),
      })),
      extra: this.extras(el, ['Query', 'Fields']),
      queryExtra: this.extras(query, ['DataSourceName', 'CommandText']),
    };
    d.origin = this.origin(el, d);
    return d;
  }

  parameter(el: Element): Parameter {
    const def = child(el, 'DefaultValue');
    const values = elements(child(def, 'Values'), 'Value');
    // Only a single literal default is modelled; query-based or multi-value defaults are kept verbatim.
    const simpleDefault = !def || (elements(def).length === 1 && values.length === 1 && !values[0].getAttribute('xsi:nil'));
    const p: Parameter = {
      id: newId(),
      name: el.getAttribute('Name') ?? '',
      dataType: (text(el, 'DataType') ?? 'String') as ParameterType,
      prompt: text(el, 'Prompt') ?? '',
      defaultValue: simpleDefault ? values[0]?.textContent ?? '' : '',
      allowBlank: bool(text(el, 'AllowBlank'), false),
      nullable: bool(text(el, 'Nullable'), false),
      extra: this.extras(el, ['DataType', 'Prompt', 'AllowBlank', 'Nullable', ...(simpleDefault ? ['DefaultValue'] : [])]),
    };
    p.origin = this.origin(el, p);
    return p;
  }
}

const ITEM_NAMES = new Set(['Textbox', 'Rectangle', 'Line', 'Image', 'Tablix', 'Chart', 'Subreport', 'Map', 'GaugePanel', 'CustomReportItem']);

/** Text of a textbox for display: runs and paragraphs folded into one value (an `=a & b` expression if needed). */
export function textboxText(el: Element): string {
  const paragraphs = elements(child(el, 'Paragraphs'), 'Paragraph');
  return joinRuns(paragraphs.map(p => elements(child(p, 'TextRuns'), 'TextRun').map(r => text(r, 'Value') ?? '')));
}

export function joinRuns(paragraphs: string[][]): string {
  const all = paragraphs.flat();
  if (all.length <= 1) return all[0] ?? '';
  if (!all.some(v => v.startsWith('='))) return paragraphs.map(p => p.join('')).join('\n');
  const part = (v: string) => (v.startsWith('=') ? `(${v.slice(1)})` : `"${v.replace(/"/g, '""')}"`);
  return '=' + paragraphs.map(p => p.filter(v => v !== '').map(part).join(' & ') || '""').join(' & vbCrLf & ');
}

export function normalizeFragment(xml: string): string {
  return xml
    .replace(/ xmlns="http:\/\/schemas\.microsoft\.com\/sqlserver\/reporting\/\d{4}\/\d{2}\/reportdefinition"/g, '')
    .replace(new RegExp(` xmlns:rd="${NS_RD.replace(/[./]/g, '\\$&')}"`, 'g'), '')
    // drop indentation between tags, but keep whitespace that is the whole content of an element: <a> </a>
    .replace(/(<[^>]+>)\s+(?=<)/g, (m, tag: string, offset: number, all: string) =>
      !tag.startsWith('</') && !tag.endsWith('/>') && all.startsWith('</', offset + m.length) ? m : tag)
    .replace(/<([^>]*?[^\s/])\/>/g, '<$1 />');
}

export function parseRdl(input: string, dom: XmlDom = browserDom): Report {
  const bom = input.startsWith('﻿');
  const xml = bom ? input.slice(1) : input;
  const doc = dom.parse(xml);
  const root = doc.documentElement;
  if (!root || root.localName !== 'Report') {
    const err = doc.getElementsByTagName('parsererror')[0];
    throw new Error(err ? err.textContent ?? 'Ungültiges XML' : 'Kein <Report>-Element gefunden');
  }
  const p = new Parser(dom);
  const report = emptyReport();
  // RDL 2008 keeps Body/Width/Page directly under <Report>; 2010+ wraps them in ReportSections.
  const sections = elements(child(root, 'ReportSections'), 'ReportSection');
  const section = sections[0] ?? root;
  const page = child(section, 'Page');

  report.namespace = root.namespaceURI === NS_2010 ? NS_2010 : NS_2016;
  const widthSrc = text(section, 'Width');
  const unitRaw = text(root, 'ReportUnitType');
  // Business Central writes "Invalid"; then the unit of the body width decides.
  report.unit = unitRaw === 'Cm' ? 'cm' : unitRaw === 'Inch' ? 'in' : /cm|mm/i.test(widthSrc ?? '') ? 'cm' : 'in';
  report.reportId = text(root, 'ReportID') ?? report.reportId;
  report.width = parseSize(widthSrc, report.width);
  report.body = p.section(child(section, 'Body'))!;
  report.header = p.section(child(page, 'PageHeader'));
  report.footer = p.section(child(page, 'PageFooter'));
  if (page) {
    const pageSizes = ['PageWidth', 'PageHeight', 'TopMargin', 'BottomMargin', 'LeftMargin', 'RightMargin'];
    report.page = {
      width: parseSize(text(page, 'PageWidth'), 8.5),
      height: parseSize(text(page, 'PageHeight'), 11),
      marginTop: parseSize(text(page, 'TopMargin')),
      marginBottom: parseSize(text(page, 'BottomMargin')),
      marginLeft: parseSize(text(page, 'LeftMargin')),
      marginRight: parseSize(text(page, 'RightMargin')),
      extra: p.extras(page, ['PageHeader', 'PageFooter', ...pageSizes]),
    };
    report.page.origin = { xml: '', key: '', order: elements(page).map(c => c.nodeName), sizes: p.sizes(page, pageSizes) };
  }
  report.dataSources = elements(child(root, 'DataSources'), 'DataSource').map(e => p.dataSource(e));
  report.dataSets = elements(child(root, 'DataSets'), 'DataSet').map(e => p.dataSet(e));
  report.parameters = elements(child(root, 'ReportParameters'), 'ReportParameter').map(e => p.parameter(e));
  report.extraXml = p.extras(root, [
    'DataSources', 'DataSets', 'ReportSections', 'ReportParameters', 'ReportParametersLayout', 'ReportUnitType',
    'ReportID', 'Body', 'Width', 'Page',
  ]);
  const layout = child(root, 'ReportParametersLayout');
  const decl = /^\s*(<\?xml[^>]*\?>)/.exec(xml)?.[1] ?? null;
  report.source = {
    rootAttributes: Array.from(root.attributes as ArrayLike<Attr>).map(a => [a.name, a.value]),
    order: elements(root).map(c => c.nodeName),
    sectionOrder: section === root ? [] : elements(section).map(c => c.nodeName),
    sectionExtra: section === root ? [] : p.extras(section, ['Body', 'Width', 'Page']),
    moreSections: sections.slice(1).map(p.xml),
    widthSrc,
    unitRaw,
    unitInferred: report.unit,
    parameterLayout: layout && {
      xml: p.xml(layout),
      names: elements(child(layout, 'GridLayoutDefinition', 'CellDefinitions'), 'CellDefinition').map(c => text(c, 'ParameterName') ?? ''),
    },
    declaration: decl,
    emptyPairs: emptyPairTags(xml),
    eol: xml.includes('\r\n') ? '\r\n' : '\n',
    finalNewline: /\n\s*$/.test(xml),
    bom,
  };
  return report;
}

/** Tag names written empty as <X></X> in `xml` and never self-closing (the DOM cannot tell the two apart). */
function emptyPairTags(xml: string): string[] {
  const pairs = new Set(Array.from(xml.matchAll(/<([\w:.-]+)(?:\s[^>]*)?><\/\1>/g), m => m[1]));
  for (const m of xml.matchAll(/<([\w:.-]+)(?:\s[^>]*)?\/>/g)) pairs.delete(m[1]);
  return [...pairs];
}

// ---------------------------------------------------------------------------------------------------------------
// Serialization

/** XML of one textbox as it would be saved (`positioned`: not a table cell). */
export function textboxXml(r: Report, tb: TextboxItem, positioned: boolean, dom: XmlDom = browserDom): string {
  return new Writer(r, dom).textbox(tb, positioned);
}

/**
 * Reads one textbox from verbatim XML: editable when the model can represent it (and `raw` is not set), otherwise
 * as a raw item kept verbatim.
 */
export function textboxFromXml(xml: string, positioned: boolean, dom: XmlDom = browserDom, raw = false): TextboxItem | RawItem {
  const p = new Parser(dom);
  const el = elements(dom.parse(`<w xmlns:rd="${NS_RD}">${xml}</w>`).documentElement)[0];
  return (raw ? null : p.textbox(el, positioned)) ?? p.raw(el);
}

/** Escaping for attribute values. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Escaping for text content: quotes stay as they are (as Visual Studio writes them). */
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Part = string | undefined | false | null;
const tagOf = (frag: string) => /^<([^\s/>]+)/.exec(frag)?.[1] ?? '';

/** A table cell without content (<CellContents /> or only ColSpan): written back without an item. */
export const emptyCell = (): RawItem => ({ id: newId(), type: 'raw', kind: 'Empty', name: '', xml: '', top: 0, left: 0, width: 0, height: 0, style: {} });

/** Builds an element from fragments; with `order`, fragments are arranged in the original child order. */
function el(name: string, parts: Part[], order?: string[], attrs = ''): string {
  let frags = parts.filter((x): x is string => !!x);
  if (order?.length) {
    const rank = (f: string) => { const i = order.indexOf(tagOf(f)); return i < 0 ? order.length : i; };
    frags = frags.map((f, i) => [f, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
  }
  return frags.length ? `<${name}${attrs}>${frags.join('')}</${name}>` : `<${name}${attrs} />`;
}
const tel = (name: string, value: string | undefined, attrs = '') =>
  value === undefined ? undefined : value === '' ? `<${name}${attrs} />` : `<${name}${attrs}>${escText(value)}</${name}>`;
const nameAttr = (name: string) => ` Name="${esc(name)}"`;

const RUN_KEYS: StyleKey[] = ['FontStyle', 'FontFamily', 'FontSize', 'FontWeight', 'Format', 'TextDecoration', 'Color'];
const HOME: Record<StyleKey, StyleLevel> = Object.fromEntries([
  ...RUN_KEYS.map(k => [k, 'run']), ['TextAlign', 'paragraph'],
]) as Record<StyleKey, StyleLevel>;
const homeOf = (k: StyleKey) => HOME[k] ?? 'box';

/**
 * `<Style>` of an element at `path` ("Style", "Paragraph/Style", …) in the original child order. For objects read from
 * a file that had no such element, an empty style is left out.
 */
function styleXml(style: Style, extra: string[] | undefined, withBorder: boolean, origin: Origin | undefined, path = 'Style'): string | undefined {
  const order = origin?.inner?.[path];
  const border = withBorder && (style.BorderStyle !== undefined || style.BorderColor !== undefined || style.BorderWidth !== undefined)
    ? el('Border', [tel('Color', style.BorderColor), tel('Style', style.BorderStyle), tel('Width', style.BorderWidth)], origin?.inner?.[`${path}/Border`])
    : undefined;
  const xml = el('Style', [border, ...STYLE_KEYS.map(k => tel(k, style[k])), ...(extra ?? [])], order);
  return xml === '<Style />' && origin && !order ? undefined : xml;
}

/**
 * The style written at one level of a textbox: keys whose home is this level (where the file had them, or the
 * canonical level for new keys) get the current value; values the file had at other levels stay as they were.
 */
function levelStyle(tb: TextboxItem, level: StyleLevel): Style {
  const lv = tb.styleLevels;
  const out: Style = {};
  for (const k of Object.keys(tb.style) as StyleKey[]) {
    const home: StyleLevel = lv?.run[k] !== undefined ? 'run' : lv?.paragraph[k] !== undefined ? 'paragraph' : lv?.box[k] !== undefined ? 'box' : homeOf(k);
    if (home === level) out[k] = tb.style[k];
    else if (lv?.[level][k] !== undefined) out[k] = lv[level][k];
  }
  return out;
}

class Writer {
  constructor(private r: Report, private dom: XmlDom) {}

  /** A size in its original notation if the value did not change, otherwise in the report unit. */
  len(value: number, src: string | undefined): string {
    return src !== undefined && Math.abs(parseSize(src, NaN) - value) < 1e-6 ? src : formatSize(value, this.r.unit);
  }

  /** Top/Left/Height/Width; sizes the file left out (default 0) are only written once they are non-zero. */
  /** Position and size elements; `inCell`: the item fills a table cell – only sizes the file had are written. */
  position(it: ReportItem, box: { top: number; left: number; width: number; height: number } = it, inCell = false) {
    const s = it.origin?.sizes ?? {};
    const one = (name: string, v: number) => (inCell ? s[name] !== undefined : !it.origin || s[name] !== undefined || Math.abs(v) > 1e-9) && tel(name, this.len(v, s[name]));
    return [one('Top', box.top), one('Left', box.left), one('Height', box.height), one('Width', box.width)];
  }

  items(items: ReportItem[]): string | undefined {
    return items.length ? el('ReportItems', items.map(i => this.item(i))) : undefined;
  }

  /** An item; `inCell`: it fills a table cell and has no position of its own. */
  item(it: ReportItem, inCell = false): string {
    if (it.type === 'raw') return this.raw(it);
    if (unchanged(it)) return it.origin!.xml;
    const isNew = !it.origin;
    const order = it.origin?.order;
    const common = (box = it) => [...this.position(it, box, inCell), ...(it.extra ?? [])];
    switch (it.type) {
      case 'textbox': return this.textbox(it, !inCell);
      case 'rectangle':
        return el('Rectangle', [this.items(it.items), isNew && tel('KeepTogether', 'true'), ...common(),
          styleXml(it.style, it.styleExtra, true, it.origin)], order, nameAttr(it.name));
      case 'line':
        return el('Line', [...common(), styleXml(isNew ? { BorderStyle: 'Solid', ...it.style } : it.style, it.styleExtra, true, it.origin)], order, nameAttr(it.name));
      case 'image':
        return el('Image', [tel('Source', it.source), tel('Value', it.value), tel('Sizing', it.sizing), ...common(),
          styleXml(isNew ? { BorderStyle: 'None', ...it.style } : it.style, it.styleExtra, true, it.origin)], order, nameAttr(it.name));
      case 'table': return this.table(it, inCell);
    }
  }

  /** Raw items are written verbatim; only a changed position/size is patched into their XML. */
  raw(it: RawItem): string {
    const box = { top: it.top, left: it.left, width: it.width, height: it.height };
    if (!it.origin || fingerprint(box) === it.origin.key) return it.xml;
    const doc = this.dom.parse(`<w xmlns:rd="${NS_RD}">${it.xml}</w>`);
    const node = elements(doc.documentElement)[0];
    const values: Record<string, number> = { Top: box.top, Left: box.left, Width: box.width, Height: box.height };
    for (const name of SIZE_NAMES) {
      const e = child(node, name);
      if (e) e.textContent = this.len(values[name], it.origin.sizes[name]);
    }
    return normalizeFragment(this.dom.serialize(node));
  }

  textbox(tb: TextboxItem, positioned: boolean): string {
    if (unchanged(tb)) return tb.origin!.xml;
    const isNew = !tb.origin;
    // Literal multi-line text becomes several paragraphs; expressions stay in one run.
    const lines = tb.value.startsWith('=') ? [tb.value] : tb.value.split('\n');
    const valueAttrs = (tb.valueAttrs ?? []).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    const inner = tb.origin?.inner;
    const paragraphs = lines.map(line => el('Paragraph', [
      el('TextRuns', [el('TextRun', [
        tel('Value', line, valueAttrs), styleXml(levelStyle(tb, 'run'), tb.runStyleExtra, false, tb.origin, 'TextRun/Style'), ...(tb.runExtra ?? []),
      ], inner?.TextRun)]),
      styleXml(levelStyle(tb, 'paragraph'), tb.paragraphStyleExtra, false, tb.origin, 'Paragraph/Style'),
      ...(tb.paragraphExtra ?? []),
    ], inner?.Paragraph));
    return el('Textbox', [
      (tb.canGrow || tb.origin?.order.includes('CanGrow')) && tel('CanGrow', String(tb.canGrow)),
      isNew && tel('KeepTogether', 'true'),
      el('Paragraphs', paragraphs),
      isNew && `<rd:DefaultName>${esc(tb.name)}</rd:DefaultName>`,
      ...(positioned ? this.position(tb) : []),
      styleXml(levelStyle(tb, 'box'), tb.styleExtra, true, tb.origin),
      ...(tb.extra ?? []),
    ], tb.origin?.order, nameAttr(tb.name));
  }

  table(t: TableItem, inCell = false): string {
    let width = tableWidth(t);
    let height = tableHeight(t);
    if (t.parsedSums) {
      width = t.width + width - t.parsedSums.width;
      height = t.height + height - t.parsedSums.height;
    }
    const cell = (c: ReportItem) => [
      el('TablixCell', [el('CellContents', [this.item(c, true), (c.colSpan ?? 1) > 1 ? tel('ColSpan', String(c.colSpan)) : undefined, ...(c.contentsExtra ?? [])], c.contentsOrder), ...(c.cellExtra ?? [])]),
      // columns covered by a merged cell
      ...Array.from({ length: Math.max(0, (c.colSpan ?? 1) - 1) }, () => '<TablixCell />'),
    ].join('');
    const cellContents = (c: ReportItem, spans: Part[]) => el('CellContents', [this.item(c, true), ...spans, ...(c.contentsExtra ?? [])], c.contentsOrder);
    return el('Tablix', [
      t.corner && el('TablixCorner', [el('TablixCornerRows', t.corner.map(row => el('TablixCornerRow', row.map(c => (c.item
        ? el('TablixCornerCell', [cellContents(c.item, [
          (c.item.colSpan ?? 1) > 1 ? tel('ColSpan', String(c.item.colSpan)) : undefined, (c.rowSpan ?? 1) > 1 ? tel('RowSpan', String(c.rowSpan)) : undefined,
        ]), ...(c.item.cellExtra ?? [])])
        : '<TablixCornerCell />')))))]),
      el('TablixBody', [
        el('TablixColumns', t.columns.map((w, i) => el('TablixColumn', [tel('Width', this.len(w, t.columnSrc?.[i]))]))),
        el('TablixRows', t.rows.map(r => el('TablixRow', [tel('Height', this.len(r.height, r.heightSrc)), el('TablixCells', r.cells.map(cell))]))),
      ]),
      el('TablixColumnHierarchy', [el('TablixMembers', t.columnMembers.map(m => this.member(m)))]),
      el('TablixRowHierarchy', [el('TablixMembers', t.rowMembers.map(m => this.member(m)))]),
      t.dataSetName ? tel('DataSetName', t.dataSetName) : undefined,
      ...this.position(t, { ...t, width, height }, inCell),
      styleXml(t.origin ? t.style : { BorderStyle: 'None', ...t.style }, t.styleExtra, true, t.origin),
      ...(t.extra ?? []),
    ], t.origin?.order, nameAttr(t.name));
  }

  member(m: RowMember): string {
    if (unchanged(m)) return m.origin!.xml;
    const h = m.header;
    return el('TablixMember', [
      m.group && this.group(m.group),
      h && el('TablixHeader', [tel('Size', this.len(h.size, h.sizeSrc)), el('CellContents', [this.item(h.cell, true), ...(h.cell.contentsExtra ?? [])], h.cell.contentsOrder)], h.order),
      m.sort.length ? el('SortExpressions', m.sort.map(s => el('SortExpression', [tel('Value', s.value), s.descending ? tel('Direction', 'Descending') : undefined]))) : undefined,
      ...m.extra,
      m.children.length ? el('TablixMembers', m.children.map(c => this.member(c))) : undefined,
    ], m.origin?.order);
  }

  group(g: TableGroup): string {
    if (unchanged(g)) return g.origin!.xml;
    return el('Group', [
      g.expressions.length ? el('GroupExpressions', g.expressions.map(e => tel('GroupExpression', e))) : undefined,
      g.filters.length ? el('Filters', g.filters.map(f => el('Filter', [
        tel('FilterExpression', f.expression), tel('Operator', f.operator), el('FilterValues', f.values.map(v => tel('FilterValue', v))),
      ]))) : undefined,
      g.pageBreak || g.pageBreakExtra.length ? el('PageBreak', [g.pageBreak ? tel('BreakLocation', g.pageBreak) : undefined, ...g.pageBreakExtra], g.origin?.inner?.PageBreak) : undefined,
      ...g.extra,
    ], g.origin?.order, nameAttr(g.name));
  }

  section(tag: string, s: Section, pageSection: boolean): string {
    if (unchanged(s)) return s.origin!.xml;
    const isNew = !s.origin;
    return el(tag, [
      this.items(s.items),
      tel('Height', this.len(s.height, s.origin?.sizes.Height)),
      // new page sections print on all pages unless set otherwise (then the setting is in `extra`)
      pageSection && isNew && !s.extra?.some(x => x.startsWith('<PrintOnFirstPage')) && tel('PrintOnFirstPage', 'true'),
      pageSection && isNew && !s.extra?.some(x => x.startsWith('<PrintOnLastPage')) && tel('PrintOnLastPage', 'true'),
      styleXml(s.style, s.styleExtra, true, s.origin),
      ...(s.extra ?? []),
    ], s.origin?.order ?? (pageSection ? ['Height', 'PrintOnFirstPage', 'PrintOnLastPage', 'ReportItems', 'Style'] : undefined));
  }

  dataSource(d: DataSource): string {
    if (unchanged(d)) return d.origin!.xml;
    return el('DataSource', [
      d.sharedReference !== undefined
        ? tel('DataSourceReference', d.sharedReference)
        : el('ConnectionProperties', [tel('DataProvider', d.provider), tel('ConnectString', d.connectString), ...d.connExtra]),
      ...d.extra,
      (!d.origin || d.origin.order.includes('rd:DataSourceID')) && `<rd:DataSourceID>${escText(d.id)}</rd:DataSourceID>`,
    ], d.origin?.order, nameAttr(d.name));
  }

  dataSet(d: DataSet): string {
    if (unchanged(d)) return d.origin!.xml;
    return el('DataSet', [
      el('Query', [tel('DataSourceName', d.dataSourceName), ...d.queryExtra, tel('CommandText', d.commandText)]),
      (d.fields.length > 0 || d.origin?.order.includes('Fields')) && el('Fields', d.fields.map(f => el('Field', [
        f.value !== undefined ? tel('Value', f.value) : tel('DataField', f.dataField),
        f.typeName && `<rd:TypeName>${escText(f.typeName)}</rd:TypeName>`, ...(f.extra ?? []),
      ], undefined, nameAttr(f.name)))),
      ...d.extra,
    ], d.origin?.order, nameAttr(d.name));
  }

  parameter(p: Parameter): string {
    if (unchanged(p)) return p.origin!.xml;
    // a newly entered literal default replaces a verbatim (query-based) one
    const extra = p.defaultValue !== '' ? p.extra.filter(x => tagOf(x) !== 'DefaultValue') : p.extra;
    return el('ReportParameter', [
      tel('DataType', p.dataType),
      p.nullable && tel('Nullable', 'true'),
      p.defaultValue !== '' && el('DefaultValue', [el('Values', [tel('Value', p.defaultValue)])]),
      p.allowBlank && tel('AllowBlank', 'true'),
      tel('Prompt', p.prompt || p.name),
      ...extra,
    ], p.origin?.order, nameAttr(p.name));
  }

  /** SSRS rejects a parameter grid that does not list exactly the declared parameters; regenerated when they changed. */
  parameterLayout(params: Parameter[]): string | undefined {
    const src = this.r.source?.parameterLayout;
    if (src && src.names.join('\n') === params.map(p => p.name).join('\n')) return src.xml;
    // The grid is optional; files without one (Business Central layouts) do not get one.
    if (!params.length || (this.r.source && !src)) return undefined;
    const cols = 4;
    return el('ReportParametersLayout', [el('GridLayoutDefinition', [
      tel('NumberOfColumns', String(cols)),
      tel('NumberOfRows', String(Math.max(2, Math.ceil(params.length / cols)))),
      el('CellDefinitions', params.map((p, i) => el('CellDefinition', [
        tel('ColumnIndex', String(i % cols)), tel('RowIndex', String(Math.floor(i / cols))), tel('ParameterName', p.name)]))),
    ])]);
  }

  page(): string {
    const p = this.r.page;
    const s = p.origin?.sizes ?? {};
    const isNew = !p.origin;
    // Sizes the file left out (RDL defaults) are only written once they are set to something else.
    const size = (name: string, value: number, fallback: number) =>
      (isNew || s[name] !== undefined || Math.abs(value - fallback) > 1e-9) && tel(name, this.len(value, s[name]));
    return el('Page', [
      this.r.header && this.section('PageHeader', this.r.header, true),
      this.r.footer && this.section('PageFooter', this.r.footer, true),
      size('PageHeight', p.height, 11), size('PageWidth', p.width, 8.5),
      size('LeftMargin', p.marginLeft, 0), size('RightMargin', p.marginRight, 0),
      size('TopMargin', p.marginTop, 0), size('BottomMargin', p.marginBottom, 0),
      ...p.extra,
      isNew && !p.extra.some(x => tagOf(x) === 'Style') && '<Style />',
    ], p.origin?.order);
  }
}

export function serializeRdl(r: Report, dom: XmlDom = browserDom): string {
  const w = new Writer(r, dom);
  const src: Partial<SourceFormat> = r.source ?? {};
  const isNew = !r.source;
  const unitText = src.unitRaw !== undefined && src.unitInferred === r.unit ? src.unitRaw : r.unit === 'cm' ? 'Cm' : 'Inch';
  const writeUnit = isNew || src.unitRaw !== undefined || src.unitInferred !== r.unit;

  const section = el('ReportSection', [
    w.section('Body', r.body, false),
    tel('Width', w.len(r.width, src.widthSrc)),
    w.page(),
    ...(src.sectionExtra ?? []),
  ], src.sectionOrder);

  // Root attributes as in the file (MustUnderstand, df/rd namespace declarations, …), with the namespace written.
  const attrs = new Map<string, string>(src.rootAttributes ?? []);
  attrs.set('xmlns', r.namespace);
  if (!attrs.has('xmlns:rd')) attrs.set('xmlns:rd', NS_RD);
  const attrText = [...attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');

  const body = el('Report', [
    isNew && tel('AutoRefresh', '0'),
    ...r.extraXml,
    r.dataSources.length > 0 && el('DataSources', r.dataSources.map(d => w.dataSource(d))),
    r.dataSets.length > 0 && el('DataSets', r.dataSets.map(d => w.dataSet(d))),
    el('ReportSections', [section, ...(src.moreSections ?? [])]),
    r.parameters.length > 0 && el('ReportParameters', r.parameters.map(x => w.parameter(x))),
    r.namespace === NS_2016 && w.parameterLayout(r.parameters),
    writeUnit && `<rd:ReportUnitType>${esc(unitText)}</rd:ReportUnitType>`,
    (isNew || src.order?.includes('rd:ReportID')) && `<rd:ReportID>${esc(r.reportId)}</rd:ReportID>`,
  ], src.order, attrText);

  // Namespace declarations the root already makes are not repeated on verbatim fragments (e.g. xmlns:df).
  const rootStart = body.indexOf('>') + 1;
  let inner = body.slice(rootStart);
  for (const [k, v] of attrs) {
    if (k.startsWith('xmlns:')) inner = inner.split(` ${k}="${esc(v)}"`).join('');
  }
  const eol = src.eol ?? '\n';
  let pretty = prettyXml(body.slice(0, rootStart) + inner);
  for (const tag of src.emptyPairs ?? []) {
    pretty = pretty.replace(new RegExp(`<${tag.replace(/\./g, '\\.')}((?:\\s[^>]*?)?) />`, 'g'), `<${tag}$1></${tag}>`);
  }
  const lines = [src.declaration === undefined ? '<?xml version="1.0" encoding="utf-8"?>' : src.declaration, pretty]
    .filter((x): x is string => x !== null);
  const textOut = lines.join('\n').replace(/\n/g, eol) + (src.finalNewline === false ? '' : eol);
  return (src.bom ? '﻿' : '') + textOut;
}

/** Indents serialized XML (two spaces per level) without touching text content. */
export function prettyXml(xml: string): string {
  const tokens = xml.match(/<[^>]+>|[^<]+/g) ?? [];
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pad = '  '.repeat(depth);
    if (t.startsWith('</')) {
      depth--;
      out.push('  '.repeat(depth) + t);
    } else if (t.startsWith('<') && !t.endsWith('/>') && !t.startsWith('<?') && !t.startsWith('<!')) {
      // <a></a> and <a>text</a> stay on one line – a line break would change the element's value
      if (tokens[i + 1]?.startsWith('</')) {
        out.push(pad + t + tokens[i + 1]);
        i += 1;
      } else if (tokens[i + 1] !== undefined && !tokens[i + 1].startsWith('<') && tokens[i + 2]?.startsWith('</')) {
        out.push(pad + t + tokens[i + 1] + tokens[i + 2]);
        i += 2;
      } else {
        out.push(pad + t);
        depth++;
      }
    } else if (t.startsWith('<')) {
      out.push(pad + t);
    } else if (t.trim()) {
      out.push(pad + t.trim());
    }
  }
  return out.join('\n');
}
