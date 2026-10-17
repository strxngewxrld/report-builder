// Parser for the parts of AL report objects that define what an RDLC layout can use:
// report / reportextension headers, dataset (dataitem/column, incl. IncludeCaption), labels and layouts
// (rendering section and the legacy RDLCLayout/WordLayout/ExcelLayout properties).
// Everything else (triggers, request pages, procedures) is skipped. Pure TypeScript – no VS Code API.

/** 0-based position, like vscode.Position. */
export interface AlPos { line: number; character: number }

export interface AlColumn { name: string; source: string; includeCaption: boolean; dataItem: string; pos: AlPos }
/** Offsets of a block's braces in the source, for edits. */
export interface AlSpan { open: number; close: number }
export interface AlDataItem {
  name: string; table: string; pos: AlPos; columns: AlColumn[]; children: AlDataItem[];
  /** Body braces, and where a new column goes (after the last column, before nested data items). */
  span?: AlSpan; columnInsert?: number;
}
export interface AlLabel {
  name: string; text: string; pos: AlPos;
  /** Translation note, maximum length and Locked (not translated), when given. */
  comment?: string; maxLength?: number; locked?: boolean;
}
export interface AlLayout { name: string; type: string; file: string; pos: AlPos }
/** Columns/data items a report extension adds to its base report. */
export interface AlAddition { target: string; columns: AlColumn[]; dataItems: AlDataItem[]; span?: AlSpan; columnInsert?: number }

export interface AlReport {
  kind: 'report' | 'reportextension';
  id: number | null;
  name: string;
  /** Base report of a report extension. */
  extends?: string;
  pos: AlPos;
  dataItems: AlDataItem[];
  additions: AlAddition[];
  labels: AlLabel[];
  layouts: AlLayout[];
  /** Braces of the object body and of the labels block (if any), for edits. */
  span?: AlSpan;
  labelsSpan?: AlSpan;
  datasetSpan?: AlSpan;
}

/** A table or table extension with its fields (to offer fields of a data item's table as new columns). */
export interface AlTable { kind: 'table' | 'tableextension'; id: number | null; name: string; extends?: string; fields: AlTableField[] }
export interface AlTableField { id: number | null; name: string; type: string }

type Tok = { t: 'id' | 'str' | 'qid' | 'num' | 'p'; v: string; start: number; end: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    const start = i;
    if (c === "'") {
      let v = '';
      i++;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { v += "'"; i += 2; continue; }
        if (src[i] === "'") break;
        v += src[i++];
      }
      i++;
      out.push({ t: 'str', v, start, end: i });
    } else if (c === '"') {
      const e = src.indexOf('"', i + 1);
      i = e < 0 ? src.length : e + 1;
      out.push({ t: 'qid', v: src.slice(start + 1, i - 1), start, end: i });
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /\w/.test(src[i])) i++;
      out.push({ t: 'id', v: src.slice(start, i), start, end: i });
    } else if (/\d/.test(c)) {
      while (i < src.length && /[\d.]/.test(src[i])) i++;
      out.push({ t: 'num', v: src.slice(start, i), start, end: i });
    } else {
      i++;
      out.push({ t: 'p', v: c, start, end: i });
    }
  }
  return out;
}

class AlParser {
  private toks: Tok[];
  private match = new Map<number, number>();
  private lineStarts: number[] = [0];

  constructor(private src: string) {
    this.toks = tokenize(src);
    for (let i = 0; i < src.length; i++) if (src[i] === '\n') this.lineStarts.push(i + 1);
    // matching brackets
    const stack: number[] = [];
    this.toks.forEach((t, i) => {
      if (t.t !== 'p') return;
      if (t.v === '(' || t.v === '{' || t.v === '[') stack.push(i);
      else if (t.v === ')' || t.v === '}' || t.v === ']') {
        const open = stack.pop();
        if (open !== undefined) { this.match.set(open, i); this.match.set(i, open); }
      }
    });
  }

  pos(offset: number): AlPos {
    let lo = 0, hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return { line: lo, character: offset - this.lineStarts[lo] };
  }

