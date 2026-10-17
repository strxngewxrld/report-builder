import { createContext, useContext, useEffect, useRef } from 'react';
import type { Row } from './expr';
import { ItemType, Report, ReportItem } from './model';
import type { BcContext } from './bc';

/** A lint finding for this layout (from the extension). */
export interface Diagnostic { item?: string; severity: 'error' | 'warning' | 'info' | 'hint'; message: string; code: string }

export type Dialog =
  | { kind: 'dataSource'; name?: string }
  | { kind: 'dataSet'; name?: string }
  | { kind: 'parameter'; name?: string }
  | { kind: 'expression'; title: string; value: string; dataSetName?: string; onOk: (value: string) => void }
  | { kind: 'reportProperties' }
  /** Properties of a row group (member id), or a new group next to a row. */
  | { kind: 'group'; table: string; member?: string; create?: { rowId: string; mode: 'parent' | 'child' } | { column: number; mode: 'column' } }
  /** Insert a chart (create: where) or edit an existing one (name). */
  | { kind: 'chart'; name?: string; create?: { section: 'header' | 'body' | 'footer'; top: number; left: number } }
  | { kind: 'matrix'; create: { section: 'header' | 'body' | 'footer'; top: number; left: number } };

export type InsertTool = Exclude<ItemType, 'raw'>;

/** A column or row of a table selected through its handle (for resizing, deleting, …). */
export interface TablePart { table: string; kind: 'column' | 'row'; index: number }

export interface Editor {
  report: Report;
  /** Applies a mutation to a copy of the report, re-renders and writes the RDL back. Return false to abort. */
  commit: (mutate: (draft: Report) => void | boolean) => void;
  selection: string[];
  select: (names: string[], part?: TablePart | null) => void;
  tablePart: TablePart | null;
  tool: InsertTool | null;
  setTool: (t: InsertTool | null) => void;
  dialog: Dialog | null;
  setDialog: (d: Dialog | null) => void;
  /** Raw rows per dataset from <report>.data.json. */
  sampleData: Record<string, Record<string, unknown>[]>;
  /** Zoom, panes and pane widths are per editor; grid, snap and ruler come from the settings. */
  view: {
    zoom: number; grid: boolean; snap: boolean; ruler: boolean; dataPane: boolean; propertiesPane: boolean; leftTab: 'data' | 'outline';
    leftWidth: number; rightWidth: number;
  };
  setView: (v: Partial<Editor['view']>) => void;
  clipboard: ReportItem[];
  copy: (cut: boolean) => void;
  paste: () => void;
  /** AL report of a Business Central layout (null: not found / not BC). */
  bc: BcContext | null;
  /** Business Central layout: AL defines the data, SSRS data source/dataset editing is hidden. */
  isBc: boolean;
  diagnostics: Diagnostic[];
  /** Item selected inside a region the designer keeps verbatim (grouped Tablix …), by name. */
  nested: string | null;
  setNested: (name: string | null) => void;
  mode: 'design' | 'preview';
  setMode: (m: 'design' | 'preview') => void;
  /** Handlers of VS Code commands (editor title, context menus, command palette) by id. */
  commands: Map<string, (arg?: unknown) => void>;
}

export const EditorContext = createContext<Editor>(null!);
export const useEditor = () => useContext(EditorContext);

/** Handles a VS Code command (bcReportBuilder.<id>) while the component is mounted; the latest handler is used. */
export function useCommand(id: string, handler: (arg?: unknown) => void) {
  const { commands } = useEditor();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (arg?: unknown) => ref.current(arg);
    commands.set(id, fn);
    return () => { if (commands.get(id) === fn) commands.delete(id); };
  }, [commands, id]);
}
export type { Row };

/** Drag payloads from the Report Data pane onto the design surface. */
export type DragPayload =
  | { kind: 'field'; dataSet: string; field: string; typeName: string }
  | { kind: 'dataSet'; dataSet: string }
  /** Business Central data item: a table with its columns. */
  | { kind: 'dataItem'; dataSet: string; name: string; columns: string[] }
  | { kind: 'parameter'; name: string }
  | { kind: 'global'; name: string }
  /** Embedded image: an image item showing it. */
  | { kind: 'image'; name: string };

export const DRAG_MIME = 'application/x-rdl-item';
/** dataTransfer contents are not readable during dragover, so the payload is also kept here. */
export let currentDrag: DragPayload | null = null;
export const setCurrentDrag = (p: DragPayload | null) => { currentDrag = p; };
