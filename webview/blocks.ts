// Portable layout blocks are ordinary RDL files. They carry their dependencies for inspection, but inserting
// a block never edits the AL report or silently adds fields/parameters to a Business Central dataset.
import { Report, SectionKind, allItems } from './model';
import { locate, sectionOf, tableWidth, tableHeight } from './ops';
import { XmlDom, browserDom, parseRdl, serializeRdl, elements, text } from './rdl';
import { addEmbeddedImage, embeddedImages } from './images';
import { expressionReferences } from './expressionSearch';
import { l10n } from './l10n';

export function createBlock(report: Report, selection: string[], dom: XmlDom = browserDom): Report {
  const selected = selection.map(name => locate(report, name)).filter(x => x?.container);
  if (!selected.length) throw new Error(l10n.t('Select at least one layout item to save a block.'));
  const roots = selected.filter(loc => !selected.some(other => other !== loc && [...allItems([other!.item])].some(i => i.name === loc!.item.name)));
  const top = Math.min(...roots.map(l => l!.item.top + l!.originTop));
  const left = Math.min(...roots.map(l => l!.item.left + l!.originLeft));
  const block = structuredClone(report);
  block.header = null; block.footer = null;
  block.body = { height: 0, style: {}, items: roots.map(l => {
    const item = structuredClone(l!.item);
    item.top += l!.originTop - top; item.left += l!.originLeft - left;
    return item;
  }) };
  block.body.height = Math.max(...block.body.items.map(i => i.top + i.height));
  block.width = Math.max(...block.body.items.map(i => i.left + i.width));
  // Blocks carry presentation and code, never unrelated queries, connections or report parameters.
  block.dataSources = []; block.dataSets = []; block.parameters = [];
  const itemsXml = serializeRdl({ ...block, extraXml: [] });
  const usesCode = /\bCode\s*[.!]/i.test(itemsXml);
  block.extraXml = block.extraXml.filter(x => /^\s*<EmbeddedImages\b/.test(x) || (usesCode && /^\s*<(Code|CodeModules)\b/.test(x)));
  const usedImages = new Set<string>();
  let dynamicImage = false;
  const imageDoc = dom.parse(itemsXml);
  for (const el of Array.from(imageDoc.getElementsByTagName('*')).filter(el => el.localName === 'Image')) {
    if (text(el, 'Source') === 'Embedded') {
      const value = text(el, 'Value') ?? '';
      if (value.trimStart().startsWith('=')) dynamicImage = true;
      else usedImages.add(value);
    }
  }
  // Dynamic image expressions can select any embedded image.
  if (!dynamicImage) {
    const images = embeddedImages(block).filter(i => usedImages.has(i.name));
    block.extraXml = block.extraXml.filter(x => !/^\s*<EmbeddedImages\b/.test(x));
    for (const image of images) addEmbeddedImage(block, image.name, image.mimeType, image.data);
  }
  if (block.source) { block.source.moreSections = []; block.source.sectionExtra = []; block.source.parameterLayout = undefined; }
  return block;
}

export interface BlockPlan { names: string[]; missing: string[] }
const ITEMS = new Set(['Textbox', 'Rectangle', 'Tablix', 'Image', 'Line', 'Chart', 'GaugePanel', 'Subreport', 'Map', 'Group']);

