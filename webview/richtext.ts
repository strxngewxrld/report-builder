// Textboxes with several differently formatted parts ("rich text": paragraphs of text runs, e.g. "Page " + bold
// page number). They stay verbatim XML in the model; edits patch exactly the run or paragraph concerned.

import { RawItem, Report, ReportItem } from './model';
import { locate, replaceItem } from './ops';
import { NS_RD, XmlDom, browserDom, child, elements, normalizeFragment, text, textboxFromXml, textboxText, textboxXml } from './rdl';

export interface RichRun {
  value: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string;
  fontSize: string;
  format: string;
}
export interface RichParagraph { runs: RichRun[] }

export type RichEdit =
  | { kind: 'run'; p: number; r: number; patch: Partial<RichRun> }
  | { kind: 'addRun'; p: number; after: number }
  | { kind: 'removeRun'; p: number; r: number }
  | { kind: 'addParagraph'; after: number }
  | { kind: 'removeParagraph'; p: number };

function find(xml: string, name: string, dom: XmlDom) {
  const doc = dom.parse(`<w xmlns:rd="${NS_RD}">${xml}</w>`);
  const tb = Array.from(doc.getElementsByTagName('Textbox') as ArrayLike<Element>).find(t => t.getAttribute('Name') === name);
  return { doc, tb };
}

const paragraphsOf = (tb: Element) => elements(child(tb, 'Paragraphs'), 'Paragraph');
const runsOf = (p: Element) => elements(child(p, 'TextRuns'), 'TextRun');

export function readRichText(xml: string, name: string, dom: XmlDom = browserDom): RichParagraph[] | null {
  const { tb } = find(xml, name, dom);
  if (!tb) return null;
  return paragraphsOf(tb).map(p => ({
    runs: runsOf(p).map(r => {
      const s = child(r, 'Style');
      return {
        value: text(r, 'Value') ?? '',
        bold: /^(bold|semibold|extrabold|heavy)$/i.test(text(s, 'FontWeight') ?? ''),
        italic: (text(s, 'FontStyle') ?? '').toLowerCase() === 'italic',
        underline: (text(s, 'TextDecoration') ?? '').toLowerCase() === 'underline',
        color: text(s, 'Color') ?? '',
        fontSize: text(s, 'FontSize') ?? '',
        format: text(s, 'Format') ?? '',
      };
    }),
  }));
}

function setChild(doc: Document, parent: Element, tag: string, value: string) {
  const existing = elements(parent, tag)[0];
  if (value === '') { existing?.parentNode?.removeChild(existing); return; }
  const el = existing ?? parent.appendChild(doc.createElementNS(parent.namespaceURI, tag));
  el.textContent = value;
}
const ensure = (doc: Document, parent: Element, tag: string): Element =>
  elements(parent, tag)[0] ?? parent.appendChild(doc.createElementNS(parent.namespaceURI, tag));

/** Inserts a copy of `node` after it (same formatting); returns the copy. */
function cloneAfter(node: Element): Element {
  const copy = node.cloneNode(true) as Element;
  node.parentNode!.insertBefore(copy, node.nextSibling);
  return copy;
}

/** Returns the XML with the edit applied; everything not concerned stays as it was. */
export function editRichText(xml: string, name: string, edit: RichEdit, dom: XmlDom = browserDom): string {
  const { doc, tb } = find(xml, name, dom);
  if (!tb) return xml;
  const paras = paragraphsOf(tb);
  switch (edit.kind) {
    case 'run': {
      const run = runsOf(paras[edit.p] ?? paras[0])[edit.r];
      if (!run) return xml;
      const { patch } = edit;
      if (patch.value !== undefined) setChild(doc, run, 'Value', patch.value);
      const styled = (['bold', 'italic', 'underline', 'color', 'fontSize', 'format'] as const).some(k => patch[k] !== undefined);
      if (styled) {
        const style = ensure(doc, run, 'Style');
        if (patch.bold !== undefined) setChild(doc, style, 'FontWeight', patch.bold ? 'Bold' : '');
        if (patch.italic !== undefined) setChild(doc, style, 'FontStyle', patch.italic ? 'Italic' : '');
        if (patch.underline !== undefined) setChild(doc, style, 'TextDecoration', patch.underline ? 'Underline' : '');
        if (patch.color !== undefined) setChild(doc, style, 'Color', patch.color);
        if (patch.fontSize !== undefined) setChild(doc, style, 'FontSize', patch.fontSize);
        if (patch.format !== undefined) setChild(doc, style, 'Format', patch.format);
      }
      break;
    }
    case 'addRun': {
      const run = runsOf(paras[edit.p])[edit.after];
      if (!run) return xml;
      const copy = cloneAfter(run);
      setChild(doc, copy, 'Value', '');
      const label = elements(copy, 'Label')[0];
      label?.parentNode?.removeChild(label);
      break;
    }
    case 'removeRun': {
      const runs = runsOf(paras[edit.p]);
      if (runs.length <= 1 || !runs[edit.r]) return xml;
      runs[edit.r].parentNode!.removeChild(runs[edit.r]);
      break;
    }
    case 'addParagraph': {
      const para = paras[edit.after];
      if (!para) return xml;
      const copy = cloneAfter(para);
      // one empty run in the new paragraph
      runsOf(copy).slice(1).forEach(r => r.parentNode!.removeChild(r));
      const run = runsOf(copy)[0];
      if (run) setChild(doc, run, 'Value', '');
      break;
    }
    case 'removeParagraph': {
      if (paras.length <= 1 || !paras[edit.p]) return xml;
      paras[edit.p].parentNode!.removeChild(paras[edit.p]);
      break;
    }
  }
  return normalizeFragment(dom.serialize(elements(doc.documentElement)[0]));
}

