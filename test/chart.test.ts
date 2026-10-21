import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ChartSpec, chartXml, deriveValues, emptyAxis, patchChart, readChart } from '../webview/charts';
import { RawItem, emptyReport } from '../webview/model';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { renderReport } from '../webview/render/engine';
import { RChart } from '../webview/render/types';
import { exportBlocks } from '../webview/render/export';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const spec: ChartSpec = {
  name: 'Umsatzdiagramm', dataSetName: 'Sales', kind: 'Column', category: '=Fields!Region.Value',
  series: [{ name: 'Umsatz', value: '=Sum(Fields!Amount.Value)' }, { name: 'Menge', value: '=Sum(Fields!Qty.Value)' }],
  title: 'Umsatz je Region', legend: true, palette: 'BrightPastel',
  dataLabels: false, categoryAxis: emptyAxis(), valueAxis: emptyAxis(), secondaryAxis: emptyAxis(),
};
const data = { Sales: [
  { Region: 'Nord', Amount: 100, Qty: 1 }, { Region: 'Süd', Amount: 50, Qty: 2 }, { Region: 'Nord', Amount: 25, Qty: 3 },
] };

/** A report containing the chart, through the designer's own parse/serialize. */
function withChart(xml: string) {
  const r = emptyReport();
  r.dataSources.push({ id: 's', name: 'DS', provider: 'SQL', connectString: '', extra: [], connExtra: [] });
  r.dataSets.push({ id: 'd', name: 'Sales', dataSourceName: 'DS', commandText: '', extra: [], queryExtra: [],
    fields: ['Region', 'Amount', 'Qty'].map(n => ({ name: n, dataField: n, typeName: '' })) });
  const placeholder = parseRdl(serializeRdl(r, dom).replace('<Height>2.25in</Height>', `<ReportItems>${xml}</ReportItems><Height>2.25in</Height>`), dom);
  return placeholder;
}

test('Neues Diagramm: gültig eingebettet, ausgewertet, exportiert', () => {
  const r = withChart(chartXml(spec, { top: 0, left: 0, width: 4, height: 2.5 }));
  const raw = r.body.items[0] as RawItem;
  assert.equal(raw.type, 'raw');
  assert.equal(raw.kind, 'Chart');
  assert.deepEqual(readChart(raw.xml, dom), spec);
  const xml = serializeRdl(r, dom);
  assert.equal(serializeRdl(parseRdl(xml, dom), dom), xml, 'stabil');

  const chart = renderReport(xml, { dom, mode: 'preview', data }).body.nodes[0] as RChart;
  assert.equal(chart.kind, 'chart');
  assert.deepEqual(chart.categories, ['Nord', 'Süd']);
  assert.deepEqual(chart.series.map(s => [s.name, s.type, s.values]), [['Umsatz', 'Column', [125, 50]], ['Menge', 'Column', [4, 2]]]);
  assert.equal(chart.title, 'Umsatz je Region');
  const design = renderReport(xml, { dom, mode: 'design' }).body.nodes[0] as RChart;
  assert.equal(design.sample, true);

  // as a value table in Excel/Word
  const blocks = exportBlocks(renderReport(xml, { dom, mode: 'preview', data }));
  assert.deepEqual(blocks.find(b => b.kind === 'table') && (blocks.find(b => b.kind === 'table') as { rows: { text: string }[][] }).rows.map(r => r.map(c => c.text)),
    [['', 'Umsatz', 'Menge'], ['Nord', '125', '4'], ['Süd', '50', '2']]);
});

test('Diagramm bearbeiten: Typ, Reihen, Kategorie, Titel – der Rest bleibt', () => {
  const xml = chartXml(spec, { top: 0, left: 0, width: 4, height: 2.5 });
  const pie = patchChart(xml, { ...spec, kind: 'Pie', series: [spec.series[0]], title: 'Anteile', category: '=Fields!Region.Value' }, dom);
  const back = readChart(pie, dom)!;
  assert.equal(back.kind, 'Pie');
  assert.deepEqual(back.series, [spec.series[0]]);
  assert.equal(back.title, 'Anteile');
  assert.ok(pie.includes('<Palette>BrightPastel</Palette>'));
  const more = patchChart(pie, { ...back, kind: 'StackedColumn', series: [...back.series, { name: 'Menge', value: '=Sum(Fields!Qty.Value)' }], legend: false }, dom);
  const b2 = readChart(more, dom)!;
  assert.equal(b2.kind, 'StackedColumn');
  assert.deepEqual(b2.series.map(s => s.name), ['Umsatz', 'Menge']);
  assert.equal(b2.legend, false);
  const chart = renderReport(serializeRdl(withChart(more), dom), { dom, mode: 'preview', data }).body.nodes[0] as RChart;
  assert.deepEqual(chart.series.map(s => [s.type, s.stacked]), [['Column', true], ['Column', true]]);
  assert.equal(chart.legend, false);
});