/** Rewrite references and aggregate scopes without changing ordinary string arguments. */
export function remapBlockExpression(value: string, names: Map<string, string>, remapItems = true): string {
  if (remapItems) value = value.replace(/"(?:[^"]|"")*"|\bReportItems\s*(?:!\s*([A-Za-z_]\w*)|\(\s*"((?:[^"]|"")*)"\s*\))/gi, (whole, bang: string, key: string) => {
    const old = bang ?? key;
    return old && names.has(old) ? (bang ? `ReportItems!${names.get(old)}` : `ReportItems("${names.get(old)}")`) : whole;
  });
  const scopeArgument: Record<string, number> = {
    sum: 1, avg: 1, min: 1, max: 1, first: 1, last: 1, count: 1, countdistinct: 1,
    stdev: 1, stdevp: 1, var: 1, varp: 1, aggregate: 1, previous: 1,
    countrows: 0, rownumber: 0, inscope: 0, level: 0, runningvalue: 2,
  };
  const frames: { name: string; arg: number }[] = [];
  let previous = '', beforePrevious = '';
  return value.replace(/"(?:[^"]|"")*"|#[^#]*#|[A-Za-z_]\w*|[(),]|[^\s]/g, (token: string, offset: number) => {
    let replacement = token;
    if (token === '(') frames.push({ name: /^[A-Za-z_]\w*$/.test(previous) && beforePrevious !== '.' && beforePrevious !== '!' ? previous.toLowerCase() : '', arg: 0 });
    else if (token === ')') frames.pop();
    else if (token === ',') { const frame = frames.at(-1); if (frame) frame.arg++; }
    else if (token.startsWith('"')) {
      const frame = frames.at(-1), name = token.slice(1, -1).replace(/""/g, '"');
      // Only a complete literal scope argument is renamed, never a concatenation or an IIf branch.
      if (frame && scopeArgument[frame.name] === frame.arg && (previous === '(' || previous === ',') && /^\s*[,)]/.test(value.slice(offset + token.length)) && names.has(name)) replacement = `"${names.get(name)}"`;
    }
    beforePrevious = previous; previous = token;
    return replacement;
  });
}

/** Rename every item/group, including names inside preserved regions, and its internal references. */
function freshBlock(target: Report, block: Report, dom: XmlDom): Report {
  const source = dom.parse(serializeRdl(block));
  const occupied = new Set<string>();
  const collect = (el: Element) => {
    if (ITEMS.has(el.localName) && el.hasAttribute('Name')) occupied.add(el.getAttribute('Name')!);
    elements(el).forEach(collect);
  };
  collect(dom.parse(serializeRdl(target)).documentElement);
  const names = new Map<string, string>();
  const assign = (el: Element) => {
    if (ITEMS.has(el.localName) && el.hasAttribute('Name')) {
      const old = el.getAttribute('Name')!;
      let next = old, n = 2;
      while (occupied.has(next)) next = `${old}_${n++}`;
      occupied.add(next); names.set(old, next); el.setAttribute('Name', next);
    }
    elements(el).forEach(assign);
  };
  assign(source.documentElement);
  const rewrite = (el: Element) => {
    const children = elements(el);
    if (!children.length) {
      let value = el.textContent ?? '';
      if (['ToggleItem', 'RepeatWith', 'SortExpressionScope', 'SortTarget'].includes(el.localName)) value = names.get(value) ?? value;
      else if (value.trimStart().startsWith('=')) {
        // Tokenize strings together with references so text containing "ReportItems!X" stays literal.
        value = remapBlockExpression(value, names);
      }
      if (value !== (el.textContent ?? '')) el.textContent = value;
    } else children.forEach(rewrite);
  };
  rewrite(source.documentElement);
  return parseRdl(dom.serialize(source), dom);
}

export function blockMissing(target: Report, block: Report, dom: XmlDom = browserDom): string[] {
  const missing = new Set<string>();
  const parameters = new Set(target.parameters.map(p => p.name));
  const content = structuredClone(block); content.dataSets = []; content.parameters = [];
  const doc = dom.parse(serializeRdl(content));
  const walk = (el: Element, inherited?: string) => {
    if (['Code', 'CodeModules', 'EmbeddedImages'].includes(el.localName)) return;
    const dataSet = text(el, 'DataSetName') ?? inherited;
    const fields = new Set((dataSet ? target.dataSets.filter(d => d.name === dataSet) : target.dataSets).flatMap(d => d.fields.map(f => f.name)));
    if (el.localName === 'DataSetName' && !target.dataSets.some(d => d.name === el.textContent)) missing.add(`DataSet: ${el.textContent}`);
    const children = elements(el);
    if (!children.length && el.getAttribute('EvaluationMode') !== 'Constant' && (el.textContent ?? '').trimStart().startsWith('=')) {
      for (const r of expressionReferences(el.textContent ?? '')) {
        if (!(r.kind === 'Fields' ? fields : parameters).has(r.name)) missing.add(`${r.kind}!${r.name}${r.kind === 'Fields' && dataSet ? ` (${dataSet})` : ''}`);
      }
    }
    children.forEach(c => walk(c, dataSet));
  };
  walk(doc.documentElement);
  return [...missing].sort();
}

