import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createItem } from '../webview/ops';
import { emptyReport, TextboxItem } from '../webview/model';
import {
  actionOf, alignItems, bookmarkOf, centerInContainer, distribute, hiddenOf, makeSameSize, printsOn, setAction, setBookmark, setHidden, setPrintsOn,
} from '../webview/layoutTools';
import { renderReport } from '../webview/render/engine';
import { RBox } from '../webview/render/types';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};

function three() {
  const r = emptyReport();
  const a = createItem(r, 'textbox', { left: 1, top: 1, width: 2, height: 0.5 });
  r.body.items.push(a);
  const b = createItem(r, 'textbox', { left: 4, top: 2, width: 1, height: 0.25 });
  r.body.items.push(b);
  const c = createItem(r, 'textbox', { left: 5.5, top: 0.5, width: 0.5, height: 1 });
  r.body.items.push(c);
  return { r, a, b, c };
}

test('Ausrichten am zuerst gewählten Element', () => {
  const { r, a, b, c } = three();
  assert.ok(alignItems(r, [a.name, b.name, c.name], 'left'));
  assert.deepEqual([b.left, c.left], [1, 1]);
  alignItems(r, [a.name, b.name], 'right');
  assert.equal(b.left + b.width, 3);
  alignItems(r, [a.name, c.name], 'middle');
  assert.equal(c.top, 0.75);
  assert.equal(alignItems(r, [a.name], 'top'), false, 'ein Element: nichts zu tun');
});

test('Gleiche Größe und gleichmäßig verteilen', () => {
  const { r, a, b, c } = three();
  makeSameSize(r, [a.name, b.name, c.name], 'width');
  assert.deepEqual([b.width, c.width], [2, 2]);
  makeSameSize(r, [a.name, b.name], 'both');
  assert.equal(b.height, 0.5);

  const t = three();
  assert.ok(distribute(t.r, [t.a.name, t.b.name, t.c.name], 'horizontal'));
  // span 1 … 6, widths 2 + 1 + 0.5 → gaps of 0.75
  assert.equal(t.b.left, 3.75);
  assert.equal(t.c.left, 5.5);
});

test('Im Container zentrieren', () => {
  const { r, a } = three();
  r.width = 6;
  centerInContainer(r, [a.name], 'horizontal');
  assert.equal(a.left, 2);
});

test('Ausblenden-Ausdruck: setzen, ändern, entfernen – ToggleItem bleibt', () => {
  const tb = { extra: ['<ZIndex>1</ZIndex>'] } as Partial<TextboxItem>;
  assert.equal(hiddenOf(tb), '');
  assert.ok(setHidden(tb, '=Fields!Amount.Value < 0'));
  assert.equal(hiddenOf(tb), '=Fields!Amount.Value < 0');
  assert.match(tb.extra!.join(''), /<Visibility><Hidden>=Fields!Amount.Value &lt; 0<\/Hidden><\/Visibility>/);
  tb.extra = ['<Visibility><Hidden>true</Hidden><ToggleItem>Header</ToggleItem></Visibility>'];
  setHidden(tb, '');
  assert.deepEqual(tb.extra, ['<Visibility><ToggleItem>Header</ToggleItem></Visibility>']);
  setHidden(tb, 'true');
  assert.equal(hiddenOf(tb), 'true');
  tb.extra = ['<Visibility><Hidden>true</Hidden></Visibility>'];
  setHidden(tb, 'false');
  assert.deepEqual(tb.extra, []);
});