test('Diagramm: Achsen, Datenbeschriftungen, zweite Werteachse, Kombidiagramm', () => {
  const combo: ChartSpec = {
    ...spec, kind: 'Column', dataLabels: true,
    series: [spec.series[0], { ...spec.series[1], kind: 'SmoothLine', secondary: true }],
    categoryAxis: { ...emptyAxis(), title: 'Region' },
    valueAxis: { title: 'Umsatz', format: 'N0', min: '0', max: '200' },
    secondaryAxis: { ...emptyAxis(), title: 'Menge' },
  };
  const xml = chartXml(combo, { top: 0, left: 0, width: 4, height: 2.5 });
  assert.deepEqual(readChart(xml, dom), combo);
  const r = withChart(xml);
  const out = renderReport(serializeRdl(r, dom), { dom, mode: 'preview', data });
  const chart = out.body.nodes[0] as RChart;
  assert.deepEqual(chart.valueAxis, { title: 'Umsatz', format: 'N0', min: 0, max: 200 });
  assert.equal(chart.secondaryAxis?.title, 'Menge');
  assert.equal(chart.categoryAxis?.title, 'Region');
  assert.equal(chart.dataLabels, true);
  assert.deepEqual(chart.series.map(s => [s.type, !!s.smooth, !!s.secondary]), [['Column', false, false], ['Line', true, true]]);

  // patching a plain chart: only what changed; the secondary axis is added as a copy of the primary one
  const plain = chartXml(spec, { top: 0, left: 0, width: 4, height: 2.5 });
  const patched = patchChart(plain, combo, dom);
  assert.deepEqual(readChart(patched, dom), combo);
  assert.match(patched, /<ChartAxis Name="Secondary">[\s\S]*?<Location>Opposite<\/Location>/);
  // and back: labels off, axis bounds automatic again
  const back = patchChart(patched, { ...combo, dataLabels: false, valueAxis: { ...combo.valueAxis, min: '', max: '' } }, dom);
  const read = readChart(back, dom)!;
  assert.equal(read.dataLabels, false);
  assert.deepEqual([read.valueAxis.min, read.valueAxis.max], ['', '']);
  assert.match(back, /<Minimum>NaN<\/Minimum>/);
});

test('Weitere Diagrammtypen: 100 %-Säulen, gestapelte Fläche, Punkte', () => {
  for (const kind of ['PercentColumn', 'StackedArea', 'Scatter'] as const) {
    const xml = chartXml({ ...spec, kind }, { top: 0, left: 0, width: 4, height: 2.5 });
    assert.equal(readChart(xml, dom)!.kind, kind);
    const chart = renderReport(serializeRdl(withChart(xml), dom), { dom, mode: 'preview', data }).body.nodes[0] as RChart;
    assert.equal(chart.series.length, 2);
    if (kind === 'PercentColumn') assert.ok(chart.series.every(s => s.percent && s.stacked));
    if (kind === 'StackedArea') assert.ok(chart.series.every(s => s.type === 'Area' && s.stacked));
    if (kind === 'Scatter') assert.ok(chart.series.every(s => s.type === 'Scatter'));
  }
});

