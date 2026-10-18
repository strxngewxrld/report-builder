// Interpreter for the <Code> block of a report: the Visual Basic subset used by Business Central layouts
// (BlankZero…, SetData/GetData, IsNewPage/GetGroupPageNumber, SetRowColor, CalcPct, …).
//
// Supported: Function/Sub with parameters, Shared/Dim declarations (optionally initialised), If/ElseIf/Else/End If
// (block and single-line, "Then" optional), For/Next (with Step), For Each, While/End While, Do…Loop (While/Until
// before or after), Select Case (values, ranges with To, Is <op>, Case Else), Exit/Continue For/Do/While/Select,
// Try/Catch (with When)/Finally, Throw, With/End With, arrays (Dim a(5), Dim a() = {…}, ReDim Preserve, a(i) = x,
// several dimensions), Return, Exit Function/Sub/Try, assignments (=, +=, -=, *=, /=, \=, ^=, &=) to variables,
// array elements and members, calls, comments (' and REM), line continuations and On Error (ignored). Other statements
// are reported as unsupported when they are executed.
//
// Writes to Shared variables are logged with a version number, so the state at any point of the evaluation can be
// restored – page headers need the state as it was at the end of their page.

import { EvalContext, Node, compare, evalNode, isNothing, parseExpression, toBool, toNum, toStr } from './expr';
import { l10n } from './l10n';

type LoopKind = 'for' | 'do' | 'while' | 'select' | 'try';
type LoopCond = { until: boolean; cond: Node } | null;
/** One test of a Case clause: a value (op '='), "Is <op> value" or a range "a To b". */
type CaseTest = { op: string; expr: Node } | { from: Node; to: Node };

type Stmt =
  | { k: 'if'; branches: { cond: Node | null; body: Stmt[] }[] }
  | { k: 'for'; name: string; local: boolean; from: Node; to: Node; step: Node | null; body: Stmt[] }
  | { k: 'foreach'; name: string; local: boolean; list: Node; body: Stmt[] }
  | { k: 'loop'; kind: 'do' | 'while'; pre: LoopCond; post: LoopCond; body: Stmt[] }
  | { k: 'select'; subject: Node; cases: { tests: CaseTest[] | null; body: Stmt[] }[] }
  | { k: 'exitloop'; kind: LoopKind }
  | { k: 'continue'; kind: LoopKind }
  | { k: 'return'; expr: Node | null }
  | { k: 'exit' }
  | { k: 'assign'; target: Target; op: string; expr: Node }
  | { k: 'dim'; decls: Decl[] }
  | { k: 'redim'; name: string; dims: Node[]; preserve: boolean }
  | { k: 'try'; body: Stmt[]; catches: { name: string | null; when: Node | null; body: Stmt[] }[]; fin: Stmt[] | null }
  | { k: 'throw'; expr: Node | null }
  | { k: 'with'; tmp: string; subject: Node; body: Stmt[] }
  | { k: 'expr'; expr: Node }
  | { k: 'unsupported'; text: string };

/** Left side of an assignment: a variable, an array element a(i, j) or a member obj.Name. */
type Target = { k: 'var'; name: string } | { k: 'index'; name: string; idx: Node[] } | { k: 'member'; obj: Node; name: string };
/** One declared variable: Dim a(5) As Integer / Dim b() As String = {"x"} / Dim n As Decimal = 1. */
interface Decl { name: string; dims: Node[] | null; isArray: boolean; type: string; init: Node | null }

interface Fn { name: string; params: { name: string; def: Node | null }[]; body: Stmt[]; isSub: boolean }

class ReturnSignal { constructor(readonly value: unknown) {} }
class ExitSignal {}
class LoopSignal { constructor(readonly kind: LoopKind, readonly cont: boolean) {} }
/** Errors the code cannot catch: endless loops and too deep recursion. */
class LimitError extends Error {}

/** The exception object of a Catch block (ex.Message, ex.ToString()). */
export class VbException {
  constructor(readonly Message: string) {}
  toString() { return this.Message; }
}
class ThrownError extends Error { constructor(readonly exception: VbException) { super(exception.Message); } }

const NUMERIC = /^(integer|int16|int32|int64|long|short|byte|sbyte|uinteger|ulong|ushort|decimal|double|single|float)$/i;
/** Value of an uninitialised variable or array element of a type. */
function defaultValue(type: string): unknown {
  const t = type.replace(/^system\./i, '');
  return NUMERIC.test(t) ? 0 : /^boolean$/i.test(t) ? false : null;
}

