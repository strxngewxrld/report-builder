import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AlExpectation, itemAt, lintAlUsage, lintLayout } from '../src/lint';
import { expectedDataset, parseAl } from '../src/al/parser';
import { buildBcContext } from '../src/al/context';

const layout = readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8');
const [report] = parseAl(readFileSync('samples/src/Verkaufsrechnung.Report.al', 'utf8'));
const exp = expectedDataset(report);
const al: AlExpectation = { reportName: report.name, fields: exp.fields, parameters: exp.parameters, complete: true };
// fixed texts (literal-text) are checked in their own test
const codes = (issues: { code: string }[]) => issues.map(i => i.code).filter(c => c !== 'literal-text');

test('sample layout: only the outdated dataset is reported', () => {
  const issues = lintLayout(layout, al);
  assert.deepEqual(codes(issues), ['stale-dataset']);
  assert.equal(issues.filter(i => i.code === 'literal-text').length, 5, 'Rechnungsnr., Menge, VK-Preis, Betrag, Gesamt');
  assert.match(issues.find(i => i.code === 'stale-dataset')!.message, /YourReference, YourReferenceCaption/);
  assert.deepEqual(lintLayout(layout, null), [], 'without AL nothing to report');
});

test('unknown references with positions and items', () => {
  const broken = layout
    .replace('=Fields!Description_Line.Value', '=Fields!Descripton_Line.Value')
    .replace('=Fields!Quantity_Line.Value', '=Fields!quantity_Line.Value')
    .replace('=Code.GetData(2,1)', '=Code.GetDaten(2,1)')
    .replace('="Seite " &amp; Globals!PageNumber', '=ReportItems!Nope.Value');
  const issues = lintLayout(broken, al).filter(i => i.code !== 'stale-dataset');
  assert.deepEqual(codes(issues), ['unknown-field', 'unknown-field', 'unknown-code', 'unknown-item']);
  assert.equal(broken.substr(issues[0].offset, issues[0].length), 'Descripton_Line');
  assert.equal(issues[0].item, 'Description_Line');
  assert.match(issues[1].message, /Groß-\/Kleinschreibung.*Quantity_Line/);
  assert.equal(issues[2].item, 'PageHdr_DocNo');
});

test('AL ahead of or behind the layout', () => {
  // the layout uses the new column before the project was built
  const usesNew = layout.replace('=Fields!Description_Line.Value', '=Fields!YourReference.Value');
  const stale = lintLayout(usesNew, al).find(i => i.code === 'stale-field')!;
  assert.match(stale.message, /Projekt neu erstellen/);

  // a column removed in AL is still in the layout dataset and used
  const removed: AlExpectation = { ...al, fields: al.fields.filter(f => f !== 'Paid') };
  const r = lintLayout(layout, removed).find(i => i.code === 'removed-field')!;
  assert.equal(layout.substr(r.offset, r.length), 'Paid');
});

test('unused AL columns and labels', () => {
  const unused = lintAlUsage(report, [layout]).map(u => u.message);
  // LineNo_Line is used by the line filter; only the column added after the last build is unused
  assert.deepEqual(unused, ['Spalte „YourReference“ wird in keinem RDLC-Layout dieses Reports verwendet.']);
});

test('innermost item at an offset', () => {
  const at = itemAt(layout);
  assert.equal(at(layout.indexOf('=Code.SetData')), 'SetData_Header');
  assert.equal(at(layout.indexOf('<Group Name="Details_Lines">')), 'Table_Lines');
  assert.equal(at(0), undefined);
});

test('context for the designer', () => {
  const ctx = buildBcContext(report, undefined, { fields: ['CompanyName', 'No_SalesInvHdr', 'Gone'], parameters: [] }, 'file:///x.al', 'src/x.al');
  assert.equal(ctx.dataItems[0].name, 'Header');
  assert.equal(ctx.dataItems[0].children[0].name, 'Line');
  assert.deepEqual(ctx.dataItems[0].columns.filter(c => c.inLayout).map(c => c.name), ['CompanyName', 'No_SalesInvHdr']);
  assert.deepEqual(ctx.captions, [{ name: 'YourReferenceCaption', column: 'YourReference', text: 'Your Reference', inLayout: false }]);
  assert.deepEqual(ctx.removedInAl, ['Gone']);
  assert.ok(ctx.missingInLayout.includes('Paid'));
});

test('BC-Konventionen: Dezimalfeld ohne Format, fester Text', () => {
  const layout = `<Report><DataSets><DataSet Name="DataSet_Result"><Fields>
    <Field Name="Amount"><DataField>Amount</DataField></Field><Field Name="AmountFormat"><DataField>AmountFormat</DataField></Field>
    <Field Name="Qty"><DataField>Qty</DataField></Field></Fields></DataSet></DataSets>
    <ReportItems>
      <Textbox Name="A"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Amount.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>
      <Textbox Name="B"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Sum(Fields!Amount.Value)</Value><Style><Format>=Fields!AmountFormat.Value</Format></Style></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>
      <Textbox Name="C"><Paragraphs><Paragraph><TextRuns><TextRun><Value>=Fields!Qty.Value</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>
      <Textbox Name="D"><Paragraphs><Paragraph><TextRuns><TextRun><Value>Rechnung</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>
      <Textbox Name="E"><Paragraphs><Paragraph><TextRuns><TextRun><Value>-</Value></TextRun></TextRuns></Paragraph></Paragraphs></Textbox>
    </ReportItems></Report>`;
  const al = { reportName: 'R', fields: ['Amount', 'Qty'], parameters: [], complete: true };
  const issues = lintLayout(layout, al);
  const fmt = issues.filter(i => i.code === 'bc-format');
  assert.deepEqual(fmt.map(i => i.item), ['A']);
  assert.equal(layout.slice(fmt[0].offset, fmt[0].offset + fmt[0].length), '=Fields!Amount.Value');
  assert.deepEqual(issues.filter(i => i.code === 'literal-text').map(i => i.item), ['D']);
  // without an AL report (plain SSRS) fixed texts are fine
  assert.equal(lintLayout(layout, null).filter(i => i.code === 'literal-text').length, 0);
});

test('<Code>-Block lesen und schreiben', async () => {
  const { readCodeBlock, writeCodeBlock } = await import('../src/codeBlock');
  const code = readCodeBlock(layout);
  assert.match(code, /Function GetData/);
  const changed = writeCodeBlock(layout, code + '\nPublic Function Twice(x As Integer) As Integer\n  Return x * 2 ' + "'" + ' a < b & c\nEnd Function');
  assert.match(readCodeBlock(changed), /x \* 2 ' a < b & c/);
  assert.match(changed, /a &lt; b &amp; c/);
  assert.equal(changed.replace(/<Code>[\s\S]*?<\/Code>/, ''), layout.replace(/<Code>[\s\S]*?<\/Code>/, ''), 'nur der Code-Block ändert sich');
  // a layout without code gets the block before rd:ReportUnitType
  const plain = '<Report>\n  <Width>1in</Width>\n  <rd:ReportUnitType>Cm</rd:ReportUnitType>\n</Report>';
  assert.equal(writeCodeBlock(plain, 'Dim x'), '<Report>\n  <Width>1in</Width>\n  <Code>Dim x</Code>\n  <rd:ReportUnitType>Cm</rd:ReportUnitType>\n</Report>');
  assert.equal(writeCodeBlock(plain, ''), plain);
});
