// Evaluator for the subset of SSRS (Visual Basic) expressions commonly used in reports.
// Values starting with "=" are expressions; everything else is literal text.

import { l10n } from './l10n';

export type Row = Record<string, unknown>;

export interface EvalContext {
  /** Current row for Fields!X.Value (null outside a data region). */
  row: Row | null;
  /** Rows of the current scope – what aggregates like Sum() run over when no scope is given. */
  scopeRows: Row[];
  /** All dataset rows by name, for aggregates with an explicit scope: Sum(Fields!X.Value, "DataSet1"). */
  dataSets: Record<string, Row[]>;
  parameters: Record<string, unknown>;
  globals: { ExecutionTime: Date; PageNumber: number; TotalPages: number; ReportName: string; [k: string]: unknown };
  locale?: string;
  /** Named scopes (data regions, groups) for aggregates like Sum(x, "Group1"); datasets are looked up as well. */
  scopes?: Record<string, Row[]>;
  /** All rows of the enclosing data region, for RowNumber(Nothing). */
  regionRows?: Row[];
  /** Row before the current one in its scope, for Previous(). */
  previousRow?: Row | null;
  /** Values of report items by name; [0] is used for ReportItems!X.Value, the list for First()/Last() in page sections. */
  reportItems?: (name: string) => unknown[] | undefined;
  /** The report's <Code> block (Code.Function(...)). */
  code?: { call(name: string, args: unknown[], ctx: EvalContext): unknown };
  /** Variables (used by the Code interpreter for parameters, locals and Shared fields). */
  lookup?: (name: string) => { value: unknown } | undefined;
  /** Functions defined in the Code block, callable without "Code." from within it. */
  callUser?: (name: string, args: unknown[]) => { value: unknown } | undefined;
}

/** Objects behind the identifiers "Code" and "Convert" (their members are calls). */
const CODE = Symbol('Code');
const CONVERT = Symbol('Convert');
/** .NET namespaces used in expressions: System.String.IsNullOrEmpty(…), Math.Round(…). */
const SYSTEM = Symbol('System');
const STRING_NS = Symbol('String');
const MATH_NS = Symbol('Math');
const ARRAY_NS = Symbol('Array');

/** The array of dimension `d` (1-based, as UBound's second argument): the first element's sub-array for d > 1. */
function arrayDim(a: unknown, d: unknown): unknown[] {
  let cur = a;
  for (let i = 1; i < (isNothing(d) ? 1 : toNum(d)); i++) cur = Array.isArray(cur) ? cur[0] : undefined;
  if (!Array.isArray(cur)) throw new Error(l10n.t('Not an array'));
  return cur;
}

/** a(i) / a(i, j) on an array variable; multi-dimensional arrays are nested. */
export function indexArray(a: unknown[], idx: unknown[]): unknown {
  let cur: unknown = a;
  for (const i of idx) {
    const n = toNum(i);
    if (!Array.isArray(cur) || n < 0 || n >= cur.length || !Number.isInteger(n)) throw new Error(l10n.t('Index {0} is outside the bounds of the array', n));
    cur = cur[n];
  }
  return cur ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Tokenizer

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'date'; v: Date }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c) || c === '_' && /\s/.test(src[i + 1] ?? '')) { i++; continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      // VB type suffixes like 1.5D or 10R
      if (/[DRFISL@!#%]/.test(src[i] ?? '') && !/\w/.test(src[i + 1] ?? '')) i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') { s += '"'; i += 2; continue; }
          break;
        }
        s += src[i++];
      }
      if (src[i] !== '"') throw new Error(l10n.t('Unclosed string'));
      i++;
      out.push({ t: 'str', v: s });
    } else if (c === '#') {
      const end = src.indexOf('#', i + 1);
      if (end < 0) throw new Error(l10n.t('Unclosed date literal'));
      out.push({ t: 'date', v: new Date(src.slice(i + 1, end)) });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (['<>', '<=', '>='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; }
      else if ('=<>&+-*/\\^(),.!{}'.includes(c)) { out.push({ t: 'op', v: c }); i++; }
      else throw new Error(l10n.t("Unexpected character '{0}'", c));
    }
  }
  out.push({ t: 'eof' });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Parser → AST

export type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'coll'; coll: string; name: string; prop: string }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'member'; obj: Node; name: string; args: Node[] }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'un'; op: string; a: Node }
  | { k: 'id'; name: string };

const kw = (tok: Tok, word: string) => tok.t === 'id' && tok.v.toLowerCase() === word.toLowerCase();

