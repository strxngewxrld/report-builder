import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { emptyReport, TableItem, TextboxItem } from '../webview/model';
import { createTable } from '../webview/ops';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { renderReport } from '../webview/render/engine';
import { RTable } from '../webview/render/types';
import {
  addChildGroup, addGroupRow, addParentGroup, cellLayout, deleteColumn, deleteGroup, deleteRow, groupList, insertColumn, insertRow,
  mergeCells, splitCell, toggleTableRow,
} from '../webview/tablix';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};

function report() {
  const r = emptyReport();
  r.dataSources.push({ id: 's', name: 'DS', provider: 'SQL', connectString: '', extra: [], connExtra: [] });
  r.dataSets.push({ id: 'd', name: 'Lines', dataSourceName: 'DS', commandText: '', extra: [], queryExtra: [],
    fields: ['DocNo', 'Item', 'Amount'].map(n => ({ name: n, dataField: n, typeName: n === 'Amount' ? 'System.Decimal' : 'System.String' })) });
  const t = createTable(r, { left: 0, top: 0, width: 4.5 }, 3, 'Lines', ['DocNo', 'Item', 'Amount']);
  r.body.items.push(t);
  return { r, t };
}
const kinds = (t: TableItem) => t.rows.map(x => x.kind);
const roundTrip = (r: ReturnType<typeof report>['r']) => {
  const xml = serializeRdl(r, dom);
  const back = parseRdl(xml, dom);
  assert.equal(serializeRdl(back, dom), xml, 'stabil');
  return { xml, t: back.body.items[0] as TableItem };
};
const rows = [
  { DocNo: 'A', Item: 'Tisch', Amount: 100 }, { DocNo: 'A', Item: 'Stuhl', Amount: 50 }, { DocNo: 'B', Item: 'Lampe', Amount: 20 },
];

test('Übergeordnete Gruppe mit Kopf und Fuß: Modell, XML, Vorschau', () => {
  const { r, t } = report();
  const detail = t.rows.find(x => x.kind === 'detail')!;
  const g = addParentGroup(r, t, detail.id, { name: 'ByDoc', expression: '=Fields!DocNo.Value', header: true, footer: true })!;
  assert.deepEqual(kinds(t), ['header', 'groupHeader', 'detail', 'groupFooter']);
  (t.rows[3].cells[2] as TextboxItem).value = '=Sum(Fields!Amount.Value)';
  g.group!.pageBreak = 'Between';

  const { xml, t: back } = roundTrip(r);
  assert.match(xml, /<Group Name="ByDoc">\s*<GroupExpressions>\s*<GroupExpression>=Fields!DocNo.Value</);
  assert.match(xml, /<BreakLocation>Between<\/BreakLocation>/);
  assert.match(xml, /<SortExpressions>\s*<SortExpression>\s*<Value>=Fields!DocNo.Value<\/Value>/);
  assert.deepEqual(kinds(back), kinds(t));
  assert.deepEqual(groupList(back).map(g => [g.member.group!.name, g.depth, g.details]), [['ByDoc', 0, false], [`${t.name}_Details`, 1, true]]);

  // the preview engine groups: per document a header, its lines, a footer with the sum
  const out = renderReport(xml, { dom, mode: 'preview', data: { Lines: rows } });
  const table = out.body.nodes.find(n => n.kind === 'table') as RTable;
  assert.equal(table.rows.length, 1 + 2 * 2 + 3);
  assert.equal(table.rows.filter(x => x.breakBefore).length, 1, 'Seitenumbruch zwischen den Gruppen');
});

test('Untergeordnete Gruppe, Gruppe löschen (mit und ohne Zeilen)', () => {
  const { r, t } = report();
  const detail = t.rows.find(x => x.kind === 'detail')!;
  const outer = addParentGroup(r, t, detail.id, { name: 'ByDoc', expression: '=Fields!DocNo.Value', header: true, footer: false })!;
  const inner = addChildGroup(r, t, detail.id, { name: 'ByItem', expression: '=Fields!Item.Value', header: false, footer: true })!;
  assert.deepEqual(groupList(t).map(g => [g.member.group!.name, g.depth]), [['ByDoc', 0], ['ByItem', 1], [`${t.name}_Details`, 2]]);
  assert.deepEqual(kinds(t), ['header', 'groupHeader', 'detail', 'groupFooter']);
  roundTrip(r);

  assert.ok(deleteGroup(t, inner.id, true));
  assert.deepEqual(kinds(t), ['header', 'groupHeader', 'detail']);
  assert.ok(deleteGroup(t, outer.id, false));
  assert.deepEqual(groupList(t).map(g => g.member.group!.name), [`${t.name}_Details`]);
  // the former group header now sits above the details, outside any group: a table header row
  assert.deepEqual(kinds(t), ['header', 'header', 'detail']);
  roundTrip(r);
});

