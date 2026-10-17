import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Diagnostic, Dialog, Editor, EditorContext, InsertTool, TablePart, useCommand, useEditor } from './editor';
import { BcContext, isBcLayout } from './bc';
import { Report, ReportItem, TextboxItem, allReportItems } from './model';
import { alignItems, centerInContainer, distribute, makeSameSize } from './layoutTools';
import { cloneItems, deleteItems, fitSections, locate, reorder, sectionOf } from './ops';
import { parseRdl, serializeRdl } from './rdl';
import { newReportTemplate } from './templates';
import { DesignerConfig, post, vscode } from './vscode';
import { Designer } from './components/Designer';
import { Dialogs } from './components/Dialogs';
import { DocumentOutline } from './components/DocumentOutline';
import { Codicon } from './components/Icon';
import { Preview } from './components/Preview';
import { PropertiesPane } from './components/PropertiesPane';
import { ReportDataPane } from './components/ReportDataPane';
import { Toolbar } from './components/Toolbar';
import { GroupingPane } from './components/GroupingPane';

type FromExtension =
  | { type: 'load'; text: string; fileName: string }
  | { type: 'sampleData'; data: Record<string, Record<string, unknown>[]> }
  | { type: 'bcContext'; context: BcContext | null }
  | { type: 'diagnostics'; issues: Diagnostic[] }
  | { type: 'config'; config: DesignerConfig }
  | { type: 'command'; id: string; arg?: unknown }
  | { type: 'toggleMode' };