class ExprParser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek() { return this.toks[this.i]; }
  private next() { return this.toks[this.i++]; }
  private isOp(v: string) { const t = this.peek(); return t.t === 'op' && t.v === v; }
  private expectOp(v: string) {
    if (!this.isOp(v)) throw new Error(l10n.t("'{0}' expected", v));
    this.i++;
  }

  parse(): Node {
    const n = this.or();
    if (this.peek().t !== 'eof') throw new Error(l10n.t('Unexpected end of the expression'));
    return n;
  }

  private binLoop(sub: () => Node, ops: string[], words: string[] = []): Node {
    let a = sub();
    for (;;) {
      const t = this.peek();
      const op = t.t === 'op' && ops.includes(t.v) ? t.v
        : words.find(w => kw(t, w))?.toLowerCase();
      if (!op) return a;
      this.i++;
      a = { k: 'bin', op, a, b: sub() };
    }
  }

  private or = (): Node => this.binLoop(this.and, [], ['Or', 'OrElse', 'Xor']);
  private and = (): Node => this.binLoop(this.not, [], ['And', 'AndAlso']);
  private not = (): Node => {
    if (kw(this.peek(), 'Not')) { this.i++; return { k: 'un', op: 'not', a: this.not() }; }
    return this.cmp();
  };
  private cmp = (): Node => this.binLoop(this.concat, ['=', '<>', '<', '>', '<=', '>='], ['Like', 'Is']);
  private concat = (): Node => this.binLoop(this.add, ['&']);
  private add = (): Node => this.binLoop(this.mod, ['+', '-']);
  private mod = (): Node => this.binLoop(this.intdiv, [], ['Mod']);
  private intdiv = (): Node => this.binLoop(this.mul, ['\\']);
  private mul = (): Node => this.binLoop(this.unary, ['*', '/']);
  private unary = (): Node => {
    if (this.isOp('-')) { this.i++; return { k: 'un', op: '-', a: this.unary() }; }
    if (this.isOp('+')) { this.i++; return this.unary(); }
    return this.pow();
  };
  private pow = (): Node => {
    const a = this.postfix();
    if (this.isOp('^')) { this.i++; return { k: 'bin', op: '^', a, b: this.unary() }; }
    return a;
  };

  private args(): Node[] {
    const args: Node[] = [];
    this.expectOp('(');
    if (!this.isOp(')')) {
      do { args.push(this.or()); } while (this.isOp(',') && this.next());
    }
    this.expectOp(')');
    return args;
  }

  private ident(): string {
    const t = this.next();
    if (t.t !== 'id') throw new Error(l10n.t('Identifier expected'));
    return t.v;
  }

  private postfix(): Node {
    let n = this.primary();
    while (this.isOp('.')) {
      this.i++;
      const name = this.ident();
      n = { k: 'member', obj: n, name, args: this.isOp('(') ? this.args() : [] };
    }
    return n;
  }

  private primary(): Node {
    const t = this.next();
    switch (t.t) {
      case 'num': case 'str': case 'date': return { k: 'lit', v: t.v };
      case 'op':
        if (t.v === '(') { const n = this.or(); this.expectOp(')'); return n; }
        if (t.v === '{') {
          // array literal {1, 2, 3} (Code block: Dim a() As Integer = {1, 2, 3})
          const items: Node[] = [];
          if (!this.isOp('}')) {
            do { items.push(this.or()); } while (this.isOp(',') && this.next());
          }
          this.expectOp('}');
          return { k: 'call', name: '__array', args: items };
        }
        throw new Error(l10n.t("Unexpected '{0}'", t.v));
      case 'eof': throw new Error(l10n.t('Incomplete expression'));
      case 'id': {
        const lower = t.v.toLowerCase();
        if (lower === 'true') return { k: 'lit', v: true };
        if (lower === 'false') return { k: 'lit', v: false };
        if (lower === 'nothing') return { k: 'lit', v: null };
        if (this.isOp('!')) {
          // Fields!Name.Value, Parameters!Name.Label, Globals!PageNumber, User!UserID, ReportItems!Tb.Value
          this.i++;
          const name = this.ident();
          let prop = '';
          if (this.isOp('.') && this.toks[this.i + 1]?.t === 'id' && ['value', 'label', 'isnothing', 'count']
            .includes((this.toks[this.i + 1] as { v: string }).v.toLowerCase())) {
            this.i++;
            prop = this.ident();
          }
          return { k: 'coll', coll: lower, name, prop: prop.toLowerCase() };
        }
        if (this.isOp('(')) return { k: 'call', name: lower, args: this.args() };
        return { k: 'id', name: lower };
      }
    }
  }
}