test('Zeilen einfügen innerhalb und außerhalb der Gruppe, löschen', () => {
  const { r, t } = report();
  const detail = t.rows.find(x => x.kind === 'detail')!;
  const g = addParentGroup(r, t, detail.id, { name: 'ByDoc', expression: '=Fields!DocNo.Value', header: false, footer: false })!;
  insertRow(r, t, detail.id, 'below');          // inside the group, after the details
  insertRow(r, t, detail.id, 'outsideBelow');    // outside the details group, still inside ByDoc
  assert.deepEqual(kinds(t), ['header', 'detail', 'groupFooter', 'groupFooter']);
  addGroupRow(r, t, g.id, 'header');
  assert.deepEqual(kinds(t), ['header', 'groupHeader', 'detail', 'groupFooter', 'groupFooter']);
  assert.ok(deleteRow(t, t.rows[4].id));
  assert.equal(deleteRow(t, detail.id), false, 'die Detailzeile bleibt');
  toggleTableRow(r, t, 'footer');
  assert.deepEqual(kinds(t), ['header', 'groupHeader', 'detail', 'groupFooter', 'footer']);
  toggleTableRow(r, t, 'header');
  assert.deepEqual(kinds(t), ['groupHeader', 'detail', 'groupFooter', 'footer']);
  roundTrip(r);
});

test('Zellen verbinden und teilen, Spalten mit verbundenen Zellen', () => {
  const { r, t } = report();
  const header = t.rows[0];
  const merged = mergeCells(t, [header.cells[0].name, header.cells[1].name])!;
  assert.deepEqual(cellLayout(header).map(e => [e.col, e.span]), [[0, 2], [2, 1]]);
  const { xml, t: back } = roundTrip(r);
  assert.match(xml, /<ColSpan>2<\/ColSpan>\s*<\/CellContents>\s*<\/TablixCell>\s*<TablixCell \/>/);
  assert.deepEqual(back.rows[0].cells.map(c => c.colSpan ?? 1), [2, 1]);

  insertColumn(r, t, 1);                        // inside the merged cell: it grows
  assert.deepEqual(cellLayout(header).map(e => e.span), [3, 1]);
  assert.equal(t.rows[1].cells.length, 4);
  deleteColumn(t, 0);                            // the merged cell shrinks
  assert.deepEqual(cellLayout(header).map(e => e.span), [2, 1]);
  assert.ok(splitCell(r, t, merged));
  assert.equal(header.cells.length, 3);
  assert.equal(mergeCells(t, [t.rows[1].cells[0].name, t.rows[1].cells[2].name]), null, 'nicht benachbart');
  roundTrip(r);
});

