// In-memory report model. All sizes are in inches; the RDL unit (in/cm) only matters on (de)serialization.
//
// Objects read from a file carry an `origin`. The serializer writes an object whose modelled fields are unchanged
// back as its original XML, and keeps unknown child elements (`extra`), element order and size notation for the
// objects it regenerates. Business Central layouts therefore survive editing without losses and with small diffs.

/** Flat style map keyed by RDL style element names. Border is flattened to BorderStyle/BorderColor/BorderWidth. */
export type Style = Partial<Record<StyleKey, string>>;
export type StyleKey =
  | 'FontFamily' | 'FontSize' | 'FontWeight' | 'FontStyle' | 'TextDecoration' | 'Color' | 'Format'
  | 'TextAlign' | 'VerticalAlign' | 'BackgroundColor'
  | 'BorderStyle' | 'BorderColor' | 'BorderWidth'
  | 'PaddingLeft' | 'PaddingRight' | 'PaddingTop' | 'PaddingBottom';

export interface Box { top: number; left: number; width: number; height: number }

/** Where an object came from; absent for objects created in the designer. */
export interface Origin {
  /** Original XML of the element (namespace declarations and indentation removed). */
  xml: string;
  /** Fingerprint of the modelled fields at parse time (see `fingerprint`). */
  key: string;
  /** Qualified names of the original child elements in document order. */
  order: string[];
  /** Original notation of size elements ("0.423cm", "20pt"), kept while the value is unchanged. */
  sizes: Record<string, string>;
  /** Child order of nested elements that are regenerated ("Style", "Style/Border", "Paragraph", "TextRun/Style", …);
   *  a missing key means the file did not have that element. */
  inner?: Record<string, string[]>;
}

/** Verbatim XML of child elements the model does not cover, for objects that may be regenerated. */
interface Preserved {
  origin?: Origin;
  /** Unknown child elements (Visibility, ZIndex, DataElementOutput, ToolTip, …). */
  extra?: string[];
  /** Unknown children of <Style> (TopBorder, LineHeight, Language, …). */
  styleExtra?: string[];
}

interface ItemBase extends Box, Preserved, CellFields {
  id: string;
  name: string;
  style: Style;
}

/** Fields of an item that fills a table cell (its position is the cell's). */
interface CellFields {
  /** Other children of <TablixCell> and <CellContents>. */
  cellExtra?: string[];
  contentsExtra?: string[];
  /** Number of columns the cell spans (merged cells); the covered columns have no cell. */
  colSpan?: number;
  /** Original child order of <CellContents> (e.g. rd:Selected before the item). */
  contentsOrder?: string[];
}

export type StyleLevel = 'box' | 'paragraph' | 'run';

export interface TextboxItem extends ItemBase {
  type: 'textbox';
  value: string;
  canGrow: boolean;
  /** Style as found per level in the file; decides where each key is written back. */
  styleLevels?: Record<StyleLevel, Style>;
  paragraphExtra?: string[];
  paragraphStyleExtra?: string[];
  runExtra?: string[];
  runStyleExtra?: string[];
  /** Attributes of <Value> (EvaluationMode="Constant" makes "=…" literal text). */
  valueAttrs?: [string, string][];
}
export interface RectangleItem extends ItemBase { type: 'rectangle'; items: ReportItem[] }
export interface LineItem extends ItemBase { type: 'line' }
export interface ImageItem extends ItemBase {
  type: 'image';
  source: 'External' | 'Embedded' | 'Database';
  value: string;
  sizing: 'AutoSize' | 'Fit' | 'FitProportional' | 'Clip';
}
export interface TableRow {
  id: string;
  /**
   * Role of the row, derived from the row hierarchy: table header/footer (outside all groups), group header/footer
   * (static rows inside a group), detail (the details group).
   */
  kind: 'header' | 'detail' | 'footer' | 'groupHeader' | 'groupFooter';
  height: number;
  /**
   * Cells left to right; a merged cell (colSpan > 1) covers the following columns, which have no cell. A cell is
   * usually a textbox; lists hold a rectangle with further items (Business Central document layouts), any item works.
   */
  cells: ReportItem[];
  heightSrc?: string;
}