const cache = new Map<string, Node>();
export function parseExpression(src: string): Node {
  let n = cache.get(src);
  if (!n) {
    n = new ExprParser(tokenize(src)).parse();
    if (cache.size > 2000) cache.clear();
    cache.set(src, n);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation

export const isNothing = (v: unknown) => v === null || v === undefined;
export const toNum = (v: unknown): number => {
  if (isNothing(v) || v === '') return 0;
  if (typeof v === 'boolean') return v ? -1 : 0; // VB semantics
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(l10n.t("'{0}' is not a number", String(v)));
  return n;
};
export const toStr = (v: unknown): string => {
  if (isNothing(v)) return '';
  if (v instanceof Date) return v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
};
export const toBool = (v: unknown): boolean => (typeof v === 'string' ? v.toLowerCase() === 'true' || (v !== '' && Number(v) !== 0 && !Number.isNaN(Number(v))) : !!v && v !== 0);
const toDate = (v: unknown): Date | null => {
  if (isNothing(v) || v === '') return null;
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function compare(a: unknown, b: unknown): number {
  if (isNothing(a) && isNothing(b)) return 0;
  if (typeof a === 'number' || typeof b === 'number' || a instanceof Date || b instanceof Date) {
    return toNum(a) - toNum(b);
  }
  return toStr(a) < toStr(b) ? -1 : toStr(a) > toStr(b) ? 1 : 0;
}

const AGGREGATES = new Set(['sum', 'avg', 'count', 'countdistinct', 'min', 'max', 'first', 'last', 'countrows', 'stdev', 'var', 'runningvalue']);

function aggregate(name: string, args: Node[], ctx: EvalContext): unknown {
  if (name === 'runningvalue') {
    // RunningValue(expr, Sum, "Scope"): the aggregate over the scope's rows up to the current row
    const fn = args[1]?.k === 'id' ? args[1].name : args[1]?.k === 'call' ? args[1].name : '';
    if (!AGGREGATES.has(fn) || fn === 'runningvalue') throw new Error(l10n.t('RunningValue() expects an aggregate function as its second argument'));
    const scope = args[2] ? toStr(evalNode(args[2], ctx)) : null;
    const all = scope ? ctx.scopes?.[scope] ?? ctx.dataSets[scope] ?? ctx.regionRows ?? ctx.scopeRows : ctx.regionRows ?? ctx.scopeRows;
    const upto = ctx.row && all.includes(ctx.row) ? all.slice(0, all.indexOf(ctx.row) + 1) : all;
    return aggregate(fn, [args[0]], { ...ctx, scopeRows: upto });
  }
  let rows = ctx.scopeRows;
  const scopeArg = name === 'countrows' ? args[0] : args[1];
  if (scopeArg) {
    const scope = toStr(evalNode(scopeArg, ctx));
    rows = ctx.scopes?.[scope] ?? ctx.dataSets[scope] ?? (() => { throw new Error(l10n.t('Unknown scope "{0}"', scope)); })();
  }
  if (name === 'countrows') return rows.length;
  if (!args[0]) throw new Error(l10n.t('{0}() expects an argument', name));
  // First(ReportItems!X.Value) / Last(...) in page sections refer to the instances on the current page
  const arg = args[0];
  if ((name === 'first' || name === 'last') && arg.k === 'coll' && arg.coll === 'reportitems') {
    const list = ctx.reportItems?.(arg.name) ?? [];
    return (name === 'first' ? list[0] : list[list.length - 1]) ?? null;
  }
  const values = rows.map(row => evalNode(args[0], { ...ctx, row, scopeRows: rows }));
  const present = values.filter(v => !isNothing(v));
  const nums = () => present.map(toNum);
  switch (name) {
    // no rows at all (e.g. an empty matrix intersection): Nothing, shown as an empty cell like on the report server
    case 'sum': return rows.length ? nums().reduce((a, b) => a + b, 0) : null;
    case 'avg': return present.length ? nums().reduce((a, b) => a + b, 0) / present.length : null;
    case 'count': return present.length;
    case 'countdistinct': return new Set(present.map(toStr)).size;
    case 'min': return present.length ? present.reduce((a, b) => (compare(a, b) <= 0 ? a : b)) : null;
    case 'max': return present.length ? present.reduce((a, b) => (compare(a, b) >= 0 ? a : b)) : null;
    case 'first': return values[0] ?? null;
    case 'last': return values[values.length - 1] ?? null;
    case 'var': case 'stdev': {
      const n = nums();
      if (n.length < 2) return null;
      const mean = n.reduce((a, b) => a + b, 0) / n.length;
      const v = n.reduce((a, b) => a + (b - mean) ** 2, 0) / (n.length - 1);
      return name === 'var' ? v : Math.sqrt(v);
    }
  }
  return null;
}

type Fn = (args: unknown[], ctx: EvalContext) => unknown;
const FUNCTIONS: Record<string, Fn> = {
  format: ([v, f], ctx) => formatValue(v, toStr(f), ctx.locale),
  formatnumber: ([v, d], ctx) => formatValue(v, `N${isNothing(d) ? 2 : toNum(d)}`, ctx.locale),
  formatcurrency: ([v, d], ctx) => formatValue(v, `C${isNothing(d) ? 2 : toNum(d)}`, ctx.locale),
  formatpercent: ([v, d], ctx) => formatValue(v, `P${isNothing(d) ? 0 : toNum(d)}`, ctx.locale),
  formatdatetime: ([v, f], ctx) => formatValue(v, ['G', 'D', 'd', 'T', 't'][toNum(f ?? 0)] ?? 'G', ctx.locale),
  ucase: ([v]) => toStr(v).toUpperCase(),
  lcase: ([v]) => toStr(v).toLowerCase(),
  trim: ([v]) => toStr(v).trim(),
  ltrim: ([v]) => toStr(v).trimStart(),
  rtrim: ([v]) => toStr(v).trimEnd(),
  len: ([v]) => toStr(v).length,
  left: ([v, n]) => toStr(v).slice(0, toNum(n)),
  right: ([v, n]) => (toNum(n) ? toStr(v).slice(-toNum(n)) : ''),
  mid: ([v, s, n]) => toStr(v).substr(toNum(s) - 1, isNothing(n) ? undefined : toNum(n)),
  instr: ([a, b]) => toStr(a).indexOf(toStr(b)) + 1,
  replace: ([v, a, b]) => toStr(v).split(toStr(a)).join(toStr(b)),
  cstr: ([v]) => toStr(v),
  cint: ([v]) => Math.round(toNum(v)),
  clng: ([v]) => Math.round(toNum(v)),
  cdbl: ([v]) => toNum(v),
  cdec: ([v]) => toNum(v),
  csng: ([v]) => toNum(v),
  cbool: ([v]) => toBool(v),
  cdate: ([v]) => toDate(v),
  int: ([v]) => Math.floor(toNum(v)),
  fix: ([v]) => Math.trunc(toNum(v)),
  abs: ([v]) => Math.abs(toNum(v)),
  round: ([v, d]) => { const f = 10 ** toNum(d ?? 0); return Math.round(toNum(v) * f) / f; },
  isnothing: ([v]) => isNothing(v),
  isnumeric: ([v]) => !isNothing(v) && v !== '' && !Number.isNaN(Number(v)),
  isdate: ([v]) => toDate(v) !== null,
  now: () => new Date(),
  today: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; },
  year: ([v]) => toDate(v)?.getFullYear() ?? null,
  month: ([v]) => (toDate(v)?.getMonth() ?? -2) + 1 || null,
  day: ([v]) => toDate(v)?.getDate() ?? null,
  hour: ([v]) => toDate(v)?.getHours() ?? null,
  minute: ([v]) => toDate(v)?.getMinutes() ?? null,
  weekday: ([v]) => (toDate(v)?.getDay() ?? -2) + 1 || null,
  monthname: ([m, abbr], ctx) => new Date(2000, toNum(m) - 1, 1).toLocaleString(ctx.locale, { month: toBool(abbr) ? 'short' : 'long' }),
  dateadd: ([unit, n, d]) => {
    const date = new Date(toDate(d)!.getTime());
    const k = toNum(n);
    const u = toStr(unit).toLowerCase();
    if (u === 'yyyy' || u === 'year') date.setFullYear(date.getFullYear() + k);
    else if (u === 'm' || u === 'month') date.setMonth(date.getMonth() + k);
    else if (u === 'ww' || u === 'weekofyear') date.setDate(date.getDate() + 7 * k);
    else if (u === 'h' || u === 'hour') date.setHours(date.getHours() + k);
    else date.setDate(date.getDate() + k);
    return date;
  },
  datediff: ([unit, a, b]) => {
    const da = toDate(a)!, db = toDate(b)!;
    const u = toStr(unit).toLowerCase();
    if (u === 'yyyy' || u === 'year') return db.getFullYear() - da.getFullYear();
    if (u === 'm' || u === 'month') return (db.getFullYear() - da.getFullYear()) * 12 + db.getMonth() - da.getMonth();
    return Math.floor((db.getTime() - da.getTime()) / 86400000);
  },
  // Choose(n, Split(...)) passes an array as the ParamArray, as VB does
  choose: ([i, ...opts]) => (opts.length === 1 && Array.isArray(opts[0]) ? opts[0] : opts)[toNum(i) - 1] ?? null,
  rownumber: (_args, ctx) => (ctx.row ? (ctx.regionRows ?? ctx.scopeRows).indexOf(ctx.row) + 1 : 0),
  chr: ([c]) => String.fromCharCode(toNum(c)),
  chrw: ([c]) => String.fromCharCode(toNum(c)),
  asc: ([s]) => toStr(s).charCodeAt(0) || 0,
  split: ([s, sep]) => toStr(s).split(isNothing(sep) ? ' ' : toStr(sep)),
  join: ([a, sep]) => (Array.isArray(a) ? a.map(toStr).join(isNothing(sep) ? ' ' : toStr(sep)) : toStr(a)),
  val: ([s]) => parseFloat(toStr(s)) || 0,
  space: ([n]) => ' '.repeat(Math.max(0, toNum(n))),
  sign: ([v]) => Math.sign(toNum(v)),
  instrrev: ([a, b]) => toStr(a).lastIndexOf(toStr(b)) + 1,
  strreverse: ([s]) => [...toStr(s)].reverse().join(''),
  cobj: ([v]) => v,
  __array: args => args,
  ubound: ([a, d]) => arrayDim(a, d).length - 1,
  lbound: () => 0,
  isarray: ([a]) => Array.isArray(a),
  __codeerror: ([msg]) => { throw new Error(toStr(msg)); },
};

function callMember(obj: unknown, name: string, args: unknown[], ctx: EvalContext): unknown {
  if (obj === CODE) {
    if (!ctx.code) throw new Error(l10n.t('Code.{0}: the report has no code block', name));
    return ctx.code.call(name, args, ctx);
  }
  if (obj === CONVERT) {
    switch (name.toLowerCase()) {
      // pictures arrive as base64 text in Business Central datasets
      case 'tobase64string': case 'frombase64string': case 'tostring': return isNothing(args[0]) ? '' : toStr(args[0]);
      case 'toint32': case 'toint64': case 'toint16': return Math.round(toNum(args[0]));
      case 'todecimal': case 'todouble': case 'tosingle': return toNum(args[0]);
      case 'toboolean': return toBool(args[0]);
      case 'todatetime': return toDate(args[0]);
    }
    throw new Error(l10n.t('{0} is not supported', `Convert.${name}`));
  }
  const lname = name.toLowerCase();
  if (obj === SYSTEM) {
    if (lname === 'string') return STRING_NS;
    if (lname === 'math') return MATH_NS;
    if (lname === 'convert') return CONVERT;
    if (lname === 'array') return ARRAY_NS;
    throw new Error(l10n.t('{0} is not supported', `System.${name}`));
  }
  if (obj === STRING_NS) {
    switch (lname) {
      case 'isnullorempty': return isNothing(args[0]) || toStr(args[0]) === '';
      case 'isnullorwhitespace': return isNothing(args[0]) || toStr(args[0]).trim() === '';
      case 'empty': return '';
      case 'concat': return args.map(toStr).join('');
      case 'join': return (Array.isArray(args[1]) ? args[1] : args.slice(1)).map(toStr).join(toStr(args[0]));
      case 'format': return toStr(args[0]).replace(/\{(\d+)(?::([^}]*))?\}/g, (_m, i: string, f?: string) => formatValue(args[Number(i) + 1], f ?? '', ctx.locale));
    }
    throw new Error(l10n.t('{0} is not supported', `String.${name}`));
  }
  if (obj === MATH_NS) {
    const [a, b] = args.map(x => (isNothing(x) ? 0 : toNum(x)));
    switch (lname) {
      case 'round': { const f = 10 ** (b ?? 0); return Math.round(a * f) / f; }
      case 'abs': return Math.abs(a);
      case 'floor': return Math.floor(a);
      case 'ceiling': return Math.ceil(a);
      case 'truncate': return Math.trunc(a);
      case 'max': return Math.max(a, b);
      case 'min': return Math.min(a, b);
      case 'pow': return a ** b;
      case 'sqrt': return Math.sqrt(a);
    }
    throw new Error(l10n.t('{0} is not supported', `Math.${name}`));
  }
  if (Array.isArray(obj)) {
    switch (lname) {
      case 'length': case 'count': return obj.length;
      case 'getupperbound': return arrayDim(obj, toNum(args[0] ?? 0) + 1).length - 1;
      case 'getlength': return arrayDim(obj, toNum(args[0] ?? 0) + 1).length;
      case 'getlowerbound': return 0;
      case 'contains': return obj.some(x => compare(x, args[0]) === 0);
    }
  }
  if (obj === ARRAY_NS) {
    const [a, v] = args;
    if (!Array.isArray(a)) throw new Error(l10n.t('Array.{0} expects an array', name));
    switch (lname) {
      case 'indexof': return a.findIndex(x => compare(x, v) === 0);
      case 'sort': a.sort(compare); return null;
      case 'reverse': a.reverse(); return null;
      case 'clear': a.fill(null); return null;
    }
    throw new Error(l10n.t('{0} is not supported', `Array.${name}`));
  }
  if (obj && typeof obj === 'object' && !(obj instanceof Date) && !args.length) {
    const key = Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase());
    if (key) return (obj as Record<string, unknown>)[key];
  }
  switch (name.toLowerCase()) {
    case 'tostring': return args.length ? formatValue(obj, toStr(args[0]), ctx.locale) : toStr(obj);
    case 'toupper': return toStr(obj).toUpperCase();
    case 'tolower': return toStr(obj).toLowerCase();
    case 'trim': return toStr(obj).trim();
    case 'length': return toStr(obj).length;
    case 'substring': return toStr(obj).substr(toNum(args[0]), isNothing(args[1]) ? undefined : toNum(args[1]));
    case 'contains': return toStr(obj).includes(toStr(args[0]));
    case 'year': return toDate(obj)?.getFullYear() ?? null;
    case 'month': return (toDate(obj)?.getMonth() ?? -2) + 1 || null;
    case 'day': return toDate(obj)?.getDate() ?? null;
    case 'value': return obj;
  }
  throw new Error(l10n.t('Unknown member .{0}', name));
}