test('Diagramme übernehmen die Berichtssprache für Achsen, Datenbeschriftungen und Tooltips', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { ChartView } = await import('../webview/render/ChartView');
  for (const language of ['de-DE', 'en-US']) {
    for (const kind of ['Column', 'Radar', 'Pie'] as const) {
      const definition: ChartSpec = {
        ...spec, kind, dataLabels: true,
        series: [spec.series[0], { ...spec.series[0], name: 'Zweite', secondary: kind === 'Column' }],
        valueAxis: { ...emptyAxis(), format: 'C2' },
        secondaryAxis: { ...emptyAxis(), format: 'N2' },
      };
      const xml = serializeRdl(withChart(chartXml(definition, { top: 0, left: 0, width: 6, height: 4 })), dom)
        .replace('</Report>', `<Language>${language}</Language></Report>`);
      const chart = renderReport(xml, { dom, mode: 'preview', data: { Sales: [{ Region: 'Nord', Amount: 1234.5 }] } }).body.nodes[0] as RChart;
      const svg = renderToStaticMarkup(createElement(ChartView, { chart, S: 96, style: {} }));
      assert.equal(chart.locale, language);
      if (kind === 'Column') {
        assert.ok(svg.includes(language === 'de-DE' ? '1.234,50' : '1,234.50'), `${language}: formatted labels`);
        assert.ok(svg.includes(language === 'de-DE' ? '€' : '$'), `${language}: currency`);
        assert.ok(!svg.includes(language === 'de-DE' ? '$' : '€'), `${language}: no other currency`);
      } else {
        assert.ok(svg.includes(language === 'de-DE' ? '1.234,5' : '1,234.5'), `${kind}: localized plain values`);
      }
      if (kind === 'Radar') assert.ok(svg.includes(language === 'de-DE' ? '€' : '$'), 'polar axis currency');
    }
  }
});

test('SVG-Darstellung: alle Typen, Achsentitel, zweite Achse, Beschriftungen', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { ChartView } = await import('../webview/render/ChartView');
  const kinds = ['Column', 'StackedColumn', 'PercentColumn', 'Bar', 'StackedBar', 'Line', 'SmoothLine', 'Area', 'StackedArea', 'Scatter', 'Pie', 'Doughnut'] as const;
  for (const kind of kinds) {
    const combo: ChartSpec = {
      ...spec, kind, dataLabels: true, series: [spec.series[0], { ...spec.series[1], secondary: kind === 'Column' }],
      valueAxis: { title: 'Umsatz', format: 'N0', min: '', max: '' }, secondaryAxis: { ...emptyAxis(), title: 'Menge' },
    };
    const chart = renderReport(serializeRdl(withChart(chartXml(combo, { top: 0, left: 0, width: 4, height: 2.5 })), dom), { dom, mode: 'preview', data }).body.nodes[0] as RChart;
    const svg = renderToStaticMarkup(createElement(ChartView, { chart, S: 96, style: {} }));
    assert.ok(!svg.includes('NaN'), `${kind}: keine NaN-Koordinaten`);
    if (kind !== 'Pie' && kind !== 'Doughnut') assert.ok(svg.includes('>Umsatz<'), `${kind}: Achsentitel`);
    if (kind === 'Column') assert.ok(svg.includes('>Menge<'), 'Titel der zweiten Achse');
    if (kind === 'PercentColumn') assert.ok(svg.includes('100 %') || svg.includes('100,00 %') || svg.includes('100'), '100 %');
  }
});

test('berechnete Reihen: Formeln', () => {
  const v = [2, 4, 6, null, 10];
  assert.deepEqual(deriveValues('MovingAverage', v, { Period: '2' }), [null, 3, 5, 6, 10]);
  assert.deepEqual(deriveValues('MovingAverage', v, { Period: '3', StartFromFirst: 'True' }), [2, 3, 4, 5, 8]);
  assert.deepEqual(deriveValues('Mean', v, {}), [5.5, 5.5, 5.5, 5.5, 5.5]);
  assert.deepEqual(deriveValues('Median', [3, 1, 2], {}), [2, 2, 2]);
  assert.deepEqual(deriveValues('WeightedMovingAverage', [1, 2, 3], { Period: '2' }), [null, 5 / 3, 8 / 3]);
  assert.deepEqual(deriveValues('ExponentialMovingAverage', [2, 4, 8], { Period: '2' }), [null, 3, 3 * (1 / 3) + 8 * (2 / 3)]);
  assert.equal(deriveValues('TriangularMovingAverage', [1, 2, 3, 4], { Period: '3' })!.length, 4);
  assert.equal(deriveValues('BollingerBands', v, {}), null);
});