/** Mutates a draft in one undoable transaction. Conflicting code/images are refused before any mutation. */
export function insertBlock(target: Report, block: Report, section: SectionKind, top: number, left: number, dom: XmlDom = browserDom): BlockPlan {
  if (!block.body.items.length) throw new Error(l10n.t('This block contains no layout items.'));
  const dependencies = block.extraXml.filter(x => /^\s*<(Code|CodeModules)\b/.test(x));
  for (const dep of dependencies) {
    const tag = /^\s*<([\w]+)/.exec(dep)![1];
    const current = target.extraXml.find(x => new RegExp(`^\\s*<${tag}\\b`).test(x));
    if (current && dom.serialize(dom.parse(current)).trim() !== dom.serialize(dom.parse(dep)).trim()) throw new Error(l10n.t('The block has conflicting report code. Resolve the Code block before inserting it.'));
  }
  const images = embeddedImages(block), currentImages = embeddedImages(target);
  for (const img of images) {
    const current = currentImages.find(i => i.name.toLowerCase() === img.name.toLowerCase());
    if (current && (current.data !== img.data || current.mimeType !== img.mimeType || current.name !== img.name)) throw new Error(l10n.t('Embedded image "{0}" already exists with different contents. Rename the image before inserting this block.', img.name));
  }
  // Preserve custom namespace declarations used in raw report items.
  const targetFormat = target.source ?? parseRdl(serializeRdl(target), dom).source;
  for (const [name, value] of block.source?.rootAttributes ?? []) {
    if (!name.startsWith('xmlns:')) continue;
    const current = targetFormat?.rootAttributes.find(([n]) => n === name);
    if (current && current[1] !== value) throw new Error(l10n.t('The block uses a conflicting XML namespace: {0}', name));
  }
  const next = freshBlock(target, block, dom);
  const missing = blockMissing(target, block, dom);
  for (const dep of dependencies) {
    const tag = /^\s*<([\w]+)/.exec(dep)![1];
    if (!target.extraXml.some(x => new RegExp(`^\\s*<${tag}\\b`).test(x))) target.extraXml.push(dep);
  }
  for (const img of images) if (!currentImages.some(i => i.name === img.name)) addEmbeddedImage(target, img.name, img.mimeType, img.data);
  if (targetFormat) {
    for (const attr of block.source?.rootAttributes ?? []) if (attr[0].startsWith('xmlns:') && !targetFormat.rootAttributes.some(([n]) => n === attr[0])) targetFormat.rootAttributes.push(attr);
    target.source = targetFormat;
  }
  for (const item of next.body.items) { item.top += top; item.left += left; }
  if (section !== 'body' && !target[section]) target[section] = { height: 0, style: {}, items: [] };
  const destination = sectionOf(target, section);
  destination.items.push(...next.body.items);
  // Freshly parsed items may still match their origins at (0,0), so the general fitSections helper can
  // regard them as untouched. Explicitly grow new sections even when no position patch is necessary.
  destination.height = Math.max(destination.height, ...next.body.items.map(i => i.top + (i.type === 'table' ? tableHeight(i) : i.height)));
  target.width = Math.max(target.width, ...next.body.items.map(i => i.left + (i.type === 'table' ? tableWidth(i) : i.width)));
  return { names: next.body.items.map(i => i.name), missing };
}
