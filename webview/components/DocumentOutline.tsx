import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../editor';
import { RawItem, TextboxItem } from '../model';
import { patchNestedTextbox, readNestedTextbox } from '../nested';
import { PropColor, PropText, Row } from './PropertiesPane';
import { locate } from '../ops';
import { OutlineKind, OutlineNode, buildOutline, indexOutline } from '../outline';
import { browserDom, serializeRdl } from '../rdl';
import { ActionButton, Codicon } from './Icon';
import { RichTextEditor } from './RichTextEditor';
import { vsContext } from '../vscode';
import { l10n } from '../l10n';

/** Codicon and label per outline kind. */
const kinds = (): Record<OutlineKind, [icon: string, label: string]> => ({
  Section: ['symbol-namespace', l10n.t('Section')], Rows: ['list-flat', l10n.t('Row Groups')], Columns: ['split-horizontal', l10n.t('Column Groups')],
  Group: ['group-by-ref-type', l10n.t('Group')], Textbox: ['symbol-text', l10n.t('Textbox')], Rectangle: ['primitive-square', l10n.t('Rectangle')],
  Line: ['chrome-minimize', l10n.t('Line')], Image: ['file-media', l10n.t('Image')], Tablix: ['table', 'Tablix'], Chart: ['graph', l10n.t('Chart')],
  Subreport: ['references', l10n.t('Subreport')], Map: ['globe', l10n.t('Map')], GaugePanel: ['dashboard', l10n.t('Gauge')],
  CustomReportItem: ['extensions', l10n.t('Custom')], List: ['list-unordered', l10n.t('List')], Table: ['table', l10n.t('Table')], Matrix: ['table', 'Matrix'],
});

export const SEVERITY_ICON = { error: 'error', warning: 'warning', info: 'info', hint: 'info' } as const;