export interface SortExpression { value: string; descending: boolean }
export interface TableFilter { expression: string; operator: string; values: string[] }
export type BreakLocation = '' | 'Start' | 'End' | 'StartAndEnd' | 'Between';

/** The <Group> of a dynamic row member: a row group, or the details group (no expressions). */
export interface TableGroup {
  name: string;
  expressions: string[];
  filters: TableFilter[];
  pageBreak: BreakLocation;
  /** Other children of <PageBreak> (ResetPageNumber, Disabled, …). */
  pageBreakExtra: string[];
  /** Other children of <Group> (Parent, Variables, DocumentMapLabel, DataElementName, …). */
  extra: string[];
  origin?: Origin;
}

/** Header cell of a member (<TablixHeader>): row headers left of the body, column headers above it (matrix). */
export interface TablixHeaderCell {
  /** Width (row header) or height (column header) in inches. */
  size: number;
  sizeSrc?: string;
  cell: ReportItem;
  /** Original child order of <TablixHeader>. */
  order?: string[];
}

/** A cell of the corner above the row headers and left of the column headers (null: covered by a span). */
export interface CornerCell { item: ReportItem | null; rowSpan?: number }

/**
 * A member of a Tablix hierarchy (<TablixMember>). Row hierarchy: a leaf stands for one row (in table order).
 * Column hierarchy: a leaf stands for one column. A member with a group repeats its children per group instance; a
 * static member without group just nests. Members can carry a header cell (matrix headers).
 */
export interface RowMember {
  id: string;
  group?: TableGroup;
  header?: TablixHeaderCell;
  sort: SortExpression[];
  /** Other children of <TablixMember>: KeepWithGroup, RepeatOnNewPage, KeepTogether, Visibility, … */
  extra: string[];
  children: RowMember[];
  /** Leaf: the id of its row. */
  rowId?: string;
  origin?: Origin;
}
export interface TableItem extends ItemBase {
  type: 'table';
  dataSetName: string;
  columns: number[];
  columnSrc?: (string | undefined)[];
  /** Column hierarchy; its leaves in depth-first order are the columns (static for tables, groups for matrices). */
  columnMembers: RowMember[];
  /** Corner cells of a matrix (rows × row header levels), absent without one. */
  corner?: CornerCell[][];
  rows: TableRow[];
  /** Row hierarchy; its leaves in depth-first order are the rows. */
  rowMembers: RowMember[];
  /** Sum of column widths / row heights at parse time. Files are not always consistent with the Tablix Width/Height,
   *  so the written size is the file's value adjusted by how much columns/rows changed. */
  parsedSums?: { width: number; height: number };
}
/**
 * Report items the designer cannot edit (charts, grouped Tablix, subreports, textboxes with mixed formatting, …)
 * are kept verbatim; only a changed position is patched into the XML.
 */
export interface RawItem extends ItemBase { type: 'raw'; kind: string; xml: string; /** Text of a raw textbox, for display. */ preview?: string }

export type ReportItem = TextboxItem | RectangleItem | LineItem | ImageItem | TableItem | RawItem;
export type ItemType = ReportItem['type'];

/** `extra*` arrays hold verbatim XML of child elements the designer does not edit, so they survive a round trip. */
export interface DataSource {
  id: string; name: string; provider: string; connectString: string; sharedReference?: string;
  extra: string[]; connExtra: string[]; origin?: Origin;
}
/** `value` is set for calculated fields (expression instead of DataField). `typeName` is '' when the file has none. */
export interface Field { name: string; dataField: string; typeName: string; value?: string; extra?: string[] }
export interface DataSet {
  id: string; name: string; dataSourceName: string; commandText: string; fields: Field[];
  extra: string[]; queryExtra: string[]; origin?: Origin;
}

export type ParameterType = 'String' | 'Integer' | 'Float' | 'DateTime' | 'Boolean';
export interface Parameter {
  id: string;
  name: string;
  dataType: ParameterType;
  prompt: string;
  defaultValue: string;
  allowBlank: boolean;
  nullable: boolean;
  extra: string[];
  origin?: Origin;
}

export type SectionKind = 'header' | 'body' | 'footer';
export interface Section extends Preserved { height: number; items: ReportItem[]; style: Style }

