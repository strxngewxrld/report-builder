// Charts: creating the RDL of a new chart from a simple description, and reading/patching the parts of an existing
// chart the designer edits (type, category, series values, title, legend, palette). Everything else in the chart's
// XML stays as it is (charts are kept as verbatim items).

import { NS_RD, XmlDom, browserDom, child, elements, normalizeFragment, text } from './rdl';
import { l10n } from './l10n';

export type ChartKind =
  | 'Column' | 'StackedColumn' | 'PercentColumn' | 'Bar' | 'StackedBar' | 'Line' | 'SmoothLine' | 'Area' | 'StackedArea'
  | 'Scatter' | 'Pie' | 'Doughnut';
/** Chart kinds with their (translated) label and icon; a function, so the labels follow the display language. */
export const chartKinds = (): [ChartKind, string, string][] => [
  ['Column', l10n.t('Column'), 'graph'], ['StackedColumn', l10n.t('Stacked column'), 'graph'], ['PercentColumn', l10n.t('100% column'), 'graph'],
  ['Bar', l10n.t('Bar'), 'graph-left'], ['StackedBar', l10n.t('Stacked bar'), 'graph-left'], ['Line', l10n.t('Line'), 'graph-line'],
  ['SmoothLine', l10n.t('Smooth line'), 'graph-line'], ['Area', l10n.t('Area'), 'graph-line'], ['StackedArea', l10n.t('Stacked area'), 'graph-line'],
  ['Scatter', l10n.t('Scatter'), 'graph-scatter'], ['Pie', l10n.t('Pie'), 'pie-chart'], ['Doughnut', l10n.t('Doughnut'), 'pie-chart'],
];
/** Kinds a single series can have in a combined chart (with the chart's own kind). */
export const SERIES_KINDS: ChartKind[] = ['Column', 'Line', 'SmoothLine', 'Area', 'Scatter'];
export const isPie = (k: ChartKind) => k === 'Pie' || k === 'Doughnut';

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
  Pie: ['Shape', undefined], Doughnut: ['Shape', 'Doughnut'],
} as const)[k];
const kindOf = (type: string, sub: string): ChartKind => {
  const s = sub.toLowerCase();
  if (type === 'Shape') return s === 'doughnut' ? 'Doughnut' : 'Pie';
  if (type === 'Bar') return s.includes('stacked') ? 'StackedBar' : 'Bar';
  if (type === 'Line') return s === 'smooth' ? 'SmoothLine' : 'Line';
  if (type === 'Area') return s.includes('stacked') ? 'StackedArea' : 'Area';
  if (type === 'Scatter') return 'Scatter';
  return s === 'percentstacked' ? 'PercentColumn' : s.includes('stacked') ? 'StackedColumn' : 'Column';
};

const SECONDARY = 'Secondary';
const dataLabelXml = (on: boolean) => (on ? '<ChartDataLabel><Style /><UseValueAsLabel>true</UseValueAsLabel><Visible>true</Visible></ChartDataLabel>' : '<ChartDataLabel><Style /></ChartDataLabel>');
const seriesXml = (s: ChartSeriesSpec, spec: ChartSpec) => {
  const [type, sub] = typeOf(s.kind ?? spec.kind);
  return `<ChartSeries Name="${xmlEsc(s.name.replace(/\W/g, '') || 'Series')}"><ChartDataPoints><ChartDataPoint><ChartDataPointValues><Y>${xmlEsc(s.value)}</Y></ChartDataPointValues>`
    + `${dataLabelXml(spec.dataLabels)}<Style /><ChartMarker><Style /></ChartMarker><DataElementOutput>Output</DataElementOutput></ChartDataPoint></ChartDataPoints>`
    + `<Type>${type}</Type>${sub ? `<Subtype>${sub}</Subtype>` : ''}<Style /><ChartEmptyPoints><Style /><ChartMarker><Style /></ChartMarker><ChartDataLabel><Style /></ChartDataLabel></ChartEmptyPoints>`
    + `<ValueAxisName>${s.secondary ? SECONDARY : 'Primary'}</ValueAxisName><CategoryAxisName>Primary</CategoryAxisName><ChartSmartLabel><CalloutLineColor>Black</CalloutLineColor><MinMovingDistance>0pt</MinMovingDistance></ChartSmartLabel></ChartSeries>`;
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
    + `<ChartData><ChartSeriesCollection>${spec.series.map(s => seriesXml(s, spec)).join('')}</ChartSeriesCollection></ChartData>`
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
  return {
    name: chart.getAttribute('Name') ?? '',
    dataSetName: text(chart, 'DataSetName') ?? '',
    kind,
    category: text(cat, 'Group', 'GroupExpressions', 'GroupExpression') ?? '',
    series: seriesEls.map((s, i) => {
      const own = kindOf(text(s, 'Type') ?? 'Column', text(s, 'Subtype') ?? '');
      const secondary = !!axes.secondary && text(s, 'ValueAxisName') === axes.secondary.getAttribute('Name');
      return {
        name: labels[i] || s.getAttribute('Name') || l10n.t('Series{0}', i + 1), value: text(s, 'ChartDataPoints', 'ChartDataPoint', 'ChartDataPointValues', 'Y') ?? '',
        ...(own !== kind ? { kind: own } : {}), ...(secondary ? { secondary } : {}),
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
      const y = child(el, 'ChartDataPoints', 'ChartDataPoint', 'ChartDataPointValues', 'Y');
      if (y && y.textContent !== s.value) y.textContent = s.value;
      const oldKind = old.series[i]?.kind ?? old.kind, newKind = s.kind ?? spec.kind;
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
