// Charts: creating the RDL of a new chart from a simple description, and reading/patching the parts of an existing
// chart the designer edits (type, category, series values, title, legend, palette, colors and markers of the data
// points, calculated series). Everything else in the chart's XML stays as it is (charts are kept as verbatim items).

import { NS_RD, XmlDom, browserDom, child, elements, normalizeFragment, text } from './rdl';
import { l10n } from './l10n';
import type { ChartType } from './render/types';

export type ChartKind =
  | 'Column' | 'StackedColumn' | 'PercentColumn' | 'Bar' | 'StackedBar' | 'Line' | 'SmoothLine' | 'Area' | 'StackedArea'
  | 'Scatter' | 'Pie' | 'Doughnut' | 'Funnel' | 'Pyramid' | 'Range' | 'RangeColumn' | 'RangeBar' | 'Polar' | 'Radar';
/** Chart kinds with their (translated) label and icon; a function, so the labels follow the display language. */
export const chartKinds = (): [ChartKind, string, string][] => [
  ['Column', l10n.t('Column'), 'graph'], ['StackedColumn', l10n.t('Stacked column'), 'graph'], ['PercentColumn', l10n.t('100% column'), 'graph'],
  ['Bar', l10n.t('Bar'), 'graph-left'], ['StackedBar', l10n.t('Stacked bar'), 'graph-left'], ['Line', l10n.t('Line'), 'graph-line'],
  ['SmoothLine', l10n.t('Smooth line'), 'graph-line'], ['Area', l10n.t('Area'), 'graph-line'], ['StackedArea', l10n.t('Stacked area'), 'graph-line'],
  ['Scatter', l10n.t('Scatter'), 'graph-scatter'], ['Pie', l10n.t('Pie'), 'pie-chart'], ['Doughnut', l10n.t('Doughnut'), 'pie-chart'],
  ['Funnel', l10n.t('Funnel'), 'filter'], ['Pyramid', l10n.t('Pyramid'), 'triangle-up'], ['Range', l10n.t('Range'), 'graph-line'],
  ['RangeColumn', l10n.t('Range column'), 'graph'], ['RangeBar', l10n.t('Range bar'), 'graph-left'], ['Polar', l10n.t('Polar'), 'target'],
  ['Radar', l10n.t('Radar'), 'target'],
];
/** Kinds a single series can have in a combined chart (with the chart's own kind). */
export const SERIES_KINDS: ChartKind[] = ['Column', 'Line', 'SmoothLine', 'Area', 'Scatter'];
export const isPie = (k: ChartKind) => k === 'Pie' || k === 'Doughnut';
/** One series whose points are segments of a shape: pie, doughnut, funnel, pyramid. */
export const isShape = (k: ChartKind) => isPie(k) || k === 'Funnel' || k === 'Pyramid';
/** Two values per point (high and low). */
export const isRange = (k: ChartKind) => k === 'Range' || k === 'RangeColumn' || k === 'RangeBar';
export const isPolar = (k: ChartKind) => k === 'Polar' || k === 'Radar';
/** Kinds with x/y axes, where series can be combined and plotted on a secondary axis. */
export const isCartesian = (k: ChartKind) => !isShape(k) && !isPolar(k);

/** Marker shapes of RDL (ChartMarker/Type) offered in the designer. */
export const MARKERS = ['None', 'Circle', 'Square', 'Diamond', 'Triangle', 'Cross', 'Star5'];

/** Calculated series (ChartDerivedSeries) the designer creates and the preview draws. */
export type TrendFormula = 'MovingAverage' | 'ExponentialMovingAverage' | 'WeightedMovingAverage' | 'TriangularMovingAverage' | 'Mean' | 'Median';
export const trendFormulas = (): [TrendFormula, string][] => [
  ['MovingAverage', l10n.t('Moving average')], ['ExponentialMovingAverage', l10n.t('Exponential moving average')],
  ['WeightedMovingAverage', l10n.t('Weighted moving average')], ['TriangularMovingAverage', l10n.t('Triangular moving average')],
  ['Mean', l10n.t('Mean')], ['Median', l10n.t('Median')],
];
const hasPeriod = (f: TrendFormula) => f.endsWith('MovingAverage');
export interface ChartTrend { formula: TrendFormula; period: number }

/**
 * Values of a calculated series (RDL ChartFormulas) from the values of its source series; null for formulas the
 * preview does not calculate. Period: the number of points averaged (default 2); without StartFromFirst the first
 * period − 1 points have no value.
 */