export function evalNode(n: Node, ctx: EvalContext): unknown {
  switch (n.k) {
    case 'lit': return n.v;
    case 'id': {
      if (n.name === 'vbcrlf' || n.name === 'vbnewline' || n.name === 'vblf') return '\n';
      if (n.name === 'vbtab') return '\t';
      if (n.name === 'code') return CODE;
      if (n.name === 'convert') return CONVERT;
      const v = ctx.lookup?.(n.name);
      if (v) return v.value;
      const user = ctx.callUser?.(n.name, []);
      if (user) return user.value;
      if (n.name === 'system') return SYSTEM;
      if (n.name === 'string') return STRING_NS;
      if (n.name === 'math') return MATH_NS;
      if (n.name === 'array') return ARRAY_NS;
      if (n.name in FUNCTIONS && ['now', 'today'].includes(n.name)) return FUNCTIONS[n.name]([], ctx);
      throw new Error(l10n.t("Unknown identifier '{0}'", n.name));
    }
    case 'coll': return collection(n, ctx);
    case 'member': return callMember(evalNode(n.obj, ctx), n.name, n.args.map(a => evalNode(a, ctx)), ctx);
    case 'un': {
      const v = evalNode(n.a, ctx);
      return n.op === '-' ? -toNum(v) : !toBool(v);
    }
    case 'call': {
      // a(i) on an array variable of the Code block
      const variable = ctx.lookup?.(n.name);
      if (Array.isArray(variable?.value)) return indexArray(variable.value, n.args.map(a => evalNode(a, ctx)));
      if (AGGREGATES.has(n.name)) return aggregate(n.name, n.args, ctx);
      if (n.name === 'iif') {
        if (n.args.length !== 3) throw new Error(l10n.t('IIf() expects 3 arguments'));
        return toBool(evalNode(n.args[0], ctx)) ? evalNode(n.args[1], ctx) : evalNode(n.args[2], ctx);
      }
      if (n.name === 'switch') {
        for (let i = 0; i + 1 < n.args.length; i += 2) if (toBool(evalNode(n.args[i], ctx))) return evalNode(n.args[i + 1], ctx);
        return null;
      }
      if (n.name === 'previous') {
        if (!n.args[0]) throw new Error(l10n.t('Previous() expects an argument'));
        return ctx.previousRow ? evalNode(n.args[0], { ...ctx, row: ctx.previousRow }) : null;
      }
      const args = n.args.map(a => evalNode(a, ctx));
      const user = ctx.callUser?.(n.name, args);
      if (user) return user.value;
      const fn = FUNCTIONS[n.name];
      if (!fn) throw new Error(l10n.t('Unknown function {0}()', n.name));
      return fn(args, ctx);
    }
    case 'bin': {
      if (n.op === 'andalso') return toBool(evalNode(n.a, ctx)) && toBool(evalNode(n.b, ctx));
      if (n.op === 'orelse') return toBool(evalNode(n.a, ctx)) || toBool(evalNode(n.b, ctx));
      const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx);
      switch (n.op) {
        case '&': return toStr(a) + toStr(b);
        case '+': {
          if (typeof a === 'string' && typeof b === 'string') return a + b;
          // text and number: numeric when the text is a number, otherwise concatenated (lenient where VB would fail)
          try { return toNum(a) + toNum(b); } catch { return toStr(a) + toStr(b); }
        }
        case '-': return toNum(a) - toNum(b);
        case '*': return toNum(a) * toNum(b);
        case '/': return toNum(a) / toNum(b);
        case '\\': return Math.trunc(toNum(a) / toNum(b));
        case 'mod': return toNum(a) % toNum(b);
        case '^': return toNum(a) ** toNum(b);
        case '=': return compare(a, b) === 0;
        case '<>': return compare(a, b) !== 0;
        case '<': return compare(a, b) < 0;
        case '>': return compare(a, b) > 0;
        case '<=': return compare(a, b) <= 0;
        case '>=': return compare(a, b) >= 0;
        case 'is': return a === b;
        case 'and': return toBool(a) && toBool(b);
        case 'or': return toBool(a) || toBool(b);
        case 'xor': return toBool(a) !== toBool(b);
        case 'like': {
          const re = toStr(b).replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/#/g, '\\d');
          return new RegExp(`^${re}$`).test(toStr(a));
        }
      }
    }
  }
  throw new Error(l10n.t('Invalid expression'));
}