/** Scrolls the designer to an item (items carry data-name). */
const revealInDesigner = (name: string) =>
  document.querySelector(`.designer [data-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

export function DocumentOutline() {
  const ed = useEditor();
  const { report } = ed;
  const outline = useMemo(() => buildOutline(serializeRdl(report), browserDom), [report]);
  const index = useMemo(() => indexOutline(outline), [outline]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['#header', '#body', '#footer']));
  const [active, setActive] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  // lint findings per report item (from the extension)
  const diagByItem = useMemo(() => {
    const m = new Map<string, typeof ed.diagnostics>();
    for (const d of ed.diagnostics) if (d.item) m.set(d.item, [...(m.get(d.item) ?? []), d]);
    return m;
  }, [ed.diagnostics]);
  const worst = (ds: typeof ed.diagnostics) => (['error', 'warning', 'info', 'hint'] as const).find(s => ds.some(d => d.severity === s))!;

  /** Item the designer can select for a node: the node itself, or the nearest editable ancestor (e.g. a grouped Tablix). */
  const designerTarget = (key: string): string | null => {
    const entry = index.get(key);
    if (!entry) return null;
    for (const n of [entry.node, ...[...entry.ancestors].reverse()]) {
      if (n.itemName && locate(report, n.itemName)) return n.itemName;
    }
    return null;
  };

  // Designer selection → outline: expand the path and highlight, unless the active node already maps to it
  // (clicking a cell inside a grouped Tablix selects the Tablix, but the cell stays highlighted here).
  const selected = ed.selection[0];
  useEffect(() => {
    if (!selected || (active && designerTarget(active) === selected)) return;
    const entry = index.get(`item:${selected}`);
    if (!entry) return;
    setActive(entry.node.key);
    setExpanded(prev => new Set([...prev, ...entry.ancestors.map(a => a.key)]));
  }, [selected, index]);

  // an inner item picked in the designer (inside a region kept verbatim)
  useEffect(() => {
    if (!ed.nested) return;
    const entry = index.get(`item:${ed.nested}`);
    if (!entry) return;
    setActive(entry.node.key);
    setExpanded(prev => new Set([...prev, ...entry.ancestors.map(a => a.key)]));
  }, [ed.nested, index]);

  useEffect(() => {
    if (active) listRef.current?.querySelector(`[data-key="${CSS.escape(active)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // While searching, show matches plus their ancestors, fully expanded.
  const term = filter.trim().toLowerCase();
  const visibleByFilter = useMemo(() => {
    if (!term) return null;
    const keep = new Set<string>();
    for (const [key, { node, ancestors }] of index) {
      const hay = `${node.name} ${node.details.map(d => d[1]).join(' ')}`.toLowerCase();
      if (hay.includes(term)) {
        keep.add(key);
        ancestors.forEach(a => keep.add(a.key));
      }
    }
    return keep;
  }, [term, index]);

  const rows: { node: OutlineNode; depth: number }[] = [];
  const walk = (nodes: OutlineNode[], depth: number) => {
    for (const n of nodes) {
      if (visibleByFilter && !visibleByFilter.has(n.key)) continue;
      rows.push({ node: n, depth });
      if (n.children.length && (visibleByFilter || expanded.has(n.key))) walk(n.children, depth + 1);
    }
  };
  walk(outline, 0);

  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const activate = (node: OutlineNode) => {
    setActive(node.key);
    const target = designerTarget(node.key);
    if (target) {
      ed.select([target]);
      // inside a verbatim region: highlight the inner item in the designer as well
      if (node.itemName && node.itemName !== target) ed.setNested(node.itemName);
      requestAnimationFrame(() => revealInDesigner(target));
    } else if (node.kind === 'Section') {
      ed.select([]);
    }
  };

  // Arrow-key navigation like a tree view.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = rows.findIndex(r => r.node.key === active);
    const cur = rows[i]?.node;
    if (e.key === 'ArrowDown' && i < rows.length - 1) activate(rows[i + 1].node);
    else if (e.key === 'ArrowUp' && i > 0) activate(rows[i - 1].node);
    else if (e.key === 'ArrowRight' && cur?.children.length && !expanded.has(cur.key)) toggle(cur.key);
    else if (e.key === 'ArrowLeft' && cur) {
      if (expanded.has(cur.key) && cur.children.length) toggle(cur.key);
      else { const parent = index.get(cur.key)?.ancestors.at(-1); if (parent) activate(parent); }
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /** The verbatim region (raw item) containing an outline entry, innermost first. */
  const rawOwner = (entry: { ancestors: { itemName?: string }[] }): string | undefined =>
    [...entry.ancestors].reverse().map(a => a.itemName).find(n => n && locate(report, n)?.item.type === 'raw');

  const activeEntry = active ? index.get(active) : undefined;
  const activeNode = activeEntry?.node;
  const target = active ? designerTarget(active) : null;
  const editable = activeNode?.itemName && target === activeNode.itemName ? locate(report, activeNode.itemName)?.item : undefined;
  const count = index.size;

  return (
    <div className="pane-content outline">
      <div className="filter-row">
        <span className="filter-input">
          <Codicon name="filter" />
          <input type="text" placeholder={l10n.t('Filter (name or expression)')} value={filter} aria-label={l10n.t('Filter outline')}
            onChange={e => setFilter(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setFilter(''); }} />
          {filter && <ActionButton icon="close" title={l10n.t('Clear Filter')} onClick={() => setFilter('')} />}
        </span>
        <ActionButton icon="expand-all" title={l10n.t('Expand All')} onClick={() => setExpanded(new Set([...index.keys()]))} />
        <ActionButton icon="collapse-all" title={l10n.t('Collapse All')} onClick={() => setExpanded(new Set(['#body']))} />
      </div>
      <div className="tree outline-tree" ref={listRef} tabIndex={0} onKeyDown={onKeyDown} role="tree" aria-label={l10n.t('Document outline')}
        {...vsContext({ preventDefaultContextMenuItems: true })}>
        {rows.map(({ node, depth }) => {
          const [icon, label] = kinds()[node.kind];
          const hidden = node.hidden?.trim().toLowerCase();
          const open = !!visibleByFilter || expanded.has(node.key);
          const diags = node.itemName ? diagByItem.get(node.itemName) : undefined;
          // editable items get the designer's context menu (it acts on the selection, which a right click sets)
          const loc = ed.mode === 'design' && node.itemName && designerTarget(node.key) === node.itemName ? locate(report, node.itemName) : null;
          return (
            <div key={node.key} data-key={node.key} role="treeitem" aria-selected={node.key === active} aria-expanded={node.children.length ? open : undefined}
              className={`tree-row outline-row kind-${node.kind} ${node.key === active ? 'selected' : ''} ${hidden === 'true' ? 'is-hidden' : ''}`}
              onClick={() => activate(node)}
              onContextMenu={() => activate(node)}
              {...(loc ? vsContext({ webviewSection: 'item', itemType: loc.item.type, positioned: !!loc.container, inTable: false }) : {})}
              onDoubleClick={() => node.children.length && toggle(node.key)}
              title={node.hidden ? l10n.t('{0} – hidden: {1}', label, node.hidden) : label}>
              <span className="indent" style={{ width: depth * 12 }} />
              <span className={`twisty ${node.children.length ? '' : 'leaf'}`} onClick={e => { e.stopPropagation(); toggle(node.key); }}>
                <Codicon name={open ? 'chevron-down' : 'chevron-right'} />
              </span>
              <Codicon name={icon} className={`kind-icon kind-icon-${node.kind}`} />
              <span className="outline-name">{node.name}</span>
              {node.kind === 'Textbox' && node.details[0]?.[0] === l10n.t('Value') && (
                <span className="tree-description">{node.details[0][1]}</span>
              )}
              <span className="grow" />
              {node.hidden && <Codicon name="eye-closed" className={`hidden-flag ${hidden === 'true' ? '' : 'conditional'}`}
                title={hidden === 'true' ? l10n.t('Hidden') : l10n.t('Conditionally hidden: {0}', node.hidden)} />}
              {diags && (() => {
                const sev = worst(diags);
                return <Codicon name={SEVERITY_ICON[sev]} className={`sev-${sev}`} title={diags.map(d => d.message).join('\n')} />;
              })()}
            </div>
          );
        })}
        {!rows.length && <div className="tree-empty">{term ? l10n.t('No matches') : l10n.t('No items')}</div>}
      </div>
      <div className="outline-details">
        {activeNode ? (
          <>
            <div className="outline-details-title">
              <Codicon name={kinds()[activeNode.kind][0]} className="kind-icon" /> {activeNode.name} <span className="muted">{kinds()[activeNode.kind][1]}</span>
            </div>
            <div className="outline-path">
              {[...(activeEntry?.ancestors ?? []).map(a => a.name), activeNode.name].join(' › ')}
            </div>
            {activeNode.details.map(([k, v]) => (
              <div key={k} className="detail-row"><span>{k}</span><code>{v}</code></div>
            ))}
            {activeNode.itemName && diagByItem.has(activeNode.itemName) && (
              <div className="diag-list">
                {diagByItem.get(activeNode.itemName)!.map((d, i) => (
                  <div key={i} className="diag-item"><Codicon name={SEVERITY_ICON[d.severity]} className={`sev-${d.severity}`} /><span>{d.message}</span></div>
                ))}
              </div>
            )}
            {activeNode.itemName && target !== activeNode.itemName && activeNode.kind !== 'Textbox' && (
              <div className="prop-note">
                {target
                  ? l10n.t('Lies in a region the designer saves unchanged (selected: {0}). Textboxes in it can be edited here, everything else via "Open as XML".', target)
                  : l10n.t('Lies in a region the designer saves unchanged. Textboxes in it can be edited here, everything else via "Open as XML".')}
              </div>
            )}
            {activeNode.kind === 'Textbox' && activeNode.itemName && target !== activeNode.itemName && rawOwner(activeEntry!) && (
              <NestedTextboxEditor raw={rawOwner(activeEntry!)!} name={activeNode.itemName} />
            )}
            {editable?.type === 'textbox' && (
              <button className="secondary" onClick={() => ed.setDialog({
                kind: 'expression', title: l10n.t('Value of {0}', editable.name), value: editable.value,
                dataSetName: locate(report, editable.name)?.table?.dataSetName,
                onOk: v => ed.commit(r => { (locate(r, editable.name)!.item as TextboxItem).value = v; }),
              })}>{l10n.t('Edit Expression…')}</button>
            )}
          </>
        ) : (
          <div className="prop-note">{l10n.t('{0} entries. Select an item to reveal it in the designer and see details.', count)} <Codicon name="eye-closed" /> {l10n.t('= hidden (dimmed: conditional).')}</div>
        )}
      </div>
    </div>
  );
}

/** Edits a textbox inside a region the designer keeps verbatim by patching the region's XML. */
function NestedTextboxEditor({ raw, name }: { raw: string; name: string }) {
  const ed = useEditor();
  const item = locate(ed.report, raw)?.item as RawItem | undefined;
  const tb = item ? readNestedTextbox(item.xml, name) : null;
  if (!item || !tb) return null;
  const set = (patch: Parameters<typeof patchNestedTextbox>[2]) => ed.commit(r => {
    const it = locate(r, raw)!.item as RawItem;
    const next = patchNestedTextbox(it.xml, name, patch);
    if (next === it.xml) return false;
    it.xml = next;
  });
  return (
    <div className="nested-editor">
      {tb.editableValue ? (
        <Row label={l10n.t('Value')}>
          <span className="expr-prop">
            <PropText value={tb.value} multiline onCommit={v => set({ value: v })} />
            <button className="fx action-item" title={l10n.t('Edit Expression…')} onClick={() => ed.setDialog({
              kind: 'expression', title: l10n.t('Value of {0}', name), value: tb.value,
              dataSetName: ed.report.dataSets[0]?.name, onOk: v => set({ value: v }),
            })}><Codicon name="symbol-operator" /></button>
          </span>
        </Row>
      ) : <RichTextEditor owner={raw} name={name} />}
      <Row label={l10n.t('Format')}><PropText value={tb.format} placeholder={l10n.t('e.g. N2, dd.MM.yyyy')} onCommit={v => set({ format: v })} /></Row>
      <Row label={l10n.t('Style')}>
        <span className="toggle-group">
          <ActionButton icon="bold" title={l10n.t('Bold')} checked={tb.bold} onClick={() => set({ bold: !tb.bold })} />
          <ActionButton icon="italic" title={l10n.t('Italic')} checked={tb.italic} onClick={() => set({ italic: !tb.italic })} />
        </span>
      </Row>
      <Row label={l10n.t('Color')}><PropColor value={tb.color || undefined} onCommit={v => set({ color: v })} /></Row>
      <Row label={l10n.t('Hide')}><PropText value={tb.hidden} placeholder={l10n.t('empty = visible, true, =expression')} onCommit={v => set({ hidden: v })} /></Row>
    </div>
  );
}
