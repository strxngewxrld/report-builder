import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as RKeyboardEvent } from 'react';
import { useEditor } from '../editor';
import { allReportItems } from '../model';
import { CodeModule } from '../vb';
import { Codicon } from './Icon';
import { globals } from './ReportDataPane';
import { l10n } from '../l10n';

interface Suggestion { label: string; insert: string; detail?: string; icon: string }

/** Functions offered by the completion, with their (translated) signature. */
const functions = (): [string, string][] => [
  ['IIf', l10n.t('IIf(Condition, TrueValue, FalseValue)')],
  ['Switch', l10n.t('Switch(Condition1, Value1, …)')],
  ['Choose', l10n.t('Choose(Index, Value1, …)')],
  ['Format', l10n.t('Format(Value, "N2")')],
  ['FormatNumber', l10n.t('FormatNumber(Value, Digits)')],
  ['FormatCurrency', l10n.t('FormatCurrency(Value)')],
  ['FormatPercent', l10n.t('FormatPercent(Value, Digits)')],
  ['FormatDateTime', l10n.t('FormatDateTime(Date, Format)')],
  ['Sum', l10n.t('Sum(Expression, Scope)')],
  ['Count', l10n.t('Count(Expression, Scope)')],
  ['CountDistinct', l10n.t('CountDistinct(Expression)')],
  ['Avg', l10n.t('Avg(Expression)')],
  ['Min', l10n.t('Min(Expression)')],
  ['Max', l10n.t('Max(Expression)')],
  ['First', l10n.t('First(Expression, Scope)')],
  ['Last', l10n.t('Last(Expression, Scope)')],
  ['RunningValue', l10n.t('RunningValue(Expression, Sum, Scope)')],
  ['Previous', l10n.t('Previous(Expression)')],
  ['RowNumber', l10n.t('RowNumber(Scope)')],
  ['UCase', l10n.t('UCase(Text)')],
  ['LCase', l10n.t('LCase(Text)')],
  ['Trim', l10n.t('Trim(Text)')],
  ['Len', l10n.t('Len(Text)')],
  ['Left', l10n.t('Left(Text, n)')],
  ['Right', l10n.t('Right(Text, n)')],
  ['Mid', l10n.t('Mid(Text, Start, n)')],
  ['InStr', l10n.t('InStr(Text, Search)')],
  ['Replace', l10n.t('Replace(Text, Old, New)')],
  ['CStr', l10n.t('CStr(Value)')],
  ['CInt', l10n.t('CInt(Value)')],
  ['CDbl', l10n.t('CDbl(Value)')],
  ['CDec', l10n.t('CDec(Value)')],
  ['CDate', l10n.t('CDate(Value)')],
  ['CBool', l10n.t('CBool(Value)')],
  ['IsNothing', l10n.t('IsNothing(Value)')],
  ['Year', l10n.t('Year(Date)')],
  ['Month', l10n.t('Month(Date)')],
  ['Day', l10n.t('Day(Date)')],
  ['DateAdd', l10n.t('DateAdd("d", n, Date)')],
  ['DateDiff', l10n.t('DateDiff("d", From, To)')],
  ['Now', 'Now()'], ['Today', 'Today()'],
];
const prefixes = (): [string, string][] => [
  ['Fields!', l10n.t('Field of the dataset')], ['Parameters!', l10n.t('Parameter, label or caption')], ['ReportItems!', l10n.t('Value of a report item')],
  ['Globals!', l10n.t('Built-in field')], ['User!', l10n.t('User')], ['Code.', l10n.t('Function of the code block')],
];

