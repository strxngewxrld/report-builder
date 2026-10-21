// React rendering of the render engine's output (render/types.ts), used by the preview and – in design mode – by the
// designer for regions it keeps verbatim. Items keep their designed positions; content that grows (tables, text,
// rectangles) is measured and pushes the items below it down (Flow), as the report server does.

import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as RMouseEvent } from 'react';
import { RAction, RNode, RTable } from './types';
import { ChartView } from './ChartView';
import { GaugeView } from './GaugeView';
import { l10n } from '../l10n';

/** Pixels per inch and optional interaction (designer). */
export interface ViewOptions {
  S: number;
  /** Click on a rendered item (design mode): name of the innermost item. */
  onPick?: (name: string, e: RMouseEvent) => void;
  /** Name of the item to highlight. */
  selected?: string | null;
  /** Show hidden items dimmed instead of invisible (design mode). */
  showHidden?: boolean;
  /** Preview interactivity: drilldown toggle (RBox.toggle.key) and interactive sort (textbox name). */
  onToggle?: (key: string) => void;
  onSort?: (name: string) => void;
  /** Preview: click on an item with an action (hyperlink, bookmark link, drillthrough). */
  onAction?: (action: RAction) => void;
}

const actionTitle = (a: RAction) =>
  a.kind === 'hyperlink' ? a.url : a.kind === 'bookmarkLink' ? l10n.t('Go to bookmark "{0}"', a.bookmark) : l10n.t('Drillthrough: {0}', a.report);

/** The +/− box of a drilldown textbox and the sort arrows of interactive sorting (left out when printing). */
function Interactive({ node }: { node: Extract<RNode, { kind: 'box' }> }) {
  const o = useContext(Options);
  const box: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 9, height: 9, marginRight: 3, border: '1px solid #777',
    fontSize: 9, lineHeight: '9px', fontFamily: 'Arial, sans-serif', color: '#333', background: 'white', cursor: 'pointer', verticalAlign: 'middle', userSelect: 'none',
  };
  return <>
    {node.toggle && o.onToggle && (
      <span className="rv-interactive" style={box} role="button" tabIndex={0} aria-expanded={node.toggle.expanded}
        aria-label={node.toggle.expanded ? l10n.t('Collapse') : l10n.t('Expand')}
        title={node.toggle.expanded ? l10n.t('Collapse') : l10n.t('Expand')}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); o.onToggle!(node.toggle!.key); } }}
        onClick={e => { e.stopPropagation(); o.onToggle!(node.toggle!.key); }}>{node.toggle.expanded ? '−' : '+'}</span>
    )}
    {node.userSort && o.onSort && (
      <span className="rv-interactive" role="button" tabIndex={0} aria-label={l10n.t('Sort')}
        title={l10n.t('Sort')} style={{ float: 'right', cursor: 'pointer', fontSize: 9, color: node.userSort.direction ? '#0a84ff' : '#999', userSelect: 'none' }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); o.onSort!(node.userSort!.name); } }}
        onClick={e => { e.stopPropagation(); o.onSort!(node.userSort!.name); }}>
        {node.userSort.direction === 'Ascending' ? '▲' : node.userSort.direction === 'Descending' ? '▼' : '⇅'}
      </span>
    )}
  </>;
}
const Options = createContext<ViewOptions>({ S: 96 });
export const RenderOptionsProvider = Options.Provider;

const hasNestedTable = (row: RTable['rows'][number]) => row.cells.some(c => c.node && containsTable(c.node));
const containsTable = (n: RNode): boolean => n.kind === 'table' || (n.kind === 'box' && (n.children ?? []).some(containsTable));

/** Children positioned at their designed tops plus the growth of the items above them. */
export function Flow({ nodes, height }: { nodes: RNode[]; height: number }) {
  const { S } = useContext(Options);
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ shifts: number[]; height: number }>({ shifts: nodes.map(() => 0), height: height * S });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const kids = Array.from(el.children) as HTMLElement[];
      const info = nodes.map((n, i) => {
        const orig = n.height * S;
        const actual = kids[i] ? kids[i].offsetHeight : orig;
        return { n, top: n.top * S, orig, growth: n.hidden ? 0 : Math.max(0, actual - orig), shift: 0, i };
      });
      const byTop = [...info].sort((a, b) => a.top - b.top);
      for (const [k, a] of byTop.entries()) {
        for (const b of byTop.slice(0, k)) {
          if (b.top + b.orig <= a.top + 0.5) a.shift = Math.max(a.shift, b.shift + b.growth);
        }
      }
      const shifts = info.map(x => x.shift);
      const maxGrowth = Math.max(0, ...info.map(x => x.shift + x.growth));
      const h = Math.max(height * S + maxGrowth, ...info.map(x => x.top + x.shift + x.orig + x.growth));
      setLayout(prev => (prev.height === h && prev.shifts.every((s, i) => s === shifts[i]) && prev.shifts.length === shifts.length ? prev : { shifts, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    for (const k of Array.from(el.children)) ro.observe(k);
    return () => ro.disconnect();
  }, [nodes, height, S]);

  return (
    <div ref={ref} style={{ position: 'relative', height: layout.height }}>
      {nodes.map((n, i) => <NodeView key={n.key} node={n} shift={layout.shifts[i] ?? 0} />)}
    </div>
  );
}

const V_ALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

