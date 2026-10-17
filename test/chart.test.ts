import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ChartSpec, chartXml, emptyAxis, patchChart, readChart } from '../webview/charts';
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
