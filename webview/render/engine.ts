// Render engine: evaluates an RDL document (as XML) with data into a positioned tree (see types.ts).
// Works on the XML so every report item is covered – including grouped Tablix regions of Business Central layouts
// the designer keeps verbatim. Runs without a browser (tests use @xmldom/xmldom).
//
// mode 'preview' evaluates expressions against data; mode 'design' shows the structure as the designer does:
// every group once, expressions as [Field] labels, hidden items visible.

import { EvalContext, Row, compare, designLabel, evaluate, formatValue, isNothing, toBool, toStr } from '../expr';
import { XmlDom, child, elements, text } from '../rdl';
import { parseSize } from '../units';
import { CodeModule } from '../vb';
import { ChartType, Css, PageInfo, RBox, RCell, RChart, RChartAxis, RChartSeries, RGauge, RNode, RPara, RRow, RSection, RTable, RenderResult } from './types';
import { axesOf, readAxis } from '../charts';

export interface RenderOptions {
  dom: XmlDom;
  mode: 'preview' | 'design';
  /** Rows per dataset name. */
  data?: Record<string, Row[]>;
  parameters?: Record<string, unknown>;
  reportName?: string;
  locale?: string;
  now?: Date;
  /**
   * Interactivity of the preview: toggle keys the user clicked (drilldown, see RBox.toggle) and interactive sorts by
   * textbox name (UserSort).
   */
  toggled?: ReadonlySet<string>;
  userSort?: Readonly<Record<string, 'Ascending' | 'Descending'>>;
}

const ITEMS = new Set(['Textbox', 'Rectangle', 'Line', 'Image', 'Tablix', 'Chart', 'Subreport', 'Map', 'GaugePanel', 'CustomReportItem']);
const PLACEHOLDER: Record<string, string> = {
  Chart: 'Diagramm', Subreport: 'Unterbericht', Map: 'Karte', GaugePanel: 'Messgerät', CustomReportItem: 'Benutzerdefiniertes Element',
};
const FONT_WEIGHT: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, heavy: 900,
};
const BORDER_STYLE: Record<string, string> = { none: 'none', solid: 'solid', dotted: 'dotted', dashed: 'dashed', double: 'double', default: 'none' };

interface Box { top: number; left: number; width: number; height: number }