export function NodeView({ node, shift = 0, inCell = false }: { node: RNode; shift?: number; inCell?: boolean }) {
  const o = useContext(Options);
  const { S } = o;
  const pos: CSSProperties = inCell
    ? { position: 'relative', width: '100%', minHeight: node.height * S }
    : { position: 'absolute', left: node.left * S, top: node.top * S + shift, width: node.width * S };
  const hidden: CSSProperties = node.hidden ? (o.showHidden ? { opacity: 0.4, outline: '1px dashed #999' } : { visibility: 'hidden' }) : {};
  const selected: CSSProperties = o.selected && o.selected === node.name ? { outline: '2px solid #0a84ff', outlineOffset: -2, zIndex: 2 } : {};
  const common = {
    'data-key': node.key,
    ...(node.pageBreakBefore ? { 'data-break': node.resetPageNumber ? 'reset' : '' } : {}),
    ...(node.pageBreakAfter ? { 'data-break-after': node.resetPageNumber ? 'reset' : '' } : {}),
    'data-seq': node.seq,
    ...(node.values ? { 'data-values': '' } : {}),
    ...(node.keepTogether ? { 'data-keep': '' } : {}),
    ...(node.bookmark ? { 'data-bookmark': node.bookmark } : {}),
    ...(node.action && o.onAction ? { title: actionTitle(node.action), 'data-action': '' } : {}),
    onClick: o.onPick ? (e: RMouseEvent) => { e.stopPropagation(); o.onPick!(node.name, e); }
      : node.action && o.onAction ? (e: RMouseEvent) => { e.stopPropagation(); o.onAction!(node.action!); }
      : undefined,
  };

  switch (node.kind) {
    case 'box': {
      if (node.paragraphs) {
        // textbox
        const fixed: CSSProperties = node.canGrow
          ? { minHeight: node.height * S }
          : { height: node.height * S, overflow: 'hidden' };
        return (
          <div {...common} data-leaf="" style={{
            ...pos, ...fixed, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: V_ALIGN[node.vAlign],
            fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '10pt', color: 'black', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.15,
            ...node.css, ...hidden, ...selected,
          }}>
            {node.paragraphs.map((p, i) => (
              <div key={i} style={p.css}>
                {i === 0 && (node.toggle || node.userSort) && <Interactive node={node} />}
                {p.runs.map((r, j) => <span key={j} style={r.css}>{r.text}</span>)}{p.runs.every(r => !r.text) ? '​' : null}
              </div>
            ))}
          </div>
        );
      }
      // rectangle
      return (
        <div {...common} style={{ ...pos, boxSizing: 'border-box', ...node.css, ...hidden, ...selected }}>
          <Flow nodes={node.children ?? []} height={node.height} />
        </div>
      );
    }
    case 'table': {
      const width = node.columns.reduce((a, b) => a + b, 0) * S;
      return (
        <table {...common} data-table="" style={{ ...pos, width, borderCollapse: 'collapse', tableLayout: 'fixed', borderSpacing: 0, ...node.css, ...hidden, ...selected }}>
          <colgroup>{node.columns.map((w, i) => <col key={i} style={{ width: w * S }} />)}</colgroup>
          <tbody>
            {node.rows.map(r => (
              <tr key={r.key} data-key={r.key} style={{ height: r.height * S }}
                {...(hasNestedTable(r) ? {} : { 'data-leaf': '' })}
                {...(r.breakAfter ? { 'data-break-after': r.resetPageNumberAfter ? 'reset' : '' } : {})}
                {...(r.breakBefore ? { 'data-break': r.resetPageNumber ? 'reset' : '' } : {})}
                {...(r.repeat ? { 'data-repeat': '' } : {})}>
                {r.cells.map((c, i) => (
                  <td key={i} colSpan={c.colSpan} rowSpan={c.rowSpan} style={{ padding: 0, verticalAlign: 'top', height: r.height * S }}>
                    {c.node && <NodeView node={c.node} inCell />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'line':
      return (
        <svg {...common} data-leaf="" style={{ ...pos, width: Math.max(node.width * S, 1), height: Math.max(node.height * S, 1), overflow: 'visible', ...hidden }}>
          <line x1={0} y1={0} x2={node.width * S} y2={node.height * S} stroke={node.stroke} strokeWidth={node.strokeWidth} strokeDasharray={node.dash} />
        </svg>
      );
    case 'image':
      return (
        <div {...common} data-leaf="" style={{ ...pos, height: node.height * S, overflow: 'hidden', ...node.css, ...hidden, ...selected }}>
          {node.src
            ? <img src={node.src} alt="" style={{ width: '100%', height: '100%', objectFit: node.sizing === 'Fit' ? 'fill' : node.sizing === 'Clip' ? 'none' : 'contain', objectPosition: 'left top' }}
                onError={e => { e.currentTarget.style.display = 'none'; }} />
            : <div style={{ fontSize: 10, color: '#999', padding: 2 }}>{l10n.t('Image')}</div>}
        </div>
      );
    case 'chart':
      return (
        <div {...common} data-leaf="" style={{ ...pos, height: node.height * S, ...hidden, ...selected }}>
          <ChartView chart={node} S={S} style={{ display: 'block' }} />
        </div>
      );
    case 'gauge':
      return (
        <div {...common} data-leaf="" style={{ ...pos, height: node.height * S, ...hidden, ...selected }}>
          <GaugeView gauge={node} S={S} style={{ display: 'block' }} />
        </div>
      );
    case 'placeholder':
      return (
        <div {...common} data-leaf="" style={{ ...pos, height: node.height * S, border: '1px dashed #bbb', color: '#888', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', ...hidden, ...selected }}>
          {node.label}
        </div>
      );
  }
}
