import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { ImageItem, emptyReport } from '../webview/model';
import { createItem } from '../webview/ops';
import { addEmbeddedImage, deleteEmbeddedImage, embeddedImages, imageUses, renameEmbeddedImage } from '../webview/images';
import { renderReport } from '../webview/render/engine';
import { RImage } from '../webview/render/types';

const dom: XmlDom = {
  parse: xml => new DOMParser().parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('Eingebettete Bilder: hinzufügen, verwenden, umbenennen, löschen', () => {
  const r = emptyReport();
  assert.equal(addEmbeddedImage(r, 'Firmen Logo.png', 'image/png', PNG), 'Firmen_Logo');
  assert.equal(addEmbeddedImage(r, 'Firmen Logo.png', 'image/png', PNG), 'Firmen_Logo2');
  assert.equal(addEmbeddedImage(r, '1.png', 'image/png', PNG), 'Bild1');
  assert.deepEqual(embeddedImages(r).map(i => i.name), ['Firmen_Logo', 'Firmen_Logo2', 'Bild1']);

  const img = createItem(r, 'image', { left: 0, top: 0, width: 1, height: 1 }) as ImageItem;
  Object.assign(img, { source: 'Embedded', value: 'Firmen_Logo' });
  r.body.items.push(img);
  assert.equal(imageUses(r, 'Firmen_Logo'), 1);

  // saved and read back; the preview shows it
  let xml = serializeRdl(r, dom);
  assert.match(xml, /<EmbeddedImages>\s*<EmbeddedImage Name="Firmen_Logo">\s*<MIMEType>image\/png<\/MIMEType>/);
  const back = parseRdl(xml, dom);
  assert.equal(embeddedImages(back).length, 3);
  assert.equal(serializeRdl(back, dom), xml);
  const node = renderReport(xml, { dom, mode: 'preview', data: {}, reportName: 'R', parameters: {} }).body.nodes[0] as RImage;
  assert.equal(node.src, `data:image/png;base64,${PNG}`);

  // rename updates the image item; invalid or taken names are refused
  assert.ok(!renameEmbeddedImage(back, 'Firmen_Logo', 'Bild1'));
  assert.ok(!renameEmbeddedImage(back, 'Firmen_Logo', 'mit Leerzeichen'));
  assert.ok(renameEmbeddedImage(back, 'Firmen_Logo', 'Logo'));
  assert.equal((back.body.items[0] as ImageItem).value, 'Logo');
  xml = serializeRdl(back, dom);
  assert.match(xml, /<EmbeddedImage Name="Logo">/);
  assert.match(xml, /<Value>Logo<\/Value>/);

  // delete; the container goes with the last image
  assert.ok(deleteEmbeddedImage(back, 'Firmen_Logo2'));
  assert.ok(!deleteEmbeddedImage(back, 'Firmen_Logo2'));
  assert.deepEqual(embeddedImages(back).map(i => i.name), ['Logo', 'Bild1']);
  deleteEmbeddedImage(back, 'Logo');
  deleteEmbeddedImage(back, 'Bild1');
  assert.ok(!serializeRdl(back, dom).includes('EmbeddedImages'));
});
