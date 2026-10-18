import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bcMockRows, previewParameters } from '../bc';
import { useCommand, useEditor } from '../editor';
import type { Row } from '../expr';
import { Parameter } from '../model';
import { browserDom, serializeRdl } from '../rdl';
import { renderReport } from '../render/engine';
import { Measured, PageSlice, paginate } from '../render/paginate';
import { Flow, NodeView, RenderOptionsProvider } from '../render/RenderView';
import { PageInfo, RAction, RNode, RTable } from '../render/types';
import { bindRows, mockRows, numericFieldsFromLayout } from '../sampleData';
import { post, requestFonts } from '../vscode';
import { ActionButton, Codicon, DropdownAction, Separator } from './Icon';
import { exportBlocks } from '../render/export';
import { pagesToPdf } from '../render/pdf';
import { l10n } from '../l10n';

const S = 96;

function convertParam(p: Parameter, v: string): unknown {
  if (v === '') return p.nullable ? null : '';
  switch (p.dataType) {
    case 'Integer': return parseInt(v, 10);
    case 'Float': return parseFloat(v.replace(',', '.'));
    case 'Boolean': return v.toLowerCase() === 'true';
    case 'DateTime': { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d; }
    default: return v;
  }
}

/** Render nodes by key (for ReportItems values and repeated table headers). */
function indexNodes(nodes: RNode[], map = new Map<string, RNode>()) {
  for (const n of nodes) {
    map.set(n.key, n);
    if (n.kind === 'box') indexNodes(n.children ?? [], map);
    if (n.kind === 'table') for (const r of n.rows) for (const c of r.cells) if (c.node) indexNodes([c.node], map);
  }
  return map;
}

interface Mark { top: number; key: string; seq: number; values: boolean }

/** Measures the laid-out body: unbreakable elements, forced breaks, repeated headers, item positions. */
function measure(root: HTMLElement): { m: Measured; marks: Mark[]; tableLeft: Map<string, number> } {
  const base = root.getBoundingClientRect();
  const rel = (el: Element) => { const r = el.getBoundingClientRect(); return { top: r.top - base.top, bottom: r.bottom - base.top, left: r.left - base.left }; };
  const all = (sel: string) => Array.from(root.querySelectorAll(sel));
  const tableLeft = new Map<string, number>();
  const tables: Measured['tables'] = [];
  for (const t of all('table[data-table]')) {
    const rows = Array.from(t.querySelectorAll(':scope > tbody > tr'));
    const lead = rows.findIndex(r => !r.hasAttribute('data-repeat'));
    const box = rel(t);
    tableLeft.set(t.getAttribute('data-key')!, box.left);
    if (lead > 0) tables.push({ key: t.getAttribute('data-key')!, top: box.top, bottom: box.bottom, headerBottom: rel(rows[lead]).top });
  }
  return {
    m: {
      height: root.scrollHeight,
      leaves: all('[data-leaf]').map(rel),
      keeps: all('[data-keep]').map(rel),
      forced: [
        ...all('[data-break]').map(r => ({ y: rel(r).top, reset: r.getAttribute('data-break') === 'reset' })),
        ...all('[data-break-after]').map(r => ({ y: rel(r).bottom, reset: r.getAttribute('data-break-after') === 'reset' })),
      ],
      tables,
    },
    marks: all('[data-seq]').map(e => ({ top: rel(e).top, key: e.getAttribute('data-key')!, seq: Number(e.getAttribute('data-seq')), values: e.hasAttribute('data-values') })),
    tableLeft,
  };
}

