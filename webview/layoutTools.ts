// Layout tools of the Visual Studio report designer (Format › Align / Make Same Size / Spacing / Center in Form)
// and properties the model keeps as verbatim XML (visibility, header/footer on first/last page).
// Pure helpers on a Report draft.

import { ReportItem, Report, Section } from './model';
import { locate } from './ops';

export type AlignOp = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type SizeOp = 'width' | 'height' | 'both';
export type SpacingOp = 'horizontal' | 'vertical';

/** Items in keyboard order: page header, body, footer; within each top to bottom, left to right (rectangles' items after them). */
export function focusOrder(r: Report): string[] {
  const out: string[] = [];
  const visit = (items: ReportItem[]) => [...items].sort((a, b) => a.top - b.top || a.left - b.left).forEach(it => {
    out.push(it.name);
    if (it.type === 'rectangle') visit(it.items);
  });
  for (const s of [r.header, r.body, r.footer]) if (s) visit(s.items);
  return out;
}

/** Items that can be positioned (not table cells), in the same container as the first one. */
function positioned(r: Report, names: string[]) {
  const locs = names.map(n => locate(r, n)).filter(l => l?.container);
  const first = locs[0];
  return first ? locs.filter(l => l!.container === first.container).map(l => l!.item) : [];
}

const right = (i: ReportItem) => i.left + i.width;
const bottom = (i: ReportItem) => i.top + i.height;

/**
 * Aligns the items to the first selected one (the "primary selection" in Visual Studio). Returns false when there is
 * nothing to do (fewer than two items).
 */
export function alignItems(r: Report, names: string[], op: AlignOp): boolean {
  const [ref, ...rest] = positioned(r, names);
  if (!ref || !rest.length) return false;
  for (const it of rest) {
    if (op === 'left') it.left = ref.left;
    if (op === 'right') it.left = right(ref) - it.width;
    if (op === 'center') it.left = ref.left + (ref.width - it.width) / 2;
    if (op === 'top') it.top = ref.top;
    if (op === 'bottom') it.top = bottom(ref) - it.height;
    if (op === 'middle') it.top = ref.top + (ref.height - it.height) / 2;
    it.left = Math.max(0, it.left);
    it.top = Math.max(0, it.top);
  }
  return true;
}

/** Gives the items the width and/or height of the first selected one. Tables size themselves from their columns. */
export function makeSameSize(r: Report, names: string[], op: SizeOp): boolean {
  const [ref, ...rest] = positioned(r, names);
  const targets = rest.filter(i => i.type !== 'table');
  if (!ref || !targets.length) return false;
  for (const it of targets) {
    if (op !== 'height') it.width = ref.width;
    if (op !== 'width') it.height = ref.height;
  }
  return true;
}

/** Spaces three or more items evenly between the outermost ones (Format › Horizontal/Vertical Spacing › Make Equal). */
export function distribute(r: Report, names: string[], op: SpacingOp): boolean {
  const items = positioned(r, names);
  if (items.length < 3) return false;
  const pos = op === 'horizontal' ? 'left' : 'top';
  const size = op === 'horizontal' ? 'width' : 'height';
  items.sort((a, b) => a[pos] - b[pos]);
  const start = items[0][pos];
  const end = items[items.length - 1][pos] + items[items.length - 1][size];
  const gap = (end - start - items.reduce((s, i) => s + i[size], 0)) / (items.length - 1);
  let at = start;
  for (const it of items) {
    it[pos] = at;
    at += it[size] + gap;
  }
  return true;
}

/** Centers the items as a group in their section or rectangle (Format › Center in Form). */
export function centerInContainer(r: Report, names: string[], op: SpacingOp): boolean {
  const items = positioned(r, names);
  if (!items.length) return false;
  const loc = locate(r, items[0].name)!;
  const parent = findParentRectangle(r, items[0].name);
  const span = op === 'horizontal'
    ? parent ? parent.width : r.width
    : parent ? parent.height : sectionHeight(r, loc.section);
  const pos = op === 'horizontal' ? 'left' : 'top';
  const size = op === 'horizontal' ? 'width' : 'height';
  const min = Math.min(...items.map(i => i[pos]));
  const max = Math.max(...items.map(i => i[pos] + i[size]));
  const shift = (span - (max - min)) / 2 - min;
  for (const it of items) it[pos] = Math.max(0, it[pos] + shift);
  return true;
}

const sectionHeight = (r: Report, kind: 'header' | 'body' | 'footer') =>
  (kind === 'body' ? r.body : kind === 'header' ? r.header : r.footer)?.height ?? 0;

function findParentRectangle(r: Report, name: string): ReportItem | undefined {
  const walk = (items: ReportItem[], parent?: ReportItem): ReportItem | undefined => {
    for (const it of items) {
      if (it.name === name) return parent;
      if (it.type === 'rectangle') { const hit = walk(it.items, it); if (hit) return hit; }
    }
    return undefined;
  };
  for (const s of [r.header, r.body, r.footer]) if (s) { const hit = walk(s.items); if (hit) return hit; }
  return undefined;
}

