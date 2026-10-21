import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { FontIndex, extractFace, familyName, fontDirectories } from '../src/fonts';

// a real TrueType font from the dependencies
const TTF = readFileSync('node_modules/@vscode/codicons/dist/codicon.ttf');

/** Table tag → bytes of an sfnt font. */
function tablesOf(font: Buffer, start = 0): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let i = 0; i < font.readUInt16BE(start + 4); i++) {
    const r = start + 12 + i * 16;
    out.set(font.toString('latin1', r, r + 4), font.subarray(font.readUInt32BE(r + 8), font.readUInt32BE(r + 8) + font.readUInt32BE(r + 12)));
  }
  return out;
}

/** A collection of the same font twice, as in .ttc files. */
function collection(font: Buffer): Buffer {
  const header = Buffer.alloc(20);
  header.write('ttcf', 0, 'latin1');
  header.writeUInt32BE(0x00010000, 4);
  header.writeUInt32BE(2, 8);
  // both faces share the tables: the second directory is a copy pointing at the same data
  const dirLength = 12 + font.readUInt16BE(4) * 16;
  const first = 20, second = 20 + dirLength;
  header.writeUInt32BE(first, 12);
  header.writeUInt32BE(second, 16);
  const shift = 20 + 2 * dirLength;
  const dir = Buffer.from(font.subarray(0, dirLength));
  for (let i = 0; i < dir.readUInt16BE(4); i++) dir.writeUInt32BE(dir.readUInt32BE(12 + i * 16 + 8) + shift, 12 + i * 16 + 8);
  return Buffer.concat([header, dir, dir, font]);
}

test('font directories per platform', () => {
  assert.deepEqual(fontDirectories('win32', { WINDIR: 'D:\\Win' }, 'h'), [path.join('D:\\Win', 'Fonts')]);
  assert.ok(fontDirectories('darwin', {}, '/Users/x').includes('/System/Library/Fonts/Supplemental'));
  assert.ok(fontDirectories('linux', {}, '/home/x').includes('/usr/share/fonts'));
});

test('family name from the name table, faces of a collection extracted', () => {
  const name = tablesOf(TTF).get('name')!;
  assert.equal(familyName(name), 'codicon');
  const ttc = collection(TTF);
  const face = extractFace(ttc, 1);
  const a = tablesOf(TTF), b = tablesOf(face);
  assert.deepEqual([...b.keys()], [...a.keys()]);
  for (const [tag, data] of a) assert.ok(data.equals(b.get(tag)!), tag);
});

test('FontIndex finds families, styles and fallbacks in a font directory', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fonts-'));
  writeFileSync(path.join(dir, 'codicon.ttf'), TTF);
  writeFileSync(path.join(dir, 'pair.ttc'), collection(TTF));
  writeFileSync(path.join(dir, 'broken.ttf'), Buffer.from('not a font'));
  const index = new FontIndex([dir, path.join(dir, 'missing')]);
  const face = await index.find({ families: ['Missing Font', 'Codicon'], bold: true, italic: false });
  assert.ok(face);
  assert.equal(face.family, 'codicon');
  // the plain file is preferred over a face of the collection
  assert.ok(face.file.endsWith('codicon.ttf'));
  assert.ok(Buffer.from(await index.bytes(face)).equals(TTF));
  assert.equal(await index.find({ families: ['Arial', 'sans-serif'], bold: false, italic: false }), null);
});

test('FontIndex resolves a CSS legacy family without losing the typographic family', async () => {
  const records = [[1, 'Example Sans Light'], [16, 'Example Sans']] as const;
  const strings = records.map(([, value]) => Buffer.from(value, 'utf16le').swap16());
  const name = Buffer.alloc(6 + records.length * 12);
  name.writeUInt16BE(records.length, 2);
  name.writeUInt16BE(name.length, 4);
  let offset = 0;
  records.forEach(([id], i) => {
    const at = 6 + i * 12;
    [3, 1, 0x409, id, strings[i].length, offset].forEach((v, j) => name.writeUInt16BE(v, at + j * 2));
    offset += strings[i].length;
  });
  const table = Buffer.concat([name, ...strings]);
  const font = Buffer.concat([TTF, table]);
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    if (font.toString('latin1', at, at + 4) !== 'name') continue;
    font.writeUInt32BE(TTF.length, at + 8);
    font.writeUInt32BE(table.length, at + 12);
  }
  assert.equal(familyName(table), 'Example Sans');
  const dir = mkdtempSync(path.join(tmpdir(), 'font-alias-'));
  writeFileSync(path.join(dir, 'light.ttf'), font);
  const index = new FontIndex([dir]);
  for (const family of ['Example Sans Light', 'Example Sans']) {
    const face = await index.find({ families: [family], bold: false, italic: false });
    assert.ok(face, family);
    assert.ok(face.file.endsWith('light.ttf'));
  }
});