test('Business-Central-Beleg mit Gruppen und verbundenen Zellen wird bearbeitbar, ohne Verluste', () => {
  // the shape of BC document layouts: header group per document, lines, totals row with merged label cell
  const tb = (n: string, v: string) => `<Textbox Name="${n}"><CanGrow>true</CanGrow><KeepTogether>true</KeepTogether><Paragraphs><Paragraph><TextRuns><TextRun><Value>${v}</Value><Style /></TextRun></TextRuns><Style /></Paragraph></Paragraphs><Style><Border><Style>None</Style></Border></Style></Textbox>`;
  const cell = (n: string, v: string, span = 1) => `<TablixCell><CellContents>${tb(n, v)}${span > 1 ? `<ColSpan>${span}</ColSpan>` : ''}</CellContents></TablixCell>${'<TablixCell />'.repeat(span - 1)}`;
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition" xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">
  <ReportSections><ReportSection><Body><ReportItems>
    <Tablix Name="Lines"><TablixBody><TablixColumns>${'<TablixColumn><Width>2cm</Width></TablixColumn>'.repeat(3)}</TablixColumns><TablixRows>
      <TablixRow><Height>0.4cm</Height><TablixCells>${cell('DocHdr', '=Fields!DocNo.Value', 3)}</TablixCells></TablixRow>
      <TablixRow><Height>0.4cm</Height><TablixCells>${cell('L1', '=Fields!DocNo.Value')}${cell('L2', '=Fields!Item.Value')}${cell('L3', '=Fields!Amount.Value')}</TablixCells></TablixRow>
      <TablixRow><Height>0.4cm</Height><TablixCells>${cell('TotLbl', 'Summe', 2)}${cell('Tot', '=Sum(Fields!Amount.Value)')}</TablixCells></TablixRow>
    </TablixRows></TablixBody>
    <TablixColumnHierarchy><TablixMembers><TablixMember /><TablixMember /><TablixMember /></TablixMembers></TablixColumnHierarchy>
    <TablixRowHierarchy><TablixMembers><TablixMember><Group Name="Doc"><GroupExpressions><GroupExpression>=Fields!DocNo.Value</GroupExpression></GroupExpressions><PageBreak><BreakLocation>Between</BreakLocation><ResetPageNumber>true</ResetPageNumber></PageBreak></Group>
      <TablixMembers><TablixMember><KeepWithGroup>After</KeepWithGroup><RepeatOnNewPage>true</RepeatOnNewPage></TablixMember>
        <TablixMember><Group Name="Details"><Filters><Filter><FilterExpression>=Fields!Item.Value</FilterExpression><Operator>NotEqual</Operator><FilterValues><FilterValue /></FilterValues></Filter></Filters></Group><SortExpressions><SortExpression><Value>=Fields!Item.Value</Value></SortExpression></SortExpressions></TablixMember>
        <TablixMember><KeepWithGroup>Before</KeepWithGroup></TablixMember></TablixMembers></TablixMember></TablixMembers></TablixRowHierarchy>
    <DataSetName>Lines</DataSetName><Top>0cm</Top><Left>0cm</Left><Height>1.2cm</Height><Width>6cm</Width></Tablix>
  </ReportItems><Height>2cm</Height></Body><Width>6cm</Width><Page><PageHeight>29.7cm</PageHeight><PageWidth>21cm</PageWidth></Page></ReportSection></ReportSections>
  <DataSets><DataSet Name="Lines"><Query><DataSourceName>DS</DataSourceName><CommandText /></Query><Fields><Field Name="DocNo"><DataField>DocNo</DataField></Field><Field Name="Item"><DataField>Item</DataField></Field><Field Name="Amount"><DataField>Amount</DataField></Field></Fields></DataSet></DataSets>
  <DataSources><DataSource Name="DS"><ConnectionProperties><DataProvider>SQL</DataProvider><ConnectString /></ConnectionProperties></DataSource></DataSources>
</Report>`;
  const r = parseRdl(xml, dom);
  const t = r.body.items[0] as TableItem;
  assert.equal(t.type, 'table');
  assert.deepEqual(kinds(t), ['groupHeader', 'detail', 'groupFooter']);
  assert.deepEqual(t.rows.map(x => x.cells.map(c => c.colSpan ?? 1)), [[3], [1, 1, 1], [2, 1]]);
  const [doc, details] = groupList(t).map(g => g.member);
  assert.equal(doc.group!.pageBreak, 'Between');
  assert.deepEqual(doc.group!.pageBreakExtra, ['<ResetPageNumber>true</ResetPageNumber>']);
  assert.deepEqual(details.group!.filters, [{ expression: '=Fields!Item.Value', operator: 'NotEqual', values: [''] }]);
  assert.deepEqual(details.sort, [{ value: '=Fields!Item.Value', descending: false }]);
  // (byte identity with real, BC-formatted files is checked by the corpus test; this XML is not indented like BC)
  const saved = serializeRdl(r, dom);
  assert.equal(serializeRdl(parseRdl(saved, dom), dom), saved, 'stabil');
  const squash = (x: string) => x.replace(/>\s+</g, '><').replace(/^<\?xml[^>]*\?>/, '').trim();
  assert.equal(squash(saved).length, squash(xml).length, 'nichts verloren oder hinzugefügt');

  // editing a cell and the sort leaves the rest of the hierarchy as it was
  (t.rows[2].cells[0] as TextboxItem).value = 'Gesamt';
  details.sort[0].descending = true;
  const edited = serializeRdl(r, dom);
  assert.match(edited, /<Value>=Fields!Item.Value<\/Value>\s*<Direction>Descending<\/Direction>/);
  assert.ok(edited.includes('<ResetPageNumber>true</ResetPageNumber>'));
  assert.ok(edited.includes('<RepeatOnNewPage>true</RepeatOnNewPage>'));
  assert.ok(edited.includes('<Operator>NotEqual</Operator>'));
  assert.equal(serializeRdl(parseRdl(edited, dom), dom), edited);
});

test('Drilldown: Details je Beleg einzeln aufklappen; interaktive Sortierung', async () => {
  const { r, t } = report();
  const detail = t.rows.find(x => x.kind === 'detail')!;
  addParentGroup(r, t, detail.id, { name: 'ByDoc', expression: '=Fields!DocNo.Value', header: true, footer: false });
  const hdr = t.rows.find(x => x.kind === 'groupHeader')!.cells[0];
  const details = groupList(t).find(g => g.details)!.member;
  details.extra.push(`<Visibility><Hidden>true</Hidden><ToggleItem>${hdr.name}</ToggleItem></Visibility>`);
  // interactive sort on the amount column header
  (t.rows[0].cells[2] as TextboxItem).value = 'Betrag';
  t.rows[0].cells[2].extra = ['<UserSort><SortExpression>=Fields!Amount.Value</SortExpression></UserSort>'];
  const xml = serializeRdl(r, dom);
  const run = (opts: object) => (renderReport(xml, { dom, mode: 'preview', data: { Lines: rows }, ...opts }).body.nodes.find(n => n.kind === 'table') as RTable);
  const visibleRows = (tb: RTable) => tb.rows.length;

  const collapsed = run({});
  assert.equal(visibleRows(collapsed), 1 + 2, 'Kopf + zwei Belegköpfe, Details zugeklappt');
  const toggles = collapsed.rows.slice(1).map(row => (row.cells[0].node as { toggle?: { key: string; expanded: boolean } }).toggle!);
  assert.deepEqual(toggles.map(x => x.expanded), [false, false]);
  assert.notEqual(toggles[0].key, toggles[1].key, 'jeder Beleg hat seinen eigenen Schalter');

  const one = run({ toggled: new Set([toggles[0].key]) });
  assert.equal(visibleRows(one), 1 + 2 + 2, 'nur Beleg A aufgeklappt (zwei Zeilen)');
  assert.equal((one.rows[1].cells[0].node as { toggle?: { expanded: boolean } }).toggle!.expanded, true);

  // sorting by amount descending: the documents (outermost group) are ordered by it
  const header = run({}).rows[0].cells[2].node as { userSort?: { name: string } };
  assert.ok(header.userSort);
  const sorted = run({ userSort: { [header.userSort!.name]: 'Ascending' } });
  const docs = (tb: RTable) => tb.rows.slice(1).map(row => {
    const n = row.cells[0].node as { paragraphs?: { runs: { text: string }[] }[] };
    return n.paragraphs?.[0].runs.map(x => x.text).join('');
  });
  assert.deepEqual(docs(run({})), ['A', 'B']);
  assert.deepEqual(docs(sorted), ['B', 'A'], 'aufsteigend nach Betrag (B: 20, A: 100)');
  assert.deepEqual(docs(run({ userSort: { [header.userSort!.name]: 'Descending' } })), ['A', 'B']);
});

test('Matrix: anlegen, stabil speichern, Kreuztabelle in der Vorschau, Kopfzellen im Modell', async () => {
  const { createMatrix, matrixLayout } = await import('../webview/tablix');
  const { locate, tableWidth, tableHeight } = await import('../webview/ops');
  const { r } = report();
  r.body.items = [];
  const m = createMatrix(r, { top: 0, left: 0 }, { dataSetName: 'Lines', rowGroup: '=Fields!DocNo.Value', columnGroup: '=Fields!Item.Value', value: '=Sum(Fields!Amount.Value)', rowTotal: true, columnTotal: true });
  r.body.items.push(m);
  assert.equal(tableWidth(m), 1.25 + 2);
  assert.equal(tableHeight(m), 0.25 + 0.5);
  const layout = matrixLayout(m, m.columns, m.rows.map(x => x.height));
  assert.deepEqual(layout.cells.map(c => c.axis).sort(), ['column', 'column', 'corner', 'row', 'row']);
  // header cells are report items: found by name, unique names
  const names = layout.cells.map(c => c.item.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(locate(r, names[0]));

  const xml = serializeRdl(r, dom);
  const back = parseRdl(xml, dom);
  assert.equal(serializeRdl(back, dom), xml, 'stabil');
  const bt = back.body.items[0] as TableItem;
  assert.equal(bt.type, 'table');
  assert.equal(bt.corner?.length, 1);
  assert.match(xml, /<TablixCorner>[\s\S]*<TablixColumnHierarchy>[\s\S]*<TablixHeader>/);

  // A/B × Tisch/Stuhl/Lampe with totals
  const out = renderReport(xml, { dom, mode: 'preview', data: { Lines: rows } });
  const table = out.body.nodes[0] as RTable;
  const text = (n: unknown) => ((n as { paragraphs?: { runs: { text: string }[] }[] })?.paragraphs ?? []).map(p => p.runs.map(x => x.text).join('')).join('');
  const grid = table.rows.map(row => row.cells.map(c => text(c.node)));
  // groups sorted ascending, as created
  assert.deepEqual(grid[0], ['', 'Lampe', 'Stuhl', 'Tisch', 'Total']);
  assert.deepEqual(grid.map(g => g[0]), ['', 'A', 'B', 'Total']);
  assert.deepEqual(grid[1].slice(1), ['', '50', '100', '150'], 'A: Stuhl 50, Tisch 100');
  assert.deepEqual(grid[2].slice(1), ['20', '', '', '20'], 'B: Lampe 20');
  assert.deepEqual(grid[3].slice(1), ['20', '50', '100', '170']);
});

test('Spaltengruppe zu einer Tabelle hinzufügen, Vorschau, löschen (nur Gruppe / mit Spalten); Spalte ausblenden', async () => {
  const { addColumnGroup, columnGroupBlocker, columnGroupList, columnLeaf, deleteColumnGroup } = await import('../webview/tablix');
  const { setHidden } = await import('../webview/layoutTools');
  const { r, t } = report();
  // Amount per document number across the columns
  const amount = t.rows.find(x => x.kind === 'detail')!.cells[2] as TextboxItem;
  amount.value = '=Sum(Fields!Amount.Value)';
  assert.equal(columnGroupBlocker(t, 2), null);
  const g = addColumnGroup(r, t, 2, { name: 'Belege', expression: '=Fields!DocNo.Value' })!;
  assert.ok(g);
  assert.deepEqual(columnGroupList(t).map(x => x.member.group!.name), ['Belege']);
  assert.match(columnGroupBlocker(t, 0) ?? '', /column headers/);
  assert.equal(t.corner, undefined, 'ohne Zeilenköpfe keine Ecke');

  const { xml, t: back } = roundTrip(r);
  assert.match(xml, /<TablixColumnHierarchy>\s*<TablixMembers>\s*<TablixMember>\s*<TablixHeader>/);
  assert.equal(columnGroupList(back).length, 1);
  const out = renderReport(xml, { dom, mode: 'preview', data: { Lines: rows }, reportName: 'R', parameters: {} });
  const table = out.body.nodes[0] as RTable;
  // header row with the group values, then the table: 2 static + 2 group columns (A, B)
  assert.equal(table.columns.length, 4);
  const texts = (row: RTable['rows'][number]) => row.cells.map(c => (c.node && c.node.kind === 'box' ? c.node.paragraphs?.map(p => p.runs.map(x => x.text).join('')).join('') : ''));
  assert.deepEqual(texts(table.rows[0]), ['', '', 'A', 'B']);

  // hide a column: the preview leaves it out
  setHidden(columnLeaf(back, 0), 'true');
  const hidden = renderReport(serializeRdl({ ...r, body: { ...r.body, items: [back] } }, dom), { dom, mode: 'preview', data: { Lines: rows }, reportName: 'R', parameters: {} });
  assert.equal((hidden.body.nodes[0] as RTable).columns.length, 3);

  // delete only the group: the column stays, the empty header row goes
  const r2 = structuredClone(r);
  const t2 = r2.body.items[0] as TableItem;
  assert.ok(deleteColumnGroup(r2, t2, g.id, false));
  assert.equal(t2.columns.length, 3);
  assert.equal(columnGroupList(t2).length, 0);
  assert.ok(t2.columnMembers.every(m => !m.header));
  // delete with columns
  assert.ok(deleteColumnGroup(r, t, g.id, true));
  assert.equal(t.columns.length, 2);
  assert.ok(t.columnMembers.every(m => !m.header));
  assert.ok(t.rows.every(row => cellLayout(row).reduce((n, c) => n + c.span, 0) === 2));
  roundTrip(r);
});
