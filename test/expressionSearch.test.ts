import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom } from '../webview/rdl';
import { expressionReferences, expressionsIn, patchExpressions, replaceLiteral, renameParameterReference } from '../webview/expressionSearch';
const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: n => new XMLSerializer().serializeToString(n as never),
};

test('parameter renaming covers collection syntax and case without rewriting string literals', () => {
  const value = '=Parameters!Year.Value + Parameters("YEAR").Value + parameters ! year.Value & "Parameters!Year.Value" & Parameters!Yearly.Value';
  assert.equal(renameParameterReference(value, 'Year', 'FiscalYear'), '=Parameters!FiscalYear.Value + Parameters("FiscalYear").Value + Parameters!FiscalYear.Value & "Parameters!Year.Value" & Parameters!Yearly.Value');
});

test('expression search includes preserved regions, group and style properties but skips constants, code and comments', () => {
  const xml = `<Report><Body><Textbox Name="Total"><Value>=Fields!Amount.Value &amp; " €"</Value><Style><Color>=IIf(Fields!Amount.Value &lt; 0, "Red", "Black")</Color></Style></Textbox>
  <Textbox Name="Literal"><Value EvaluationMode="Constant">=Fields!Amount.Value</Value></Textbox>
  <Tablix Name="List"><Group Name="Document"><GroupExpression>=Fields!Number.Value</GroupExpression></Group></Tablix>
  <!-- <Value>=Fields!Fake.Value</Value> --><Code>=Fields!Code.Value</Code><CommandText>=SQL</CommandText></Body></Report>`;
  const found = expressionsIn(xml, dom);
  assert.equal(found.length, 3);
  assert.equal(found[0].item, 'Total');
  assert.equal(found[0].value, '=Fields!Amount.Value & " €"');
  assert.equal(found[2].item, 'List');
  assert.match(found[2].path, /Group\[Document\]/);
  const next = patchExpressions(xml, [{ location: found[0], value: '=Fields!Net.Value & " < €"' }]);
  assert.equal(next, xml.replace('=Fields!Amount.Value &amp; " €"', '=Fields!Net.Value &amp; " &lt; €"'));
});

test('literal replacement is case configurable and treats dollar signs and regex metacharacters literally', () => {
  assert.equal(replaceLiteral('=Fields!A.Value + fields!a.value', 'Fields!A.Value', '$&', false), '=$& + $&');
  assert.equal(replaceLiteral('=Fields!A.Value + fields!a.value', 'Fields!A.Value', '0', true), '=0 + fields!a.value');
  assert.equal(replaceLiteral('=1', '', 'x'), '=1');
});

test('reference overview ignores quoted text and includes keyed access and AL label parameters', () => {
  assert.deepEqual(expressionReferences('="Fields!Fake.Value" & Fields!Amount.Value & Parameters!Caption.Value & Fields("Other").Value & "say ""Parameters!Fake"""'), [
    { kind: 'Fields', name: 'Amount' }, { kind: 'Parameters', name: 'Caption' }, { kind: 'Fields', name: 'Other' },
  ]);
});

test('multiple replacements preserve original offsets and unrelated source bytes', () => {
  const xml = '\ufeff<Report>\r\n<Value>=1 &lt; 2</Value> <Value>=3</Value>\r\n</Report>\r\n';
  const found = expressionsIn(xml, dom);
  const next = patchExpressions(xml, found.map(location => ({ location, value: location.value + ' + 10' })));
  assert.equal(next, '\ufeff<Report>\r\n<Value>=1 &lt; 2 + 10</Value> <Value>=3 + 10</Value>\r\n</Report>\r\n');
});

test('CDATA expressions are searchable and replacement keeps XML valid', () => {
  const xml = '<Report><Textbox Name="T"><Value><![CDATA[=Fields!Amount.Value < 10]]></Value></Textbox></Report>';
  const locations = expressionsIn(xml, dom);
  assert.equal(locations.length, 1);
  assert.equal(locations[0].value, '=Fields!Amount.Value < 10');
  const patched = patchExpressions(xml, [{ location: locations[0], value: '="end ]]> text"' }]);
  assert.equal(dom.parse(patched).getElementsByTagName('Value')[0].textContent, '="end ]]> text"');
  assert.match(patched, /<!\[CDATA\[/);
});

test('qualified report element names still expose item ownership and skip Code content', () => {
  const xml = '<r:Report xmlns:r="urn:rdl"><r:Textbox Name="T"><r:Value>=Fields!A.Value</r:Value></r:Textbox><r:Code>=not an expression</r:Code></r:Report>';
  const found = expressionsIn(xml, dom);
  assert.equal(found.length, 1);
  assert.equal(found[0].item, 'T');
});