  private is(i: number, v: string) { const t = this.toks[i]; return !!t && (t.t === 'id' ? t.v.toLowerCase() === v.toLowerCase() : t.v === v); }
  private name(i: number) { const t = this.toks[i]; return t && (t.t === 'id' || t.t === 'qid' || t.t === 'num') ? t.v : ''; }

  /** Indexes of tokens at the top level of the block whose opening brace is at `open`. */
  private *top(open: number): Generator<number> {
    const close = this.match.get(open) ?? this.toks.length;
    for (let i = open + 1; i < close; i++) {
      yield i;
      const t = this.toks[i];
      if (t.t === 'p' && (t.v === '{' || t.v === '(' || t.v === '[')) i = this.match.get(i) ?? i;
    }
  }

  parse(): AlReport[] {
    const out: AlReport[] = [];
    for (let i = 0; i < this.toks.length; i++) {
      const kind = this.is(i, 'report') ? 'report' : this.is(i, 'reportextension') ? 'reportextension' : null;
      // object declarations start a line: "report 50100 Name" (ignore "Report::X", "Report.Run", variables)
      if (!kind || this.toks[i + 1]?.t !== 'num' || (i > 0 && this.toks[i - 1].v === ':')) continue;
      let j = i + 2;
      const name = this.name(j++);
      let ext: string | undefined;
      if (this.is(j, 'extends')) { ext = this.name(j + 1); j += 2; }
      while (j < this.toks.length && !this.is(j, '{')) j++;
      if (j >= this.toks.length) break;
      const report: AlReport = {
        kind, id: Number(this.toks[i + 1].v), name, extends: ext, pos: this.pos(this.toks[i].start), dataItems: [], additions: [], labels: [], layouts: [],
        span: this.span(j),
      };
      this.objectBody(j, report);
      out.push(report);
      i = this.match.get(j) ?? this.toks.length;
    }
    return out;
  }

  private objectBody(open: number, r: AlReport) {
    for (const i of this.top(open)) {
      const next = i + 1;
      if (this.is(i, 'dataset') && this.is(next, '{')) {
        r.datasetSpan = this.span(next);
        if (r.kind === 'report') r.dataItems = this.dataItems(next);
        else r.additions = this.additions(next);
      } else if (this.is(i, 'labels') && this.is(next, '{')) {
        r.labels = this.labels(next);
        r.labelsSpan = this.span(next);
      } else if (this.is(i, 'rendering') && this.is(next, '{')) {
        r.layouts.push(...this.rendering(next));
      } else if (/^(rdlclayout|wordlayout|excellayout)$/i.test(this.toks[i].v) && this.is(next, '=') && this.toks[i + 2]?.t === 'str') {
        const type = this.toks[i].v.toLowerCase().replace('layout', '');
        r.layouts.push({ name: this.toks[i].v, type: type === 'rdlc' ? 'RDLC' : type === 'word' ? 'Word' : 'Excel', file: this.toks[i + 2].v, pos: this.pos(this.toks[i + 2].start) });
      }
    }
  }

  /** dataitem(...) and column(...) entries directly inside a block. */
  private dataItems(open: number): AlDataItem[] {
    const items: AlDataItem[] = [];
    for (const i of this.top(open)) {
      if (this.is(i, 'dataitem') && this.is(i + 1, '(')) items.push(this.dataItem(i));
    }
    return items;
  }