/** What can follow the text before the caret, and the partial word typed so far. */
function context(before: string): { kind: string; partial: string } | null {
  const m = /\b(Fields|Parameters|ReportItems|Globals|User)!(\w*)$/i.exec(before) ?? /\b(Code)\.(\w*)$/i.exec(before);
  if (m) return { kind: m[1].toLowerCase(), partial: m[2] };
  const word = /(?:^=\s*|[=(,+\-*/&<>\s])([A-Za-z]\w*)$/.exec(before);
  return before.startsWith('=') && word ? { kind: 'word', partial: word[1] } : null;
}

/** Suggestions from the report: dataset fields (with their AL column source in BC), parameters, items, code functions. */
function useSuggestions(dataSetName?: string) {
  const ed = useEditor();
  return useMemo(() => {
    const r = ed.report;
    const alColumns = new Map<string, string>();
    const walk = (items: NonNullable<typeof ed.bc>['dataItems']) => items.forEach(d => {
      d.columns.forEach(c => alColumns.set(c.name, `${d.name} · ${c.source}`));
      walk(d.children);
    });
    walk(ed.bc?.dataItems ?? []);
    const labels = new Map([...(ed.bc?.labels ?? []).map(l => [l.name, l10n.t('Label "{0}"', l.text)] as const), ...(ed.bc?.captions ?? []).map(c => [c.name, l10n.t('Caption "{0}"', c.text)] as const)]);
    const dataSets = r.dataSets.filter(d => !dataSetName || d.name === dataSetName);
    const fields = [...new Map(dataSets.flatMap(d => d.fields.map(f => [f.name, f] as const))).values()];
    let code: string[] = [];
    const block = r.extraXml.find(x => x.startsWith('<Code'));
    const text = block && /<Code>([\s\S]*)<\/Code>/.exec(block)?.[1];
    if (text) {
      try { code = new CodeModule(text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).functionNames; } catch { /* reported by the linter */ }
    }
    const byKind: Record<string, Suggestion[]> = {
      fields: fields.map(f => ({ label: f.name, insert: `${f.name}.Value`, icon: f.value ? 'symbol-operator' : 'symbol-field',
        detail: alColumns.get(f.name) ?? (f.name.endsWith('Format') && fields.some(x => x.name === f.name.slice(0, -6)) ? l10n.t('Number format from Business Central') : f.typeName.replace('System.', '')) })),
      parameters: r.parameters.map(p => ({ label: p.name, insert: `${p.name}.Value`, icon: 'symbol-key', detail: labels.get(p.name) ?? p.dataType })),
      reportitems: allReportItems(r).filter(i => i.type === 'textbox').map(i => ({ label: i.name, insert: `${i.name}.Value`, icon: 'symbol-text' })),
      globals: [...globals().map(([g, l]) => ({ label: g, insert: g, icon: 'symbol-constant', detail: l })),
        { label: 'OverallPageNumber', insert: 'OverallPageNumber', icon: 'symbol-constant' }, { label: 'OverallTotalPages', insert: 'OverallTotalPages', icon: 'symbol-constant' }],
      user: [{ label: 'UserID', insert: 'UserID', icon: 'person' }, { label: 'Language', insert: 'Language', icon: 'globe' }],
      code: code.map(f => ({ label: f, insert: `${f}(`, icon: 'symbol-method', detail: l10n.t('Code block') })),
      word: [
        ...prefixes().map(([p, d]) => ({ label: p, insert: p, icon: 'symbol-namespace', detail: d })),
        ...functions().map(([f, sig]) => ({ label: f, insert: `${f}(`, icon: 'symbol-function', detail: sig })),
        ...['Nothing', 'True', 'False', 'And', 'Or', 'Not', 'AndAlso', 'OrElse'].map(k => ({ label: k, insert: k, icon: 'symbol-keyword' })),
      ],
    };
    return byKind;
  }, [ed.report, ed.bc, dataSetName]);
}

/** Pixel position of the caret in a textarea/input (mirror element with the same text metrics). */
function caretPosition(el: HTMLTextAreaElement | HTMLInputElement) {
  const style = getComputedStyle(el);
  const mirror = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingLeft', 'paddingRight', 'borderTopWidth', 'borderLeftWidth', 'boxSizing', 'width', 'tabSize'] as const) {
    (mirror.style as unknown as Record<string, string>)[p] = style[p] as string;
  }
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', whiteSpace: el.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre', overflowWrap: 'break-word', top: '0', left: '0' });
  mirror.textContent = el.value.slice(0, el.selectionStart ?? 0);
  const mark = document.createElement('span');
  mark.textContent = '​';
  mirror.appendChild(mark);
  document.body.appendChild(mirror);
  const rect = el.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
  const pos = { left: rect.left + mark.offsetLeft - el.scrollLeft, top: rect.top + mark.offsetTop - el.scrollTop + lineHeight };
  mirror.remove();
  return pos;
}

type Props = {
  value: string; onChange: (v: string) => void; onKeyDown?: (e: RKeyboardEvent) => void; onBlur?: () => void;
  multiline?: boolean; rows?: number; className?: string; placeholder?: string; readOnly?: boolean; title?: string; autoFocus?: boolean;
  dataSetName?: string; inputRef?: (el: HTMLTextAreaElement | HTMLInputElement | null) => void;
};