export function deriveValues(formula: string, values: (number | null)[], params: Record<string, string>): (number | null)[] | null {
  const period = Math.max(1, Math.round(Number(params.Period) || 2));
  const fromFirst = /^true$/i.test(params.StartFromFirst ?? '');
  const present = values.filter((v): v is number => v !== null);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const window = (i: number, p: number) => values.slice(Math.max(0, i - p + 1), i + 1).filter((v): v is number => v !== null);
  const sma = (p: number) => values.map((_, i) => (i < p - 1 && !fromFirst ? null : window(i, p).length ? mean(window(i, p)) : null));
  switch (formula) {
    case 'Mean': return present.length ? values.map(() => mean(present)) : values.map(() => null);
    case 'Median': {
      if (!present.length) return values.map(() => null);
      const s = [...present].sort((a, b) => a - b), m = s.length >> 1;
      const med = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      return values.map(() => med);
    }
    case 'MovingAverage': return sma(period);
    case 'WeightedMovingAverage': return values.map((_, i) => {
      if (i < period - 1 && !fromFirst) return null;
      const w = values.slice(Math.max(0, i - period + 1), i + 1);
      let sum = 0, weights = 0;
      w.forEach((v, j) => { if (v !== null) { sum += v * (j + 1); weights += j + 1; } });
      return weights ? sum / weights : null;
    });
    case 'TriangularMovingAverage': {
      const half = Math.ceil((period + 1) / 2);
      const first = values.map((_, i) => (window(i, half).length ? mean(window(i, half)) : null));
      return first.map((_, i) => {
        if (i < period - 1 && !fromFirst) return null;
        const w = first.slice(Math.max(0, i - half + 1), i + 1).filter((v): v is number => v !== null);
        return w.length ? mean(w) : null;
      });
    }
    case 'ExponentialMovingAverage': {
      const k = 2 / (period + 1);
      let ema: number | null = null;
      return values.map((v, i) => {
        if (ema === null) {
          if (i < period - 1 && !fromFirst) return null;
          const w = window(i, period);
          ema = w.length ? mean(w) : null;
          return ema;
        }
        if (v !== null) ema = v * k + ema * (1 - k);
        return ema;
      });
    }
  }
  return null;
}

/** The type the preview draws for a ChartSeries Type/Subtype. */
export function renderTypeOf(type: string, subtype: string): ChartType {
  const sub = subtype.toLowerCase();
  if (type === 'Shape') return sub.includes('doughnut') ? 'Doughnut' : sub === 'funnel' ? 'Funnel' : sub === 'pyramid' ? 'Pyramid' : 'Pie';
  if (type === 'Range') return sub === 'column' ? 'RangeColumn' : sub === 'bar' ? 'RangeBar' : 'Range';
  if (type === 'Polar') return sub === 'radar' ? 'Radar' : 'Polar';
  return (['Column', 'Bar', 'Line', 'Area', 'Scatter'] as string[]).includes(type) ? type as ChartType : 'Column';
}

/** An axis: title, number format of its labels (N0, P0, …), fixed minimum/maximum ('' = automatic). */
export interface ChartAxisSpec { title: string; format: string; min: string; max: string }
export const emptyAxis = (): ChartAxisSpec => ({ title: '', format: '', min: '', max: '' });

export interface ChartSeriesSpec {
  name: string;
  value: string;
  /** Own type in a combined chart (undefined: the chart's type). */
  kind?: ChartKind;
  /** Plotted against the secondary value axis (right). */
  secondary?: boolean;
  /** Range charts: the low value (`value` is the high value). */
  low?: string;
  /** Color of the data points: a color or an expression evaluated per point, e.g. =IIf(Fields!X.Value < 0, "Red", "Green"). */
  color?: string;
  /** Marker shape of the points (MARKERS); undefined: automatic. */
  marker?: string;
  /** A calculated series derived from this one. */
  trend?: ChartTrend;
}
export const PALETTES = ['BrightPastel', 'Pastel', 'EarthTones', 'Berry', 'Chocolate', 'Fire', 'Grayscale', 'SemiTransparent'];

