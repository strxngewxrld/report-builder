import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createBlock, blockMissing, insertBlock } from '../webview/blocks';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { allReportItems, emptyReport } from '../webview/model';
import { createItem } from '../webview/ops';
import { addEmbeddedImage, embeddedImages } from '../webview/images';
const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: n => new XMLSerializer().serializeToString(n as never),
};

test('block selection includes nested content only once and normalizes its position', () => {
  const r = emptyReport();
  const rect = createItem(r, 'rectangle', { top: 2, left: 1, width: 3, height: 1 });
  assert.equal(rect.type, 'rectangle');
  if (rect.type !== 'rectangle') return;
  const box = createItem(r, 'textbox', { top: .2, left: .1, width: 1, height: .2 });
  rect.items.push(box); r.body.items.push(rect);
  const block = createBlock(r, [rect.name, box.name], dom);
  assert.equal(block.body.items.length, 1);
  assert.equal(block.body.items[0].top, 0);
  assert.equal(block.body.items[0].left, 0);
  assert.equal(allReportItems(block).length, 2);
  assert.throws(() => createBlock(r, [], dom));
});

test('inserting the same BC block twice renames all items and groups, including preserved nested items', () => {
  const r = parseRdl(readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8'), dom);
  const block = createBlock(r, [r.body.items[0].name], dom);
  const target = structuredClone(r);
  const first = insertBlock(target, block, 'body', 3, .5, dom);
  const second = insertBlock(target, block, 'body', 7, .5, dom);
  assert.notEqual(first.names[0], second.names[0]);
  const doc = dom.parse(serializeRdl(target));
  const nodes = Array.from(doc.getElementsByTagName('*')) as Element[];
  const names = nodes.filter(n => ['Textbox', 'Rectangle', 'Tablix', 'Group'].includes(n.localName)).map(n => n.getAttribute('Name'));
  assert.equal(new Set(names).size, names.length);
  assert.equal(target.body.items[1].top, block.body.items[0].top + 3);
  assert.equal(target.dataSets.length, r.dataSets.length, 'AL datasets are never modified');
});

test('internal ReportItems and toggles follow renamed elements while literal text is preserved', () => {
  const r = emptyReport();
  const a = createItem(r, 'textbox', { top: 0, left: 0, width: 1, height: .2 });
  const b = createItem(r, 'textbox', { top: .3, left: 0, width: 1, height: .2 });
  b.name = 'Consumer';
  assert.equal(b.type, 'textbox');
  if (b.type !== 'textbox') return;
  b.value = `=ReportItems!${a.name}.Value & "ReportItems!${a.name}"`;
  b.extra = [`<Visibility><ToggleItem>${a.name}</ToggleItem></Visibility>`];
  r.body.items.push(a,b);
  const block = createBlock(r, [a.name,b.name], dom);
  insertBlock(r, block, 'header', 0,0,dom);
  assert.ok(r.header!.height >= .5, 'a new section grows even when imported items keep their original positions');
  const next = r.header!.items[1];
  assert.equal(next.type, 'textbox');
  if (next.type !== 'textbox') return;
  assert.equal(next.value, `=ReportItems!${a.name}_2.Value & "ReportItems!${a.name}"`);
  assert.match(serializeRdl(r), new RegExp(`<ToggleItem>${a.name}_2</ToggleItem>`));
});

test('blocks transfer embedded images and reject conflicts atomically', () => {
  const source = emptyReport(); addEmbeddedImage(source, 'Logo', 'image/png', 'YWJj');
  source.body.items.push(createItem(source, 'image', {top:0,left:0,width:1,height:1}));
  if (source.body.items[0].type === 'image') { source.body.items[0].value = 'Logo'; source.body.items[0].source = 'Embedded'; }
  const block = createBlock(source, [source.body.items[0].name], dom);
  const target = emptyReport();
  insertBlock(target, block, 'body', 0,0,dom);
  assert.equal(embeddedImages(target).length, 1);
  const conflict = emptyReport(); addEmbeddedImage(conflict,'Logo','image/png','ZGVm');
  const before = serializeRdl(conflict);
  assert.throws(() => insertBlock(conflict,block,'body',0,0,dom), /different contents/);
  assert.equal(serializeRdl(conflict), before);
});

test('missing fields and labels are reported; conflicting report code never overwrites existing code', () => {
  const r = emptyReport();
  const box = createItem(r,'textbox',{top:0,left:0,width:1,height:1});
  if (box.type !== 'textbox') return;
  box.value = '=Fields!Amount.Value & Parameters!Title.Value'; r.body.items.push(box);
  assert.deepEqual(blockMissing(emptyReport(), r, dom), ['Fields!Amount', 'Parameters!Title']);
  r.extraXml.push('<Code>source code</Code>');
  const target = emptyReport(); target.extraXml.push('<Code>target code</Code>');
  const before = serializeRdl(target);
  assert.throws(() => insertBlock(target,r,'body',0,0,dom), /conflicting report code/);
  assert.equal(serializeRdl(target), before);
});

test('block dependencies use the dataset of the containing table, not fields in unrelated datasets', () => {
  const r = parseRdl(readFileSync('samples/Verkaufsrechnung.rdlc', 'utf8'), dom);
  const block = createBlock(r, [r.body.items[0].name], dom);
  const target = structuredClone(r);
  const original = target.dataSets[0];
  target.dataSets = [{ ...original, fields: original.fields.filter(f => f.name !== 'Quantity_Line') }, { ...original, name: 'Unrelated', fields: original.fields }];
  assert.ok(blockMissing(target, block, dom).includes('Fields!Quantity_Line (DataSet_Result)'));
});

test('saved blocks contain only selected presentation dependencies, without source queries or connection strings', () => {
  const r = emptyReport();
  r.dataSources.push({ id: 'src', name: 'Private', provider: 'SQL', connectString: 'Password=secret', extra: [], connExtra: [] });
  addEmbeddedImage(r, 'Unused', 'image/png', 'YWJj');
  r.extraXml.push('<Code>unused code</Code>');
  const item = createItem(r, 'textbox', { top: 0, left: 0, width: 1, height: .2 });
  r.body.items.push(item);
  const xml = serializeRdl(createBlock(r, [item.name], dom));
  assert.ok(!xml.includes('Password=secret'));
  assert.ok(!xml.includes('Unused'));
  assert.ok(!xml.includes('unused code'));
});

test('block scope remapping distinguishes aggregate scopes from ordinary strings and Code calls', async () => {
  const { remapBlockExpression } = await import('../webview/blocks');
  const names = new Map([['Group1', 'Group1_2'], ['ReportItems', 'ReportItems_2']]);
  assert.equal(remapBlockExpression('=IIf(True, "Group1", Sum(Fields!A.Value, "Group1")) & Code.Sum(1, "Group1")', names),
    '=IIf(True, "Group1", Sum(Fields!A.Value, "Group1_2")) & Code.Sum(1, "Group1")');
  assert.equal(remapBlockExpression('=ReportItems!ReportItems.Value & ReportItems("ReportItems").Value', names),
    '=ReportItems!ReportItems_2.Value & ReportItems("ReportItems_2").Value');
  assert.equal(remapBlockExpression('=RunningValue(Fields!A.Value, Sum, "Group1") + RowNumber("Group1")', names),
    '=RunningValue(Fields!A.Value, Sum, "Group1_2") + RowNumber("Group1_2")');
});