/**
 * Text field for RDL expressions with completion like VS Code's suggest widget: after Fields!, Parameters!,
 * ReportItems!, Globals!, User! and Code., and for functions/keywords (Ctrl+Space shows all).
 */
export function ExpressionInput(props: Props) {
  const all = useSuggestions(props.dataSetName);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [state, setState] = useState<{ items: Suggestion[]; partial: string; index: number; pos: { left: number; top: number } } | null>(null);
  const caretAfter = useRef<number | null>(null);
  /** Set while typing: suggestions are computed once the new value is rendered. */
  const typed = useRef(false);

  const update = (forced = false) => {
    const el = ref.current;
    if (!el || el.selectionStart !== el.selectionEnd) { setState(null); return; }
    const ctx = context(el.value.slice(0, el.selectionStart ?? 0));
    if (!ctx || (ctx.kind === 'word' && !forced && ctx.partial.length < 2)) { setState(null); return; }
    const p = ctx.partial.toLowerCase();
    const items = (all[ctx.kind] ?? []).filter(s => s.label.toLowerCase().startsWith(p) && s.label.toLowerCase() !== p)
      .concat((all[ctx.kind] ?? []).filter(s => !s.label.toLowerCase().startsWith(p) && s.label.toLowerCase().includes(p) && p.length > 1));
    setState(items.length ? { items: items.slice(0, 50), partial: ctx.partial, index: 0, pos: caretPosition(el) } : null);
  };

  const accept = (s: Suggestion) => {
    const el = ref.current!;
    const start = (el.selectionStart ?? 0) - (state?.partial.length ?? 0);
    const next = el.value.slice(0, start) + s.insert + el.value.slice(el.selectionEnd ?? 0);
    caretAfter.current = start + s.insert.length;
    props.onChange(next);
    setState(null);
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caretAfter.current !== null) {
      el.selectionStart = el.selectionEnd = caretAfter.current;
      caretAfter.current = null;
      // after "Fields!" etc. continue with the next list
      if (/[!.]$/.test(el.value.slice(0, el.selectionStart))) update();
    }
  });
  useLayoutEffect(() => {
    if (!typed.current) return;
    typed.current = false;
    update();
  }, [props.value]);
  useEffect(() => { if (state) document.querySelector('.suggest .focused')?.scrollIntoView({ block: 'nearest' }); }, [state?.index]);

  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === ' ' && e.ctrlKey) { e.preventDefault(); update(true); return; }
    if (state) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = state.items.length;
        setState({ ...state, index: (state.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(state.items[state.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setState(null); return; }
    }
    props.onKeyDown?.(e);
  };

  const common = {
    ref: (el: HTMLTextAreaElement | HTMLInputElement | null) => { ref.current = el; props.inputRef?.(el); },
    value: props.value, className: props.className, placeholder: props.placeholder, readOnly: props.readOnly, title: props.title,
    autoFocus: props.autoFocus, spellCheck: false, onKeyDown,
    onChange: (e: { target: { value: string } }) => { typed.current = true; props.onChange(e.target.value); },
    onBlur: () => { setState(null); props.onBlur?.(); },
    onClick: () => setState(null),
    'aria-autocomplete': 'list' as const, 'aria-expanded': !!state,
  };
  return (
    <>
      {props.multiline
        ? <textarea {...common} ref={common.ref as (el: HTMLTextAreaElement | null) => void} rows={props.rows ?? 2} />
        : <input {...common} ref={common.ref as (el: HTMLInputElement | null) => void} />}
      {state && (
        <div className="suggest" role="listbox" style={{ left: Math.min(state.pos.left, window.innerWidth - 420), top: state.pos.top + 2 }}>
          {state.items.map((s, i) => (
            <div key={s.label} role="option" aria-selected={i === state.index} className={`suggest-item ${i === state.index ? 'focused' : ''}`}
              onMouseDown={e => { e.preventDefault(); accept(s); }}>
              <Codicon name={s.icon} className={`suggest-icon icon-${s.icon}`} />
              <Highlighted label={s.label} match={state.partial} />
              {s.detail && <span className="suggest-detail">{s.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Label with the typed part highlighted where it matches (prefix or inside the word). */
function Highlighted({ label, match }: { label: string; match: string }) {
  const at = match ? label.toLowerCase().indexOf(match.toLowerCase()) : -1;
  if (at < 0) return <span className="suggest-label">{label}</span>;
  return <span className="suggest-label">{label.slice(0, at)}<b>{label.slice(at, at + match.length)}</b>{label.slice(at + match.length)}</span>;
}