test('Trichter, Bereich, Polar; Punktfarben, Markierungen, gleitender Durchschnitt', () => {
  const rich: ChartSpec = {
    ...spec,
    series: [
      { name: 'Umsatz', value: '=Sum(Fields!Amount.Value)', color: '=IIf(Sum(Fields!Amount.Value) > 60, "Green", "Red")', marker: 'Diamond', trend: { formula: 'MovingAverage', period: 2 } },
      { name: 'Menge', value: '=Sum(Fields!Qty.Value)', kind: 'Line' },
    ],
  };
  const xml = chartXml(rich, { top: 0, left: 0, width: 4, height: 2.5 });
  assert.deepEqual(readChart(xml, dom), rich);
  const r = withChart(xml);
  const doc = serializeRdl(r, dom);
  assert.match(xml, /<ChartDerivedSeriesCollection><ChartDerivedSeries><ChartSeries Name="Umsatz_MovingAverage">/);
  assert.match(xml, /<SourceChartSeriesName>Umsatz<\/SourceChartSeriesName><DerivedSeriesFormula>MovingAverage<\/DerivedSeriesFormula>/);
  const chart = renderReport(doc, { dom, mode: 'preview', data }).body.nodes[0] as RChart;
  assert.deepEqual(chart.series[0].colors, ['Green', 'Red']);
  assert.deepEqual(chart.series[0].marker, { type: 'Diamond' });
  const trend = chart.series.find(s => s.derived)!;
  assert.deepEqual(trend.values, [null, 87.5]);
  assert.equal(trend.type, 'Line');
  const design = renderReport(doc, { dom, mode: 'design' }).body.nodes[0] as RChart;
  assert.equal(design.series.filter(s => s.derived).length, 1);

  // the trend is changed, then removed; the chart's other XML stays
  const p2 = patchChart(xml, { ...rich, series: [{ ...rich.series[0], trend: { formula: 'Mean', period: 2 } }, rich.series[1]] }, dom);
  assert.equal(readChart(p2, dom)!.series[0].trend?.formula, 'Mean');
  assert.equal((p2.match(/<ChartDerivedSeries>/g) ?? []).length, 1);
  assert.doesNotMatch(p2, /Period/);
  const p3 = patchChart(p2, { ...rich, series: [{ ...rich.series[0], trend: undefined, color: undefined, marker: undefined }, rich.series[1]] }, dom);
  assert.doesNotMatch(p3, /ChartDerivedSeries|<Color>=IIf|Diamond/);
  // renaming the series keeps its calculated series attached
  const p4 = patchChart(xml, { ...rich, series: [{ ...rich.series[0], name: 'Erlös' }, rich.series[1]] }, dom);
  assert.match(p4, /<SourceChartSeriesName>Erls<\/SourceChartSeriesName>/);
  assert.equal((p4.match(/<ChartDerivedSeries>/g) ?? []).length, 1);

  // range: High/Low instead of Y, back to Y
  const range = patchChart(xml, { ...rich, kind: 'RangeColumn', series: [{ name: 'Umsatz', value: '=Max(Fields!Amount.Value)', low: '=Min(Fields!Amount.Value)' }] }, dom);
  assert.match(range, /<Type>Range<\/Type><Subtype>Column<\/Subtype>/);
  assert.match(range, /<ChartDataPointValues><High>=Max\(Fields!Amount.Value\)<\/High><Low>=Min\(Fields!Amount.Value\)<\/Low><\/ChartDataPointValues>/);
  const rc = renderReport(serializeRdl(withChart(range), dom), { dom, mode: 'preview', data }).body.nodes[0] as RChart;
  assert.equal(rc.series[0].type, 'RangeColumn');
  assert.deepEqual(rc.series[0].values, [100, 50]);
  assert.deepEqual(rc.series[0].low, [25, 50]);
  const back = patchChart(range, { ...rich, kind: 'Column', series: [{ name: 'Umsatz', value: '=Sum(Fields!Amount.Value)' }] }, dom);
  assert.match(back, /<ChartDataPointValues><Y>=Sum\(Fields!Amount.Value\)<\/Y><\/ChartDataPointValues>/);

  for (const [kind, type, sub, render] of [['Funnel', 'Shape', 'Funnel', 'Funnel'], ['Pyramid', 'Shape', 'Pyramid', 'Pyramid'], ['Radar', 'Polar', 'Radar', 'Radar'], ['Polar', 'Polar', undefined, 'Polar'], ['Range', 'Range', undefined, 'Range']] as const) {
    const one: ChartSpec = { ...spec, kind, series: [{ name: 'Umsatz', value: '=Sum(Fields!Amount.Value)', ...(kind === 'Range' ? { low: '=0' } : {}) }] };
    const x = chartXml(one, { top: 0, left: 0, width: 4, height: 2.5 });
    assert.match(x, new RegExp(`<Type>${type}</Type>${sub ? `<Subtype>${sub}</Subtype>` : '<Style'}`));
    assert.deepEqual(readChart(x, dom), one);
    const c = renderReport(serializeRdl(withChart(x), dom), { dom, mode: 'preview', data }).body.nodes[0] as RChart;
    assert.equal(c.series[0].type, render);
  }
});