type PersistedView = Pick<Editor['view'], 'zoom' | 'dataPane' | 'propertiesPane' | 'leftTab' | 'leftWidth' | 'rightWidth'>;
const DEFAULT_VIEW: Editor['view'] = {
  zoom: 1, grid: true, snap: true, ruler: true, dataPane: true, propertiesPane: true, leftTab: 'outline', leftWidth: 280, rightWidth: 300,
};
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const TYPE_LABEL: Record<string, string> = {
  textbox: 'Textfeld', rectangle: 'Rechteck', line: 'Linie', image: 'Bild', table: 'Tabelle', raw: 'Element',
};
const TOOL_LABEL: Record<InsertTool, string> = { textbox: 'Textfeld', table: 'Tabelle', image: 'Bild', line: 'Linie', rectangle: 'Rechteck' };

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function App() {
  const [report, setReport] = useState<Report | null>(null);
  const reportRef = useRef<Report | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const selectionRef = useRef<string[]>([]);
  const [tablePart, setTablePart] = useState<TablePart | null>(null);
  const [tool, setTool] = useState<InsertTool | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [sampleData, setSampleData] = useState<Editor['sampleData']>({});
  // Restored per editor (VS Code keeps webview state across reloads); without saved state the settings decide the zoom.
  const saved = useRef(vscode.getState() as Partial<PersistedView> | undefined);
  const [view, setViewState] = useState<Editor['view']>(() => ({ ...DEFAULT_VIEW, ...saved.current }));
  const commands = useRef(new Map<string, (arg?: unknown) => void>()).current;
  const [page, setPage] = useState<{ current: number; total: number } | undefined>();
  const [clipboard, setClipboard] = useState<ReportItem[]>([]);
  const [mode, setMode] = useState<'design' | 'preview'>('design');
  const [bc, setBc] = useState<BcContext | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [nested, setNested] = useState<string | null>(null);

  const setView = useCallback((v: Partial<Editor['view']>) => setViewState(prev => {
    const next = { ...prev, ...v };
    const { zoom, dataPane, propertiesPane, leftTab, leftWidth, rightWidth } = next;
    vscode.setState({ zoom, dataPane, propertiesPane, leftTab, leftWidth, rightWidth } satisfies PersistedView);
    return next;
  }), []);

  const select = useCallback((names: string[], part: TablePart | null = null) => {
    selectionRef.current = names;
    setSelection(names);
    setTablePart(part);
    setNested(null);
  }, []);

  const commit = useCallback((mutate: (draft: Report) => void | boolean) => {
    const current = reportRef.current;
    if (!current) return;
    const draft = structuredClone(current);
    if (mutate(draft) === false) return;
    fitSections(draft);
    reportRef.current = draft;
    setReport(draft);
    post({ type: 'edit', text: serializeRdl(draft) });
  }, []);

  // ------------------------------------------------------------------------------------------------ extension messages

  useEffect(() => {
    const onMessage = (e: MessageEvent<FromExtension>) => {
      const msg = e.data;
      if (msg.type === 'load') {
        setFileName(msg.fileName);
        if (!msg.text.trim()) {
          // Empty .rdl file: start from Report Builder's blank report.
          const r = newReportTemplate();
          reportRef.current = r;
          setReport(r);
          setLoadError(null);
          post({ type: 'edit', text: serializeRdl(r) });
          return;
        }
        try {
          const r = parseRdl(msg.text);
          reportRef.current = r;
          setReport(r);
          setLoadError(null);
          const all = allReportItems(r);
          post({ type: 'loaded', items: all.length, raw: all.filter(i => i.type === 'raw').length });
          // Keep the selection across undo/redo where the items still exist.
          const kept = selectionRef.current.filter(n => locate(r, n));
          selectionRef.current = kept;
          setSelection(kept);
        } catch (err) {
          setLoadError((err as Error).message);
        }
      } else if (msg.type === 'sampleData') {
        setSampleData(msg.data ?? {});
      } else if (msg.type === 'bcContext') {
        setBc(msg.context);
      } else if (msg.type === 'diagnostics') {
        setDiagnostics(msg.issues);
      } else if (msg.type === 'config') {
        const { grid, snap, ruler, defaultZoom } = msg.config;
        setViewState(prev => ({ ...prev, grid, snap, ruler, zoom: saved.current?.zoom ?? defaultZoom }));
        saved.current = { ...saved.current, zoom: saved.current?.zoom ?? defaultZoom };
      } else if (msg.type === 'command') {
        commands.get(msg.id)?.(msg.arg);
      } else if (msg.type === 'toggleMode') {
        setMode(m => (m === 'design' ? 'preview' : 'design'));
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // ------------------------------------------------------------------------------------------------ clipboard

  const copy = useCallback((cut: boolean) => {
    const r = reportRef.current;
    if (!r) return;
    const items = selectionRef.current.map(n => locate(r, n)).filter(l => l?.container).map(l => structuredClone(l!.item));
    if (!items.length) return;
    setClipboard(items);
    if (cut) {
      commit(d => deleteItems(d, selectionRef.current));
      select([]);
    }
  }, [commit, select]);

  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  const paste = useCallback(() => {
    let names: string[] = [];
    commit(r => {
      if (!clipboardRef.current.length) return false;
      const target = selectionRef.current.map(n => locate(r, n)).find(Boolean)?.section ?? 'body';
      const copies = cloneItems(r, clipboardRef.current, 0.125);
      sectionOf(r, target).items.push(...copies);
      names = copies.map(c => c.name);
    });
    if (names.length) select(names);
  }, [commit, select]);

  // ------------------------------------------------------------------------------------------------ keyboard

  useEffect(() => {
    // F5 (preview) is a VS Code keybinding: the webview forwards key presses to the workbench.
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || dialog || mode !== 'design') return;
      const mod = e.metaKey || e.ctrlKey;
      const sel = selectionRef.current;
      if (e.key === 'Escape') { setTool(null); select([]); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        e.preventDefault();
        commit(r => deleteItems(r, sel));
        select(sel.filter(n => reportRef.current && locate(reportRef.current, n)), tablePart);
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') { copy(false); return; }
      if (mod && e.key.toLowerCase() === 'x') { copy(true); return; }
      if (mod && e.key.toLowerCase() === 'v') { paste(); return; }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        if (reportRef.current) select(reportRef.current.body.items.map(i => i.name));
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key] && sel.length) {
        e.preventDefault();
        const r = reportRef.current!;
        const step = e.shiftKey ? 1 / 96 : r.unit === 'in' ? 0.125 : 0.25 / 2.54;
        const [dx, dy] = arrows[e.key];
        commit(d => {
          let moved = false;
          for (const n of sel) {
            const loc = locate(d, n);
            if (!loc?.container) continue;
            loc.item.left = Math.max(0, loc.item.left + dx * step);
            loc.item.top = Math.max(0, loc.item.top + dy * step);
            moved = true;
          }
          return moved;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, copy, paste, select, dialog, mode, tablePart]);

  const changeMode = useCallback((m: 'design' | 'preview') => { setMode(m); setTool(null); }, []);

  const editor = useMemo<Editor | null>(() => report && {
    report, commit, selection, select, tablePart, tool, setTool, dialog, setDialog, sampleData, view, setView, clipboard, copy, paste,
    bc, isBc: isBcLayout(report, bc), diagnostics, nested, setNested, mode, setMode: changeMode, commands,
  }, [report, commit, selection, select, tablePart, tool, dialog, sampleData, view, setView, clipboard, copy, paste, bc, diagnostics, nested, mode, changeMode, commands]);

  // ------------------------------------------------------------------------------------------------ state for VS Code

  const selected = editor && selection.length === 1 ? locate(editor.report, selection[0]) : null;
  const status = tool
    ? `$(add) ${TOOL_LABEL[tool]}: klicken oder Rahmen ziehen`
    : selected ? `$(inspect) ${selected.item.name} (${selected.cell ? 'Tabellenzelle' : TYPE_LABEL[selected.item.type]})`
      : selection.length ? `$(inspect) ${selection.length} Elemente` : '';
  useEffect(() => {
    if (!report) return;
    post({
      type: 'state', state: {
        mode, zoom: view.zoom, unit: report.unit, status, hasSelection: selection.length > 0, canPaste: clipboard.length > 0,
        hasHeader: !!report.header, hasFooter: !!report.footer,
        panes: { outline: view.dataPane && view.leftTab === 'outline', reportData: view.dataPane && view.leftTab === 'data', properties: view.propertiesPane },
        page: mode === 'preview' ? page : undefined,
      },
    });
  }, [report, mode, view.zoom, view.dataPane, view.leftTab, view.propertiesPane, status, selection.length, clipboard.length, page]);

  // Ctrl/⌘ + mouse wheel zooms, like the image preview and the editor.
  const zoomRef = useRef(view.zoom);
  zoomRef.current = view.zoom;
  const onWheel = useCallback((e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const z = Math.min(4, Math.max(0.25, zoomRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    setView({ zoom: Math.round(z * 100) / 100 });
  }, [setView]);
  const centerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = centerRef.current;
    el?.addEventListener('wheel', onWheel, { passive: false });
    return () => el?.removeEventListener('wheel', onWheel);
  }, [onWheel, editor !== null]);

  if (loadError) {
    return (
      <div className="load-error">
        <Codicon name="error" className="load-error-icon" />
        <h2>Der Bericht konnte nicht geladen werden</h2>
        <pre>{loadError}</pre>
        <p>Die Datei ist kein gültiges RDL-XML. Korrigieren Sie sie im Texteditor – der Designer lädt sie danach automatisch neu.</p>
        <button className="primary" onClick={() => post({ type: 'openXml' })}>Als XML öffnen</button>
      </div>
    );
  }
  if (!editor) return <div className="loading"><div className="progress-bar" /></div>;

  return (
    <EditorContext.Provider value={editor}>
      <AppCommands />
      <div className="app">
        {mode === 'design' && <Toolbar />}
        <div className="main">
          {view.dataPane && <>
            <div className="pane left-pane" style={{ width: view.leftWidth }}>
              <div className="pane-header" role="tablist">
                <button role="tab" aria-selected={view.leftTab === 'outline'} className={view.leftTab === 'outline' ? 'on' : ''} onClick={() => setView({ leftTab: 'outline' })}>Gliederung</button>
                <button role="tab" aria-selected={view.leftTab === 'data'} className={view.leftTab === 'data' ? 'on' : ''} onClick={() => setView({ leftTab: 'data' })}>Berichtsdaten</button>
                <span className="grow" />
                <button className="action-item" title="Bereich ausblenden" onClick={() => setView({ dataPane: false })}><Codicon name="close" /></button>
              </div>
              {view.leftTab === 'outline' ? <DocumentOutline /> : <ReportDataPane />}
            </div>
            <Sash side="left" onResize={w => setView({ leftWidth: w })} width={view.leftWidth} />
          </>}
          <div className="center" ref={centerRef}>
            {mode === 'design' ? <><Designer /><GroupingPane /></> : <Preview fileName={fileName} onPage={setPage} />}
          </div>
          {view.propertiesPane && mode === 'design' && <>
            <Sash side="right" onResize={w => setView({ rightWidth: w })} width={view.rightWidth} />
            <PropertiesPane width={view.rightWidth} />
          </>}
        </div>
      </div>
      <Dialogs />
    </EditorContext.Provider>
  );
}

/** Commands of the whole editor (editor title, context menus, command palette, status bar). */
function AppCommands() {
  const ed = useEditor();
  const { view, setView } = ed;
  const zoomStep = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOM_LEVELS.find(z => z > view.zoom + 1e-6) : [...ZOOM_LEVELS].reverse().find(z => z < view.zoom - 1e-6);
    if (next) setView({ zoom: next });
  };
  const designOnly = (fn: () => void) => () => { if (ed.mode === 'design') fn(); };
  useCommand('togglePreview', () => ed.setMode(ed.mode === 'design' ? 'preview' : 'design'));
  useCommand('setMode', m => ed.setMode(m as 'design' | 'preview'));
  useCommand('setZoom', z => setView({ zoom: Number(z) }));
  useCommand('zoomIn', () => zoomStep(1));
  useCommand('zoomOut', () => zoomStep(-1));
  useCommand('zoomReset', () => setView({ zoom: 1 }));
  useCommand('setUnit', u => ed.commit(r => { r.unit = u as 'in' | 'cm'; }));
  useCommand('toggleOutline', () => setView(view.dataPane && view.leftTab === 'outline' ? { dataPane: false } : { dataPane: true, leftTab: 'outline' }));
  useCommand('toggleReportData', () => setView(view.dataPane && view.leftTab === 'data' ? { dataPane: false } : { dataPane: true, leftTab: 'data' }));
  useCommand('toggleProperties', () => setView({ propertiesPane: !view.propertiesPane }));
  useCommand('toggleHeader', () => ed.commit(r => { r.header = r.header ? null : { height: 1, items: [], style: {} }; }));
  useCommand('toggleFooter', () => ed.commit(r => { r.footer = r.footer ? null : { height: 1, items: [], style: {} }; }));
  useCommand('reportProperties', () => ed.setDialog({ kind: 'reportProperties' }));
  useCommand('importSampleData', arg => {
    const picked = (arg as { entryKind?: string; name?: string } | undefined)?.entryKind === 'dataSet' ? (arg as { name: string }).name : undefined;
    const ds = ed.report.dataSets.find(d => d.name === 'DataSet_Result') ?? ed.report.dataSets[0];
    post({ type: 'importSampleData', dataSet: picked ?? ds?.name });
  });
  for (const t of ['textbox', 'table', 'image', 'line', 'rectangle'] as const) {
    // hooks in a loop: the list is fixed, so the order is the same on every render
    useCommand(`insert.${t}`, () => { ed.setMode('design'); ed.setTool(t); });
  }
  useCommand('insert.chart', () => {
    ed.setMode('design');
    // below the selected item, else at the top of the body
    const loc = ed.selection[0] ? locate(ed.report, ed.selection[0]) : null;
    const at = loc?.container ? { section: loc.section, top: loc.item.top + loc.item.height + 0.125, left: loc.item.left } : { section: 'body' as const, top: 0.25, left: 0.25 };
    ed.setDialog({ kind: 'chart', create: at });
  });
  useCommand('insert.matrix', () => {
    ed.setMode('design');
    const loc = ed.selection[0] ? locate(ed.report, ed.selection[0]) : null;
    const at = loc?.container ? { section: loc.section, top: loc.item.top + loc.item.height + 0.125, left: loc.item.left } : { section: 'body' as const, top: 0.25, left: 0.25 };
    ed.setDialog({ kind: 'matrix', create: at });
  });
  useCommand('chart.properties', () => {
    const it = ed.selection[0] ? locate(ed.report, ed.selection[0])?.item : undefined;
    if (it?.type === 'raw' && it.kind === 'Chart') ed.setDialog({ kind: 'chart', name: it.name });
  });
  useCommand('cut', designOnly(() => ed.copy(true)));
  useCommand('copy', designOnly(() => ed.copy(false)));
  useCommand('paste', designOnly(() => ed.paste()));
  useCommand('delete', designOnly(() => {
    const names = ed.selection;
    ed.commit(r => deleteItems(r, names));
  }));
  const arrange = (front: boolean) => designOnly(() => {
    const name = ed.selection.find(n => locate(ed.report, n)?.container);
    if (name) ed.commit(r => reorder(locate(r, name)!, front));
  });
  useCommand('bringToFront', arrange(true));
  useCommand('sendToBack', arrange(false));

  // Format menu of the Visual Studio designer: align to / size like the first selected item, spacing, centering
  const layout = (fn: (r: Report, names: string[]) => boolean) => designOnly(() => {
    const names = ed.selection;
    ed.commit(r => fn(r, names));
  });
  useCommand('layout.alignLeft', layout((r, n) => alignItems(r, n, 'left')));
  useCommand('layout.alignCenter', layout((r, n) => alignItems(r, n, 'center')));
  useCommand('layout.alignRight', layout((r, n) => alignItems(r, n, 'right')));
  useCommand('layout.alignTop', layout((r, n) => alignItems(r, n, 'top')));
  useCommand('layout.alignMiddle', layout((r, n) => alignItems(r, n, 'middle')));
  useCommand('layout.alignBottom', layout((r, n) => alignItems(r, n, 'bottom')));
  useCommand('layout.sameWidth', layout((r, n) => makeSameSize(r, n, 'width')));
  useCommand('layout.sameHeight', layout((r, n) => makeSameSize(r, n, 'height')));
  useCommand('layout.sameSize', layout((r, n) => makeSameSize(r, n, 'both')));
  useCommand('layout.distributeHorizontal', layout((r, n) => distribute(r, n, 'horizontal')));
  useCommand('layout.distributeVertical', layout((r, n) => distribute(r, n, 'vertical')));
  useCommand('layout.centerHorizontal', layout((r, n) => centerInContainer(r, n, 'horizontal')));
  useCommand('layout.centerVertical', layout((r, n) => centerInContainer(r, n, 'vertical')));

  // from the extension: a textbox now shows a new AL label
  useCommand('setTextboxValue', arg => {
    const { name, value } = arg as { name: string; value: string };
    ed.commit(r => {
      const it = locate(r, name)?.item;
      if (it?.type !== 'textbox') return false;
      (it as TextboxItem).value = value;
    });
  });
  // CodeLens in AL: select the first textbox using a column/label (also inside regions kept verbatim)
  useCommand('revealReference', arg => {
    const { name } = arg as { name: string };
    const uses = new RegExp(`\\b(?:Fields|Parameters)!${name}(?:Format|Caption)?\\b`);
    ed.setMode('design');
    const items = allReportItems(ed.report);
    const tb = items.find(i => i.type === 'textbox' && uses.test(i.value + (i.style.Format ?? '')));
    const raw = tb ? undefined : items.find(i => i.type === 'raw' && uses.test(i.xml));
    const target = tb ?? raw;
    if (!target) return;
    ed.select([target.name]);
    if (raw && raw.type === 'raw') {
      const inner = [...raw.xml.matchAll(/<Textbox Name="([^"]+)">([\s\S]*?)<\/Textbox>/g)].find(m => uses.test(m[2]));
      if (inner) ed.setNested(inner[1]);
    }
    requestAnimationFrame(() => document.querySelector(`.designer [data-name="${CSS.escape(target.name)}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest' }));
  });
  return null;
}

/** Drag handle between panes, like VS Code's sashes (double-click restores the default width). */
function Sash({ side, width, onResize }: { side: 'left' | 'right'; width: number; onResize: (w: number) => void }) {
  const [active, setActive] = useState(false);
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    setActive(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      onResize(Math.round(Math.min(window.innerWidth * 0.6, Math.max(180, side === 'left' ? width + dx : width - dx))));
    };
    const up = () => {
      setActive(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className={`sash ${active ? 'active' : ''}`} onPointerDown={onPointerDown}
    onDoubleClick={() => onResize(side === 'left' ? DEFAULT_VIEW.leftWidth : DEFAULT_VIEW.rightWidth)} />;
}
