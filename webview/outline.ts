// Document outline (as in the Visual Studio report designer): the full hierarchy of report items, including the
// contents of data regions the designer itself does not edit, such as grouped Tablix regions in Business Central layouts.
// It is built from the RDL XML so nothing the designer passes through verbatim is invisible.

import { XmlDom, child, elements, joinRuns, text } from './rdl';
import { l10n } from './l10n';

export type OutlineKind =
  | 'Section' | 'Rows' | 'Columns' | 'Group'
  | 'Textbox' | 'Rectangle' | 'Line' | 'Image' | 'Tablix' | 'Chart' | 'Subreport' | 'Map' | 'GaugePanel' | 'CustomReportItem'
  | 'List' | 'Table' | 'Matrix';

export interface OutlineNode {
  /** Unique key: "item:Name", "group:Name" or a synthetic key for sections and group lists. */
  key: string;
  kind: OutlineKind;
  name: string;
  /** Report item name, set for report items only (used to sync with the designer selection). */
  itemName?: string;
  /** Visibility/Hidden: "true" or an expression. */
  hidden?: string;
  /** Label/value pairs for the detail panel (value expression, dataset, grouping, position, …). */
  details: [string, string][];
  children: OutlineNode[];
}

const ITEM_TYPES = new Set<string>([
  'Textbox', 'Rectangle', 'Line', 'Image', 'Tablix', 'Chart', 'Subreport', 'Map', 'GaugePanel', 'CustomReportItem',
  'List', 'Table', 'Matrix',
]);

/** Report items anywhere below `el` (cell contents, rectangles, …) without descending into the items themselves. */
function itemsIn(el: Element | undefined, skip: string[] = []): OutlineNode[] {
  return elements(el).flatMap(c => {
    if (ITEM_TYPES.has(c.localName)) return [itemNode(c)];
    if (skip.includes(c.localName)) return [];
    return itemsIn(c);
  });
}

function textboxValue(el: Element): string {
  const paragraphs = elements(child(el, 'Paragraphs'), 'Paragraph');
  return joinRuns(paragraphs.map(p => elements(child(p, 'TextRuns'), 'TextRun').map(r => text(r, 'Value') ?? '')));
}

function itemNode(el: Element): OutlineNode {
  const kind = el.localName as OutlineKind;
  const name = el.getAttribute('Name') ?? '';
  const details: [string, string][] = [];
  const add = (label: string, value: string | undefined) => { if (value) details.push([label, value]); };

  if (kind === 'Textbox') add(l10n.t('Value'), textboxValue(el));
  if (kind === 'Image') add(l10n.t('Image'), `${text(el, 'Source') ?? ''}: ${text(el, 'Value') ?? ''}`);
  if (kind === 'Subreport') add(l10n.t('Subreport'), text(el, 'ReportName'));
  add(l10n.t('Dataset'), text(el, 'DataSetName'));
  const hidden = text(el, 'Visibility', 'Hidden');
  add(l10n.t('Hidden'), hidden);
  add(l10n.t('Toggled by'), text(el, 'Visibility', 'ToggleItem'));
  const pos = ['Left', 'Top', 'Width', 'Height'].map(k => text(el, k));
  if (pos.every(Boolean)) add(l10n.t('Position'), `${pos[0]}, ${pos[1]} – ${pos[2]} × ${pos[3]}`);

  let children: OutlineNode[];
  if (kind === 'Tablix') {
    const rows = memberNodes(child(el, 'TablixRowHierarchy', 'TablixMembers'));
    const cols = memberNodes(child(el, 'TablixColumnHierarchy', 'TablixMembers'));
    children = [
      ...(rows.length ? [{ key: `rows:${name}`, kind: 'Rows' as const, name: l10n.t('Row Groups'), details: [], children: rows }] : []),
      ...(cols.length ? [{ key: `cols:${name}`, kind: 'Columns' as const, name: l10n.t('Column Groups'), details: [], children: cols }] : []),
      // corner and body cells; header cells of the hierarchies are listed under their groups
      ...itemsIn(el, ['TablixRowHierarchy', 'TablixColumnHierarchy']),
    ];
  } else {
    children = itemsIn(el);
  }
  return { key: `item:${name}`, kind, name, itemName: name, hidden, details, children };
}

/**
 * Tablix members as a group tree. Static members are flattened into their parent so only real groups (incl. the
 * details group) form levels; their header cells appear under the group they belong to.
 */
function memberNodes(members: Element | undefined): OutlineNode[] {
  return elements(members, 'TablixMember').flatMap(m => {
    const inner = [...itemsIn(child(m, 'TablixHeader')), ...memberNodes(child(m, 'TablixMembers'))];
    const g = child(m, 'Group');
    if (!g) return inner;
    const name = g.getAttribute('Name') ?? '';
    const exprs = elements(child(g, 'GroupExpressions'), 'GroupExpression').map(e => e.textContent ?? '');
    const details: [string, string][] = [[l10n.t('Group by'), exprs.length ? exprs.join(', ') : l10n.t('(detail data)')]];
    const filters = elements(child(g, 'Filters'), 'Filter').map(f => `${text(f, 'FilterExpression')} ${text(f, 'Operator')} ${elements(child(f, 'FilterValues')).map(v => v.textContent).join(', ')}`);
    if (filters.length) details.push([l10n.t('Filter'), filters.join('; ')]);
    const sort = elements(child(m, 'SortExpressions'), 'SortExpression').map(s => `${text(s, 'Value')}${text(s, 'Direction') === 'Descending' ? ' ↓' : ''}`);
    if (sort.length) details.push([l10n.t('Sorting'), sort.join(', ')]);
    if (child(g, 'PageBreak')) details.push([l10n.t('Page break'), text(g, 'PageBreak', 'BreakLocation') ?? l10n.t('yes')]);
    const hidden = text(m, 'Visibility', 'Hidden');
    if (hidden) details.push([l10n.t('Hidden'), hidden]);
    return [{ key: `group:${name}`, kind: 'Group' as const, name, hidden, details, children: inner }];
  });
}

export function buildOutline(xml: string, dom: XmlDom): OutlineNode[] {
  const root = dom.parse(xml).documentElement;
  const section = child(root, 'ReportSections', 'ReportSection') ?? root;
  const page = child(section, 'Page') ?? root;
  const out: OutlineNode[] = [];
  const header = child(page, 'PageHeader');
  if (header) out.push({ key: '#header', kind: 'Section', name: l10n.t('Page Header'), details: [], children: itemsIn(child(header, 'ReportItems')) });
  out.push({ key: '#body', kind: 'Section', name: l10n.t('Body'), details: [], children: itemsIn(child(child(section, 'Body'), 'ReportItems')) });
  const footer = child(page, 'PageFooter');
  if (footer) out.push({ key: '#footer', kind: 'Section', name: l10n.t('Page Footer'), details: [], children: itemsIn(child(footer, 'ReportItems')) });
  return out;
}

/** Flat index: key → node and its ancestor keys (outermost first). */
export function indexOutline(nodes: OutlineNode[]): Map<string, { node: OutlineNode; ancestors: OutlineNode[] }> {
  const index = new Map<string, { node: OutlineNode; ancestors: OutlineNode[] }>();
  const walk = (list: OutlineNode[], ancestors: OutlineNode[]) => {
    for (const n of list) {
      index.set(n.key, { node: n, ancestors });
      walk(n.children, [...ancestors, n]);
    }
  };
  walk(nodes, []);
  return index;
}