function collection(n: Extract<Node, { k: 'coll' }>, ctx: EvalContext): unknown {
  switch (n.coll) {
    case 'fields': {
      const sets = Object.values(ctx.dataSets);
      const row = ctx.row ?? ctx.scopeRows[0] ?? (sets.length === 1 ? sets[0][0] : undefined);
      if (row === undefined) {
        if (sets.length === 1) return null; // dataset without rows
        throw new Error(l10n.t('Fields!{0} outside of a data region', n.name));
      }
      const v = row[n.name];
      return n.prop === 'isnothing' ? isNothing(v) : v ?? null;
    }
    case 'parameters': {
      if (!(n.name in ctx.parameters)) throw new Error(l10n.t('Unknown parameter {0}', n.name));
      return ctx.parameters[n.name];
    }
    case 'globals': return ctx.globals[n.name] ?? null;
    case 'user': return n.name.toLowerCase() === 'userid' ? 'DOMAIN\\user' : 'de-DE';
    case 'reportitems': {
      const list = ctx.reportItems?.(n.name);
      if (!list) throw new Error(l10n.t('ReportItems!{0} is not available here', n.name));
      return list[0] ?? null;
    }
    default: throw new Error(l10n.t('The collection {0}! is not supported in the preview', n.coll));
  }
}