  private dataItem(i: number): AlDataItem {
    const argsOpen = i + 1;
    const argsClose = this.match.get(argsOpen) ?? argsOpen;
    const name = this.name(argsOpen + 1);
    const table = this.toks.slice(argsOpen + 3, argsClose).map(t => t.v).join('');
    const item: AlDataItem = { name, table, pos: this.pos(this.toks[argsOpen + 1]?.start ?? 0), columns: [], children: [] };
    const body = argsClose + 1;
    if (this.is(body, '{')) {
      item.span = this.span(body);
      let lastColumnEnd: number | undefined, firstChild: number | undefined, lastProperty: number | undefined;
      for (const j of this.top(body)) {
        if (this.is(j, 'column') && this.is(j + 1, '(')) {
          item.columns.push(this.column(j, name));
          const close = this.match.get(j + 1) ?? j + 1;
          lastColumnEnd = this.toks[this.is(close + 1, '{') ? this.match.get(close + 1) ?? close : close].end;
        } else if (this.is(j, 'dataitem') && this.is(j + 1, '(')) {
          firstChild ??= this.toks[j].start;
          item.children.push(this.dataItem(j));
        } else if (this.toks[j].v === ';' && firstChild === undefined) lastProperty = this.toks[j].end;
      }
      // after the last column; else after the properties (DataItemLink = …;), before nested data items
      item.columnInsert = lastColumnEnd ?? lastProperty ?? this.toks[body].end;
    }
    return item;
  }

  private column(i: number, dataItem: string): AlColumn {
    const open = i + 1;
    const close = this.match.get(open) ?? open;
    const nameTok = this.toks[open + 1];
    const semi = this.toks.findIndex((t, k) => k > open && k < close && t.v === ';');
    const source = semi > 0 ? this.src.slice(this.toks[semi + 1]?.start ?? 0, this.toks[close].start).trim() : '';
    let includeCaption = false;
    if (this.is(close + 1, '{')) {
      for (const j of this.top(close + 1)) {
        if (this.is(j, 'IncludeCaption') && this.is(j + 1, '=') && this.is(j + 2, 'true')) includeCaption = true;
      }
    }
    return { name: this.name(open + 1), source, includeCaption, dataItem, pos: this.pos(nameTok?.start ?? 0) };
  }

  /** reportextension: add(X) { columns }, addfirst/addlast/addbefore/addafter(X) { dataitems / columns }. */
  private additions(open: number): AlAddition[] {
    const out: AlAddition[] = [];
    for (const i of this.top(open)) {
      if (!/^add(first|last|before|after)?$/i.test(this.toks[i].v) || !this.is(i + 1, '(')) continue;
      const close = this.match.get(i + 1) ?? i + 1;
      const target = this.name(i + 2);
      const add: AlAddition = { target, columns: [], dataItems: [] };
      if (this.is(close + 1, '{')) {
        add.span = this.span(close + 1);
        add.columnInsert = this.toks[close + 1].end;
        for (const j of this.top(close + 1)) {
          if (this.is(j, 'column') && this.is(j + 1, '(')) {
            add.columns.push(this.column(j, target));
            const c = this.match.get(j + 1) ?? j + 1;
            add.columnInsert = this.toks[this.is(c + 1, '{') ? this.match.get(c + 1) ?? c : c].end;
          } else if (this.is(j, 'dataitem') && this.is(j + 1, '(')) add.dataItems.push(this.dataItem(j));
        }
      }
      out.push(add);
    }
    return out;
  }

  private span(open: number): AlSpan {
    return { open: this.toks[open].start, close: this.toks[this.match.get(open) ?? open].start };
  }

  /** table / tableextension objects with their fields. */
  tables(): AlTable[] {
    const out: AlTable[] = [];
    for (let i = 0; i < this.toks.length; i++) {
      const kind = this.is(i, 'table') ? 'table' : this.is(i, 'tableextension') ? 'tableextension' : null;
      if (!kind || this.toks[i + 1]?.t !== 'num' || (i > 0 && this.toks[i - 1].v === ':')) continue;
      let j = i + 2;
      const table: AlTable = { kind, id: Number(this.toks[i + 1].v), name: this.name(j++), fields: [] };
      if (this.is(j, 'extends')) { table.extends = this.name(j + 1); j += 2; }
      while (j < this.toks.length && !this.is(j, '{')) j++;
      if (j >= this.toks.length) break;
      for (const k of this.top(j)) {
        if (!this.is(k, 'fields') || !this.is(k + 1, '{')) continue;
        for (const f of this.top(k + 1)) {
          if (!this.is(f, 'field') || !this.is(f + 1, '(')) continue;
          const close = this.match.get(f + 1) ?? f + 1;
          const semis = this.toks.slice(f + 2, close).map((t, n) => (t.v === ';' ? f + 2 + n : -1)).filter(n => n >= 0);
          if (semis.length < 2) continue;
          table.fields.push({
            id: this.toks[f + 2].t === 'num' ? Number(this.toks[f + 2].v) : null,
            name: this.name(semis[0] + 1),
            type: this.src.slice(this.toks[semis[1] + 1]?.start ?? 0, this.toks[close].start).trim(),
          });
        }
      }
      out.push(table);
      i = this.match.get(j) ?? this.toks.length;
    }
    return out;
  }

