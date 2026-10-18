// Locate expression text in the serialized report, including preserved XML. Edits splice only the affected
// text nodes, so unrelated markup, namespaces, whitespace, comments and literal values stay untouched.
import { XmlDom, browserDom } from './rdl';

export interface ExpressionLocation {
  id: number; start: number; end: number; value: string; property: string; path: string; item?: string; cdata?: boolean;
}
const ITEM = new Set(['Textbox', 'Rectangle', 'Tablix', 'Image', 'Line', 'Chart', 'GaugePanel', 'Subreport', 'Map']);
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function expressionsIn(xml: string, dom: XmlDom = browserDom): ExpressionLocation[] {
  const stack: { tag: string; name?: string; item?: string; constant: boolean }[] = [];
  const out: ExpressionLocation[] = [];
  // Tokenize markup first: comments, declarations and CDATA must never masquerade as report properties.
  const tokens = /<!--[\s\S]*?-->|<\?[^]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>|[^<]+/g;
  for (const m of xml.matchAll(tokens)) {
    const t = m[0];
    const cdata = t.startsWith('<![CDATA[');
    if (t.startsWith('<!--') || t.startsWith('<?') || (t.startsWith('<!') && !cdata)) continue;
    if (t.startsWith('</')) { stack.pop(); continue; }
    if (t.startsWith('<') && !cdata) {
      const tag = (/^<([^\s/>]+)/.exec(t)?.[1] ?? '').split(':').pop()!;
      const name = /\bName\s*=\s*(["'])(.*?)\1/.exec(t)?.[2];
      if (!t.endsWith('/>')) stack.push({ tag, name, item: ITEM.has(tag) ? name : undefined, constant: /\bEvaluationMode\s*=\s*(["'])Constant\1/.test(t) });
      continue;
    }
    const parent = stack.at(-1);
    const raw = cdata ? t.slice(9, -3) : t;
    if (!parent || parent.constant || !/^\s*=/.test(raw)) continue;
    // A text node, never a Code block or a SQL query that happens to start with '='.
    if (stack.some(s => s.tag === 'Code' || s.tag === 'CommandText')) continue;
    const value = cdata ? raw : dom.parse(`<v>${t}</v>`).documentElement.textContent ?? '';
    out.push({ id: out.length, start: m.index! + (cdata ? 9 : 0), end: m.index! + t.length - (cdata ? 3 : 0), value, cdata,
      property: parent.tag, path: stack.map(s => s.name ? `${s.tag}[${s.name}]` : s.tag).join(' / '),
      item: [...stack].reverse().find(s => s.item)?.item });
  }
  return out;
}

export function replaceLiteral(value: string, search: string, replacement: string, matchCase = false): string {
  if (!search) return value;
  const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(escaped, matchCase ? 'g' : 'gi'), () => replacement);
}

export function patchExpressions(xml: string, changes: { location: ExpressionLocation; value: string }[]): string {
  for (const { location, value } of [...changes].sort((a, b) => b.location.start - a.location.start)) {
    xml = xml.slice(0, location.start) + (location.cdata ? value.replace(/\]\]>/g, ']]]]><![CDATA[>') : encode(value)) + xml.slice(location.end);
  }
  return xml;
}

/** Literal strings do not count as references. Collection access with a quoted key does. */
export function expressionReferences(value: string): { kind: 'Fields' | 'Parameters'; name: string }[] {
  const out: { kind: 'Fields' | 'Parameters'; name: string }[] = [];
  const token = /"(?:[^"]|"")*"|\b(Fields|Parameters)\s*(?:!\s*([A-Za-z_]\w*)|\(\s*"((?:[^"]|"")*)"\s*\))/gi;
  for (const m of value.matchAll(token)) if (m[1]) out.push({ kind: m[1].toLowerCase() === 'fields' ? 'Fields' : 'Parameters', name: (m[2] ?? m[3]).replace(/""/g, '"') });
  return out;
}

export function renameParameterReference(value: string, from: string, to: string): string {
  return value.replace(/"(?:[^"]|"")*"|\bParameters\s*(?:!\s*([A-Za-z_]\w*)|\(\s*"((?:[^"]|"")*)"\s*\))/gi, (whole, bang: string, key: string) => {
    const name = bang ?? key?.replace(/""/g, '"');
    if (name?.toLowerCase() !== from.toLowerCase()) return whole;
    return bang ? `Parameters!${to}` : `Parameters("${to}")`;
  });
}
