// Builds the AL context of a layout (for the designer) from parsed AL reports and the layout's own dataset.
import { BcContext, BcDataItem, captionFromSource } from '../../webview/bc';
import { AlDataItem, AlReport, expectedDataset } from './parser';

/** Data items of a report, with a report extension's additions merged into its base report's tree. */
export function mergedDataItems(rep: AlReport, base?: AlReport): AlDataItem[] {
  const items: AlDataItem[] = structuredClone(base?.dataItems ?? rep.dataItems);
  if (rep.kind !== 'reportextension') return items;
  const find = (list: AlDataItem[], name: string): AlDataItem | undefined => {
    for (const d of list) {
      if (d.name.toLowerCase() === name.toLowerCase()) return d;
      const hit = find(d.children, name);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const a of rep.additions) {
    const target = find(items, a.target);
    if (target) {
      target.columns.push(...a.columns);
      target.children.push(...a.dataItems);
    } else {
      items.push(...a.dataItems);
      if (a.columns.length) items.push({ name: a.target, table: '', pos: { line: 0, character: 0 }, columns: a.columns, children: [] });
    }
  }
  return items;
}

export function buildBcContext(
  rep: AlReport, base: AlReport | undefined, layout: { fields: string[]; parameters: string[] }, alUri: string, alFile: string,
): BcContext {
  const expected = expectedDataset(rep, base);
  const fields = new Set(layout.fields);
  const params = new Set(layout.parameters);
  const toBc = (d: AlDataItem): BcDataItem => ({
    name: d.name, table: d.table, line: d.pos.line, character: d.pos.character,
    columns: d.columns.map(c => ({ name: c.name, source: c.source, includeCaption: c.includeCaption, inLayout: fields.has(c.name), line: c.pos.line, character: c.pos.character })),
    children: d.children.map(toBc),
  });
  const expectedFields = new Set(expected.fields);
  const expectedParams = new Set(expected.parameters);
  return {
    reportName: rep.name,
    kind: rep.kind,
    id: rep.id,
    alFile,
    alUri,
    line: rep.pos.line,
    character: rep.pos.character,
    dataItems: mergedDataItems(rep, base).map(toBc),
    labels: expected.labels.map(l => ({ name: l.name, text: l.text, inLayout: params.has(l.name), line: l.pos.line, character: l.pos.character })),
    captions: expected.columns.filter(c => c.includeCaption).map(c => ({
      name: `${c.name}Caption`, column: c.name, text: captionFromSource(c.source), inLayout: params.has(`${c.name}Caption`),
    })),
    complete: expected.complete,
    missingInLayout: [...expected.fields.filter(f => !fields.has(f)), ...expected.parameters.filter(p => !params.has(p))],
    removedInAl: expected.complete
      ? [
        ...layout.fields.filter(f => !expectedFields.has(f) && !(f.endsWith('Format') && expectedFields.has(f.slice(0, -6)))),
        ...layout.parameters.filter(p => !expectedParams.has(p)),
      ]
      : [],
  };
}