  private labels(open: number): AlLabel[] {
    const out: AlLabel[] = [];
    for (const i of this.top(open)) {
      const t = this.toks[i];
      if ((t.t === 'id' || t.t === 'qid') && this.is(i + 1, '=') && this.toks[i + 2]?.t === 'str' && (i === open + 1 || this.toks[i - 1].v === ';')) {
        const label: AlLabel = { name: t.v, text: this.toks[i + 2].v, pos: this.pos(t.start) };
        // options: , Comment = '…', MaxLength = 30, Locked = true
        for (let j = i + 3; this.is(j, ',') && this.is(j + 2, '='); j += 4) {
          const key = this.toks[j + 1].v.toLowerCase(), v = this.toks[j + 3];
          if (key === 'comment' && v?.t === 'str') label.comment = v.v;
          if (key === 'maxlength' && v?.t === 'num') label.maxLength = Number(v.v);
          if (key === 'locked') label.locked = /^true$/i.test(v?.v ?? '');
        }
        out.push(label);
      }
    }
    return out;
  }

  private rendering(open: number): AlLayout[] {
    const out: AlLayout[] = [];
    for (const i of this.top(open)) {
      if (!this.is(i, 'layout') || !this.is(i + 1, '(')) continue;
      const close = this.match.get(i + 1) ?? i + 1;
      const layout: AlLayout = { name: this.name(i + 2), type: '', file: '', pos: this.pos(this.toks[i].start) };
      if (this.is(close + 1, '{')) {
        for (const j of this.top(close + 1)) {
          if (this.is(j, 'Type') && this.is(j + 1, '=')) layout.type = this.toks[j + 2]?.v ?? '';
          if (this.is(j, 'LayoutFile') && this.is(j + 1, '=') && this.toks[j + 2]?.t === 'str') {
            layout.file = this.toks[j + 2].v;
            layout.pos = this.pos(this.toks[j + 2].start);
          }
        }
      }
      out.push(layout);
    }
    return out;
  }
}

export function parseAl(source: string): AlReport[] {
  return new AlParser(source).parse();
}

export function parseAlTables(source: string): AlTable[] {
  return new AlParser(source).tables();
}

/** All columns of a data item tree, depth first. */
export function allColumns(items: AlDataItem[]): AlColumn[] {
  return items.flatMap(d => [...d.columns, ...allColumns(d.children)]);
}

/** Columns a report or report extension declares itself (an extension: in its add(…) blocks and new data items). */
export const declaredColumns = (r: AlReport): AlColumn[] =>
  [...allColumns(r.dataItems), ...r.additions.flatMap(a => [...a.columns, ...allColumns(a.dataItems)])];

/**
 * What the AL compiler generates into the RDLC: a field per column (decimal columns additionally get "<Name>Format",
 * which is accepted but not required since the column types are unknown here) and a parameter per label and per
 * column with IncludeCaption ("<Name>Caption").
 */
export function expectedDataset(report: AlReport, base?: AlReport) {
  const items = [...(base?.dataItems ?? []), ...report.dataItems];
  const columns = [...allColumns(items), ...report.additions.flatMap(a => [...a.columns, ...allColumns(a.dataItems)])];
  const labels = [...(base?.labels ?? []), ...report.labels];
  return {
    columns,
    fields: columns.map(c => c.name),
    parameters: [...labels.map(l => l.name), ...columns.filter(c => c.includeCaption).map(c => `${c.name}Caption`)],
    labels,
    /** A report extension whose base report is not in the workspace only knows its own additions. */
    complete: report.kind === 'report' || !!base,
  };
}