test('Sichtbarkeit und Seitenkopf-Optionen überstehen Speichern und Laden', () => {
  const r = parseRdl(readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8'), dom);
  const tb = r.body.items.find(i => i.type === 'textbox') as TextboxItem | undefined
    ?? (r.header!.items.find(i => i.type === 'textbox') as TextboxItem);
  setHidden(tb, '=Globals!PageNumber > 1');
  assert.ok(r.header);
  const first = printsOn(r.header!, 'First');
  setPrintsOn(r.header!, 'First', !first);
  const back = parseRdl(serializeRdl(r), dom);
  const tb2 = [...back.body.items, ...back.header!.items].find(i => i.name === tb.name)!;
  assert.equal(hiddenOf(tb2), '=Globals!PageNumber > 1');
  assert.equal(printsOn(back.header!, 'First'), !first);

  // new header: printed on all pages, switching one off writes it once
  const n = emptyReport();
  n.header = { height: 1, items: [], style: {} };
  assert.equal(printsOn(n.header, 'First'), true);
  setPrintsOn(n.header, 'First', false);
  const xml = serializeRdl(n);
  assert.equal(xml.match(/<PrintOnFirstPage>/g)?.length, 1);
  assert.match(xml, /<PrintOnFirstPage>false<\/PrintOnFirstPage>/);
  assert.match(xml, /<PrintOnLastPage>true<\/PrintOnLastPage>/);
});

test('BC-Konventionen beim Ziehen: Format-Feld, übersetzte Beschriftung, keine Format-Spalten', async () => {
  const { bcFieldConventions, createTable, displayFields } = await import('../webview/ops');
  const r = emptyReport();
  r.dataSets.push({ id: 'd', name: 'DataSet_Result', dataSourceName: 'DataSource', commandText: '', extra: [], queryExtra: [],
    fields: ['Description_Line', 'Amount_Line', 'Amount_LineFormat'].map(n => ({ name: n, dataField: n, typeName: '' })) });
  r.parameters.push({ id: 'p', name: 'Amount_LineCaption', dataType: 'String', prompt: '', defaultValue: '', allowBlank: true, nullable: false, extra: [] });
  assert.deepEqual(bcFieldConventions(r, 'DataSet_Result', 'Amount_Line'),
    { format: '=Fields!Amount_LineFormat.Value', caption: '=Parameters!Amount_LineCaption.Value', numeric: true });
  const names = displayFields(r.dataSets[0].fields.map(f => f.name));
  assert.deepEqual(names, ['Description_Line', 'Amount_Line']);
  const t = createTable(r, { left: 0, top: 0, width: 4 }, names.length, 'DataSet_Result', names);
  const [header, detail] = t.rows;
  assert.deepEqual(header.cells.map(c => (c as TextboxItem).value), ['Description Line', '=Parameters!Amount_LineCaption.Value']);
  assert.equal(detail.cells[1].style.Format, '=Fields!Amount_LineFormat.Value');
  assert.equal(detail.cells[1].style.TextAlign, 'Right');
  assert.equal(header.cells[1].style.TextAlign, 'Right');
  assert.equal(detail.cells[0].style.Format, undefined);
});

test('Umschalten (ToggleItem) und interaktive Sortierung (UserSort) setzen, Rest bleibt', async () => {
  const { toggleItemOf, setToggleItem, userSortOf, setUserSort } = await import('../webview/layoutTools');
  const it: Partial<TextboxItem> = { extra: ['<Visibility><Hidden>true</Hidden></Visibility>'] };
  setToggleItem(it, 'DocNo');
  assert.deepEqual(it.extra, ['<Visibility><Hidden>true</Hidden><ToggleItem>DocNo</ToggleItem></Visibility>']);
  assert.equal(toggleItemOf(it), 'DocNo');
  assert.equal(hiddenOf(it), 'true');
  setToggleItem(it, '');
  assert.deepEqual(it.extra, ['<Visibility><Hidden>true</Hidden></Visibility>']);
  const plain: Partial<TextboxItem> = {};
  setToggleItem(plain, 'X');
  assert.deepEqual(plain.extra, ['<Visibility><ToggleItem>X</ToggleItem></Visibility>']);

  const tb: Partial<TextboxItem> = { extra: ['<UserSort><SortExpression>=Fields!A.Value</SortExpression><SortExpressionScope>G</SortExpressionScope></UserSort>'] };
  assert.equal(userSortOf(tb), '=Fields!A.Value');
  setUserSort(tb, '=Fields!B.Value');
  assert.deepEqual(tb.extra, ['<UserSort><SortExpression>=Fields!B.Value</SortExpression><SortExpressionScope>G</SortExpressionScope></UserSort>']);
  setUserSort(tb, '');
  assert.deepEqual(tb.extra, []);
});

test('Aktionen: Hyperlink, Lesezeichen, Drillthrough – schreiben, lesen, in der Vorschau auswerten', () => {
  const r = emptyReport();
  const tb = createItem(r, 'textbox', { left: 0, top: 0, width: 2, height: 0.25 }) as TextboxItem;
  tb.value = 'Link';
  r.body.items.push(tb);
  assert.deepEqual(actionOf(tb), { kind: 'none' });
  assert.ok(setAction(tb, { kind: 'hyperlink', value: '="https://example.com/?a=1&b=" & 2' }));
  assert.ok(!setAction(tb, { kind: 'hyperlink', value: '="https://example.com/?a=1&b=" & 2' }));
  assert.ok(setBookmark(tb, 'Anfang'));
  assert.equal(bookmarkOf(tb), 'Anfang');

  const xml = serializeRdl(r, dom);
  assert.match(xml, /<ActionInfo>\s*<Actions>\s*<Action>\s*<Hyperlink>="https:\/\/example.com\/\?a=1&amp;b=" &amp; 2<\/Hyperlink>/);
  const back = parseRdl(xml, dom);
  const tb2 = back.body.items[0] as TextboxItem;
  assert.deepEqual(actionOf(tb2), { kind: 'hyperlink', value: '="https://example.com/?a=1&b=" & 2' });
  assert.equal(serializeRdl(back, dom), xml);

  const node = renderReport(xml, { dom, mode: 'preview', data: {}, reportName: 'R', parameters: {} }).body.nodes[0] as RBox;
  assert.deepEqual(node.action, { kind: 'hyperlink', url: 'https://example.com/?a=1&b=2' });
  assert.equal(node.bookmark, 'Anfang');

  // drillthrough with parameters; switching back to none removes <ActionInfo>
  setAction(tb2, { kind: 'drillthrough', report: 'Kundenkarte', parameters: [{ name: 'No', value: '="10000"' }, { name: ' ', value: 'x' }] });
  assert.deepEqual(actionOf(tb2), { kind: 'drillthrough', report: 'Kundenkarte', parameters: [{ name: 'No', value: '="10000"' }] });
  const dt = renderReport(serializeRdl(back, dom), { dom, mode: 'preview', data: {}, reportName: 'R', parameters: {} }).body.nodes[0] as RBox;
  assert.deepEqual(dt.action, { kind: 'drillthrough', report: 'Kundenkarte', parameters: [['No', '10000']] });
  setAction(tb2, { kind: 'bookmarkLink', value: 'Anfang' });
  assert.deepEqual(actionOf(tb2), { kind: 'bookmarkLink', value: 'Anfang' });
  setAction(tb2, { kind: 'none' });
  assert.ok(!(tb2.extra ?? []).some(x => x.includes('ActionInfo')));

  // an ActionInfo with further actions keeps them
  tb2.extra = ['<ActionInfo><Actions><Action><Hyperlink>a</Hyperlink></Action><Action><Hyperlink>b</Hyperlink></Action></Actions></ActionInfo>'];
  setAction(tb2, { kind: 'hyperlink', value: 'c' });
  assert.deepEqual(tb2.extra, ['<ActionInfo><Actions><Action><Hyperlink>c</Hyperlink></Action><Action><Hyperlink>b</Hyperlink></Action></Actions></ActionInfo>']);
});

test('Tastaturreihenfolge: Seitenkopf, Text, Seitenfuß; oben nach unten, links nach rechts; Rechteckinhalt danach', async () => {
  const { focusOrder } = await import('../webview/layoutTools');
  const r = emptyReport();
  const add = (list: typeof r.body.items, type: 'textbox' | 'rectangle', left: number, top: number) => {
    const it = createItem(r, type, { left, top, width: 1, height: 0.5 });
    list.push(it);
    return it;
  };
  r.header = { height: 1, items: [], style: {} };
  const b = add(r.body.items, 'textbox', 3, 1);
  const a = add(r.body.items, 'textbox', 1, 1);
  const rect = add(r.body.items, 'rectangle', 0, 0);
  const inner = add((rect as unknown as { items: typeof r.body.items }).items, 'textbox', 0, 0);
  const h = add(r.header.items, 'textbox', 5, 0);
  assert.deepEqual(focusOrder(r), [h.name, rect.name, inner.name, a.name, b.name]);
});