/** An array with the upper bounds `bounds` (VB: Dim a(2) has three elements), nested for several dimensions. */
function makeArray(bounds: number[], type: string, old?: unknown): unknown[] {
  const [n, ...rest] = bounds;
  return Array.from({ length: Math.max(0, Math.trunc(n) + 1) }, (_, i) => {
    const prev = Array.isArray(old) ? old[i] : undefined;
    if (rest.length) return makeArray(rest, type, prev);
    return Array.isArray(old) && i < old.length ? prev : defaultValue(type);
  });
}

/** The first top-level assignment operator of a statement: [left, operator, right], or null. */
function splitAssign(text: string): [string, string, string] | null {
  let depth = 0, inStr = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (depth === 0 && ch === '=') {
      const prev = text[i - 1] ?? '';
      if (prev === '<' || prev === '>') return null; // a comparison: not an assignment statement
      const op = '+-*/\\^&'.includes(prev) && i > 0 ? prev + '=' : '=';
      const left = text.slice(0, i - (op.length - 1)).trim();
      return left ? [left, op, text.slice(i + 1).trim()] : null;
    }
  }
  return null;
}

/** Splits at commas outside of strings, parentheses and braces. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr = false, cur = '';
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr && (ch === '(' || ch === '{')) depth++;
    else if (!inStr && (ch === ')' || ch === '}')) depth--;
    else if (!inStr && depth === 0 && ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const MODIFIERS = /^(?:(?:public|private|friend|protected|shared|overloads|overrides|static)\s+)*/i;

/** Splits code into logical lines without comments; `_` at the end continues a line. */
function logicalLines(code: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let pending = '', start = 0;
  code.split(/\r?\n/).forEach((raw, i) => {
    let s = '', inStr = false;
    for (const ch of raw) {
      if (ch === '"') inStr = !inStr;
      if (ch === "'" && !inStr) break;
      s += ch;
    }
    s = s.trim();
    if (/^rem(\s|$)/i.test(s)) s = '';
    if (!pending) start = i + 1;
    if (/(^|\s)_$/.test(s)) { pending += s.slice(0, -1) + ' '; return; }
    const text = (pending + s).trim();
    pending = '';
    if (text) out.push({ text, line: start });
  });
  return out;
}

export class CodeModule {
  private functions = new Map<string, Fn>();
  private initial = new Map<string, unknown>();
  private shared = new Map<string, unknown>();
  private log: { version: number; name: string; value: unknown }[] = [];
  private depth = 0;
  private steps = 0;
  /** Increases with every write to a Shared variable. */
  version = 0;
  /** Variables written while `overlay` mode is on (page sections) – they persist across pages. */
  private overlay: Map<string, unknown> | null = null;
  readonly errors: string[] = [];

  constructor(source: string) {
    // Me.Report.Globals!X / Report.Parameters!Y inside code refer to the report's collections
    const lines = logicalLines(source.replace(/\b(?:Me\.)?Report\.(?=(?:Globals|Parameters|User|Fields|ReportItems)!)/gi, ''));
    let i = 0;
    while (i < lines.length) {
      const { text, line } = lines[i];
      const fn = new RegExp(`${MODIFIERS.source}(function|sub)\\s+(\\w+)\\s*(?:\\((.*)\\))?\\s*(?:as\\s+[\\w.()]+)?\\s*$`, 'i').exec(text);
      if (fn) {
        const [body, next] = this.block(lines, i + 1, /^end\s+(function|sub)$/i);
        const params = (fn[3] ?? '').split(',').map(p => p.trim()).filter(Boolean).map(p => {
          const m = /^(?:(?:byval|byref|optional|paramarray)\s+)*(\w+)(?:\s*\(\s*\))?(?:\s+as\s+[\w.()]+)?(?:\s*=\s*(.+))?$/i.exec(p);
          return { name: (m?.[1] ?? p).toLowerCase(), def: m?.[2] ? this.expr(m[2], line) : null };
        });
        this.functions.set(fn[2].toLowerCase(), { name: fn[2], params, body, isSub: fn[1].toLowerCase() === 'sub' });
        i = next;
        continue;
      }
      // several variables in one declaration: "Shared Data1, Data2 As Object"
      const multi = /^((?:(?:public|private|friend|protected|shared|dim|static)\s+)+)(\w+(?:\s*,\s*\w+)+)(\s+as\s+[\w.]+)?$/i.exec(text);
      if (multi) {
        for (const n of multi[2].split(',')) this.initial.set(n.trim().toLowerCase(), null);
        i++;
        continue;
      }
      const head = /^(?:(?:public|private|friend|protected|shared|dim|static|const|readonly)\s+)+(.+)$/i.exec(text);
      const decl = head && this.decl(head[1], line);
      if (decl) {
        let value: unknown = null;
        try {
          value = this.initValue(decl, this.bareContext());
        } catch (e) { this.errors.push(l10n.t('Line {0}: {1}', line, (e as Error).message)); }
        this.initial.set(decl.name, value);
      } else if (!/^(option|imports)\s/i.test(text)) {
        this.errors.push(l10n.t('Line {0}: unsupported statement outside of a function: {1}', line, text));
      }
      i++;
    }
    this.shared = new Map(this.initial);
  }

