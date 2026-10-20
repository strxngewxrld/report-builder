import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { NS_2010 } from '../webview/model';
import { OutlineNode, buildOutline, indexOutline } from '../webview/outline';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const bc = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');

/** Compact "Kind:Name" tree for assertions. */
const shape = (nodes: OutlineNode[]): unknown[] =>
  nodes.map(n => (n.children.length ? { [`${n.kind}:${n.name}`]: shape(n.children) } : `${n.kind}:${n.name}`));

test('outline shows the full hierarchy of a Business Central layout', () => {
  // built from what the designer writes back, i.e. after a round trip through the model
  const outline = buildOutline(serializeRdl(parseRdl(bc, dom)), dom);
  assert.deepEqual(shape(outline), [
    { 'Section:Page Header': ['Textbox:PageHdr_Company', 'Textbox:PageHdr_DocNo', 'Textbox:PageNo'] },
    { 'Section:Body': [{
      'Tablix:Table_Document': [
        { 'Rows:Row Groups': ['Group:Group_Document'] },
        { 'Rectangle:Rect_DocHeader': ['Textbox:CompanyName', 'Textbox:DocumentNo_Lbl', 'Textbox:DocumentNo', 'Textbox:DocumentDate', 'Textbox:SetData_Header', 'Textbox:PaidInfo'] },
        { 'Tablix:Table_Lines': [
          { 'Rows:Row Groups': ['Group:Details_Lines'] },
          'Textbox:Description_Lbl', 'Textbox:Quantity_Lbl', 'Textbox:UnitPrice_Lbl', 'Textbox:LineAmount_Lbl',
          'Textbox:Description_Line', 'Textbox:Quantity_Line', 'Textbox:UnitPrice_Line', 'Textbox:LineAmount_Line',
          'Textbox:Total_Lbl', 'Textbox:Total_Empty1', 'Textbox:Total_Empty2', 'Textbox:TotalAmount',
        ] },
      ],
    }] },
  ]);
});

test('outline details: visibility, grouping, filters, sorting, values', () => {
  const index = indexOutline(buildOutline(bc, dom));
  const get = (key: string) => Object.fromEntries(index.get(key)!.node.details);

  assert.equal(index.get('item:SetData_Header')!.node.hidden, '=Code.SetData(Fields!CompanyName.Value + Chr(177) + Fields!No_SalesInvHdr.Value, 1)');
  assert.equal(index.get('item:PaidInfo')!.node.hidden, '=Not Fields!Paid.Value');
  assert.equal(get('item:PageHdr_Company').Value, '=Code.GetData(1,1)');
  assert.equal(get('item:Table_Document').Dataset, 'DataSet_Result');
  assert.equal(get('group:Group_Document')['Group by'], '=Fields!No_SalesInvHdr.Value');
  assert.equal(get('group:Group_Document')['Page break'], 'Between');
  assert.equal(get('group:Details_Lines')['Group by'], '(detail data)');
  assert.equal(get('group:Details_Lines').Filter, '=Fields!LineNo_Line.Value NotEqual 0');
  assert.equal(get('group:Details_Lines').Sorting, '=Fields!LineNo_Line.Value');
  assert.equal(get('item:CompanyName').Position, '0cm, 0cm – 10cm × 0.7cm');
  assert.deepEqual(index.get('item:TotalAmount')!.ancestors.map(a => a.name), ['Body', 'Table_Document', 'Table_Lines']);
});

test('group header cells are listed under their group', () => {
  const xml = readFileSync('samples/Umsatzbericht.rdl', 'utf8')
    .replace('<TablixMember><Group Name="Details" /></TablixMember>',
      '<TablixMember><Group Name="Region_Group"><GroupExpressions><GroupExpression>=Fields!Region.Value</GroupExpression></GroupExpressions></Group>'
      + '<TablixHeader><Size>2cm</Size><CellContents><Textbox Name="RegionHeader"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Region.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox></CellContents></TablixHeader>'
      + '<TablixMembers><TablixMember><Group Name="Details" /></TablixMember></TablixMembers></TablixMember>');
  const index = indexOutline(buildOutline(xml, dom));
  assert.deepEqual(shape(index.get('rows:Bestellungen')!.node.children), [
    { 'Group:Region_Group': ['Textbox:RegionHeader', 'Group:Details'] },
  ]);
});

test('BC layout survives a round trip and keeps its schema version', () => {
  const r = parseRdl(bc, dom);
  const xml = serializeRdl(r);
  assert.equal(r.body.items[0].type, 'table'); // grouped list with a rectangle per document: editable
  assert.equal(xml, bc, 'unchanged: byte-identical');
  for (const f of ['<Code>', 'Public Function GetData', '<rd:DataSetInfo>', '<ConsumeContainerWhitespace>true</ConsumeContainerWhitespace>', '<Language>=User!Language</Language>']) {
    assert.ok(xml.includes(f), `missing ${f}`);
  }
  assert.equal(serializeRdl(parseRdl(xml, dom)), xml);

  const xml2010 = serializeRdl(parseRdl(bc.replace('2016/01/reportdefinition"', '2010/01/reportdefinition"'), dom));
  assert.ok(xml2010.includes(`<Report xmlns="${NS_2010}"`));
});

test('2016-only parameter layout is not written into 2010 files', () => {
  const xml = readFileSync('samples/Umsatzbericht.rdl', 'utf8').replace('xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"', `xmlns="${NS_2010}"`);
  const out = serializeRdl(parseRdl(xml, dom));
  assert.ok(!out.includes('ReportParametersLayout'));
  assert.ok(out.includes('<ReportParameter Name="Jahr">'));
});