// ------------------------------------------------------------------------------------------------ conversion

/** Splits at `sep` outside of strings and parentheses. */
function splitTop(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, inStr = false, cur = '';
  for (const ch of text) {
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === '(') depth++;
    else if (!inStr && ch === ')') depth--;
    else if (!inStr && depth === 0 && ch === sep) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Removes parentheses around the whole expression: "(a & b)" → "a & b". */
function unwrap(e: string): string {
  if (!e.startsWith('(') || !e.endsWith(')')) return e;
  let depth = 0, inStr = false;
  for (let i = 0; i < e.length; i++) {
    const ch = e[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === '(') depth++;
    else if (!inStr && ch === ')' && --depth === 0 && i < e.length - 1) return e;
  }
  return unwrap(e.slice(1, -1).trim());
}

/**
 * The parts of a textbox value as paragraphs of text runs: literal text by line; an expression concatenated with `&`
 * becomes one run per part – string literals as text, everything else as `=expression`, vbCrLf starts a paragraph.
 * (The inverse of `joinRuns`.)
 */
export function splitRuns(value: string, constant = false): string[][] {
  if (constant || !value.startsWith('=')) return value.split('\n').map(line => [line]);
  const paragraphs: string[][] = [[]];
  for (const raw of splitTop(value.slice(1), '&')) {
    const part = raw.trim();
    if (/^(vbCrLf|vbNewLine|Environment\.NewLine)$/i.test(part)) { paragraphs.push([]); continue; }
    const literal = /^"((?:[^"]|"")*)"$/.exec(part);
    paragraphs[paragraphs.length - 1].push(literal && !literal[1].startsWith('=') ? literal[1].replace(/""/g, '"') : `=${unwrap(part)}`);
  }
  return paragraphs.map(p => (p.length ? p : ['']));
}

const cellFields = (from: ReportItem, to: ReportItem) => {
  for (const k of ['colSpan', 'cellExtra', 'contentsExtra', 'contentsOrder'] as const) {
    if (from[k] !== undefined) (to as unknown as Record<string, unknown>)[k] = from[k];
  }
};

/**
 * Turns a textbox into one with text parts (rich text) – "Seite " & Globals!PageNumber becomes two runs that can be
 * formatted separately. Formatting is copied to every part. Returns false if the item is no editable textbox.
 */
export function toRichText(r: Report, name: string, dom: XmlDom = browserDom): boolean {
  const loc = locate(r, name);
  if (!loc || loc.item.type !== 'textbox') return false;
  const tb = loc.item;
  const positioned = !!loc.container;
  const constant = (tb.valueAttrs ?? []).some(([k, v]) => k === 'EvaluationMode' && v === 'Constant');
  const paragraphs = splitRuns(tb.value, constant);
  let xml = textboxXml(r, { ...tb, value: paragraphs[0][0] }, positioned, dom);
  paragraphs.forEach((runs, p) => {
    if (p > 0) xml = editRichText(xml, name, { kind: 'addParagraph', after: p - 1 }, dom);
    runs.forEach((value, i) => {
      if (i > 0) xml = editRichText(xml, name, { kind: 'addRun', p, after: i - 1 }, dom);
      xml = editRichText(xml, name, { kind: 'run', p, r: i, patch: { value } }, dom);
    });
  });
  const next = textboxFromXml(xml, positioned, dom, true);
  cellFields(tb, next);
  return replaceItem(loc, next);
}

/**
 * Turns a textbox with text parts into a simple textbox: the parts are joined into one value (an `&` expression if
 * needed) and take the formatting of the first part. Returns false if the item is not such a textbox.
 */
export function toSimpleText(r: Report, name: string, dom: XmlDom = browserDom): boolean {
  const loc = locate(r, name);
  const raw = loc?.item;
  if (!loc || raw?.type !== 'raw' || raw.kind !== 'Textbox') return false;
  const { doc, tb } = find(raw.xml, name, dom);
  if (!tb) return false;
  const value = textboxText(tb);
  const paras = paragraphsOf(tb);
  paras.slice(1).forEach(p => p.parentNode!.removeChild(p));
  const runs = paras[0] ? runsOf(paras[0]) : [];
  if (!runs.length) return false;
  runs.slice(1).forEach(run => run.parentNode!.removeChild(run));
  setChild(doc, runs[0], 'Value', value);
  // the joined value is an expression: the first part's EvaluationMode="Constant" would make it literal text
  const valueEl = elements(runs[0], 'Value')[0];
  if (value.startsWith('=')) valueEl?.removeAttribute('EvaluationMode');
  const next = textboxFromXml(normalizeFragment(dom.serialize(tb)), !!loc.container, dom);
  if (next.type !== 'textbox') return false;
  cellFields(raw, next);
  return replaceItem(loc, next);
}

/** Whether toSimpleText loses formatting: the parts are formatted differently. */
export function partsDiffer(item: RawItem, dom: XmlDom = browserDom): boolean {
  const paragraphs = readRichText(item.xml, item.name, dom) ?? [];
  const styles = paragraphs.flatMap(p => p.runs.map(({ value: _, ...style }) => JSON.stringify(style)));
  return new Set(styles).size > 1;
}

