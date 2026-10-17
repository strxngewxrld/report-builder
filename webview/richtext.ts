// Textboxes with several differently formatted parts ("rich text": paragraphs of text runs, e.g. "Page " + bold
// page number). They stay verbatim XML in the model; edits patch exactly the run or paragraph concerned.

import { NS_RD, XmlDom, browserDom, child, elements, normalizeFragment, text } from './rdl';

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
