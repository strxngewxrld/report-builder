// The <Code> block of an RDL layout as text (decoded) and written back. Pure.

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encodeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The <Code> block of a layout text, and the layout text with a new one. */
export function readCodeBlock(layout: string): string {
  const m = /<Code>([\s\S]*?)<\/Code>|<Code\s*\/>/.exec(layout);
  return m?.[1] ? decodeXml(m[1]) : '';
}
export function writeCodeBlock(layout: string, code: string): string {
  const element = code.trim() ? `<Code>${encodeXml(code)}</Code>` : '';
  if (/<Code>[\s\S]*?<\/Code>|<Code\s*\/>/.test(layout)) return layout.replace(/<Code>[\s\S]*?<\/Code>|<Code\s*\/>/, () => element);
  if (!element) return layout;
  // before the elements that follow <Code> in Business Central layouts, else at the end of <Report>
  const next = /\n?([ \t]*)<(?:CodeModules|Language|ConsumeContainerWhitespace|rd:ReportUnitType|rd:ReportID)\b/.exec(layout);
  if (next) return layout.slice(0, next.index) + `\n${next[1]}${element}` + layout.slice(next.index);
  return layout.replace(/\n?<\/Report>\s*$/, m => `\n  ${element}${m}`);
}
