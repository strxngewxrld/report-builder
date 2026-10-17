// Editing textboxes inside regions the designer keeps verbatim (grouped Tablix, charts' surroundings, …):
// the raw XML of the region is patched in place, so everything else in it stays byte-identical.

import { NS_RD, XmlDom, browserDom, child, elements, normalizeFragment, text } from './rdl';

export interface NestedTextbox {
  value: string;
  format: string;
  bold: boolean;
  italic: boolean;
  color: string;
  /** Visibility/Hidden ('' = always visible). */
  hidden: string;
  /** Only textboxes with a single text run can have their value edited here. */
  editableValue: boolean;
}

function find(xml: string, name: string, dom: XmlDom) {
  const doc = dom.parse(`<w xmlns:rd="${NS_RD}">${xml}</w>`);
  const all = Array.from(doc.getElementsByTagName('Textbox') as ArrayLike<Element>);
  return { doc, tb: all.find(t => t.getAttribute('Name') === name) };
}

const runsOf = (tb: Element) => elements(child(tb, 'Paragraphs'), 'Paragraph').flatMap(p => elements(child(p, 'TextRuns'), 'TextRun'));

export function readNestedTextbox(xml: string, name: string, dom: XmlDom = browserDom): NestedTextbox | null {
  const { tb } = find(xml, name, dom);
  if (!tb) return null;
  const runs = runsOf(tb);
  const style = child(runs[0], 'Style');
  return {
    value: runs.length === 1 ? text(runs[0], 'Value') ?? '' : '',
    format: text(style, 'Format') ?? '',
    bold: (text(style, 'FontWeight') ?? '').toLowerCase() === 'bold',
    italic: (text(style, 'FontStyle') ?? '').toLowerCase() === 'italic',
    color: text(style, 'Color') ?? '',
    hidden: text(tb, 'Visibility', 'Hidden') ?? '',
    editableValue: runs.length === 1,
  };
}

/** Sets (or removes, for '') a child element with text, appending it if missing. */
function setChild(doc: Document, parent: Element, tag: string, value: string) {
  const existing = elements(parent, tag)[0];
  if (value === '') { existing?.parentNode?.removeChild(existing); return; }
  const el = existing ?? parent.appendChild(doc.createElementNS(parent.namespaceURI, tag));
  el.textContent = value;
}

function ensure(doc: Document, parent: Element, tag: string): Element {
  return elements(parent, tag)[0] ?? parent.appendChild(doc.createElementNS(parent.namespaceURI, tag));
}

/** Returns the region's XML with the textbox changed; unchanged fields are left exactly as they were. */
export function patchNestedTextbox(xml: string, name: string, patch: Partial<NestedTextbox>, dom: XmlDom = browserDom): string {
  const { doc, tb } = find(xml, name, dom);
  if (!tb) return xml;
  const runs = runsOf(tb);
  if (patch.value !== undefined && runs.length === 1) setChild(doc, runs[0], 'Value', patch.value);
  // run formatting applies to all runs of the textbox
  for (const run of runs) {
    const style = (patch.format !== undefined || patch.bold !== undefined || patch.italic !== undefined || patch.color !== undefined) ? ensure(doc, run, 'Style') : null;
    if (!style) break;
    if (patch.format !== undefined) setChild(doc, style, 'Format', patch.format);
    if (patch.bold !== undefined) setChild(doc, style, 'FontWeight', patch.bold ? 'Bold' : '');
    if (patch.italic !== undefined) setChild(doc, style, 'FontStyle', patch.italic ? 'Italic' : '');
    if (patch.color !== undefined) setChild(doc, style, 'Color', patch.color);
  }
  if (patch.hidden !== undefined) {
    if (patch.hidden === '') {
      const vis = child(tb, 'Visibility');
      if (vis) {
        setChild(doc, vis, 'Hidden', '');
        if (!elements(vis).length) vis.parentNode?.removeChild(vis);
      }
    } else {
      setChild(doc, ensure(doc, tb, 'Visibility'), 'Hidden', patch.hidden);
    }
  }
  return normalizeFragment(dom.serialize(elements(doc.documentElement)[0]));
}
