import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { emptyReport } from '../webview/model';
import { XmlDom, serializeRdl } from '../webview/rdl';
import { renderReport } from '../webview/render/engine';
import { RGauge } from '../webview/render/types';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};

// as Report Builder writes a radial gauge (shortened to the parts that matter)
const gauge = (kind: 'Radial' | 'Linear') => `<GaugePanel Name="Auslastung"><${kind}Gauges><${kind}Gauge Name="G1"><GaugeScales><${kind}Scale Name="S1">
<GaugePointers><${kind}Pointer Name="P1"><GaugeInputValue><Value>=Sum(Fields!Amount.Value)</Value></GaugeInputValue></${kind}Pointer></GaugePointers>
<ScaleRanges><ScaleRange Name="R1"><StartValue><Value>0</Value></StartValue><EndValue><Value>100</Value></EndValue><Style><BackgroundColor>Green</BackgroundColor></Style></ScaleRange>
<ScaleRange Name="R2"><StartValue><Value>=Parameters!Grenze.Value</Value></StartValue><EndValue><Value>200</Value></EndValue><Style><BackgroundColor>Red</BackgroundColor></Style></ScaleRange></ScaleRanges>
<MinimumValue><Value>0</Value></MinimumValue><MaximumValue><Value>200</Value></MaximumValue></${kind}Scale></GaugeScales></${kind}Gauge></${kind}Gauges>
<DataSetName>Sales</DataSetName><Top>0in</Top><Left>0in</Left><Height>2in</Height><Width>3in</Width></GaugePanel>`;

function report(xml: string) {
  const r = emptyReport();
  r.dataSources.push({ id: 's', name: 'DS', provider: 'SQL', connectString: '', extra: [], connExtra: [] });
  r.dataSets.push({ id: 'd', name: 'Sales', dataSourceName: 'DS', commandText: '', extra: [], queryExtra: [], fields: [{ name: 'Amount', dataField: 'Amount', typeName: '' }] });
  return serializeRdl(r, dom).replace('<Height>2.25in</Height>', `<ReportItems>${xml}</ReportItems><Height>2.25in</Height>`);
}

test('Messgerät: Wert, Skala und Bereiche in der Vorschau; Darstellung als SVG', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { GaugeView } = await import('../webview/render/GaugeView');
  for (const kind of ['Radial', 'Linear'] as const) {
    const out = renderReport(report(gauge(kind)), {
      dom, mode: 'preview', data: { Sales: [{ Amount: 70 }, { Amount: 50 }] }, parameters: { Grenze: 150 },
    });
    const g = out.body.nodes[0] as RGauge;
    assert.equal(g.kind, 'gauge');
    assert.equal(g.shape, kind === 'Radial' ? 'radial' : 'linear');
    assert.deepEqual([g.value, g.min, g.max], [120, 0, 200]);
    assert.deepEqual(g.ranges, [{ start: 0, end: 100, color: 'Green' }, { start: 150, end: 200, color: 'Red' }]);
    const svg = renderToStaticMarkup(createElement(GaugeView, { gauge: g, S: 96, style: {} }));
    assert.ok(svg.includes('>120<') && !svg.includes('NaN'));
  }
  // design mode: a sample value
  const design = renderReport(report(gauge('Radial')), { dom, mode: 'design', data: {} }).body.nodes[0] as RGauge;
  assert.equal(design.sample, true);
});