// ------------------------------------------------------------------------------------------------ verbatim properties

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isTag = (xml: string, tag: string) => new RegExp(`^<${tag}[\\s/>]`).test(xml.trim());

/** Hidden expression of an item ("" = always visible, "true", "=Fields!X.Value = 0" …). */
export function hiddenOf(item: { extra?: string[] }): string {
  const vis = item.extra?.find(x => isTag(x, 'Visibility'));
  const m = vis && /<Hidden>([\s\S]*?)<\/Hidden>/.exec(vis);
  return m ? decode(m[1]) : '';
}

/** Sets the Hidden expression; keeps the rest of <Visibility> (ToggleItem). Returns false if nothing changed. */
export function setHidden(item: { extra?: string[] }, value: string): boolean {
  value = value.trim();
  if (value.toLowerCase() === 'false') value = '';
  if (value === hiddenOf(item)) return false;
  const extra = item.extra ?? [];
  const i = extra.findIndex(x => isTag(x, 'Visibility'));
  const vis = i >= 0 ? extra[i] : '<Visibility></Visibility>';
  let next = /<Hidden>[\s\S]*?<\/Hidden>|<Hidden\s*\/>/.test(vis)
    ? vis.replace(/<Hidden>[\s\S]*?<\/Hidden>|<Hidden\s*\/>/, value ? `<Hidden>${encode(value)}</Hidden>` : '')
    : vis.replace(/^<Visibility\s*\/>$/, '<Visibility></Visibility>').replace(/^<Visibility>/, `<Visibility>${value ? `<Hidden>${encode(value)}</Hidden>` : ''}`);
  if (/^<Visibility>\s*<\/Visibility>$/.test(next)) next = '';
  item.extra = i >= 0 ? extra.flatMap((x, k) => (k === i ? (next ? [next] : []) : [x])) : next ? [...extra, next] : extra;
  return true;
}

/**
 * PrintOnFirstPage / PrintOnLastPage of a page header or footer. RDL's default is false; sections created in the
 * designer are written with true (like Report Builder does).
 */
export function printsOn(s: Section, which: 'First' | 'Last'): boolean {
  const tag = `PrintOn${which}Page`;
  const x = s.extra?.find(e => isTag(e, tag));
  if (x) return /true/i.test(x);
  return !s.origin;
}

export function setPrintsOn(s: Section, which: 'First' | 'Last', on: boolean) {
  const tag = `PrintOn${which}Page`;
  s.extra = [...(s.extra ?? []).filter(e => !isTag(e, tag)), `<${tag}>${on}</${tag}>`];
}

/** Name of the textbox that toggles the item's visibility (drilldown), "" if none. */
export function toggleItemOf(item: { extra?: string[] }): string {
  const vis = item.extra?.find(x => isTag(x, 'Visibility'));
  const m = vis && /<ToggleItem>([\s\S]*?)<\/ToggleItem>/.exec(vis);
  return m ? decode(m[1]).trim() : '';
}

/** Sets or removes the ToggleItem; keeps Hidden. Returns false if nothing changed. */
export function setToggleItem(item: { extra?: string[] }, name: string): boolean {
  name = name.trim();
  if (name === toggleItemOf(item)) return false;
  const extra = item.extra ?? [];
  const i = extra.findIndex(x => isTag(x, 'Visibility'));
  let vis = i >= 0 ? extra[i].replace(/^<Visibility\s*\/>$/, '<Visibility></Visibility>') : '<Visibility></Visibility>';
  vis = vis.replace(/<ToggleItem>[\s\S]*?<\/ToggleItem>/, '');
  if (name) vis = vis.replace(/<\/Visibility>$/, `<ToggleItem>${encode(name)}</ToggleItem></Visibility>`);
  const next = /^<Visibility>\s*<\/Visibility>$/.test(vis) ? '' : vis;
  item.extra = i >= 0 ? extra.flatMap((x, k) => (k === i ? (next ? [next] : []) : [x])) : next ? [...extra, next] : extra;
  return true;
}

/** Sort expression of an interactive sort on a textbox (UserSort), "" if none. */
export function userSortOf(item: { extra?: string[] }): string {
  const us = item.extra?.find(x => isTag(x, 'UserSort'));
  const m = us && /<SortExpression>([\s\S]*?)<\/SortExpression>/.exec(us);
  return m ? decode(m[1]) : '';
}

/** Sets or removes the interactive sort; other UserSort settings (SortExpressionScope …) stay. */
export function setUserSort(item: { extra?: string[] }, expression: string): boolean {
  expression = expression.trim();
  if (expression === userSortOf(item)) return false;
  const extra = item.extra ?? [];
  const i = extra.findIndex(x => isTag(x, 'UserSort'));
  const next = !expression ? '' : i >= 0 && /<SortExpression>/.test(extra[i])
    ? extra[i].replace(/<SortExpression>[\s\S]*?<\/SortExpression>/, `<SortExpression>${encode(expression)}</SortExpression>`)
    : `<UserSort><SortExpression>${encode(expression)}</SortExpression></UserSort>`;
  item.extra = i >= 0 ? extra.flatMap((x, k) => (k === i ? (next ? [next] : []) : [x])) : next ? [...extra, next] : extra;
  return true;
}