  /** Names of the functions defined in the code (for linting). */
  get functionNames(): string[] { return [...this.functions.values()].map(f => f.name); }

  private expr(text: string, line: number): Node {
    text = this.withify(text);
    try { return parseExpression(text); } catch (e) { throw new Error(l10n.t('Code, line {0}: {1} in "{2}"', line, (e as Error).message, text)); }
  }

  /** Parses statements up to a line matching `end`; returns them and the index after the end line. */
  private block(lines: { text: string; line: number }[], from: number, end: RegExp): [Stmt[], number] {
    const out: Stmt[] = [];
    let i = from;
    while (i < lines.length) {
      const { text, line } = lines[i];
      if (end.test(text)) return [out, i + 1];
      // block If (Then optional, nothing after it)
      const ifBlock = /^if\s+(.+?)(?:\s+then)?$/i.exec(text);
      const ifLine = /^if\s+(.+?)\s+then\s+(.+)$/i.exec(text);
      if (ifLine && !/^\s*$/.test(ifLine[2])) {
        const [thenPart, elsePart] = ifLine[2].split(/\s+else\s+/i);
        out.push(this.guard(text, () => ({
          k: 'if', branches: [
            { cond: this.expr(ifLine[1], line), body: [this.stmt(thenPart, line)] },
            ...(elsePart ? [{ cond: null, body: [this.stmt(elsePart, line)] }] : []),
          ],
        })));
        i++;
        continue;
      }
      if (ifBlock) {
        const branches: { cond: Node | null; body: Stmt[] }[] = [];
        let cond: Node | null = this.condOrFail(ifBlock[1], line);
        i++;
        for (;;) {
          const [body, next] = this.block(lines, i, /^(elseif\s+.+|else|end\s+if)$/i);
          branches.push({ cond, body });
          const stop = lines[next - 1]?.text ?? 'end if';
          i = next;
          // also stops at the end of the code when "End If" is missing
          if (/^end\s+if$/i.test(stop) || i >= lines.length) break;
          const elseIf = /^elseif\s+(.+?)(?:\s+then)?$/i.exec(stop);
          cond = elseIf ? this.condOrFail(elseIf[1], lines[next - 1].line) : null;
        }
        out.push({ k: 'if', branches });
        continue;
      }
      const loop = this.loop(lines, i);
      if (loop) {
        out.push(loop[0]);
        i = loop[1];
        continue;
      }
      out.push(this.stmt(text, line));
      i++;
    }
    return [out, i];
  }

  /** Subjects of the enclosing With blocks while parsing (innermost last). */
  private withs: string[] = [];
  private withCount = 0;

