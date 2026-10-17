// Text edits on a layout made in the extension host, so they can go into one WorkspaceEdit with AL edits (one undo
// step across both files). Source-preserving: only the value concerned changes.

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Replaces the value of a textbox with a single text run. Returns the offsets and the new <Value> element, or null
 * when there is no such textbox (unknown name, several runs or paragraphs).
 */
export function textboxValueEdit(xml: string, name: string, value: string): { start: number; end: number; text: string } | null {
  const attr = name.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const open = new RegExp(`<Textbox\\s[^>]*\\bName="${escRe(attr)}"[^>]*>`).exec(xml);
  if (!open) return null;
  const close = xml.indexOf('</Textbox>', open.index);
  if (close < 0) return null;
  const body = xml.slice(open.index, close);
  if ((body.match(/<Paragraph[\s>]/g) ?? []).length !== 1 || (body.match(/<TextRun[\s>]/g) ?? []).length !== 1) return null;
  const run = body.indexOf('<TextRun');
  const v = /<Value(\s[^>]*?)?(?:\s*\/>|>[\s\S]*?<\/Value>)/.exec(body.slice(run));
  if (!v) return null;
  // EvaluationMode="Constant" would show the expression as text
  const attrs = (v[1] ?? '').replace(/\s*EvaluationMode="[^"]*"/, '');
  const start = open.index + run + v.index;
  return { start, end: start + v[0].length, text: `<Value${attrs}>${escText(value)}</Value>` };
}