// ------------------------------------------------------------------------------------------------ actions, bookmarks

/** The action of a textbox or image (<ActionInfo>): go to a URL, to a bookmark, or to another report (drillthrough). */
export type ItemAction =
  | { kind: 'none' }
  | { kind: 'hyperlink' | 'bookmarkLink'; value: string }
  | { kind: 'drillthrough'; report: string; parameters: { name: string; value: string }[] };

const tagText = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decode(m[1]) : undefined;
};

/** The first action of the item; more than one action per item is not modelled (and kept as it is). */
export function actionOf(item: { extra?: string[] }): ItemAction {
  const info = item.extra?.find(x => isTag(x, 'ActionInfo'));
  const action = info && /<Action>([\s\S]*?)<\/Action>/.exec(info)?.[1];
  if (!action) return { kind: 'none' };
  const link = tagText(action, 'Hyperlink');
  if (link !== undefined) return { kind: 'hyperlink', value: link };
  const mark = tagText(action, 'BookmarkLink');
  if (mark !== undefined) return { kind: 'bookmarkLink', value: mark };
  const dt = /<Drillthrough>([\s\S]*?)<\/Drillthrough>/.exec(action)?.[1];
  if (dt !== undefined) {
    const parameters = Array.from(dt.matchAll(/<Parameter\s+Name="([^"]*)"\s*>([\s\S]*?)<\/Parameter>/g),
      m => ({ name: decode(m[1]), value: tagText(m[2], 'Value') ?? '' }));
    return { kind: 'drillthrough', report: tagText(dt, 'ReportName') ?? '', parameters };
  }
  return { kind: 'none' };
}

const actionXml = (a: ItemAction): string => {
  switch (a.kind) {
    case 'none': return '';
    case 'hyperlink': return `<Hyperlink>${encode(a.value)}</Hyperlink>`;
    case 'bookmarkLink': return `<BookmarkLink>${encode(a.value)}</BookmarkLink>`;
    case 'drillthrough': {
      const params = a.parameters.filter(p => p.name.trim());
      return `<Drillthrough><ReportName>${encode(a.report)}</ReportName>${params.length
        ? `<Parameters>${params.map(p => `<Parameter Name="${encode(p.name.trim()).replace(/"/g, '&quot;')}"><Value>${encode(p.value)}</Value></Parameter>`).join('')}</Parameters>`
        : ''}</Drillthrough>`;
    }
  }
};

/**
 * Sets the item's action. An existing <ActionInfo> keeps everything but the content of its first <Action>; with
 * 'none' the first action is removed (and <ActionInfo> when it is empty then). Returns false if nothing changed.
 */
export function setAction(item: { extra?: string[] }, action: ItemAction): boolean {
  if (JSON.stringify(action) === JSON.stringify(actionOf(item))) return false;
  const extra = item.extra ?? [];
  const i = extra.findIndex(x => isTag(x, 'ActionInfo'));
  const inner = actionXml(action);
  let next: string;
  if (i < 0) {
    next = inner ? `<ActionInfo><Actions><Action>${inner}</Action></Actions></ActionInfo>` : '';
  } else if (/<Action>[\s\S]*?<\/Action>/.test(extra[i])) {
    next = extra[i].replace(/<Action>[\s\S]*?<\/Action>/, inner ? `<Action>${inner}</Action>` : '');
    if (!/<Action>/.test(next)) next = '';
  } else {
    next = inner ? `<ActionInfo><Actions><Action>${inner}</Action></Actions></ActionInfo>` : '';
  }
  item.extra = i >= 0 ? extra.flatMap((x, k) => (k === i ? (next ? [next] : []) : [x])) : next ? [...extra, next] : extra;
  return true;
}

/** Bookmark of an item (target of BookmarkLink actions), "" if none. */
export function bookmarkOf(item: { extra?: string[] }): string {
  const b = item.extra?.find(x => isTag(x, 'Bookmark'));
  return b ? tagText(b, 'Bookmark') ?? '' : '';
}

export function setBookmark(item: { extra?: string[] }, value: string): boolean {
  value = value.trim();
  if (value === bookmarkOf(item)) return false;
  const extra = (item.extra ?? []);
  const i = extra.findIndex(x => isTag(x, 'Bookmark'));
  const next = value ? `<Bookmark>${encode(value)}</Bookmark>` : '';
  item.extra = i >= 0 ? extra.flatMap((x, k) => (k === i ? (next ? [next] : []) : [x])) : next ? [...extra, next] : extra;
  return true;
}