/** Comparison that never throws: values that cannot be compared numerically are compared as text. */
function cmpSafe(a: unknown, b: unknown): number {
  try {
    return compare(a, b);
  } catch {
    const x = toStr(a), y = toStr(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
}

/** One member instance after expanding a Tablix hierarchy. */
interface Leaf {
  index: number;
  rows: Row[];
  ctx: EvalContext;
  breakBefore: boolean;
  reset: boolean;
  repeat: boolean;
}
interface HeaderCell { level: number; start: number; span: number; contents: Element | undefined; size: number; ctx: EvalContext }

/** An active interactive sort inside a data region. */
interface UserSortSpec { expr: string; descending: boolean; scope?: string }

export function renderReport(xml: string, opts: RenderOptions): RenderResult {
  return new Engine(xml, opts).result();
}

class Engine {
  private root: Element;
  private section: Element;
  private page: Element | undefined;
  private errors = new Map<string, string>();
  private code?: CodeModule;
  private images: Record<string, string> = {};
  /** Most recent value per report item name (ReportItems! inside the body). */
  private last = new Map<string, unknown>();
  private counter = 0;
  private base: EvalContext;
  /** Textboxes other items toggle with (ToggleItem), and instance ids of rows for toggle scopes. */
  private toggleSources = new Set<string>();
  private rowIds = new WeakMap<object, string>();
  private design: boolean;
  /** Names of all report items (ReportItems! to an item not evaluated yet gives Nothing instead of an error). */
  private itemNames = new Set<string>();

  constructor(xml: string, private opts: RenderOptions) {
    const doc = opts.dom.parse(xml.replace(/^﻿/, ''));
    this.root = doc.documentElement;
    this.section = child(this.root, 'ReportSections', 'ReportSection') ?? this.root;
    this.page = child(this.section, 'Page') ?? child(this.root, 'Page');
    this.design = opts.mode === 'design';

    for (const img of elements(child(this.root, 'EmbeddedImages'), 'EmbeddedImage')) {
      const data = text(img, 'ImageData')?.replace(/\s/g, '');
      if (data) this.images[img.getAttribute('Name') ?? ''] = `data:${text(img, 'MIMEType') ?? 'image/png'};base64,${data}`;
    }
    for (const tag of ITEMS) {
      for (const e of Array.from(doc.getElementsByTagName(tag) as ArrayLike<Element>)) this.itemNames.add(e.getAttribute('Name') ?? '');
    }
    const codeText = text(this.root, 'Code');
    if (codeText && !this.design) {
      try {
        this.code = new CodeModule(codeText);
        this.code.errors.forEach((e, i) => this.errors.set(`Code ${i + 1}`, e));
      } catch (e) {
        this.errors.set('Code', (e as Error).message);
      }
    }
    for (const t of xml.matchAll(/<ToggleItem>([^<]+)<\/ToggleItem>/g)) this.toggleSources.add(t[1].trim());
    // stable instance ids: the position of a row in its dataset (independent of what is expanded)
    for (const [ds, rows] of Object.entries(opts.data ?? {})) rows.forEach((r, i) => { if (r && typeof r === 'object') this.rowIds.set(r, `${ds}:${i}`); });
    this.base = {
      row: null, scopeRows: [], dataSets: opts.data ?? {}, parameters: opts.parameters ?? {},
      globals: {
        ExecutionTime: opts.now ?? new Date(), PageNumber: 1, TotalPages: 1, OverallPageNumber: 1, OverallTotalPages: 1,
        ReportName: opts.reportName ?? 'Bericht', ReportFolder: '/', ReportServerUrl: '', RenderFormat: { Name: 'RPL', IsInteractive: true },
      },
      code: this.code,
      reportItems: n => (this.last.has(n) ? [this.last.get(n)] : this.itemNames.has(n) ? [] : undefined),
      scopes: {},
    };
    const lang = text(this.root, 'Language');
    this.base.locale = opts.locale ?? (lang ? toStr(this.eval(lang, this.base, 'Language')) || undefined : undefined);
  }

  result(): RenderResult {
    const p = this.page;
    const sectionInfo = (el: Element | undefined) => el && {
      height: parseSize(text(el, 'Height'), 0),
      printOnFirstPage: (text(el, 'PrintOnFirstPage') ?? 'true').toLowerCase() === 'true',
      printOnLastPage: (text(el, 'PrintOnLastPage') ?? 'true').toLowerCase() === 'true',
    };
    const headerEl = child(p, 'PageHeader'), footerEl = child(p, 'PageFooter');
    // the body is evaluated first: page sections may use Code state and ReportItems produced by it
    const body = this.sectionNodes(child(this.section, 'Body'), this.base);
    return {
      page: {
        width: parseSize(text(p, 'PageWidth'), 8.5), height: parseSize(text(p, 'PageHeight'), 11),
        marginTop: parseSize(text(p, 'TopMargin')), marginBottom: parseSize(text(p, 'BottomMargin')),
        marginLeft: parseSize(text(p, 'LeftMargin')), marginRight: parseSize(text(p, 'RightMargin')),
      },
      bodyWidth: parseSize(text(this.section, 'Width'), 6.5),
      body,
      header: sectionInfo(headerEl) ?? null,
      footer: sectionInfo(footerEl) ?? null,
      renderSection: (kind, page) => this.pageSection(kind === 'header' ? headerEl : footerEl, page),
      errors: [...this.errors],
    };
  }

  private pageSection(el: Element | undefined, page: PageInfo): RSection | null {
    if (!el) return null;
    const ctx: EvalContext = {
      ...this.base,
      globals: { ...this.base.globals, PageNumber: page.number, TotalPages: page.total, OverallPageNumber: page.overallNumber, OverallTotalPages: page.overallTotal },
      reportItems: n => page.reportItems.get(n) ?? [],
    };
    const run = () => this.sectionNodes(el, ctx);
    return this.code ? this.code.atVersion(page.version, run) : run();
  }

  private sectionNodes(el: Element | undefined, ctx: EvalContext): RSection {
    return {
      height: parseSize(text(el, 'Height'), 0),
      css: this.styleCss(child(el, 'Style'), ctx, el?.localName ?? 'Body'),
      nodes: this.items(child(el, 'ReportItems'), ctx),
    };
  }

  // ------------------------------------------------------------------------------------------------ evaluation

  private eval(value: string, ctx: EvalContext, where: string): unknown {
    if (this.design) return value.startsWith('=') ? designLabel(value) : value;
    try {
      return evaluate(value, ctx);
    } catch (e) {
      if (!this.errors.has(where)) this.errors.set(where, (e as Error).message);
      return '#Fehler';
    }
  }

  private evalBool(el: Element | undefined, ctx: EvalContext, where: string): boolean {
    const v = el?.textContent?.trim();
    if (!v || this.design) return false;
    return toBool(this.eval(v, ctx, where));
  }

  private key() { return `r${(this.counter++).toString(36)}`; }

  /** Value of a style property: literal, or evaluated expression (ignored in design mode). */
  private styleValue(v: string | undefined, ctx: EvalContext, where: string): string | undefined {
    if (v === undefined || v === '') return undefined;
    if (!v.startsWith('=')) return v;
    if (this.design) return undefined;
    const r = this.eval(v, ctx, `${where} (Stil)`);
    return isNothing(r) || r === '#Fehler' ? undefined : toStr(r);
  }

  /** CSS for a <Style>: fonts, colors, padding, alignment and borders (Border plus per-side overrides). */
  styleCss(style: Element | undefined, ctx: EvalContext, where: string): Css {
    const css: Css = {};
    if (!style) return css;
    const val = (name: string) => this.styleValue(text(style, name), ctx, where);
    const set = (k: string, v: string | number | undefined) => { if (v !== undefined && v !== '') css[k] = v; };
    // fonts missing on this machine (Segoe UI on macOS, …) fall back to a similar sans-serif
    const ff = val('FontFamily');
    if (ff) css.fontFamily = `"${ff.replace(/"/g, '')}", "Segoe UI", Arial, Helvetica, sans-serif`;
    set('fontSize', val('FontSize'));
    const fw = val('FontWeight');
    if (fw) css.fontWeight = FONT_WEIGHT[fw.toLowerCase()] ?? 400;
    if (val('FontStyle')?.toLowerCase() === 'italic') css.fontStyle = 'italic';
    const td = val('TextDecoration')?.toLowerCase();
    if (td && td !== 'none') css.textDecoration = td === 'linethrough' ? 'line-through' : td;
    set('color', val('Color'));
    const bg = val('BackgroundColor');
    if (bg && bg.toLowerCase() !== 'transparent' && bg.toLowerCase() !== 'no color') css.backgroundColor = bg;
    for (const side of ['Left', 'Right', 'Top', 'Bottom']) set(`padding${side}`, val(`Padding${side}`));
    const ta = val('TextAlign')?.toLowerCase();
    if (ta && ta !== 'general') css.textAlign = ta;
    set('lineHeight', val('LineHeight'));

    const border = (el: Element | undefined) => el && {
      style: this.styleValue(text(el, 'Style'), ctx, where),
      color: this.styleValue(text(el, 'Color'), ctx, where),
      width: this.styleValue(text(el, 'Width'), ctx, where),
    };
    const all = border(child(style, 'Border'));
    for (const side of ['Top', 'Bottom', 'Left', 'Right']) {
      const s = border(child(style, `${side}Border`));
      const st = BORDER_STYLE[(s?.style ?? all?.style ?? 'none').toLowerCase()] ?? 'solid';
      if (st === 'none') continue;
      css[`border${side}`] = `${s?.width ?? all?.width ?? '1pt'} ${st} ${s?.color ?? all?.color ?? 'Black'}`;
    }
    return css;
  }

  // ------------------------------------------------------------------------------------------------ items

  private items(container: Element | undefined, ctx: EvalContext): RNode[] {
    return elements(container).filter(e => ITEMS.has(e.localName)).map(e => this.item(e, ctx, null));
  }

  /** Renders one report item; `cell` is the cell box when the item fills a Tablix cell. */
  private item(el: Element, ctx: EvalContext, cell: Box | null): RNode {
    const name = el.getAttribute('Name') ?? '';
    const box: Box = cell ?? {
      top: parseSize(text(el, 'Top')), left: parseSize(text(el, 'Left')),
      width: parseSize(text(el, 'Width')), height: parseSize(text(el, 'Height')),
    };
    const hidden = this.visible(child(el, 'Visibility'), ctx, ctx, `${name} (Sichtbarkeit)`);
    const keepTogether = (text(el, 'KeepTogether') ?? '').toLowerCase() === 'true';
    const base = { key: this.key(), name, ...box, hidden, seq: this.code?.version ?? 0, keepTogether, ...this.actionInfo(el, ctx, name) };
    switch (el.localName) {
      case 'Textbox': return this.textbox(el, ctx, base);
      case 'Rectangle': {
        const node: RBox = {
          ...base, kind: 'box', css: this.styleCss(child(el, 'Style'), ctx, name), canGrow: true, vAlign: 'top',
          children: this.items(child(el, 'ReportItems'), ctx),
        };
        node.seq = this.code?.version ?? 0;
        return node;
      }
      case 'Line': {
        const css = this.styleCss(child(el, 'Style'), ctx, name);
        const [w, st, color] = String(css.borderTop ?? '1pt solid Black').split(' ');
        return { ...base, kind: 'line', css: {}, stroke: color ?? 'Black', strokeWidth: w ?? '1pt', dash: st === 'dashed' ? '6 3' : st === 'dotted' ? '1 2' : undefined };
      }
      case 'Image': return { ...base, kind: 'image', css: this.styleCss(child(el, 'Style'), ctx, name), src: this.imageSrc(el, ctx, name), sizing: text(el, 'Sizing') ?? 'AutoSize' };
      case 'Tablix': return this.tablix(el, ctx, base, cell !== null || ctx.regionRows !== undefined);
      case 'Chart': return this.chart(el, ctx, base);
      case 'GaugePanel': return this.gauge(el, ctx, base) ?? { ...base, kind: 'placeholder', css: {}, label: `Messgerät „${name}“` };
      default: return { ...base, kind: 'placeholder', css: {}, label: `${PLACEHOLDER[el.localName] ?? el.localName} „${name}“` };
    }
  }

  /** Action (first <Action> of <ActionInfo>) and bookmark of an item, evaluated; nothing in design mode. */
  private actionInfo(el: Element, ctx: EvalContext, name: string): Pick<RNode, 'action' | 'bookmark'> {
    if (this.design) return {};
    const out: Pick<RNode, 'action' | 'bookmark'> = {};
    const bookmark = text(el, 'Bookmark');
    if (bookmark) out.bookmark = toStr(this.eval(bookmark, ctx, `${name} (Lesezeichen)`));
    const action = elements(child(el, 'ActionInfo', 'Actions'), 'Action')[0];
    const where = `${name} (Aktion)`;
    const link = text(action, 'Hyperlink');
    const mark = text(action, 'BookmarkLink');
    const dt = child(action, 'Drillthrough');
    if (link) out.action = { kind: 'hyperlink', url: toStr(this.eval(link, ctx, where)) };
    else if (mark) out.action = { kind: 'bookmarkLink', bookmark: toStr(this.eval(mark, ctx, where)) };
    else if (dt) {
      out.action = {
        kind: 'drillthrough', report: toStr(this.eval(text(dt, 'ReportName') ?? '', ctx, where)),
        parameters: elements(child(dt, 'Parameters'), 'Parameter').map(p => [p.getAttribute('Name') ?? '', toStr(this.eval(text(p, 'Value') ?? '', ctx, where))]),
      };
    }
    return out;
  }

  private imageSrc(el: Element, ctx: EvalContext, name: string): string {
    if (this.design) return '';
    const source = text(el, 'Source') ?? 'External';
    const value = toStr(this.eval(text(el, 'Value') ?? '', ctx, name));
    if (!value || value === '#Fehler') return '';
    if (source === 'Embedded') return this.images[value] ?? '';
    if (source === 'Database') return /^data:/.test(value) ? value : `data:${text(el, 'MIMEType') ?? 'image/png'};base64,${value}`;
    return value;
  }

  private textbox(el: Element, ctx: EvalContext, base: Omit<RBox, 'kind' | 'css' | 'canGrow' | 'vAlign'>): RBox {
    const name = base.name;
    const values: unknown[] = [];
    const paragraphs: RPara[] = elements(child(el, 'Paragraphs'), 'Paragraph').map(p => {
      const runs = elements(child(p, 'TextRuns'), 'TextRun').map(r => {
        const valueEl = child(r, 'Value');
        const raw = valueEl?.textContent ?? '';
        // EvaluationMode="Constant": text starting with "=" is literal
        const value = valueEl?.getAttribute('EvaluationMode') === 'Constant' ? raw : this.eval(raw, ctx, name);
        values.push(value);
        const style = child(r, 'Style');
        const format = this.design ? undefined : this.styleValue(text(style, 'Format'), ctx, name);
        const shown = this.design ? toStr(value) : formatValue(value, format ?? '', ctx.locale);
        return { text: shown, css: this.styleCss(style, ctx, name), value };
      });
      const pcss = this.styleCss(child(p, 'Style'), ctx, name);
      // TextAlign "General": numbers and dates right
      if (!pcss.textAlign) {
        const v = runs[0]?.value;
        if (typeof v === 'number' || v instanceof Date) pcss.textAlign = 'right';
      }
      return { css: pcss, runs: runs.map(({ text: t, css }) => ({ text: t, css })) };
    });
    const value = values.length === 1 ? values[0] : paragraphs.map(p => p.runs.map(r => r.text).join('')).join('\n');
    this.last.set(name, value);
    const css = this.styleCss(child(el, 'Style'), ctx, name);
    const va = (this.styleValue(text(child(el, 'Style'), 'VerticalAlign'), ctx, name) ?? 'Top').toLowerCase();
    const node: RBox = {
      ...base, kind: 'box', css, paragraphs, canGrow: (text(el, 'CanGrow') ?? 'false').toLowerCase() === 'true',
      vAlign: va === 'middle' ? 'middle' : va === 'bottom' ? 'bottom' : 'top',
      values: [[name, value]], seq: this.code?.version ?? 0,
    };
    if (!this.design && this.toggleSources.has(name)) {
      const key = this.toggleKey(name, ctx);
      const initial = this.evalBool(child(el, 'ToggleImage', 'InitialState'), ctx, `${name} (Umschaltbild)`);
      node.toggle = { key, expanded: initial !== !!this.opts.toggled?.has(key) };
    }
    if (!this.design && child(el, 'UserSort')) node.userSort = { name, direction: this.opts.userSort?.[name] };
    return node;
  }

  // ------------------------------------------------------------------------------------------------ Tablix

  private filter(filters: Element | undefined, rows: Row[], ctxFor: (rows: Row[]) => EvalContext, where: string): Row[] {
    const list = elements(filters, 'Filter');
    if (!list.length || this.design) return rows;
    return list.reduce((acc, f) => this.applyFilter(f, acc, ctxFor, where), rows);
  }

  /** Applies one <Filter> to rows (row filters) – used for Tablix filters. */
  private applyFilter(f: Element, rows: Row[], ctxFor: (rows: Row[]) => EvalContext, where: string): Row[] {
    const expr = text(f, 'FilterExpression') ?? '';
    const op = (text(f, 'Operator') ?? 'Equal').toLowerCase();
    const literal = (v: Element, c: EvalContext) => {
      const t = v.textContent ?? '';
      if (t.startsWith('=')) return this.eval(t, c, `${where} (Filter)`);
      const type = v.getAttribute('DataType');
      if (type === 'Integer' || type === 'Float') return Number(t);
      if (type === 'Boolean') return t.toLowerCase() === 'true';
      if (type === 'DateTime') return new Date(t);
      return t;
    };
    const valuesEl = elements(child(f, 'FilterValues'), 'FilterValue');
    if (op === 'topn' || op === 'bottomn' || op === 'toppercent' || op === 'bottompercent') {
      const c0 = ctxFor(rows);
      const n = Number(literal(valuesEl[0], c0));
      const sorted = [...rows].sort((a, b) => cmpSafe(this.eval(expr, { ...c0, row: b }, where), this.eval(expr, { ...c0, row: a }, where)));
      if (op.startsWith('bottom')) sorted.reverse();
      return sorted.slice(0, op.endsWith('percent') ? Math.ceil(rows.length * n / 100) : n);
    }
    return rows.filter(row => {
      const c = { ...ctxFor([row]), row };
      const lhs = this.eval(expr, c, `${where} (Filter)`);
      const vals = valuesEl.map(v => literal(v, c));
      const cmp = (v: unknown) => cmpSafe(lhs, typeof lhs === 'number' && typeof v === 'string' && v !== '' ? Number(v) : v);
      switch (op) {
        case 'equal': return cmp(vals[0]) === 0;
        case 'notequal': return cmp(vals[0]) !== 0;
        case 'greaterthan': return cmp(vals[0]) > 0;
        case 'greaterthanorequal': return cmp(vals[0]) >= 0;
        case 'lessthan': return cmp(vals[0]) < 0;
        case 'lessthanorequal': return cmp(vals[0]) <= 0;
        case 'in': return vals.some(v => cmp(v) === 0);
        case 'between': return cmp(vals[0]) >= 0 && cmp(vals[1]) <= 0;
        case 'like': {
          const re = toStr(vals[0]).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
          return new RegExp(`^${re}$`, 'i').test(toStr(lhs));
        }
        default: return true;
      }
    });
  }

  private tablix(el: Element, ctx: EvalContext, base: { key: string; name: string; top: number; left: number; width: number; height: number; hidden: boolean; seq: number; keepTogether: boolean }, nested: boolean): RTable {
    const name = base.name;
    const ds = text(el, 'DataSetName');
    // a nested region works on the rows of its enclosing scope; a top-level one on its dataset
    let rows: Row[] = nested ? ctx.scopeRows : ds ? this.base.dataSets[ds] ?? [] : [];
    if (!nested && ds && !(ds in this.base.dataSets) && !this.design) this.errors.set(name, `Dataset „${ds}“ hat keine Daten`);
    const regionCtx = (r: Row[]): EvalContext => ({ ...ctx, row: r[0] ?? null, scopeRows: r, regionRows: rows, scopes: { ...ctx.scopes, [name]: rows } });
    rows = this.filter(child(el, 'Filters'), rows, regionCtx, name);
    const rctx = regionCtx(rows);

    const body = child(el, 'TablixBody');
    const colWidths = elements(child(body, 'TablixColumns'), 'TablixColumn').map(c => parseSize(text(c, 'Width'), 1));
    const bodyRows = elements(child(body, 'TablixRows'), 'TablixRow');

    const rowAxis = this.expand(child(el, 'TablixRowHierarchy', 'TablixMembers'), rows, rctx, name, this.userSortsOf(el));
    const colAxis = this.expand(child(el, 'TablixColumnHierarchy', 'TablixMembers'), rows, rctx, name);
    const rowHeaderLevels = Math.max(0, ...rowAxis.headers.map(h => h.level + 1));
    const colHeaderLevels = Math.max(0, ...colAxis.headers.map(h => h.level + 1));
    const levelSize = (headers: HeaderCell[], level: number) => headers.find(h => h.level === level)?.size ?? 1;

    const columns = [
      ...Array.from({ length: rowHeaderLevels }, (_, l) => levelSize(rowAxis.headers, l)),
      ...colAxis.leaves.map(c => colWidths[c.index] ?? 1),
    ];
    const outRows: RRow[] = [];
    const cellNode = (contents: Element | undefined, c: EvalContext, w: number, h: number): RNode | null => {
      const it = elements(contents).find(e => ITEMS.has(e.localName));
      return it ? this.item(it, c, { top: 0, left: 0, width: w, height: h }) : null;
    };
    const span = (contents: Element | undefined, tag: string) => Number(text(contents, tag) ?? 1) || 1;

    // column header rows (column hierarchy headers) with the Tablix corner on the left
    const cornerRows = elements(child(el, 'TablixCorner', 'TablixCornerRows'), 'TablixCornerRow');
    for (let level = 0; level < colHeaderLevels; level++) {
      const h = levelSize(colAxis.headers, level);
      const cells: RCell[] = [];
      if (level < cornerRows.length) {
        for (const cc of elements(cornerRows[level], 'TablixCornerCell')) {
          const contents = child(cc, 'CellContents');
          if (!contents) continue;
          const cs = span(contents, 'ColSpan'), rs = span(contents, 'RowSpan');
          cells.push({ colSpan: cs, rowSpan: rs, node: cellNode(contents, rctx, columns.slice(cells.length, cells.length + cs).reduce((a, b) => a + b, 0), h) });
        }
      } else if (rowHeaderLevels > 0 && level === 0) {
        cells.push({ colSpan: rowHeaderLevels, rowSpan: colHeaderLevels, node: null });
      }
      for (const hc of colAxis.headers.filter(x => x.level === level)) {
        const w = colAxis.leaves.slice(hc.start, hc.start + hc.span).reduce((a, c) => a + (colWidths[c.index] ?? 1), 0);
        cells.push({ colSpan: hc.span, rowSpan: 1, node: cellNode(hc.contents, hc.ctx, w, h) });
      }
      outRows.push({ key: this.key(), height: h, cells, breakBefore: false, resetPageNumber: false, repeat: true });
    }

    // body rows with row headers
    rowAxis.leaves.forEach((leaf, r) => {
      const rowEl = bodyRows[leaf.index];
      const height = parseSize(text(rowEl, 'Height'), 0.25);
      const cells: RCell[] = [];
      for (const hc of rowAxis.headers.filter(x => x.start === r)) {
        const h = rowAxis.leaves.slice(hc.start, hc.start + hc.span).reduce((a, l) => a + parseSize(text(bodyRows[l.index], 'Height'), 0.25), 0);
        cells.push({ colSpan: 1, rowSpan: hc.span, node: cellNode(hc.contents, hc.ctx, hc.size, h) });
      }
      const bodyCells = elements(child(rowEl, 'TablixCells'), 'TablixCell');
      for (let c = 0; c < colAxis.leaves.length;) {
        const col = colAxis.leaves[c];
        const contents = child(bodyCells[col.index], 'CellContents');
        const cs = Math.min(span(contents, 'ColSpan'), colAxis.leaves.length - c);
        const width = colAxis.leaves.slice(c, c + cs).reduce((a, x) => a + (colWidths[x.index] ?? 1), 0);
        // the cell's scope: rows of its row group instance that also belong to its column group instance
        const colRows = col.rows === rows ? null : new Set(col.rows);
        const cellRows = colRows ? leaf.rows.filter(x => colRows.has(x)) : leaf.rows;
        const cctx: EvalContext = colRows ? { ...leaf.ctx, scopeRows: cellRows, row: cellRows[0] ?? null } : leaf.ctx;
        cells.push({ colSpan: cs, rowSpan: 1, node: cellNode(contents, cctx, width, height) });
        c += cs;
      }
      outRows.push({ key: this.key(), height, cells, breakBefore: leaf.breakBefore, resetPageNumber: leaf.reset, repeat: leaf.repeat });
    });

    // no data: NoRowsMessage instead of the (empty) region
    const message = text(el, 'NoRowsMessage');
    if (!this.design && rows.length === 0 && message) {
      return { ...base, kind: 'table', css: this.styleCss(child(el, 'Style'), ctx, name), columns: [base.width || columns.reduce((a, b) => a + b, 0)],
        rows: [{ key: this.key(), height: 0.25, breakBefore: false, resetPageNumber: false, repeat: false,
          cells: [{ colSpan: 1, rowSpan: 1, node: { key: this.key(), name, kind: 'box', top: 0, left: 0, width: base.width, height: 0.25, hidden: false, seq: 0, css: {}, canGrow: true, vAlign: 'top',
            paragraphs: [{ css: {}, runs: [{ text: toStr(this.eval(message, rctx, name)), css: {} }] }] } }] }] };
    }
    return { ...base, kind: 'table', css: this.styleCss(child(el, 'Style'), ctx, name), columns, rows: outRows, seq: this.code?.version ?? 0 };
  }

  /**
   * Expands a Tablix hierarchy into leaf instances (one per output row/column) and header cells.
   * Static members are rendered once; group members once per group instance (details: once per row).
   */
  private expand(members: Element | undefined, rows: Row[], ctx: EvalContext, region: string, userSorts: UserSortSpec[] = []): { leaves: Leaf[]; headers: HeaderCell[] } {
    const leaves: Leaf[] = [];
    const headers: HeaderCell[] = [];
    let leafIndex = 0;
    // body index of each leaf member, in document order of the static hierarchy
    const indexOf = new Map<Element, number>();
    const assign = (ms: Element | undefined) => {
      for (const m of elements(ms, 'TablixMember')) {
        const kids = child(m, 'TablixMembers');
        if (kids && elements(kids, 'TablixMember').length) assign(kids);
        else indexOf.set(m, leafIndex++);
      }
    };
    assign(members);

    const walk = (ms: Element | undefined, scopeRows: Row[], c: EvalContext, level: number, inherited: { repeat: boolean; sorted?: boolean }) => {
      for (const m of elements(ms, 'TablixMember')) {
        const group = child(m, 'Group');
        const kids = child(m, 'TablixMembers');
        const headerEl = child(m, 'TablixHeader');
        const repeat = inherited.repeat || (text(m, 'RepeatOnNewPage') ?? '').toLowerCase() === 'true';
        let instances: { rows: Row[]; ctx: EvalContext }[];
        const gname = group?.getAttribute('Name') ?? '';
        if (!group) {
          instances = [{ rows: scopeRows, ctx: c }];
        } else if (this.design) {
          instances = [{ rows: [], ctx: { ...c, row: null, scopeRows: [] } }];
        } else {
          instances = this.groupInstances(m, group, scopeRows, c, gname, region);
          // interactive sort: the named scope, else the outermost groups of the data region
          const sorts = userSorts.filter(u => (u.scope ? u.scope === gname : !inherited.sorted));
          if (sorts.length) instances = this.sortInstances(instances, sorts.map(u => ({ value: u.expr, descending: u.descending })), `${gname || region} (interaktive Sortierung)`);
        }
        const sortedHere = inherited.sorted || (!!group && userSorts.some(u => !u.scope));
        const pb = child(group, 'PageBreak');
        const loc = (text(pb, 'BreakLocation') ?? '').toLowerCase();
        const reset = (text(pb, 'ResetPageNumber') ?? '').toLowerCase() === 'true';
        instances.forEach((inst, i) => {
          // a toggled member belongs to the instance around it (c): each document/group expands on its own
          if (this.visible(child(m, 'Visibility'), inst.ctx, c, `${gname || region} (Sichtbarkeit)`)) return;
          const start = leaves.length;
          const breakHere = !this.design && ((loc === 'between' && i > 0) || loc === 'start' || loc === 'startandend'
            || ((loc === 'end' || loc === 'startandend') && i > 0));
          if (kids && elements(kids, 'TablixMember').length) {
            walk(kids, inst.rows, inst.ctx, level + 1, { repeat: repeat && !group, sorted: sortedHere });
          } else {
            leaves.push({ index: indexOf.get(m) ?? 0, rows: inst.rows, ctx: inst.ctx, breakBefore: false, reset: false, repeat: repeat && !group });
          }
          if (leaves.length > start && breakHere) {
            leaves[start].breakBefore = true;
            leaves[start].reset = reset;
          }
          if (headerEl && leaves.length > start) {
            headers.push({ level, start, span: leaves.length - start, contents: child(headerEl, 'CellContents'), size: parseSize(text(headerEl, 'Size'), 1), ctx: inst.ctx });
          }
        });
      }
    };
    walk(members, rows, ctx, 0, { repeat: false, sorted: false });
    return { leaves, headers };
  }

  // ------------------------------------------------------------------------------------------------ Chart

  /**
   * Category groups × series (static members map to the ChartSeries in order, a series group repeats them per
   * instance) → one value per data point, evaluated on the rows both have in common.
   */
  private chart(el: Element, ctx: EvalContext, base: { key: string; name: string; top: number; left: number; width: number; height: number; hidden: boolean; seq: number; keepTogether: boolean }): RChart {
    const name = base.name;
    const seriesEls = elements(child(el, 'ChartData', 'ChartSeriesCollection'), 'ChartSeries');
    const title = child(el, 'ChartTitles', 'ChartTitle');
    const legendEl = child(el, 'ChartLegends', 'ChartLegend');
    const out: RChart = {
      ...base, kind: 'chart', css: this.styleCss(child(el, 'Style'), ctx, name), categories: [], series: [],
      title: title ? toStr(this.eval(text(title, 'Caption') ?? '', ctx, name)) || undefined : undefined,
      legend: !!legendEl && (text(legendEl, 'Hidden') ?? '').toLowerCase() !== 'true',
      palette: text(el, 'Palette') ?? 'Default', sample: this.design,
    };
    const axes = axesOf(el);
    const secondaryName = axes.secondary?.getAttribute('Name');
    const evalAxis = (a: Element | undefined): RChartAxis | undefined => {
      if (!a) return undefined;
      const spec = readAxis(a);
      const num = (v: string) => {
        if (v === '') return undefined;
        const n = Number(this.eval(v, ctx, `${name} (Achse)`));
        return Number.isFinite(n) ? n : undefined;
      };
      return {
        title: spec.title ? toStr(this.eval(spec.title, ctx, `${name} (Achsentitel)`)) || undefined : undefined,
        format: spec.format || undefined, min: num(spec.min), max: num(spec.max),
      };
    };
    out.categoryAxis = evalAxis(axes.category);
    out.valueAxis = evalAxis(axes.primary);
    if (secondaryName && seriesEls.some(x => text(x, 'ValueAxisName') === secondaryName)) out.secondaryAxis = evalAxis(axes.secondary);
    out.dataLabels = seriesEls.some(x => (text(x, 'ChartDataPoints', 'ChartDataPoint', 'ChartDataLabel', 'Visible') ?? '').toLowerCase() === 'true');
    const typeOf = (s: Element): Omit<RChartSeries, 'name' | 'values'> => {
      const t = (text(s, 'Type') ?? 'Column') as string;
      const sub = (text(s, 'Subtype') ?? '').toLowerCase();
      const type: ChartType = t === 'Shape' ? (sub === 'doughnut' ? 'Doughnut' : 'Pie') : (['Column', 'Bar', 'Line', 'Area', 'Scatter'].includes(t) ? t as ChartType : 'Column');
      return {
        type, stacked: sub.includes('stacked'),
        ...(sub === 'percentstacked' ? { percent: true } : {}), ...(sub === 'smooth' ? { smooth: true } : {}),
        ...(secondaryName && text(s, 'ValueAxisName') === secondaryName ? { secondary: true } : {}),
      };
    };
    if (this.design) {
      out.categories = ['A', 'B', 'C', 'D'];
      out.series = seriesEls.map((s, i) => ({ name: s.getAttribute('Name') ?? `Reihe ${i + 1}`, ...typeOf(s), values: [3, 5, 2, 4].map(v => v + i) }));
      return out;
    }
    const dsName = text(el, 'DataSetName') ?? '';
    let rows = ctx.regionRows ?? this.opts.data?.[dsName] ?? [];
    const rctx: EvalContext = { ...ctx, scopeRows: rows, row: rows[0] ?? null, scopes: { ...ctx.scopes, [name]: rows } };
    rows = this.filter(child(el, 'Filters'), rows, rs => ({ ...rctx, scopeRows: rs }), name);

    // leaf instances of a chart hierarchy (categories or series): label + rows
    const leaves = (members: Element | undefined, rs: Row[], c: EvalContext, path: string): { label: string; rows: Row[]; ctx: EvalContext; member: Element }[] => {
      const res: { label: string; rows: Row[]; ctx: EvalContext; member: Element }[] = [];
      for (const m of elements(members, 'ChartMember')) {
        const group = child(m, 'Group');
        const instances = group
          ? this.groupInstances(m, group, rs, c, group.getAttribute('Name') ?? '', name)
          : [{ rows: rs, ctx: c }];
        for (const inst of instances) {
          const label = toStr(this.eval(text(m, 'Label') ?? '', inst.ctx, `${name} (Beschriftung)`));
          const kids = child(m, 'ChartMembers');
          if (kids && elements(kids, 'ChartMember').length) res.push(...leaves(kids, inst.rows, inst.ctx, `${path}${label} `));
          else res.push({ label: `${path}${label}`.trim(), rows: inst.rows, ctx: inst.ctx, member: m });
        }
      }
      return res;
    };
    const base0 = { ...rctx, scopeRows: rows, row: rows[0] ?? null };
    const cats = leaves(child(el, 'ChartCategoryHierarchy', 'ChartMembers'), rows, base0, '');
    const series = leaves(child(el, 'ChartSeriesHierarchy', 'ChartMembers'), rows, base0, '');
    const categories = cats.length ? cats : [{ label: '', rows, ctx: base0, member: el }];
    out.categories = categories.map(c => c.label);
    // static series members correspond to the ChartSeries in order; a dynamic series repeats the (single) ChartSeries
    series.forEach((s, i) => {
      const seriesEl = seriesEls[Math.min(i, seriesEls.length - 1)] ?? seriesEls[0];
      if (!seriesEl) return;
      const y = text(seriesEl, 'ChartDataPoints', 'ChartDataPoint', 'ChartDataPointValues', 'Y') ?? '';
      const inSeries = new Set(s.rows);
      const values = categories.map(c => {
        const both = c.rows.filter(r => inSeries.has(r));
        if (!both.length) return null;
        const v = this.eval(y, { ...c.ctx, scopeRows: both, row: both[0], scopes: { ...c.ctx.scopes, ...s.ctx.scopes } }, `${name} (Datenpunkt)`);
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
      });
      out.series.push({ name: s.label || seriesEl.getAttribute('Name') || `Reihe ${i + 1}`, ...typeOf(seriesEl), values });
    });
    return out;
  }

  /**
   * A gauge panel: the first radial or linear gauge, its first scale (minimum, maximum, ranges) and the first pointer's
   * value, evaluated on the panel's dataset (or the enclosing scope). Null when there is no gauge in it.
   */
  private gauge(el: Element, ctx: EvalContext, base: Omit<RGauge, 'kind' | 'css' | 'shape' | 'value' | 'min' | 'max' | 'ranges' | 'sample'>): RGauge | null {
    const name = base.name;
    const radial = elements(child(el, 'RadialGauges'), 'RadialGauge')[0];
    const linear = elements(child(el, 'LinearGauges'), 'LinearGauge')[0];
    const gauge = radial ?? linear;
    if (!gauge) return null;
    const scale = elements(child(gauge, 'GaugeScales'))[0];
    const pointer = elements(child(scale, 'GaugePointers'))[0];
    const dsName = text(el, 'DataSetName') ?? '';
    const rows = ctx.regionRows ? ctx.scopeRows : this.opts.data?.[dsName] ?? [];
    const c: EvalContext = { ...ctx, scopeRows: rows, row: rows[0] ?? null };
    const num = (v: string | undefined, fallback: number) => {
      if (v === undefined || v === '') return fallback;
      const n = Number(this.eval(v, c, `${name} (Messgerät)`));
      return Number.isFinite(n) ? n : fallback;
    };
    const min = num(text(scale, 'MinimumValue', 'Value'), 0);
    const max = num(text(scale, 'MaximumValue', 'Value'), 100);
    const valueExpr = text(pointer, 'GaugeInputValue', 'Value');
    const value = this.design ? min + (max - min) * 0.6 : valueExpr === undefined ? null : num(valueExpr, NaN);
    return {
      ...base, kind: 'gauge', css: this.styleCss(child(el, 'Style'), ctx, name), shape: radial ? 'radial' : 'linear',
      value: value === null || Number.isNaN(value) ? null : value, min, max: max > min ? max : min + 1, sample: this.design,
      format: text(pointer, 'GaugeInputValue', 'Style', 'Format') ?? text(scale, 'Style', 'Format') ?? undefined,
      ranges: elements(child(scale, 'ScaleRanges'), 'ScaleRange')
        .filter(r => (text(r, 'Hidden') ?? '').toLowerCase() !== 'true')
        .map(r => ({
          start: num(text(r, 'StartValue', 'Value'), min), end: num(text(r, 'EndValue', 'Value'), max),
          color: this.styleValue(text(r, 'Style', 'BackgroundColor'), c, name) ?? '#c0c0c0',
        })),
    };
  }

  /** Interactive sorts the user activated on textboxes of this data region (not of nested ones). */
  private userSortsOf(region: Element): UserSortSpec[] {
    const active = this.opts.userSort;
    if (this.design || !active || !Object.keys(active).length) return [];
    const out: UserSortSpec[] = [];
    const visit = (e: Element) => {
      for (const c of elements(e)) {
        if (c.localName === 'Tablix') continue; // a nested data region sorts itself
        if (c.localName === 'Textbox') {
          const dir = active[c.getAttribute('Name') ?? ''];
          const us = child(c, 'UserSort');
          if (dir && us) out.push({ expr: text(us, 'SortExpression') ?? '', descending: dir === 'Descending', scope: text(us, 'SortExpressionScope') ?? undefined });
        }
        visit(c);
      }
    };
    visit(region);
    return out;
  }

  /** Instance id of a scope: its first row (rows are objects shared by all items of the instance). */
  private scopeId(ctx: EvalContext): string {
    const row = ctx.scopeRows?.[0];
    if (!row) return '';
    let id = this.rowIds.get(row);
    if (id === undefined) { id = `r${++this.counter}`; this.rowIds.set(row, id); }
    return id;
  }

  private toggleKey(source: string, scope: EvalContext) { return `${source}@${this.scopeId(scope)}`; }

  /**
   * Hidden state of <Visibility>: the Hidden expression, inverted when the user clicked its ToggleItem in the same
   * scope instance (`scope`). Returns true for hidden.
   */
  private visible(vis: Element | undefined, ctx: EvalContext, scope: EvalContext, where: string): boolean {
    const hidden = this.evalBool(child(vis, 'Hidden'), ctx, where);
    const source = text(vis, 'ToggleItem')?.trim();
    if (!source || this.design || !this.opts.toggled?.size) return hidden;
    return hidden !== this.opts.toggled.has(this.toggleKey(source, scope));
  }

  /** Group instances in order of first appearance (or sorted), filtered by the group's filters. */
  private groupInstances(member: Element, group: Element, rows: Row[], c: EvalContext, gname: string, region: string): { rows: Row[]; ctx: EvalContext }[] {
    const exprs = elements(child(group, 'GroupExpressions'), 'GroupExpression').map(e => e.textContent ?? '');
    let parts: Row[][];
    if (!exprs.length) {
      parts = rows.map(r => [r]); // details
    } else {
      const map = new Map<string, Row[]>();
      for (const r of rows) {
        const k = JSON.stringify(exprs.map(e => this.eval(e, { ...c, row: r }, `${gname} (Gruppierung)`)));
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(r);
      }
      parts = [...map.values()];
    }
    const ctxFor = (rs: Row[], prev: Row | null): EvalContext => ({ ...c, row: rs[0] ?? null, scopeRows: rs, previousRow: prev, scopes: { ...c.scopes, [gname]: rs } });
    let instances = parts.map((rs, i) => ({ rows: rs, ctx: ctxFor(rs, i > 0 ? parts[i - 1][0] : null) }));

    // group filters are evaluated per instance
    for (const f of elements(child(group, 'Filters'), 'Filter')) {
      const keep = new Set(this.applyFilter(f, instances.map(x => x.rows[0]), rs => instances.find(x => x.rows[0] === rs[0])?.ctx ?? c, gname));
      instances = instances.filter(x => keep.has(x.rows[0]));
    }
    const sorts = elements(child(member, 'SortExpressions'), 'SortExpression');
    if (sorts.length) {
      instances = this.sortInstances(instances, sorts.map(s => ({ value: text(s, 'Value') ?? '', descending: (text(s, 'Direction') ?? '') === 'Descending' })), `${gname || region} (Sortierung)`);
    }
    return instances;
  }

  private sortInstances(instances: { rows: Row[]; ctx: EvalContext }[], sorts: { value: string; descending: boolean }[], where: string) {
    const keyed = instances.map(x => ({ x, k: sorts.map(s => this.eval(s.value, x.ctx, where)) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < sorts.length; i++) {
        const d = cmpSafe(a.k[i], b.k[i]) * (sorts[i].descending ? -1 : 1);
        if (d) return d;
      }
      return 0;
    });
    const sorted = keyed.map(k => k.x);
    // Previous() follows the sorted order
    return sorted.map((x, i) => ({ ...x, ctx: { ...x.ctx, previousRow: i > 0 ? sorted[i - 1].rows[0] : null } }));
  }
}
