// Charts: creating the RDL of a new chart from a simple description, and reading/patching the parts of an existing
// chart the designer edits (type, category, series values, title, legend, palette). Everything else in the chart's
// XML stays as it is (charts are kept as verbatim items).

import { NS_RD, XmlDom, browserDom, child, elements, normalizeFragment, text } from './rdl';

export type ChartKind = 'Column' | 'StackedColumn' | 'Bar' | 'StackedBar' | 'Line' | 'Area' | 'Pie' | 'Doughnut';
export const CHART_KINDS: [ChartKind, string, string][] = [
  ['Column', 'Säulen', 'graph'], ['StackedColumn', 'Säulen gestapelt', 'graph'], ['Bar', 'Balken', 'graph-left'],
  ['StackedBar', 'Balken gestapelt', 'graph-left'], ['Line', 'Linie', 'graph-line'], ['Area', 'Fläche', 'graph-line'],
  ['Pie', 'Kreis', 'pie-chart'], ['Doughnut', 'Ring', 'pie-chart'],
];
export const PALETTES = ['BrightPastel', 'Pastel', 'EarthTones', 'Berry', 'Chocolate', 'Fire', 'Grayscale', 'SemiTransparent'];

export interface ChartSpec {
  name: string;
  dataSetName: string;
  kind: ChartKind;
  /** Category grouping (x axis), e.g. =Fields!Region.Value; '' for a single category. */
  category: string;
  series: { name: string; value: string }[];
  title: string;
  legend: boolean;
  palette: string;
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const typeOf = (k: ChartKind): readonly [string, string | undefined] => ({
  Column: ['Column', undefined], StackedColumn: ['Column', 'Stacked'], Bar: ['Bar', undefined], StackedBar: ['Bar', 'Stacked'],
  Line: ['Line', undefined], Area: ['Area', undefined], Pie: ['Shape', undefined], Doughnut: ['Shape', 'Doughnut'],
} as const)[k];
const kindOf = (type: string, sub: string): ChartKind => {
  const s = sub.toLowerCase();
  if (type === 'Shape') return s === 'doughnut' ? 'Doughnut' : 'Pie';
  if (type === 'Bar') return s.includes('stacked') ? 'StackedBar' : 'Bar';
  if (type === 'Line' || type === 'Area') return type;
  return s.includes('stacked') ? 'StackedColumn' : 'Column';
};

const seriesXml = (s: { name: string; value: string }, kind: ChartKind) => {
  const [type, sub] = typeOf(kind);
  return `<ChartSeries Name="${xmlEsc(s.name)}"><ChartDataPoints><ChartDataPoint><ChartDataPointValues><Y>${xmlEsc(s.value)}</Y></ChartDataPointValues>`
    + `<ChartDataLabel><Style /></ChartDataLabel><Style /><ChartMarker><Style /></ChartMarker><DataElementOutput>Output</DataElementOutput></ChartDataPoint></ChartDataPoints>`
    + `<Type>${type}</Type>${sub ? `<Subtype>${sub}</Subtype>` : ''}<Style /><ChartEmptyPoints><Style /><ChartMarker><Style /></ChartMarker><ChartDataLabel><Style /></ChartDataLabel></ChartEmptyPoints>`
    + `<ValueAxisName>Primary</ValueAxisName><CategoryAxisName>Primary</CategoryAxisName><ChartSmartLabel><CalloutLineColor>Black</CalloutLineColor><MinMovingDistance>0pt</MinMovingDistance></ChartSmartLabel></ChartSeries>`;
};
const seriesMember = (s: { name: string }) => `<ChartMember><Label>${xmlEsc(s.name)}</Label></ChartMember>`;
const categoryMember = (spec: ChartSpec) => (spec.category
  ? `<ChartMember><Group Name="${xmlEsc(spec.name)}_CategoryGroup"><GroupExpressions><GroupExpression>${xmlEsc(spec.category)}</GroupExpression></GroupExpressions></Group>`
    + `<SortExpressions><SortExpression><Value>${xmlEsc(spec.category)}</Value></SortExpression></SortExpressions><Label>${xmlEsc(spec.category)}</Label></ChartMember>`
  : '<ChartMember><Label /></ChartMember>');
const axis = (name: string) => `<ChartAxis Name="${name}"><Style><FontSize>8pt</FontSize></Style><ChartAxisTitle><Caption /><Style><FontSize>8pt</FontSize></Style></ChartAxisTitle>`
  + `<ChartMajorGridLines><Style><Border><Color>Gainsboro</Color></Border></Style></ChartMajorGridLines><ChartMinorGridLines><Style><Border><Color>Gainsboro</Color><Style>Dotted</Style></Border></Style></ChartMinorGridLines>`
  + `<ChartMinorTickMarks><Length>0.5</Length></ChartMinorTickMarks><CrossAt>NaN</CrossAt><Minimum>NaN</Minimum><Maximum>NaN</Maximum><ChartAxisScaleBreak><Style /></ChartAxisScaleBreak></ChartAxis>`;

/** RDL of a new chart (the structure Report Builder creates), positioned in inches. */
export function chartXml(spec: ChartSpec, box: { top: number; left: number; width: number; height: number }): string {
  const inch = (v: number) => `${Math.round(v * 1e5) / 1e5}in`;
  return `<Chart Name="${xmlEsc(spec.name)}">`
    + `<ChartCategoryHierarchy><ChartMembers>${categoryMember(spec)}</ChartMembers></ChartCategoryHierarchy>`
    + `<ChartSeriesHierarchy><ChartMembers>${spec.series.map(seriesMember).join('')}</ChartMembers></ChartSeriesHierarchy>`
    + `<ChartData><ChartSeriesCollection>${spec.series.map(s => seriesXml(s, spec.kind)).join('')}</ChartSeriesCollection></ChartData>`
    + `<ChartAreas><ChartArea Name="Default"><ChartCategoryAxes>${axis('Primary')}</ChartCategoryAxes><ChartValueAxes>${axis('Primary')}</ChartValueAxes>`
    + `<Style><BackgroundGradientType>None</BackgroundGradientType></Style></ChartArea></ChartAreas>`
    + `<ChartLegends><ChartLegend Name="Default">${spec.legend ? '' : '<Hidden>true</Hidden>'}<Style><BackgroundGradientType>None</BackgroundGradientType><FontSize>8pt</FontSize></Style>`
    + `<ChartLegendTitle><Caption /><Style><FontSize>8pt</FontSize><FontWeight>Bold</FontWeight><TextAlign>Center</TextAlign></Style></ChartLegendTitle><HeaderSeparatorColor>Black</HeaderSeparatorColor><ColumnSeparatorColor>Black</ColumnSeparatorColor></ChartLegend></ChartLegends>`
    + `<ChartTitles><ChartTitle Name="Default"><Caption>${xmlEsc(spec.title)}</Caption><Style><BackgroundGradientType>None</BackgroundGradientType><FontWeight>Bold</FontWeight><TextAlign>General</TextAlign><VerticalAlign>Top</VerticalAlign></Style></ChartTitle></ChartTitles>`
    + `<Palette>${xmlEsc(spec.palette)}</Palette><ChartBorderSkin><Style><BackgroundColor>Gray</BackgroundColor><BackgroundGradientType>None</BackgroundGradientType><Color>White</Color></Style></ChartBorderSkin>`
    + `<ChartNoDataMessage Name="NoDataMessage"><Caption>Keine Daten</Caption><Style><BackgroundGradientType>None</BackgroundGradientType><TextAlign>General</TextAlign><VerticalAlign>Top</VerticalAlign></Style></ChartNoDataMessage>`
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
  return {
    name: chart.getAttribute('Name') ?? '',
    dataSetName: text(chart, 'DataSetName') ?? '',
    kind: kindOf(text(seriesEls[0], 'Type') ?? 'Column', text(seriesEls[0], 'Subtype') ?? ''),
    category: text(cat, 'Group', 'GroupExpressions', 'GroupExpression') ?? '',
    series: seriesEls.map((s, i) => ({ name: labels[i] || s.getAttribute('Name') || `Reihe${i + 1}`, value: text(s, 'ChartDataPoints', 'ChartDataPoint', 'ChartDataPointValues', 'Y') ?? '' })),
    title: text(chart, 'ChartTitles', 'ChartTitle', 'Caption') ?? '',
    legend: !!legend && (text(legend, 'Hidden') ?? '').toLowerCase() !== 'true',
    palette: text(chart, 'Palette') ?? 'BrightPastel',
  };
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
      if (old.kind !== spec.kind) {
        setText(doc, el, 'Type', type, 'Style');
        setText(doc, el, 'Subtype', sub, 'Style');
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
  if (spec.dataSetName !== old.dataSetName) setText(doc, chart, 'DataSetName', spec.dataSetName);
  return normalizeFragment(dom.serialize(chart));
}