/** Evaluates a textbox value: literal text as-is, "=…" as expression. Returns the raw (unformatted) value. */
export function evaluate(value: string, ctx: EvalContext): unknown {
  if (!value.startsWith('=')) return value;
  return evalNode(parseExpression(value.slice(1)), ctx);
}

/** Checks an expression for syntax errors; returns the error message or null. */
export function validateExpression(value: string): string | null {
  if (!value.startsWith('=')) return null;
  try { parseExpression(value.slice(1)); return null; } catch (e) { return (e as Error).message; }
}

/**
 * How Report Builder shows an expression on the design surface:
 * =Fields!Name.Value → [Name], =Sum(Fields!Amount.Value) → [Sum(Amount)], =Parameters!P.Value → [@P], else «Expr».
 */
export function designLabel(value: string): string {
  if (!value.startsWith('=')) return value;
  const src = value.slice(1).trim();
  let m = /^Fields!(\w+)\.Value$/i.exec(src);
  if (m) return `[${m[1]}]`;
  m = /^(\w+)\(Fields!(\w+)\.Value\)$/i.exec(src);
  if (m) return `[${m[1]}(${m[2]})]`;
  m = /^Parameters!(\w+)\.Value$/i.exec(src);
  if (m) return `[@${m[1]}]`;
  m = /^Globals!(\w+)$/i.exec(src);
  if (m) return `[&${m[1]}]`;
  return '«Expr»';
}