export interface PageSetup {
  width: number; height: number;
  marginTop: number; marginBottom: number; marginLeft: number; marginRight: number;
  extra: string[];
  origin?: Origin;
}

/** File-level details needed to write a file back the way it was read. */
export interface SourceFormat {
  /** Attributes of <Report> (namespace declarations, MustUnderstand, …). */
  rootAttributes: [string, string][];
  /** Child order of <Report> and of <ReportSection>. */
  order: string[];
  sectionOrder: string[];
  sectionExtra: string[];
  /** Further <ReportSection> elements (multi-section reports), kept verbatim. */
  moreSections: string[];
  widthSrc?: string;
  /** rd:ReportUnitType as written (Business Central writes "Invalid") and the unit inferred from it. */
  unitRaw?: string;
  unitInferred: 'in' | 'cm';
  /** Original <ReportParametersLayout> and the parameter names it was written for. */
  parameterLayout?: { xml: string; names: string[] };
  declaration: string | null;
  eol: '\n' | '\r\n';
  finalNewline: boolean;
  bom: boolean;
}

export interface Report {
  /** RDL schema namespace of the file; 2010 and 2016 are written back as they were. */
  namespace: string;
  unit: 'in' | 'cm';
  reportId: string;
  width: number;
  page: PageSetup;
  body: Section;
  header: Section | null;
  footer: Section | null;
  dataSources: DataSource[];
  dataSets: DataSet[];
  parameters: Parameter[];
  /** Top-level <Report> children not modelled here (EmbeddedImages, Code, Language, …), kept verbatim. */
  extraXml: string[];
  source?: SourceFormat;
}

/** Fingerprint of an object's modelled content: everything except ids and origins (at any depth). */
// rowId only links a member to its row: members of the same shape write the same XML whichever row they stand for
export const fingerprint = (o: unknown) => JSON.stringify(o, (k, v) => (k === 'id' || k === 'origin' || k === 'rowId' ? undefined : v));

/** True if the object was read from a file and its modelled content has not changed since. */
export const unchanged = (o: { origin?: Origin }) => !!o.origin && fingerprint(o) === o.origin.key;

let counter = 0;
export const newId = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

export const guid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export const NS_2010 = 'http://schemas.microsoft.com/sqlserver/reporting/2010/01/reportdefinition';
export const NS_2016 = 'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';

export function emptyReport(): Report {
  return {
    namespace: NS_2016,
    unit: 'in',
    reportId: guid(),
    width: 6.5,
    page: { width: 8.5, height: 11, marginTop: 1, marginBottom: 1, marginLeft: 1, marginRight: 1, extra: [] },
    body: { height: 2.25, items: [], style: {} },
    header: null,
    footer: null,
    dataSources: [],
    dataSets: [],
    parameters: [],
    extraXml: [],
  };
}

/** Depth-first walk over all report items incl. rectangle children and table cells. */
export function* allItems(items: ReportItem[]): Generator<ReportItem> {
  for (const it of items) {
    yield it;
    if (it.type === 'rectangle') yield* allItems(it.items);
    if (it.type === 'table') {
      for (const r of it.rows) yield* allItems(r.cells);
      for (const h of tableHeaders(it)) yield* allItems([h.cell]);
      for (const row of it.corner ?? []) for (const c of row) if (c.item) yield* allItems([c.item]);
    }
  }
}

/** Header cells of a table's row and column hierarchies (matrix headers). */
export function tableHeaders(t: TableItem): TablixHeaderCell[] {
  const out: TablixHeaderCell[] = [];
  const walk = (ms: RowMember[]) => ms.forEach(m => { if (m.header) out.push(m.header); walk(m.children); });
  walk(t.rowMembers);
  walk(t.columnMembers);
  return out;
}

export function allReportItems(r: Report): ReportItem[] {
  return [r.header, r.body, r.footer].flatMap(s => (s ? [...allItems(s.items)] : []));
}

/** Next free name like "Textbox3", unique across the whole report (RDL requires that). */
export function uniqueName(r: Report, prefix: string, taken: Set<string> = new Set()): string {
  const used = new Set([...allReportItems(r).map(i => i.name), ...taken]);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}