export function Preview({ fileName, onPage }: { fileName: string; onPage: (p: { current: number; total: number } | undefined) => void }) {
  const ed = useEditor();
  const { report, bc } = ed;
  const isBc = ed.isBc;
  // Business Central fills labels/captions at run time: their values come from AL and need no input
  const defaults = useMemo(() => previewParameters(report, bc), [report, bc]);
  const [input, setInput] = useState<Record<string, string>>(defaults);
  const [applied, setApplied] = useState<Record<string, string>>(defaults);
  useEffect(() => {
    setInput(prev => (isBc ? defaults : { ...defaults, ...prev }));
    if (isBc) setApplied(defaults);
  }, [defaults, isBc]);
  const zoom = ed.view.zoom;
  const [renderAll, setRenderAll] = useState(false);
  const missing = isBc ? [] : report.parameters.filter(p => (input[p.name] ?? '') === '' && !p.allowBlank && !p.nullable);

  // data per dataset: loaded data, otherwise generated rows (Business Central: shaped like the AL data items)
  const xml = useMemo(() => serializeRdl(report), [report]);
  const { data, generated } = useMemo(() => {
    const out: Record<string, Row[]> = {};
    const gen: string[] = [];
    const numeric = numericFieldsFromLayout(xml);
    for (const ds of report.dataSets) {
      const sample = ed.sampleData[ds.name];
      if (sample) out[ds.name] = bindRows(ds, sample);
      else {
        gen.push(ds.name);
        out[ds.name] = bindRows(ds, bc && ds.name === 'DataSet_Result' ? bcMockRows(bc, ds.fields, numeric) : mockRows(ds, 8, numeric));
      }
    }
    return { data: out, generated: gen };
  }, [report, ed.sampleData, bc, xml]);

  // interactivity: expanded/collapsed drilldowns and interactive sorts, reset when the report changes
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [userSort, setUserSort] = useState<Record<string, 'Ascending' | 'Descending'>>({});
  useEffect(() => { setToggled(new Set()); setUserSort({}); }, [xml]);
  const onToggle = (key: string) => setToggled(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // like the report server: one sort at a time, clicking again reverses it
  const onSort = (name: string) => setUserSort(prev => ({ [name]: prev[name] === 'Ascending' ? 'Descending' : 'Ascending' }));
  // actions: URLs open outside VS Code, bookmark links scroll to the target, drillthrough needs the report server
  const onAction = (a: RAction) => {
    if (a.kind === 'hyperlink') {
      if (a.url) post({ type: 'openLink', url: a.url });
    } else if (a.kind === 'bookmarkLink') {
      // pages are built lazily: find the target in the continuous (measured) body and scroll to its page
      const body = measureRef.current;
      const target = body?.querySelector(`[data-bookmark="${CSS.escape(a.bookmark)}"]`);
      if (!body || !target) { post({ type: 'info', message: l10n.t('Bookmark "{0}" does not occur in the preview.', a.bookmark) }); return; }
      const y = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const index = Math.max(0, pages.findIndex(pg => y >= pg.start && y < pg.end));
      const pageH = (p.height * S + 16) * zoom;
      scrollRef.current?.scrollTo({ top: index * pageH, behavior: 'smooth' });
    } else {
      const params = a.parameters.map(([n, v]) => `${n} = ${v}`).join(', ');
      post({ type: 'info', message: l10n.t('Drillthrough to "{0}"{1} – only the report server runs drillthrough reports.', a.report, params ? ` (${params})` : '') });
    }
  };

  const result = useMemo(() => renderReport(xml, {
    dom: browserDom, mode: 'preview', data, reportName: fileName.replace(/\.rdlc?$/i, ''),
    parameters: Object.fromEntries(report.parameters.map(p => [p.name, convertParam(p, applied[p.name] ?? '')])),
    toggled, userSort,
  }), [xml, data, applied, fileName, report.parameters, toggled, userSort]);
  const nodes = useMemo(() => indexNodes(result.body.nodes), [result]);

  // measure the continuous body, then break it into pages
  const measureRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<ReturnType<typeof measure> | null>(null);
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    let frame = 0;
    let disposed = false;
    // Flush layout so the FontFaceSet knows which report fonts need loading.
    el.getBoundingClientRect();
    let fontsReady = false;
    setMeasured(null);
    const update = () => {
      cancelAnimationFrame(frame);
      if (!disposed && fontsReady) frame = requestAnimationFrame(() => setMeasured(measure(el)));
    };
    // Start font loading for the actual report text before measuring page boundaries.
    void document.fonts.ready.then(() => { fontsReady = true; update(); });
    const loaded = () => { fontsReady = true; update(); };
    document.fonts.addEventListener('loadingdone', loaded);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { disposed = true; ro.disconnect(); cancelAnimationFrame(frame); document.fonts.removeEventListener('loadingdone', loaded); };
  }, [result]);

  const p = result.page;
  const headerH = (result.header?.height ?? 0) * S, footerH = (result.footer?.height ?? 0) * S;
  const available = (p.height - p.marginTop - p.marginBottom) * S - headerH - footerH;
  const pages: PageSlice[] = useMemo(() => (measured ? paginate(measured.m, available) : []), [measured, available]);

  // page numbers (ResetPageNumber starts a new numbering section) and per-page context for headers/footers
  const pageInfos: PageInfo[] = useMemo(() => {
    if (!measured) return [];
    const sectionSizes: number[] = [];
    pages.forEach((pg, i) => { if (i === 0 || pg.reset) sectionSizes.push(0); sectionSizes[sectionSizes.length - 1]++; });
    let section = -1, inSection = 0;
    const marks = [...measured.marks].sort((a, b) => a.top - b.top);
    return pages.map((pg, i) => {
      if (i === 0 || pg.reset) { section++; inSection = 0; }
      inSection++;
      const onPage = marks.filter(mk => mk.top >= pg.start - 0.5 && mk.top < pg.end - 0.5);
      const items = new Map<string, unknown[]>();
      for (const mk of onPage) {
        if (!mk.values) continue;
        for (const [name, v] of nodes.get(mk.key)?.values ?? []) items.set(name, [...(items.get(name) ?? []), v]);
      }
      return {
        number: inSection, total: sectionSizes[section], overallNumber: i + 1, overallTotal: pages.length,
        // Code state at the end of the page: the last textbox evaluated on or before it (containers carry the state
        // after their whole content and would leak later pages' state)
        version: Math.max(0, ...marks.filter(mk => mk.values && mk.top < pg.end - 0.5).map(mk => mk.seq)), reportItems: items,
      };
    });
  }, [pages, measured, nodes]);

  // tell the extension when the preview is complete (status for commands and integration tests)
  useEffect(() => { if (pages.length) post({ type: 'previewReady', pages: pages.length, errors: result.errors.length }); }, [pages.length, result]);

  const pagesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const shownPage = Math.min(currentPage, pages.length || 1);
  useEffect(() => { onPage(pages.length ? { current: shownPage, total: pages.length } : undefined); }, [shownPage, pages.length]);
  useEffect(() => () => onPage(undefined), []);
  const goTo = (n: number) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: (n - 1) * (p.height * S + 16) * zoom });
  };

  const exportPages = (kind: 'print' | 'html') => {
    setRenderAll(true);
    // mount all pages, then let their flows settle before taking the HTML
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
      const html = pagesRef.current?.innerHTML ?? '';
      setRenderAll(false);
      const doc = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${fileName.replace(/[<>&]/g, '')}</title>
<style>@page { size: ${p.width}in ${p.height}in; margin: 0 } body { margin: 0; background: #eee } .rv-page { margin: 16px auto }
@media print { body { background: none } .rv-page { margin: 0 !important; box-shadow: none !important; break-after: page } }
.rv-interactive { display: none !important }</style></head>
<body>${html}${kind === 'print' ? '<script>window.onload = () => setTimeout(() => window.print(), 300)</script>' : ''}</body></html>\n`;
      post(kind === 'print' ? { type: 'print', html: doc } : { type: 'exportHtml', html: doc });
    }, 200)));
  };

  // PDF: all pages mounted at zoom 1, drawn into a PDF here, saved by the extension
  const [pdfExport, setPdfExport] = useState(false);
  const exportPdf = () => {
    if (!pages.length || pdfExport) return;
    setRenderAll(true);
    setPdfExport(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(async () => {
      const name = fileName.replace(/\.rdlc?$/i, '');
      try {
        await document.fonts.ready;
        const els = Array.from(pagesRef.current?.querySelectorAll<HTMLElement>('.rv-page') ?? []);
        const bytes = await pagesToPdf(els, { width: p.width, height: p.height }, name, async styles =>
          (await requestFonts(styles)).map(b64 => (b64 ? Uint8Array.from(atob(b64), c => c.charCodeAt(0)) : null)));
        let data = '';
        for (let i = 0; i < bytes.length; i += 0x8000) data += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        post({ type: 'savePdf', name, data: btoa(data) });
      } catch (e) {
        post({ type: 'error', message: `PDF-Export fehlgeschlagen: ${(e as Error).message}` });
      } finally {
        setRenderAll(false);
        setPdfExport(false);
      }
    }, 300)));
  };
  useCommand('exportPdf', exportPdf);

  const exportDocument = (format: 'xlsx' | 'docx') => post({
    type: 'exportDocument', format, blocks: exportBlocks(result),
    page: { width: p.width, height: p.height, margins: [p.marginTop, p.marginRight, p.marginBottom, p.marginLeft] },
  });
  useCommand('exportExcel', () => exportDocument('xlsx'));
  useCommand('exportWord', () => exportDocument('docx'));
  useCommand('print', () => pages.length && exportPages('print'));
  useCommand('exportHtml', () => pages.length && exportPages('html'));

  return (
    <RenderOptionsProvider value={{ S, onToggle, onSort, onAction }}>
      <div className="preview">
        {!isBc && report.parameters.length > 0 && (
          <div className="param-bar">
            {report.parameters.map(par => (
              <label key={par.id}>
                <span>{par.prompt || par.name}</span>
                {par.dataType === 'Boolean' ? (
                  <select value={input[par.name] ?? ''} onChange={e => setInput({ ...input, [par.name]: e.target.value })}>
                    <option value="">–</option><option value="true">True</option><option value="false">False</option>
                  </select>
                ) : (
                  <input type={par.dataType === 'DateTime' ? 'date' : par.dataType === 'String' ? 'text' : 'number'}
                    value={input[par.name] ?? ''} onChange={e => setInput({ ...input, [par.name]: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter' && !missing.length) setApplied({ ...input }); }} />
                )}
              </label>
            ))}
            <button className="primary" disabled={missing.length > 0} title={missing.length ? l10n.t('Value missing: {0}', missing.map(x => x.name).join(', ')) : undefined}
              onClick={() => setApplied({ ...input })}>{l10n.t('View Report')}</button>
          </div>
        )}
        <div className="toolbar" role="toolbar" aria-label={l10n.t('Preview')}>
          <div className="action-group">
            <ActionButton icon="edit" title={l10n.t('Back to Design (F5)')} label={l10n.t('Design')} onClick={() => ed.setMode('design')} />
          </div>
          <Separator />
          <div className="action-group" aria-label={l10n.t('Pages')}>
            <ActionButton icon="arrow-up" title={l10n.t('Previous Page')} disabled={shownPage <= 1} onClick={() => goTo(shownPage - 1)} />
            <span className="page-indicator">{shownPage} / {pages.length || 1}</span>
            <ActionButton icon="arrow-down" title={l10n.t('Next Page')} disabled={shownPage >= pages.length} onClick={() => goTo(shownPage + 1)} />
          </div>
          <Separator />
          <div className="action-group">
            <ActionButton icon="file-pdf" title={l10n.t('Open in the browser and print or save as PDF')} label={l10n.t('Print')} disabled={!pages.length} onClick={() => exportPages('print')} />
            <DropdownAction icon="export" title={l10n.t('Export')} disabled={!pages.length} items={[
              { label: 'PDF (.pdf)…', icon: 'file-pdf', run: exportPdf },
              { label: 'Excel (.xlsx)…', icon: 'table', run: () => exportDocument('xlsx') },
              { label: 'Word (.docx)…', icon: 'file-text', run: () => exportDocument('docx') },
              { label: 'HTML…', icon: 'code', run: () => exportPages('html') },
            ]} />
          </div>
          <span className="grow" />
          <span className={`toolbar-note ${generated.length ? 'generated' : ''}`}
            title={generated.length ? l10n.t('Real data: Report Data › Load Preview Data') : undefined}>
            <Codicon name={generated.length ? 'sparkle' : 'database'} />
            {generated.length ? l10n.t('Sample data for {0}', generated.join(', ')) : l10n.t('Loaded data')}
          </span>
          {generated.length > 0 && <ActionButton icon="cloud-download" title={l10n.t('Load Preview Data (Excel, CSV, JSON)…')} onClick={() => ed.commands.get('importSampleData')?.()} />}
        </div>
        <div className="preview-scroll" ref={scrollRef} onScroll={e => {
          const el = e.currentTarget;
          const pageH = (p.height * S + 16) * zoom;
          setCurrentPage(Math.floor((el.scrollTop + el.clientHeight / 3) / pageH) + 1);
        }}>
          {/* continuous body, invisible: measured for page breaking */}
          <div ref={measureRef} className="measure" style={{ width: result.bodyWidth * S }} aria-hidden>
            <Flow nodes={result.body.nodes} height={result.body.height} />
          </div>
          <div ref={pagesRef} style={{ zoom: pdfExport ? 1 : zoom }}>
            {measured && pages.map((pg, i) => (
              <PageView key={i} slice={pg} info={pageInfos[i]} isFirst={i === 0} isLast={i === pages.length - 1}
                result={result} nodes={nodes} tableLeft={measured.tableLeft} forceMount={renderAll} />
            ))}
          </div>
          {!pages.length && <div className="preview-empty">{l10n.t('Building the report…')}</div>}
        </div>
        {result.errors.length > 0 && (
          <div className="preview-errors">
            <b><Codicon name="warning" /> {l10n.t('{0} note(s) from the evaluation', result.errors.length)}</b>
            {result.errors.map(([where, msg]) => <div key={where}><code>{where}</code>: {msg}</div>)}
          </div>
        )}
      </div>
    </RenderOptionsProvider>
  );
}

function PageView(props: {
  slice: PageSlice; info: PageInfo | undefined; isFirst: boolean; isLast: boolean;
  result: ReturnType<typeof renderReport>; nodes: Map<string, RNode>; tableLeft: Map<string, number>; forceMount: boolean;
}) {
  const { slice, info, result, isFirst, isLast } = props;
  const p = result.page;
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // only pages near the viewport are built
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '1500px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const mounted = visible || props.forceMount;
  const headerRows = (t: RTable) => t.rows.slice(0, Math.max(0, t.rows.findIndex(r => !r.repeat)));

  const section = (kind: 'header' | 'footer') => {
    const s = kind === 'header' ? result.header : result.footer;
    if (!s || !info) return null;
    if ((isFirst && !s.printOnFirstPage) || (isLast && !isFirst && !s.printOnLastPage)) return <div style={{ height: s.height * S }} />;
    const rendered = mounted ? result.renderSection(kind, info) : null;
    return (
      <div style={{ height: s.height * S, overflow: 'hidden', position: 'relative', ...rendered?.css }}>
        {rendered && <Flow nodes={rendered.nodes} height={rendered.height} />}
      </div>
    );
  };

  let offset = 0;
  return (
    <div ref={ref} className="rv-page" style={{
      width: p.width * S, height: p.height * S, boxSizing: 'border-box', background: 'white', color: 'black', position: 'relative',
      padding: `${p.marginTop * S}px ${p.marginRight * S}px ${p.marginBottom * S}px ${p.marginLeft * S}px`,
      margin: '16px auto', boxShadow: '0 1px 6px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {section('header')}
      <div style={{ height: slice.end - slice.start + slice.repeatHeight, width: result.bodyWidth * S, position: 'relative', overflow: 'hidden', flexShrink: 0, ...result.body.css }}>
        {mounted && <>
          {/* header rows of tables continuing from the previous page (RepeatOnNewPage) */}
          {slice.repeat.map(key => {
            const t = props.nodes.get(key) as RTable | undefined;
            if (!t) return null;
            const rows = headerRows(t);
            const top = offset;
            offset += rows.reduce((h, r) => h + r.height * S, 0);
            const header: RTable = { ...t, key: `${t.key}-repeat`, top: 0, left: (props.tableLeft.get(key) ?? 0) / S, rows };
            return <div key={key} style={{ position: 'absolute', top, left: 0, right: 0 }}><NodeView node={header} /></div>;
          })}
          <div style={{ position: 'absolute', top: slice.repeatHeight - slice.start, left: 0, width: '100%' }}>
            <Flow nodes={result.body.nodes} height={result.body.height} />
          </div>
        </>}
      </div>
      <div style={{ flex: 1 }} />
      {section('footer')}
    </div>
  );
}