// ---------------------------------------------------------------------------------------------------------------
// .NET-style formatting

export function formatValue(v: unknown, fmt: string, locale?: string): string {
  if (isNothing(v)) return '';
  if (!fmt) {
    if (v instanceof Date) {
      // a date without time of day is shown as a date only
      const midnight = !v.getHours() && !v.getMinutes() && !v.getSeconds();
      return midnight ? v.toLocaleDateString(locale) : v.toLocaleString(locale);
    }
    return toStr(v);
  }
  if (v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !/^[NCPFDEX#0]/i.test(fmt))) {
    const d = toDate(v);
    return d ? formatDate(d, fmt, locale) : toStr(v);
  }
  if (typeof v === 'boolean') return toStr(v);
  const num = Number(v);
  if (Number.isNaN(num)) return toStr(v);
  return formatNumber(num, fmt, locale);
}

function formatNumber(n: number, fmt: string, locale?: string): string {
  const std = /^([NCPFDEGX])(\d*)$/i.exec(fmt);
  if (std) {
    const kind = std[1].toUpperCase();
    const digits = std[2] === '' ? undefined : parseInt(std[2], 10);
    switch (kind) {
      case 'N': return n.toLocaleString(locale, { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 });
      case 'F': return n.toLocaleString(locale, { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2, useGrouping: false });
      case 'C': {
        const currency = (locale ?? navigatorLocale()).startsWith('de') ? 'EUR' : 'USD';
        return n.toLocaleString(locale, { style: 'currency', currency, minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 });
      }
      case 'P': return (n * 100).toLocaleString(locale, { minimumFractionDigits: digits ?? 2, maximumFractionDigits: digits ?? 2 }) + ' %';
      case 'D': return Math.round(n).toString().padStart(digits ?? 0, '0');
      case 'E': return n.toExponential(digits ?? 6).toUpperCase();
      case 'X': return Math.round(n).toString(16).toUpperCase().padStart(digits ?? 0, '0');
      case 'G': return n.toLocaleString(locale, { maximumFractionDigits: 15, useGrouping: false });
    }
  }
  // Custom pattern such as "#,##0.00", "0.0 %" or "€ #,##0"
  const m = /^([^#0]*)([#0,]*)(?:\.([#0]+))?(.*)$/.exec(fmt);
  if (!m || (!m[2] && !m[3])) return fmt;
  const [, prefix, intPart, frac = '', suffix] = m;
  const value = suffix.includes('%') || prefix.includes('%') ? n * 100 : n;
  const minFrac = (frac.match(/0/g) ?? []).length;
  const out = value.toLocaleString(locale, {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: frac.length,
    minimumIntegerDigits: Math.max(1, (intPart.match(/0/g) ?? []).length),
    useGrouping: intPart.includes(','),
  });
  return prefix + out + suffix;
}

const navigatorLocale = () => (typeof navigator !== 'undefined' ? navigator.language : 'en-US');

function formatDate(d: Date, fmt: string, locale?: string): string {
  const standard: Record<string, Intl.DateTimeFormatOptions> = {
    d: { dateStyle: 'short' }, D: { dateStyle: 'full' }, t: { timeStyle: 'short' }, T: { timeStyle: 'medium' },
    g: { dateStyle: 'short', timeStyle: 'short' }, G: { dateStyle: 'short', timeStyle: 'medium' },
    f: { dateStyle: 'full', timeStyle: 'short' }, F: { dateStyle: 'full', timeStyle: 'medium' },
  };
  if (standard[fmt]) return d.toLocaleString(locale, standard[fmt]);
  const pad = (v: number, n = 2) => String(v).padStart(n, '0');
  const name = (opts: Intl.DateTimeFormatOptions) => d.toLocaleString(locale, opts);
  return fmt.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|ss|tt|'[^']*'/g, tok => {
    switch (tok) {
      case 'yyyy': return String(d.getFullYear());
      case 'yy': return pad(d.getFullYear() % 100);
      case 'MMMM': return name({ month: 'long' });
      case 'MMM': return name({ month: 'short' });
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'dddd': return name({ weekday: 'long' });
      case 'ddd': return name({ weekday: 'short' });
      case 'dd': return pad(d.getDate());
      case 'd': return String(d.getDate());
      case 'HH': return pad(d.getHours());
      case 'H': return String(d.getHours());
      case 'hh': return pad(d.getHours() % 12 || 12);
      case 'h': return String(d.getHours() % 12 || 12);
      case 'mm': return pad(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      case 'tt': return d.getHours() < 12 ? 'AM' : 'PM';
      default: return tok.slice(1, -1);
    }
  });
}