export interface ChartSpec {
  name: string;
  dataSetName: string;
  kind: ChartKind;
  /** Category grouping (x axis), e.g. =Fields!Region.Value; '' for a single category. */
  category: string;
  series: ChartSeriesSpec[];
  title: string;
  legend: boolean;
  palette: string;
  /** Values shown at the data points. */
  dataLabels: boolean;
  categoryAxis: ChartAxisSpec;
  valueAxis: ChartAxisSpec;
  secondaryAxis: ChartAxisSpec;
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const typeOf = (k: ChartKind): readonly [string, string | undefined] => ({
  Column: ['Column', undefined], StackedColumn: ['Column', 'Stacked'], PercentColumn: ['Column', 'PercentStacked'],
  Bar: ['Bar', undefined], StackedBar: ['Bar', 'Stacked'], Line: ['Line', undefined], SmoothLine: ['Line', 'Smooth'],
  Area: ['Area', undefined], StackedArea: ['Area', 'Stacked'], Scatter: ['Scatter', undefined],
  Pie: ['Shape', undefined], Doughnut: ['Shape', 'Doughnut'], Funnel: ['Shape', 'Funnel'], Pyramid: ['Shape', 'Pyramid'],
  Range: ['Range', undefined], RangeColumn: ['Range', 'Column'], RangeBar: ['Range', 'Bar'],
  Polar: ['Polar', undefined], Radar: ['Polar', 'Radar'],
} as const)[k];
const kindOf = (type: string, sub: string): ChartKind => {
  const s = sub.toLowerCase();
  if (type === 'Shape') return s.includes('doughnut') ? 'Doughnut' : s === 'funnel' ? 'Funnel' : s === 'pyramid' ? 'Pyramid' : 'Pie';
  if (type === 'Range') return s === 'column' ? 'RangeColumn' : s === 'bar' ? 'RangeBar' : 'Range';
  if (type === 'Polar') return s === 'radar' ? 'Radar' : 'Polar';
  if (type === 'Bar') return s.includes('stacked') ? 'StackedBar' : 'Bar';
  if (type === 'Line') return s === 'smooth' ? 'SmoothLine' : 'Line';
  if (type === 'Area') return s.includes('stacked') ? 'StackedArea' : 'Area';
  if (type === 'Scatter') return 'Scatter';
  return s === 'percentstacked' ? 'PercentColumn' : s.includes('stacked') ? 'StackedColumn' : 'Column';
};

const SECONDARY = 'Secondary';
const dataLabelXml = (on: boolean) => (on ? '<ChartDataLabel><Style /><UseValueAsLabel>true</UseValueAsLabel><Visible>true</Visible></ChartDataLabel>' : '<ChartDataLabel><Style /></ChartDataLabel>');
const seriesName = (s: { name: string }) => s.name.replace(/\W/g, '') || 'Series';
const pointValuesXml = (s: ChartSeriesSpec, range: boolean) => (range
  ? `<High>${xmlEsc(s.value)}</High><Low>${xmlEsc(s.low ?? '')}</Low>`
  : `<Y>${xmlEsc(s.value)}</Y>`);
const markerXml = (s: ChartSeriesSpec) => `<ChartMarker>${s.marker ? `<Type>${xmlEsc(s.marker)}</Type>` : ''}<Style /></ChartMarker>`;
const seriesXml = (s: ChartSeriesSpec, spec: ChartSpec) => {
  const kind = s.kind ?? spec.kind;
  const [type, sub] = typeOf(kind);
  return `<ChartSeries Name="${xmlEsc(seriesName(s))}"><ChartDataPoints><ChartDataPoint><ChartDataPointValues>${pointValuesXml(s, isRange(kind))}</ChartDataPointValues>`
    + `${dataLabelXml(spec.dataLabels)}${s.color ? `<Style><Color>${xmlEsc(s.color)}</Color></Style>` : '<Style />'}${markerXml(s)}<DataElementOutput>Output</DataElementOutput></ChartDataPoint></ChartDataPoints>`
    + `<Type>${type}</Type>${sub ? `<Subtype>${sub}</Subtype>` : ''}<Style /><ChartEmptyPoints><Style /><ChartMarker><Style /></ChartMarker><ChartDataLabel><Style /></ChartDataLabel></ChartEmptyPoints>`
    + `<ValueAxisName>${s.secondary ? SECONDARY : 'Primary'}</ValueAxisName><CategoryAxisName>Primary</CategoryAxisName><ChartSmartLabel><CalloutLineColor>Black</CalloutLineColor><MinMovingDistance>0pt</MinMovingDistance></ChartSmartLabel></ChartSeries>`;
};
/** A calculated series (ChartDerivedSeries) of the series named `source`: a dashed line on the same axis. */
const derivedXml = (source: string, t: ChartTrend, secondary: boolean) => `<ChartDerivedSeries><ChartSeries Name="${xmlEsc(`${source}_${t.formula}`)}">`
  + `<Type>Line</Type><Style><Border><Width>1.5pt</Width><Style>Dashed</Style></Border></Style><ChartMarker><Style /></ChartMarker><ChartDataLabel><Style /></ChartDataLabel>`
  + `<ChartEmptyPoints><Style /><ChartMarker><Style /></ChartMarker><ChartDataLabel><Style /></ChartDataLabel></ChartEmptyPoints>`
  + `<ValueAxisName>${secondary ? SECONDARY : 'Primary'}</ValueAxisName><CategoryAxisName>Primary</CategoryAxisName><ChartSmartLabel><CalloutLineColor>Black</CalloutLineColor><MinMovingDistance>0pt</MinMovingDistance></ChartSmartLabel></ChartSeries>`
  + `<SourceChartSeriesName>${xmlEsc(source)}</SourceChartSeriesName><DerivedSeriesFormula>${t.formula}</DerivedSeriesFormula>`
  + (hasPeriod(t.formula) ? `<ChartFormulaParameters><ChartFormulaParameter Name="Period"><Value>${Math.max(1, Math.round(t.period))}</Value></ChartFormulaParameter></ChartFormulaParameters>` : '')
  + '</ChartDerivedSeries>';
const derivedCollectionXml = (spec: ChartSpec) => {
  const trends = spec.series.filter(s => s.trend);
  return trends.length ? `<ChartDerivedSeriesCollection>${trends.map(s => derivedXml(seriesName(s), s.trend!, !!s.secondary)).join('')}</ChartDerivedSeriesCollection>` : '';
};
const seriesMember = (s: { name: string }) => `<ChartMember><Label>${xmlEsc(s.name)}</Label></ChartMember>`;
const categoryMember = (spec: ChartSpec) => (spec.category
  ? `<ChartMember><Group Name="${xmlEsc(spec.name)}_CategoryGroup"><GroupExpressions><GroupExpression>${xmlEsc(spec.category)}</GroupExpression></GroupExpressions></Group>`
    + `<SortExpressions><SortExpression><Value>${xmlEsc(spec.category)}</Value></SortExpression></SortExpressions><Label>${xmlEsc(spec.category)}</Label></ChartMember>`
  : '<ChartMember><Label /></ChartMember>');
const axis = (name: string, a: ChartAxisSpec, opposite = false) => `<ChartAxis Name="${name}"><Style><FontSize>8pt</FontSize>${a.format ? `<Format>${xmlEsc(a.format)}</Format>` : ''}</Style>`
  + `<ChartAxisTitle>${a.title ? `<Caption>${xmlEsc(a.title)}</Caption>` : '<Caption />'}<Style><FontSize>8pt</FontSize></Style></ChartAxisTitle>`
  + `<ChartMajorGridLines>${opposite ? '<Enabled>False</Enabled>' : ''}<Style><Border><Color>Gainsboro</Color></Border></Style></ChartMajorGridLines><ChartMinorGridLines><Style><Border><Color>Gainsboro</Color><Style>Dotted</Style></Border></Style></ChartMinorGridLines>`
  + `<ChartMinorTickMarks><Length>0.5</Length></ChartMinorTickMarks><CrossAt>NaN</CrossAt><Minimum>${a.min || 'NaN'}</Minimum><Maximum>${a.max || 'NaN'}</Maximum>`
  + `${opposite ? '<Location>Opposite</Location>' : ''}<ChartAxisScaleBreak><Style /></ChartAxisScaleBreak></ChartAxis>`;

/** RDL of a new chart (the structure Report Builder creates), positioned in inches. */
export function chartXml(spec: ChartSpec, box: { top: number; left: number; width: number; height: number }): string {
  const inch = (v: number) => `${Math.round(v * 1e5) / 1e5}in`;
  return `<Chart Name="${xmlEsc(spec.name)}">`
    + `<ChartCategoryHierarchy><ChartMembers>${categoryMember(spec)}</ChartMembers></ChartCategoryHierarchy>`
    + `<ChartSeriesHierarchy><ChartMembers>${spec.series.map(seriesMember).join('')}</ChartMembers></ChartSeriesHierarchy>`
    + `<ChartData><ChartSeriesCollection>${spec.series.map(s => seriesXml(s, spec)).join('')}</ChartSeriesCollection>${derivedCollectionXml(spec)}</ChartData>`
    + `<ChartAreas><ChartArea Name="Default"><ChartCategoryAxes>${axis('Primary', spec.categoryAxis)}</ChartCategoryAxes>`
    + `<ChartValueAxes>${axis('Primary', spec.valueAxis)}${spec.series.some(x => x.secondary) ? axis(SECONDARY, spec.secondaryAxis, true) : ''}</ChartValueAxes>`
    + `<Style><BackgroundGradientType>None</BackgroundGradientType></Style></ChartArea></ChartAreas>`
    + `<ChartLegends><ChartLegend Name="Default">${spec.legend ? '' : '<Hidden>true</Hidden>'}<Style><BackgroundGradientType>None</BackgroundGradientType><FontSize>8pt</FontSize></Style>`
    + `<ChartLegendTitle><Caption /><Style><FontSize>8pt</FontSize><FontWeight>Bold</FontWeight><TextAlign>Center</TextAlign></Style></ChartLegendTitle><HeaderSeparatorColor>Black</HeaderSeparatorColor><ColumnSeparatorColor>Black</ColumnSeparatorColor></ChartLegend></ChartLegends>`
    + `<ChartTitles><ChartTitle Name="Default"><Caption>${xmlEsc(spec.title)}</Caption><Style><BackgroundGradientType>None</BackgroundGradientType><FontWeight>Bold</FontWeight><TextAlign>General</TextAlign><VerticalAlign>Top</VerticalAlign></Style></ChartTitle></ChartTitles>`
    + `<Palette>${xmlEsc(spec.palette)}</Palette><ChartBorderSkin><Style><BackgroundColor>Gray</BackgroundColor><BackgroundGradientType>None</BackgroundGradientType><Color>White</Color></Style></ChartBorderSkin>`
    + `<ChartNoDataMessage Name="NoDataMessage"><Caption>${xmlEsc(l10n.t('No data'))}</Caption><Style><BackgroundGradientType>None</BackgroundGradientType><TextAlign>General</TextAlign><VerticalAlign>Top</VerticalAlign></Style></ChartNoDataMessage>`
    + `<DataSetName>${xmlEsc(spec.dataSetName)}</DataSetName><Top>${inch(box.top)}</Top><Left>${inch(box.left)}</Left><Height>${inch(box.height)}</Height><Width>${inch(box.width)}</Width>`
    + `<Style><Border><Color>LightGrey</Color><Style>Solid</Style></Border><BackgroundColor>White</BackgroundColor><BackgroundGradientType>None</BackgroundGradientType></Style></Chart>`;
}

function parse(xml: string, dom: XmlDom) {
  const doc = dom.parse(`<w xmlns:rd="${NS_RD}">${xml}</w>`);
  return { doc, chart: elements(doc.documentElement)[0] };
}

/** What the designer edits of a chart (best effort for charts made elsewhere). */
export function readChart(xml: string, dom: XmlDom = browserDom): ChartSpec | null {
  const { chart } = parse(xml, dom);
  if (chart?.localName !== 'Chart') return null;
  const seriesEls = elements(child(chart, 'ChartData', 'ChartSeriesCollection'), 'ChartSeries');
  const labels = elements(child(chart, 'ChartSeriesHierarchy', 'ChartMembers'), 'ChartMember').map(m => text(m, 'Label') ?? '');
  const cat = elements(child(chart, 'ChartCategoryHierarchy', 'ChartMembers'), 'ChartMember')[0];
  const legend = child(chart, 'ChartLegends', 'ChartLegend');
  const kind = kindOf(text(seriesEls[0], 'Type') ?? 'Column', text(seriesEls[0], 'Subtype') ?? '');
  const axes = axesOf(chart);
  const derived = elements(child(chart, 'ChartData', 'ChartDerivedSeriesCollection'), 'ChartDerivedSeries');
  return {
    name: chart.getAttribute('Name') ?? '',
    dataSetName: text(chart, 'DataSetName') ?? '',
    kind,
    category: text(cat, 'Group', 'GroupExpressions', 'GroupExpression') ?? '',
    series: seriesEls.map((s, i) => {
      const own = kindOf(text(s, 'Type') ?? 'Column', text(s, 'Subtype') ?? '');
      const secondary = !!axes.secondary && text(s, 'ValueAxisName') === axes.secondary.getAttribute('Name');
      const point = child(s, 'ChartDataPoints', 'ChartDataPoint');
      const range = isRange(own);
      const value = (range ? text(point, 'ChartDataPointValues', 'High') : undefined) ?? text(point, 'ChartDataPointValues', 'Y') ?? '';
      const color = text(point, 'Style', 'Color');
      const marker = text(point, 'ChartMarker', 'Type');
      const d = derived.find(x => text(x, 'SourceChartSeriesName') === s.getAttribute('Name')
        && trendFormulas().some(([f]) => f === text(x, 'DerivedSeriesFormula')));
      const period = Number(text(elements(child(d, 'ChartFormulaParameters'), 'ChartFormulaParameter').find(p => p.getAttribute('Name') === 'Period'), 'Value'));
      return {
        name: labels[i] || s.getAttribute('Name') || l10n.t('Series{0}', i + 1), value,
        ...(own !== kind ? { kind: own } : {}), ...(secondary ? { secondary } : {}),
        ...(range ? { low: text(point, 'ChartDataPointValues', 'Low') ?? '' } : {}),
        ...(color ? { color } : {}), ...(marker && marker !== 'Auto' ? { marker } : {}),
        ...(d ? { trend: { formula: text(d, 'DerivedSeriesFormula') as TrendFormula, period: period > 0 ? period : 2 } } : {}),
      };
    }),
    title: text(chart, 'ChartTitles', 'ChartTitle', 'Caption') ?? '',
    legend: !!legend && (text(legend, 'Hidden') ?? '').toLowerCase() !== 'true',
    palette: text(chart, 'Palette') ?? 'BrightPastel',
    dataLabels: seriesEls.some(s => (text(s, 'ChartDataPoints', 'ChartDataPoint', 'ChartDataLabel', 'Visible') ?? '').toLowerCase() === 'true'),
    categoryAxis: readAxis(axes.category),
    valueAxis: readAxis(axes.primary),
    secondaryAxis: readAxis(axes.secondary),
  };
}

/** The axes of the first chart area; the secondary value axis is the one series use besides the primary. */
export function axesOf(chart: Element) {
  const area = child(chart, 'ChartAreas', 'ChartArea');
  const values = elements(child(area, 'ChartValueAxes'), 'ChartAxis');
  const primary = values.find(a => a.getAttribute('Name') === 'Primary') ?? values[0];
  return {
    area, values: child(area, 'ChartValueAxes'), primary,
    category: elements(child(area, 'ChartCategoryAxes'), 'ChartAxis')[0],
    secondary: values.find(a => a !== primary),
  };
}

const bound = (v: string | undefined) => (!v || /^nan$/i.test(v.trim()) ? '' : v.trim());
export function readAxis(a: Element | undefined): ChartAxisSpec {
  if (!a) return emptyAxis();
  return { title: text(a, 'ChartAxisTitle', 'Caption') ?? '', format: text(a, 'Style', 'Format') ?? '', min: bound(text(a, 'Minimum')), max: bound(text(a, 'Maximum')) };
}

function setText(doc: Document, parent: Element, tag: string, value: string | undefined, before?: string) {
  let el = elements(parent, tag)[0];
  if (value === undefined) { el?.parentNode?.removeChild(el); return; }
  if (!el) {
    el = doc.createElementNS(parent.namespaceURI, tag);
    const ref = before ? elements(parent, before)[0] : undefined;
    parent.insertBefore(el, ref ?? null);
  }
  el.textContent = value;
}

/**
 * Applies a changed description to an existing chart: series are updated in place (formatting of existing ones
 * stays), added like the last one or removed; the category group, title, legend and palette are patched.
 */
export function patchChart(xml: string, spec: ChartSpec, dom: XmlDom = browserDom): string {
  const { doc, chart } = parse(xml, dom);
  if (chart?.localName !== 'Chart') return xml;
  const old = readChart(xml, dom)!;
  const [type, sub] = typeOf(spec.kind);
  const collection = child(chart, 'ChartData', 'ChartSeriesCollection');
  const members = child(chart, 'ChartSeriesHierarchy', 'ChartMembers');
  if (collection && members) {
    let seriesEls = elements(collection, 'ChartSeries');
    let memberEls = elements(members, 'ChartMember');
    // add series (copies of the last one) / remove surplus ones
    while (seriesEls.length < spec.series.length && seriesEls.length) {
      collection.appendChild(seriesEls[seriesEls.length - 1].cloneNode(true));
      if (memberEls.length) members.appendChild(memberEls[memberEls.length - 1].cloneNode(true));
      seriesEls = elements(collection, 'ChartSeries');
      memberEls = elements(members, 'ChartMember');
    }
    seriesEls.slice(spec.series.length).forEach(s => s.parentNode!.removeChild(s));
    memberEls.slice(spec.series.length).forEach(m => m.parentNode!.removeChild(m));
    spec.series.forEach((s, i) => {
      const el = seriesEls[i];
      if (!el) return;
      if (old.series[i]?.name !== s.name || i >= old.series.length) el.setAttribute('Name', s.name.replace(/\W/g, '') || `Series${i + 1}`);
      const oldKind = old.series[i]?.kind ?? old.kind, newKind = s.kind ?? spec.kind;
      const point = child(el, 'ChartDataPoints', 'ChartDataPoint');
      const values = child(point, 'ChartDataPointValues');
      if (values) {
        const prev = old.series[i];
        if (isRange(newKind)) {
          // Y becomes High when the series turns into a range
          if (!isRange(oldKind)) setText(doc, values, 'Y', undefined);
          if (!isRange(oldKind) || prev?.value !== s.value || i >= old.series.length) setText(doc, values, 'High', s.value, 'Low');
          if (!isRange(oldKind) || (prev?.low ?? '') !== (s.low ?? '') || i >= old.series.length) setText(doc, values, 'Low', s.low ?? '');
        } else {
          if (isRange(oldKind)) { setText(doc, values, 'High', undefined); setText(doc, values, 'Low', undefined); }
          const y = child(values, 'Y');
          if (!y || y.textContent !== s.value) setText(doc, values, 'Y', s.value, 'Size');
        }
      }
      if (point && ((old.series[i]?.color ?? '') !== (s.color ?? '') || i >= old.series.length)) {
        const style = child(point, 'Style') ?? point.insertBefore(doc.createElementNS(point.namespaceURI, 'Style'), child(point, 'ChartMarker') ?? null);
        setText(doc, style, 'Color', s.color || undefined);
      }
      if (point && (old.series[i]?.marker ?? '') !== (s.marker ?? '')) {
        const marker = child(point, 'ChartMarker') ?? point.insertBefore(doc.createElementNS(point.namespaceURI, 'ChartMarker'), child(point, 'DataElementOutput') ?? null);
        setText(doc, marker, 'Type', s.marker || undefined, elements(marker)[0]?.localName);
      }
      if (oldKind !== newKind || i >= old.series.length) {
        const [t, st] = s.kind ? typeOf(s.kind) : [type, sub];
        setText(doc, el, 'Type', t, 'Style');
        setText(doc, el, 'Subtype', st, 'Style');
      }
      if (memberEls[i] && (text(memberEls[i], 'Label') ?? '') !== s.name) setText(doc, memberEls[i], 'Label', s.name);
    });
  }
  if (spec.category !== old.category) {
    const cat = elements(child(chart, 'ChartCategoryHierarchy', 'ChartMembers'), 'ChartMember')[0];
    const expr = cat && child(cat, 'Group', 'GroupExpressions', 'GroupExpression');
    if (expr) expr.textContent = spec.category;
    if (cat && (text(cat, 'Label') ?? '') === old.category) setText(doc, cat, 'Label', spec.category);
    const sort = cat && child(cat, 'SortExpressions', 'SortExpression', 'Value');
    if (sort && sort.textContent === old.category) sort.textContent = spec.category;
  }
  if (spec.title !== old.title) {
    const caption = child(chart, 'ChartTitles', 'ChartTitle', 'Caption');
    if (caption) caption.textContent = spec.title;
  }
  if (spec.legend !== old.legend) {
    const legend = child(chart, 'ChartLegends', 'ChartLegend');
    if (legend) setText(doc, legend, 'Hidden', spec.legend ? undefined : 'true', 'Style');
  }
  if (spec.palette !== old.palette) setText(doc, chart, 'Palette', spec.palette, 'DataSetName');
  patchAxesAndLabels(doc, chart, old, spec);
  patchTrends(doc, dom, chart, old, spec);
  if (spec.dataSetName !== old.dataSetName) setText(doc, chart, 'DataSetName', spec.dataSetName);
  return normalizeFragment(dom.serialize(chart));
}

/** Axis titles, formats and bounds, the secondary axis and its series, data labels – only what changed. */
function patchAxesAndLabels(doc: Document, chart: Element, old: ChartSpec, spec: ChartSpec) {
  let axes = axesOf(chart);
  const wantSecondary = spec.series.some(x => x.secondary);
  if (wantSecondary && !axes.secondary && axes.values && axes.primary) {
    // a copy of the primary value axis on the opposite side, without its own gridlines
    const copy = axes.primary.cloneNode(true) as Element;
    copy.setAttribute('Name', SECONDARY);
    setText(doc, copy, 'Location', 'Opposite', 'ChartAxisScaleBreak');
    const grid = child(copy, 'ChartMajorGridLines');
    if (grid) setText(doc, grid, 'Enabled', 'False', 'Style');
    axes.values.appendChild(copy);
    axes = axesOf(chart);
  }
  const patchAxis = (a: Element | undefined, before: ChartAxisSpec, after: ChartAxisSpec) => {
    if (!a) return;
    if (after.title !== before.title) {
      const title = child(a, 'ChartAxisTitle') ?? a.insertBefore(doc.createElementNS(a.namespaceURI, 'ChartAxisTitle'), elements(a)[1] ?? null);
      setText(doc, title, 'Caption', after.title, 'Style');
    }
    if (after.format !== before.format) {
      const style = child(a, 'Style') ?? a.insertBefore(doc.createElementNS(a.namespaceURI, 'Style'), elements(a)[0] ?? null);
      setText(doc, style, 'Format', after.format || undefined);
    }
    if (after.min !== before.min) setText(doc, a, 'Minimum', after.min || (child(a, 'Minimum') ? 'NaN' : undefined), 'ChartAxisScaleBreak');
    if (after.max !== before.max) setText(doc, a, 'Maximum', after.max || (child(a, 'Maximum') ? 'NaN' : undefined), 'ChartAxisScaleBreak');
  };
  patchAxis(axes.category, old.categoryAxis, spec.categoryAxis);
  patchAxis(axes.primary, old.valueAxis, spec.valueAxis);
  patchAxis(axes.secondary, old.secondaryAxis, spec.secondaryAxis);

  const seriesEls = elements(child(chart, 'ChartData', 'ChartSeriesCollection'), 'ChartSeries');
  spec.series.forEach((s, i) => {
    const el = seriesEls[i];
    if (!el) return;
    if (!!s.secondary !== !!old.series[i]?.secondary || i >= old.series.length) {
      const target = s.secondary ? axes.secondary?.getAttribute('Name') ?? SECONDARY : axes.primary?.getAttribute('Name') ?? 'Primary';
      setText(doc, el, 'ValueAxisName', target, 'CategoryAxisName');
    }
    if (spec.dataLabels !== old.dataLabels) {
      for (const point of elements(child(el, 'ChartDataPoints'), 'ChartDataPoint')) {
        const label = child(point, 'ChartDataLabel') ?? point.insertBefore(doc.createElementNS(point.namespaceURI, 'ChartDataLabel'), elements(point)[1] ?? null);
        setText(doc, label, 'UseValueAsLabel', spec.dataLabels ? 'true' : undefined);
        setText(doc, label, 'Visible', spec.dataLabels ? 'true' : undefined);
      }
    }
  });
}

/**
 * Calculated series: one per series with a trend. Unchanged ones stay as they are (their formatting too); changed
 * ones are replaced, removed ones and those of removed series deleted.
 */
function patchTrends(doc: Document, dom: XmlDom, chart: Element, old: ChartSpec, spec: ChartSpec) {
  const data = child(chart, 'ChartData');
  if (!data) return;
  const seriesEls = elements(child(data, 'ChartSeriesCollection'), 'ChartSeries');
  const names = seriesEls.map(s => s.getAttribute('Name') ?? '');
  const same = (a?: ChartTrend, b?: ChartTrend) => (!a && !b) || (!!a && !!b && a.formula === b.formula && (a.period === b.period || !hasPeriod(a.formula)));
  let collection = child(data, 'ChartDerivedSeriesCollection');
  const derivedOf = (name: string) => elements(collection, 'ChartDerivedSeries')
    .filter(d => text(d, 'SourceChartSeriesName') === name && trendFormulas().some(([f]) => f === text(d, 'DerivedSeriesFormula')));
  // calculated series of series that no longer exist (only the formulas the designer manages)
  for (const d of elements(collection, 'ChartDerivedSeries')) {
    if (!names.includes(text(d, 'SourceChartSeriesName') ?? '') && trendFormulas().some(([f]) => f === text(d, 'DerivedSeriesFormula'))) d.parentNode!.removeChild(d);
  }
  spec.series.forEach((s, i) => {
    const name = names[i];
    if (name === undefined) return;
    // unchanged (a renamed series lost its calculated series above and gets it again)
    if (same(old.series[i]?.trend, s.trend) && i < old.series.length && (!s.trend || derivedOf(name).length)) return;
    for (const d of derivedOf(name)) d.parentNode!.removeChild(d);
    if (!s.trend) return;
    if (!collection) {
      collection = doc.createElementNS(data.namespaceURI, 'ChartDerivedSeriesCollection');
      data.insertBefore(collection, child(data, 'ChartSeriesCollection')?.nextSibling ?? null);
    }
    const parsed = dom.parse(`<w xmlns="${data.namespaceURI ?? ''}">${derivedXml(name, s.trend, !!s.secondary)}</w>`);
    collection.appendChild(doc.importNode(elements(parsed.documentElement)[0], true));
  });
  if (collection && !elements(collection).length) collection.parentNode!.removeChild(collection);
}