  /** Inside With: ".Name" refers to the With subject (rewritten to its hidden variable). */
  private withify(text: string): string {
    const top = this.withs[this.withs.length - 1];
    if (!top) return text;
    let out = '', inStr = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') inStr = !inStr;
      if (!inStr && ch === '.' && /[A-Za-z_]/.test(text[i + 1] ?? '') && !/[\w)\]}"]/.test(text.slice(0, i).trimEnd().slice(-1))) out += top;
      out += ch;
    }
    return out;
  }

  /** Parses a declaration after Dim/Shared/…: "a(5) As Integer", "b() As String = {…}", "n As New Object". */
  private decl(text: string, line: number): Decl | null {
    const m = /^(\w+)\s*(?:\(([^)]*)\))?(?:\s+as\s+(?:new\s+)?([\w.]+)\s*(\(\s*\))?)?(?:\s*=\s*(.+))?$/i.exec(text.trim());
    if (!m) return null;
    const dims = m[2]?.trim() ? splitTop(m[2]).map(d => this.expr(d, line)) : null;
    // New Integer() {1, 2} is the same as {1, 2}
    const init = m[5]?.replace(/^new\s+[\w.]+\s*\(\s*\)\s*(?=\{)/i, '');
    return { name: m[1].toLowerCase(), dims, isArray: m[2] !== undefined || !!m[4], type: m[3] ?? '', init: init ? this.expr(init, line) : null };
  }

  private initValue(d: Decl, ctx: EvalContext): unknown {
    if (d.init) return evalNode(d.init, ctx);
    if (d.dims) return makeArray(d.dims.map(x => toNum(evalNode(x, ctx))), d.type);
    return d.isArray ? null : defaultValue(d.type);
  }

  /** Parses For, For Each, While, Do, Select Case, Try and With blocks starting at `i`; null for other lines. */
  private loop(lines: { text: string; line: number }[], i: number): [Stmt, number] | null {
    const { text, line } = lines[i];
    let m: RegExpExecArray | null;
    const typed = (name: string, as: string | undefined) => ({ name: name.toLowerCase(), local: !!as });
    if ((m = /^for\s+each\s+(\w+)(\s+as\s+[\w.]+)?\s+in\s+(.+)$/i.exec(text))) {
      const [body, next] = this.block(lines, i + 1, /^next(\s+\w+)?$/i);
      return [this.guard(text, () => ({ k: 'foreach', ...typed(m![1], m![2]), list: this.expr(m![3], line), body })), next];
    }
    if ((m = /^for\s+(\w+)(\s+as\s+[\w.]+)?\s*=\s*(.+?)\s+to\s+(.+?)(?:\s+step\s+(.+))?$/i.exec(text))) {
      const [body, next] = this.block(lines, i + 1, /^next(\s+\w+)?$/i);
      return [this.guard(text, () => ({
        k: 'for', ...typed(m![1], m![2]), from: this.expr(m![3], line), to: this.expr(m![4], line),
        step: m![5] ? this.expr(m![5], line) : null, body,
      })), next];
    }
    if ((m = /^while\s+(.+)$/i.exec(text))) {
      const [body, next] = this.block(lines, i + 1, /^(end\s+while|wend)$/i);
      return [this.guard(text, () => ({ k: 'loop', kind: 'while', pre: { until: false, cond: this.expr(m![1], line) }, post: null, body })), next];
    }
    if ((m = /^do(?:\s+(while|until)\s+(.+))?$/i.exec(text))) {
      const end = /^loop(?:\s+(while|until)\s+(.+))?$/i;
      const [body, next] = this.block(lines, i + 1, end);
      const tail = end.exec(lines[next - 1]?.text ?? '');
      return [this.guard(text, () => ({
        k: 'loop', kind: 'do', body,
        pre: m![1] ? { until: /^until$/i.test(m![1]), cond: this.expr(m![2], line) } : null,
        post: tail?.[1] ? { until: /^until$/i.test(tail[1]), cond: this.expr(tail[2], lines[next - 1].line) } : null,
      })), next];
    }
    if (/^try$/i.test(text)) {
      const part = /^(catch(\s+.*)?|finally|end\s+try)$/i;
      let [body, next] = this.block(lines, i + 1, part);
      const catches: { name: string | null; when: Node | null; body: Stmt[] }[] = [];
      let fin: Stmt[] | null = null;
      let bad: Error | null = null;
      while (next > i + 1 && next <= lines.length && part.test(lines[next - 1].text)) {
        const header = lines[next - 1];
        if (/^end\s+try$/i.test(header.text)) break;
        const [partBody, after] = this.block(lines, next, part);
        if (/^finally$/i.test(header.text)) fin = partBody;
        else {
          const c = /^catch(?:\s+(\w+)(?:\s+as\s+[\w.]+)?)?(?:\s+when\s+(.+))?$/i.exec(header.text);
          if (!c) bad ??= new Error(l10n.t('invalid Catch'));
          else {
            try {
              catches.push({ name: c[1]?.toLowerCase() ?? null, when: c[2] ? this.expr(c[2], header.line) : null, body: partBody });
            } catch (e) { bad ??= e as Error; }
          }
        }
        if (after === next || !(after <= lines.length && part.test(lines[after - 1].text))) { next = after; break; }
        next = after;
      }
      return [this.guard(text, () => {
        if (bad) throw bad;
        return { k: 'try', body, catches, fin };
      }), next];
    }
    if ((m = /^with\s+(.+)$/i.exec(text))) {
      const tmp = `__with${this.withCount++}`;
      let subject: Node | Error;
      try { subject = this.expr(m[1], line); } catch (e) { subject = e as Error; }
      this.withs.push(tmp);
      try {
        const [body, next] = this.block(lines, i + 1, /^end\s+with$/i);
        return [this.guard(text, () => {
          if (subject instanceof Error) throw subject;
          return { k: 'with', tmp, subject, body };
        }), next];
      } finally {
        this.withs.pop();
      }
    }
    if ((m = /^select\s+(?:case\s+)?(.+)$/i.exec(text))) {
      const caseOrEnd = /^(case\s+.+|end\s+select)$/i;
      // statements before the first Case are ignored; each block ends at the next Case or End Select
      let [, next] = this.block(lines, i + 1, caseOrEnd);
      const cases: { tests: CaseTest[] | null; body: Stmt[] }[] = [];
      let bad: Error | null = null;
      for (;;) {
        const header = next > i + 1 ? /^case\s+(.+)$/i.exec(lines[next - 1].text) : null;
        if (!header) break;
        const [body, after] = this.block(lines, next, caseOrEnd);
        try {
          cases.push({ tests: /^else$/i.test(header[1].trim()) ? null : this.caseTests(header[1], lines[next - 1].line), body });
        } catch (e) { bad ??= e as Error; }
        const ended = after > next && caseOrEnd.test(lines[after - 1].text);
        next = after;
        if (!ended) break; // End Select missing: the block ran to the end of the code
      }
      return [this.guard(text, () => {
        if (bad) throw bad;
        return { k: 'select', subject: this.expr(m![1], line), cases };
      }), next];
    }
    return null;
  }

  private caseTests(text: string, line: number): CaseTest[] {
    return splitTop(text).map(part => {
      let m: RegExpExecArray | null;
      if ((m = /^is\s*(<>|<=|>=|=|<|>)\s*(.+)$/i.exec(part))) return { op: m[1], expr: this.expr(m[2], line) };
      if ((m = /^(.+?)\s+to\s+(.+)$/i.exec(part))) return { from: this.expr(m[1], line), to: this.expr(m[2], line) };
      return { op: '=', expr: this.expr(part, line) };
    });
  }

  private stmt(text: string, line: number): Stmt {
    try {
      return this.parseStmt(text, line);
    } catch (e) {
      return { k: 'unsupported', text: `${text} (${(e as Error).message})` };
    }
  }

  private parseStmt(text: string, line: number): Stmt {
    let m: RegExpExecArray | null;
    if ((m = /^return(?:\s+(.+))?$/i.exec(text))) return { k: 'return', expr: m[1] ? this.expr(m[1], line) : null };
    if (/^exit\s+(function|sub)$/i.test(text)) return { k: 'exit' };
    if ((m = /^(exit|continue)\s+(for|do|while|select|try)$/i.exec(text))) {
      const kind = m[2].toLowerCase() as LoopKind;
      return /^exit$/i.test(m[1]) ? { k: 'exitloop', kind } : { k: 'continue', kind };
    }
    if (/^on\s+error\b/i.test(text)) return { k: 'expr', expr: { k: 'lit', v: null } };
    if ((m = /^(?:dim|static|const)\s+(.+)$/i.exec(text))) {
      // Dim a, b As Integer: variables without a type take the type of the next one
      const decls = splitTop(m[1]).map(d => this.decl(d, line));
      if (decls.some(d => !d)) throw new Error(l10n.t('invalid declaration'));
      const list = decls as Decl[];
      for (let j = list.length - 2; j >= 0; j--) if (!list[j].type && !list[j].init) list[j].type = list[j + 1].type;
      return { k: 'dim', decls: list };
    }
    if ((m = /^redim\s+(preserve\s+)?(\w+)\s*\((.+)\)$/i.exec(text))) {
      return { k: 'redim', name: m[2].toLowerCase(), dims: splitTop(m[3]).map(d => this.expr(d, line)), preserve: !!m[1] };
    }
    if ((m = /^throw(?:\s+(.+))?$/i.exec(text))) {
      if (!m[1]) return { k: 'throw', expr: null };
      // Throw New Exception("message")
      const ex = /^new\s+(?:system\.)?\w*exception\s*(?:\((.*)\))?$/i.exec(m[1]);
      return { k: 'throw', expr: ex ? (ex[1]?.trim() ? this.expr(ex[1], line) : { k: 'lit', v: 'Exception' }) : this.expr(m[1], line) };
    }
    if (/^(for|while|do|select|loop|next|wend|try|catch|finally|with|end)\b/i.test(text)) return { k: 'unsupported', text };
    if ((m = /^call\s+(.+)$/i.exec(text))) return { k: 'expr', expr: this.expr(m[1], line) };
    text = this.withify(text);
    const assign = splitAssign(text);
    if (assign) {
      const target = this.target(assign[0], line);
      if (target) return { k: 'assign', target, op: assign[1], expr: this.expr(assign[2], line) };
    }
    return { k: 'expr', expr: this.expr(text, line) };
  }

  private target(text: string, line: number): Target | null {
    let n: Node;
    try { n = this.expr(text, line); } catch { return null; }
    if (n.k === 'id') return { k: 'var', name: n.name };
    if (n.k === 'call') return { k: 'index', name: n.name, idx: n.args };
    if (n.k === 'member' && !n.args.length) return { k: 'member', obj: n.obj, name: n.name };
    return null;
  }

  private guard(text: string, fn: () => Stmt): Stmt {
    try { return fn(); } catch (e) { return { k: 'unsupported', text: `${text} (${(e as Error).message})` }; }
  }

  /** A condition that cannot be parsed becomes an expression that fails when evaluated. */
  private condOrFail(text: string, line: number): Node {
    try {
      return this.expr(text, line);
    } catch (e) {
      return { k: 'call', name: '__codeerror', args: [{ k: 'lit', v: (e as Error).message }] };
    }
  }

  /** Context for evaluating declarations: only Shared variables and the code's functions are visible. */
  private bareContext(): EvalContext {
    return {
      row: null, scopeRows: [], dataSets: {}, parameters: {},
      globals: { ExecutionTime: new Date(), PageNumber: 1, TotalPages: 1, ReportName: '' },
      lookup: n => (this.shared.has(n) ? { value: this.shared.get(n) } : undefined),
    };
  }

  /** Calls a function of the code block (Code.Name(args)). */
  call(name: string, args: unknown[], ctx: EvalContext): unknown {
    const fn = this.functions.get(name.toLowerCase());
    if (!fn) throw new Error(l10n.t('Code.{0} is not defined in the code block', name));
    if (this.depth > 50) throw new LimitError(l10n.t('Code.{0}: recursion too deep', name));
    const locals = new Map<string, unknown>();
    fn.params.forEach((p, i) => locals.set(p.name, i < args.length ? args[i] : p.def ? evalNode(p.def, ctx) : null));
    if (!fn.isSub) locals.set(fn.name.toLowerCase(), null);
    const inner: EvalContext = {
      ...ctx,
      lookup: n => (locals.has(n) ? { value: locals.get(n) } : this.has(n) ? { value: this.get(n) } : undefined),
      callUser: (n, a) => (this.functions.has(n) && !locals.has(n) ? { value: this.call(n, a, ctx) } : undefined),
    };
    this.depth++;
    this.steps = this.depth === 1 ? 0 : this.steps;
    try {
      this.run(fn.body, locals, inner);
      return fn.isSub ? null : locals.get(fn.name.toLowerCase()) ?? null;
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      if (e instanceof ExitSignal) return fn.isSub ? null : locals.get(fn.name.toLowerCase()) ?? null;
      throw e;
    } finally {
      this.depth--;
    }
  }

  private run(body: Stmt[], locals: Map<string, unknown>, ctx: EvalContext) {
    for (const s of body) {
      if (++this.steps > 100000) throw new LimitError(l10n.t('Code: too many statements (endless loop?)'));
      switch (s.k) {
        case 'if': {
          const branch = s.branches.find(b => b.cond === null || toBool(evalNode(b.cond, ctx)));
          if (branch) this.run(branch.body, locals, ctx);
          break;
        }
        case 'return': throw new ReturnSignal(s.expr ? evalNode(s.expr, ctx) : null);
        case 'exit': throw new ExitSignal();
        case 'dim': for (const d of s.decls) locals.set(d.name, this.initValue(d, ctx)); break;
        case 'redim': {
          const bounds = s.dims.map(d => toNum(evalNode(d, ctx)));
          const old = this.read(s.name, locals);
          this.assign(s.name, makeArray(bounds, '', s.preserve ? old : undefined), locals);
          // without Preserve the elements get the default of the old elements' type
          if (!s.preserve && Array.isArray(old)) this.fillLike(this.read(s.name, locals) as unknown[], old);
          break;
        }
        case 'throw': {
          const v = s.expr ? evalNode(s.expr, ctx) : this.caught[this.caught.length - 1];
          if (v === undefined) throw new Error(l10n.t('Code: Throw without an exception outside of Catch'));
          throw new ThrownError(v instanceof VbException ? v : new VbException(toStr(v)));
        }
        case 'try': this.runTry(s, locals, ctx); break;
        case 'with': {
          locals.set(s.tmp, evalNode(s.subject, ctx));
          try { this.run(s.body, locals, ctx); } finally { locals.delete(s.tmp); }
          break;
        }
        case 'expr': evalNode(s.expr, ctx); break;
        case 'unsupported': throw new Error(l10n.t('Code: unsupported statement "{0}"', s.text));
        case 'assign': this.runAssign(s.target, s.op, s.expr, locals, ctx); break;
        case 'exitloop': throw new LoopSignal(s.kind, false);
        case 'continue': throw new LoopSignal(s.kind, true);
        case 'for': {
          const to = Number(evalNode(s.to, ctx));
          const step = s.step ? Number(evalNode(s.step, ctx)) : 1;
          if (s.local) locals.set(s.name, null);
          this.assign(s.name, evalNode(s.from, ctx), locals);
          for (;;) {
            const cur = Number(this.read(s.name, locals));
            if (step >= 0 ? cur > to : cur < to) break;
            if (!this.iterate('for', s.body, locals, ctx)) break;
            this.assign(s.name, Number(this.read(s.name, locals)) + step, locals);
          }
          break;
        }
        case 'foreach': {
          const list = evalNode(s.list, ctx);
          const items = Array.isArray(list) ? list : typeof list === 'string' ? [...list] : list == null ? [] : null;
          if (!items) throw new Error(l10n.t('Code: For Each expects a list'));
          if (s.local) locals.set(s.name, null);
          for (const item of items) {
            this.assign(s.name, item, locals);
            if (!this.iterate('for', s.body, locals, ctx)) break;
          }
          break;
        }
        case 'loop': {
          const holds = (c: LoopCond) => !c || toBool(evalNode(c.cond, ctx)) !== c.until;
          while (holds(s.pre)) {
            if (!this.iterate(s.kind, s.body, locals, ctx)) break;
            if (!holds(s.post)) break;
          }
          break;
        }
        case 'select': {
          const v = evalNode(s.subject, ctx);
          const hit = s.cases.find(c => c.tests === null || c.tests.some(t => 'from' in t
            ? compare(v, evalNode(t.from, ctx)) >= 0 && compare(v, evalNode(t.to, ctx)) <= 0
            : toBool(evalNode({ k: 'bin', op: t.op, a: { k: 'lit', v }, b: t.expr }, ctx))));
          if (hit) {
            try {
              this.run(hit.body, locals, ctx);
            } catch (e) {
              if (!(e instanceof LoopSignal && e.kind === 'select' && !e.cont)) throw e;
            }
          }
          break;
        }
      }
    }
  }

  /** Exceptions of the enclosing Catch blocks, for Throw without an argument. */
  private caught: VbException[] = [];

  private runTry(s: Extract<Stmt, { k: 'try' }>, locals: Map<string, unknown>, ctx: EvalContext) {
    const exitTry = (e: unknown) => e instanceof LoopSignal && e.kind === 'try';
    try {
      try {
        this.run(s.body, locals, ctx);
      } catch (e) {
        if (exitTry(e)) return;
        if (!(e instanceof Error) || e instanceof LimitError) throw e;
        const ex = e instanceof ThrownError ? e.exception : new VbException(e.message);
        for (const c of s.catches) {
          if (c.name) locals.set(c.name, ex);
          if (c.when && !toBool(evalNode(c.when, ctx))) continue;
          this.caught.push(ex);
          try {
            this.run(c.body, locals, ctx);
          } catch (inner) {
            if (!exitTry(inner)) throw inner;
          } finally {
            this.caught.pop();
          }
          return;
        }
        throw e;
      }
    } finally {
      if (s.fin) this.run(s.fin, locals, ctx);
    }
  }

  private runAssign(t: Target, op: string, expr: Node, locals: Map<string, unknown>, ctx: EvalContext) {
    let value = evalNode(expr, ctx);
    const combine = (cur: unknown) => (op === '=' ? value
      : evalNode({ k: 'bin', op: op[0] === '^' ? '^' : op[0], a: { k: 'lit', v: cur }, b: { k: 'lit', v: value } }, ctx));
    if (t.k === 'var') {
      this.assign(t.name, combine(this.read(t.name, locals)), locals);
      return;
    }
    if (t.k === 'member') {
      const obj = evalNode(t.obj, ctx);
      if (!obj || typeof obj !== 'object' || obj instanceof Date || Array.isArray(obj)) throw new Error(l10n.t('Code: cannot assign to .{0}', t.name));
      const rec = obj as Record<string, unknown>;
      const key = Object.keys(rec).find(k => k.toLowerCase() === t.name.toLowerCase()) ?? t.name;
      rec[key] = combine(rec[key]);
      return;
    }
    const arr = this.read(t.name, locals);
    if (!Array.isArray(arr)) throw new Error(l10n.t('Code: {0} is not an array', t.name));
    const idx = t.idx.map(i => toNum(evalNode(i, ctx)));
    // copy the path for Shared arrays so that earlier versions (atVersion) keep their values
    const shared = !locals.has(t.name);
    const root = shared ? [...arr] : arr;
    let cur: unknown[] = root;
    idx.forEach((n, level) => {
      if (n < 0 || n >= cur.length || !Number.isInteger(n)) throw new Error(l10n.t('Index {0} is outside the bounds of the array', n));
      if (level === idx.length - 1) cur[n] = combine(cur[n]);
      else {
        if (!Array.isArray(cur[n])) throw new Error(l10n.t('Code: {0} is not an array', t.name));
        if (shared) cur[n] = [...(cur[n] as unknown[])];
        cur = cur[n] as unknown[];
      }
    });
    if (shared) this.assign(t.name, root, locals);
  }

  /** ReDim without Preserve: elements become the default of the old elements' type (0 for numbers). */
  private fillLike(arr: unknown[], old: unknown[]) {
    const sample = old.find(x => !isNothing(x) && !Array.isArray(x));
    const def = typeof sample === 'number' ? 0 : typeof sample === 'boolean' ? false : null;
    const fill = (a: unknown[]) => a.forEach((x, i) => (Array.isArray(x) ? fill(x) : (a[i] = def)));
    fill(arr);
  }

  /** Runs one loop iteration; false when the loop is left with Exit. */
  private iterate(kind: LoopKind, body: Stmt[], locals: Map<string, unknown>, ctx: EvalContext): boolean {
    if (++this.steps > 100000) throw new LimitError(l10n.t('Code: too many statements (endless loop?)'));
    try {
      this.run(body, locals, ctx);
      return true;
    } catch (e) {
      if (e instanceof LoopSignal && e.kind === kind) return e.cont;
      throw e;
    }
  }

  private read(name: string, locals: Map<string, unknown>) { return locals.has(name) ? locals.get(name) : this.get(name); }

  private assign(name: string, value: unknown, locals: Map<string, unknown>) {
    if (locals.has(name) || !this.has(name)) locals.set(name, value);
    else this.set(name, value);
  }

  private has(name: string) { return this.overlay?.has(name) || this.shared.has(name); }
  private get(name: string) { return this.overlay?.has(name) ? this.overlay.get(name) : this.shared.get(name); }
  private set(name: string, value: unknown) {
    if (this.overlay) { this.overlay.set(name, value); return; }
    this.shared.set(name, value);
    this.log.push({ version: ++this.version, name, value });
  }

  /**
   * Runs `fn` with the Shared state as it was at `version` (e.g. the end of a page's body). Writes made inside
   * (page header logic such as GetGroupPageNumber's offset) are kept for the next call – they belong to the
   * page sections, not to the body.
   */
  private sectionWrites = new Map<string, unknown>();
  atVersion<T>(version: number, fn: () => T): T {
    const saved = this.shared;
    const state = new Map(this.initial);
    for (const e of this.log) {
      if (e.version > version) break;
      state.set(e.name, e.value);
    }
    for (const [k, v] of this.sectionWrites) state.set(k, v);
    this.shared = state;
    this.overlay = this.sectionWrites;
    try {
      return fn();
    } finally {
      this.overlay = null;
      this.shared = saved;
    }
  }
}
