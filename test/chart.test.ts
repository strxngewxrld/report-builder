import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ChartSpec, chartXml, patchChart, readChart } from '../webview/charts';
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
