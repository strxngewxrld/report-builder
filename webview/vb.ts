// Interpreter for the <Code> block of a report: the Visual Basic subset used by Business Central layouts
// (BlankZero…, SetData/GetData, IsNewPage/GetGroupPageNumber, SetRowColor, CalcPct, …).
//
// Supported: Function/Sub with parameters, Shared/Dim declarations (optionally initialised), If/ElseIf/Else/End If
// (block and single-line, "Then" optional), For/Next (with Step), For Each, While/End While, Do…Loop (While/Until
// before or after), Select Case (values, ranges with To, Is <op>, Case Else), Exit/Continue For/Do/While/Select,
// Return, Exit Function/Sub, assignments (=, +=, -=, *=, /=, &=), calls, comments (' and REM), line continuations
// and On Error (ignored). Other statements (Try, With, …) are reported as unsupported when they are executed.
//
// Writes to Shared variables are logged with a version number, so the state at any point of the evaluation can be
// restored – page headers need the state as it was at the end of their page.

import { EvalContext, Node, compare, evalNode, parseExpression, toBool } from './expr';
import { l10n } from './l10n';

type LoopKind = 'for' | 'do' | 'while' | 'select';
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
  | { k: 'assign'; name: string; op: string; expr: Node }
  | { k: 'dim'; name: string; expr: Node | null }
  | { k: 'expr'; expr: Node }
  | { k: 'unsupported'; text: string };

interface Fn { name: string; params: { name: string; def: Node | null }[]; body: Stmt[]; isSub: boolean }

class ReturnSignal { constructor(readonly value: unknown) {} }
class ExitSignal {}
class LoopSignal { constructor(readonly kind: LoopKind, readonly cont: boolean) {} }

/** Splits at commas outside of strings and parentheses. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr = false, cur = '';
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === '(') depth++;
    else if (!inStr && ch === ')') depth--;
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
      const decl = /^(?:(?:public|private|friend|protected|shared|dim|static|const)\s+)+(\w+)(?:\s*\(\s*\))?(?:\s+as\s+(?:new\s+)?[\w.]+(?:\(\))?)?(?:\s*=\s*(.+))?$/i.exec(text);
      if (decl) {
        let value: unknown = null;
        if (decl[2]) {
          try { value = evalNode(this.expr(decl[2], line), this.bareContext()); } catch (e) { this.errors.push(l10n.t('Line {0}: {1}', line, (e as Error).message)); }
        }
        this.initial.set(decl[1].toLowerCase(), value);
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

  /** Parses For, For Each, While, Do and Select Case blocks starting at `i`; null if the line starts none of them. */
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
    if ((m = /^(exit|continue)\s+(for|do|while|select)$/i.exec(text))) {
      const kind = m[2].toLowerCase() as LoopKind;
      return /^exit$/i.test(m[1]) ? { k: 'exitloop', kind } : { k: 'continue', kind };
    }
    if (/^on\s+error\b/i.test(text)) return { k: 'expr', expr: { k: 'lit', v: null } };
    if ((m = /^(?:dim|static)\s+(\w+)(?:\s*\(\s*\))?(?:\s+as\s+(?:new\s+)?[\w.]+(?:\(\))?)?(?:\s*=\s*(.+))?$/i.exec(text))) {
      return { k: 'dim', name: m[1].toLowerCase(), expr: m[2] ? this.expr(m[2], line) : null };
    }
    if (/^(for|while|do|select|loop|next|wend|try|catch|with)\b/i.test(text)) return { k: 'unsupported', text };
    if ((m = /^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=|&=)\s*(.+)$/.exec(text))) return { k: 'assign', name: m[1].toLowerCase(), op: m[2], expr: this.expr(m[3], line) };
    if ((m = /^call\s+(.+)$/i.exec(text))) return { k: 'expr', expr: this.expr(m[1], line) };
    return { k: 'expr', expr: this.expr(text, line) };
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
    if (this.depth > 50) throw new Error(l10n.t('Code.{0}: recursion too deep', name));
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
      if (++this.steps > 100000) throw new Error(l10n.t('Code: too many statements (endless loop?)'));
      switch (s.k) {
        case 'if': {
          const branch = s.branches.find(b => b.cond === null || toBool(evalNode(b.cond, ctx)));
          if (branch) this.run(branch.body, locals, ctx);
          break;
        }
        case 'return': throw new ReturnSignal(s.expr ? evalNode(s.expr, ctx) : null);
        case 'exit': throw new ExitSignal();
        case 'dim': locals.set(s.name, s.expr ? evalNode(s.expr, ctx) : null); break;
        case 'expr': evalNode(s.expr, ctx); break;
        case 'unsupported': throw new Error(l10n.t('Code: unsupported statement "{0}"', s.text));
        case 'assign': {
          let value = evalNode(s.expr, ctx);
          if (s.op !== '=') {
            const cur = locals.has(s.name) ? locals.get(s.name) : this.get(s.name);
            value = evalNode({ k: 'bin', op: s.op[0], a: { k: 'lit', v: cur }, b: { k: 'lit', v: value } }, ctx);
          }
          this.assign(s.name, value, locals);
          break;
        }
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

  /** Runs one loop iteration; false when the loop is left with Exit. */
  private iterate(kind: LoopKind, body: Stmt[], locals: Map<string, unknown>, ctx: EvalContext): boolean {
    if (++this.steps > 100000) throw new Error(l10n.t('Code: too many statements (endless loop?)'));
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
