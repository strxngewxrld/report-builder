// Output of the render engine: a positioned tree of plain data (no React, no DOM), rendered by components/Preview.tsx
// and by the designer for regions it cannot edit. Sizes are in inches.

export type Css = Record<string, string | number>;

export interface RRun { text: string; css: Css }
export interface RPara { css: Css; runs: RRun[] }

interface RBase {
  /** Unique key of this rendered instance (used for DOM lookups during pagination). */
  key: string;
  /** Report item name (several instances share a name inside repeated rows). */
  name: string;
  top: number;
  left: number;
  width: number;
  height: number;
  css: Css;
  /** Visibility/Hidden evaluated to true: kept invisible in place (it still counts for ReportItems on its page). */
  hidden: boolean;
  /** Code-block state version after this item was evaluated (page headers use the state at the end of their page). */
  seq: number;
  /** ReportItems values produced by this item (textboxes). */
  values?: [string, unknown][];
  /** KeepTogether: kept on one page if it fits. */
  keepTogether?: boolean;
  /** Evaluated explicit page breaks on data regions and rectangles. */
  pageBreakBefore?: boolean;
  pageBreakAfter?: boolean;
  resetPageNumber?: boolean;
  /** Action on click (preview): evaluated URL, bookmark, or drillthrough target. */
  action?: RAction;
  /** Evaluated bookmark of this item (target of bookmark links). */
  bookmark?: string;
}

export type RAction =
  | { kind: 'hyperlink'; url: string }
  | { kind: 'bookmarkLink'; bookmark: string }
  | { kind: 'drillthrough'; report: string; parameters: [string, string][] };

export interface RBox extends RBase {
  kind: 'box';
  /** Textbox content; absent for rectangles. */
  paragraphs?: RPara[];
  children?: RNode[];
  canGrow: boolean;
  vAlign: 'top' | 'middle' | 'bottom';
  /** Textbox other items toggle with (drilldown): its key in RenderOptions.toggled and whether it shows expanded. */
  toggle?: { key: string; expanded: boolean };
  /** Interactive sort (UserSort) on this textbox and the current direction. */
  userSort?: { name: string; direction?: 'Ascending' | 'Descending' };
}

export interface RCell { colSpan: number; rowSpan: number; node: RNode | null }

export interface RRow {
  key: string;
  height: number;
  cells: RCell[];
  /** Page break before this row (group PageBreak). */
  breakBefore: boolean;
  breakAfter?: boolean;
  resetPageNumberAfter?: boolean;
  /** Page numbering restarts on the page starting with this row (PageBreak/ResetPageNumber). */
  resetPageNumber: boolean;
  /** Static header row repeated at the top of every page the table continues on (RepeatOnNewPage). */
  repeat: boolean;
}

export interface RTable extends RBase { kind: 'table'; columns: number[]; rows: RRow[] }
export interface RLine extends RBase { kind: 'line'; stroke: string; strokeWidth: string; dash?: string }
export interface RImage extends RBase { kind: 'image'; src: string; sizing: string }
export interface RPlaceholder extends RBase { kind: 'placeholder'; label: string }

export type ChartType = 'Column' | 'Bar' | 'Line' | 'Area' | 'Pie' | 'Doughnut' | 'Scatter'
  | 'Funnel' | 'Pyramid' | 'Range' | 'RangeColumn' | 'RangeBar' | 'Polar' | 'Radar';
export interface RChartSeries {
  name: string; type: ChartType; stacked: boolean; values: (number | null)[];
  /** 100 % stacked, smoothed line, plotted on the secondary value axis. */
  percent?: boolean; smooth?: boolean; secondary?: boolean;
  /** Range charts: the low value of each point (`values` are the high values). */
  low?: (number | null)[];
  /** Fill color of each data point (ChartDataPoint/Style/Color, may be an expression); null: the palette color. */
  colors?: (string | null)[];
  /** Marker of line, scatter and polar points ('None' hides them); size in points. */
  marker?: { type: string; size?: number };
  /** A calculated series (moving average, mean, …) – drawn as a dashed line. */
  derived?: boolean;
}
/** An axis as evaluated: title, label format, fixed bounds. */
export interface RChartAxis { title?: string; format?: string; min?: number; max?: number }
export interface RChart extends RBase {
  kind: 'chart';
  categories: string[];
  series: RChartSeries[];
  title?: string;
  legend: boolean;
  palette: string;
  /** Values shown at the data points. */
  dataLabels?: boolean;
  categoryAxis?: RChartAxis;
  valueAxis?: RChartAxis;
  secondaryAxis?: RChartAxis;
  /** Design mode: shape only (sample values). */
  sample: boolean;
}

/** A gauge (GaugePanel): its first radial or linear gauge with the first pointer's value, scale and ranges. */
export interface RGauge extends RBase {
  kind: 'gauge';
  shape: 'radial' | 'linear';
  value: number | null;
  min: number;
  max: number;
  ranges: { start: number; end: number; color: string }[];
  /** Format of the value label (from the pointer or the scale). */
  format?: string;
  sample: boolean;
}

export type RNode = RBox | RTable | RLine | RImage | RPlaceholder | RChart | RGauge;

export interface RSection { height: number; css: Css; nodes: RNode[] }

export interface PageInfo {
  number: number;
  total: number;
  overallNumber: number;
  overallTotal: number;
  /** Code-block state version at the end of the page's body content. */
  version: number;
  /** ReportItems values on the page in document order. */
  reportItems: Map<string, unknown[]>;
}

export interface RenderResult {
  page: { width: number; height: number; marginTop: number; marginBottom: number; marginLeft: number; marginRight: number };
  bodyWidth: number;
  body: RSection;
  header: { height: number; printOnFirstPage: boolean; printOnLastPage: boolean } | null;
  footer: { height: number; printOnFirstPage: boolean; printOnLastPage: boolean } | null;
  /** Evaluates the page header or footer for one page (page numbers, ReportItems and Code state of that page). */
  renderSection(kind: 'header' | 'footer', page: PageInfo): RSection | null;
  /** Problems found while evaluating, by item. */
  errors: [string, string][];
}
