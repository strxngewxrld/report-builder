// System fonts for the PDF export: the webview asks for a font family and style, the extension finds the installed
// TrueType/OpenType file (also a face of a .ttc collection) and returns its bytes, which pdf-lib embeds as a subset.
// Fonts whose license forbids embedding (OS/2 fsType "restricted") are skipped.

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface FontRequest { families: string[]; bold: boolean; italic: boolean }

interface Face { file: string; index: number; family: string; aliases: string[]; weight: number; italic: boolean }

/** Families tried after the requested ones, by kind (the generic CSS families and common report fonts). */
const FALLBACKS: Record<string, string[]> = {
  'sans-serif': ['Arial', 'Helvetica', 'Liberation Sans', 'Arimo', 'DejaVu Sans', 'Noto Sans'],
  serif: ['Times New Roman', 'Times', 'Liberation Serif', 'Tinos', 'DejaVu Serif', 'Noto Serif'],
  monospace: ['Courier New', 'Courier', 'Liberation Mono', 'Cousine', 'DejaVu Sans Mono', 'Menlo', 'Consolas'],
};

export function fontDirectories(platform = process.platform, env = process.env, home = os.homedir()): string[] {
  if (platform === 'win32') {
    return [path.join(env.WINDIR ?? 'C:\\Windows', 'Fonts'), ...(env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')] : [])];
  }
  if (platform === 'darwin') {
    return ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', path.join(home, 'Library', 'Fonts')];
  }
  return ['/usr/share/fonts', '/usr/local/share/fonts', path.join(home, '.local', 'share', 'fonts'), path.join(home, '.fonts')];
}

const u16 = (b: Buffer, o: number) => b.readUInt16BE(o);
const u32 = (b: Buffer, o: number) => b.readUInt32BE(o);

async function readAt(handle: fs.FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buf, 0, length, offset);
  return buf.subarray(0, bytesRead);
}

/** Table records of the sfnt font starting at `offset`: tag → [offset, length]. */
async function tables(handle: fs.FileHandle, offset: number): Promise<Map<string, [number, number]>> {
  const head = await readAt(handle, offset, 12);
  const count = u16(head, 4);
  const dir = await readAt(handle, offset + 12, count * 16);
  const out = new Map<string, [number, number]>();
  for (let i = 0; i + 16 <= dir.length; i += 16) out.set(dir.toString('latin1', i, i + 4), [u32(dir, i + 8), u32(dir, i + 12)]);
  return out;
}

/** Family name (typographic family preferred) from a 'name' table; Windows Unicode English records first. */
export function familyName(name: Buffer): string | null {
  return familyNames(name)[0] ?? null;
}

/** Keep legacy family names too: CSS uses e.g. "Segoe UI Light", whose typographic family is "Segoe UI". */
export function familyNames(name: Buffer): string[] {
  const count = u16(name, 2), strings = u16(name, 4);
  const names: { score: number; value: string }[] = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > name.length) break;
    const platform = u16(name, r), encoding = u16(name, r + 2), language = u16(name, r + 4), id = u16(name, r + 6);
    const len = u16(name, r + 8), off = strings + u16(name, r + 10);
    if (id !== 1 && id !== 16) continue;
    if (off + len > name.length) continue;
    const raw = name.subarray(off, off + len);
    let value: string;
    if (platform === 3 || platform === 0) {
      value = '';
      for (let j = 0; j + 1 < raw.length; j += 2) value += String.fromCharCode(u16(raw, j));
    } else if (platform === 1 && encoding === 0) value = raw.toString('latin1');
    else continue;
    const score = (id === 16 ? 4 : 0) + (platform === 3 ? 2 : 0) + (language === 0x409 || (platform === 1 && language === 0) ? 1 : 0);
    if (value.trim()) names.push({ score, value: value.trim() });
  }
  return [...new Set(names.sort((a, b) => b.score - a.score).map(n => n.value))];
}

/** The faces of one font file (several for a .ttc collection); empty when it cannot be read or must not be embedded. */
async function facesOf(file: string): Promise<Face[]> {
  const handle = await fs.open(file, 'r');
  try {
    const head = await readAt(handle, 0, 12);
    if (head.length < 12) return [];
    let starts = [0];
    if (head.toString('latin1', 0, 4) === 'ttcf') {
      const dir = await readAt(handle, 12, u32(head, 8) * 4);
      starts = Array.from({ length: dir.length / 4 }, (_, i) => u32(dir, i * 4));
    }
    const faces: Face[] = [];
    for (const [index, start] of starts.entries()) {
      const t = await tables(handle, start);
      const name = t.get('name'), os2 = t.get('OS/2'), headT = t.get('head');
      if (!name || !(t.has('glyf') || t.has('CFF '))) continue;
      const aliases = familyNames(await readAt(handle, name[0], name[1]));
      const family = aliases[0];
      if (!family) continue;
      let weight = 400, italic = false;
      if (os2) {
        const o = await readAt(handle, os2[0], Math.min(os2[1], 64));
        weight = u16(o, 4);
        const fsType = u16(o, 8);
        // only bit 1 (restricted license embedding) forbids embedding
        if ((fsType & 0x000f) === 0x0002) continue;
        italic = (u16(o, 62) & 1) === 1;
      } else if (headT) {
        const h = await readAt(handle, headT[0], 54);
        const mac = u16(h, 44);
        weight = mac & 1 ? 700 : 400;
        italic = (mac & 2) === 2;
      }
      faces.push({ file, index, family, aliases, weight, italic });
    }
    return faces;
  } catch {
    return [];
  } finally {
    await handle.close();
  }
}

async function fontFiles(dir: string, depth = 0): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
  const out: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) out.push(...await fontFiles(full, depth + 1));
    else if (/\.(ttf|otf|ttc)$/i.test(e.name)) out.push(full);
  }
  return out;
}

export class FontIndex {
  private faces: Promise<Map<string, Face[]>> | null = null;
  constructor(private dirs: string[] = fontDirectories()) {}

  private load(): Promise<Map<string, Face[]>> {
    this.faces ??= (async () => {
      const files = [...new Set((await Promise.all(this.dirs.map(d => fontFiles(d)))).flat())];
      const byFamily = new Map<string, Face[]>();
      for (const faces of await Promise.all(files.map(f => facesOf(f)))) {
        for (const face of faces) {
          for (const key of new Set(face.aliases.map(n => n.toLowerCase()))) {
            byFamily.set(key, [...byFamily.get(key) ?? [], face]);
          }
        }
      }
      return byFamily;
    })();
    return this.faces;
  }

  /** The best installed face for the request: the first family found, then the fallbacks of its kind. */
  async find(req: FontRequest): Promise<Face | null> {
    const byFamily = await this.load();
    const kind = req.families.map(f => f.toLowerCase()).find(f => f in FALLBACKS)
      ?? (req.families.some(f => /courier|consolas|mono/i.test(f)) ? 'monospace'
        : req.families.some(f => /times|georgia|cambria|garamond|serif/i.test(f) && !/sans/i.test(f)) ? 'serif' : 'sans-serif');
    const names = [...req.families.filter(f => !(f.toLowerCase() in FALLBACKS)), ...FALLBACKS[kind]];
    for (const name of names) {
      const faces = byFamily.get(name.toLowerCase());
      if (!faces?.length) continue;
      const target = req.bold ? 700 : 400;
      return faces.reduce((a, b) => (score(b) < score(a) ? b : a));
      function score(f: Face) { return Math.abs(f.weight - target) + (f.italic !== req.italic ? 1000 : 0) + (/\.ttc$/i.test(f.file) ? 1 : 0); }
    }
    return null;
  }

  /** Bytes of the face as a standalone font file (a face of a collection is extracted). */
  async bytes(face: Face): Promise<Uint8Array> {
    const data = await fs.readFile(face.file);
    return data.toString('latin1', 0, 4) === 'ttcf' ? extractFace(data, face.index) : data;
  }
}

/** One face of a TrueType collection as a standalone sfnt file. */
export function extractFace(ttc: Buffer, index: number): Buffer {
  const start = u32(ttc, 12 + index * 4);
  const count = u16(ttc, start + 4);
  const records = Array.from({ length: count }, (_, i) => {
    const r = start + 12 + i * 16;
    return { tag: ttc.subarray(r, r + 4), checksum: u32(ttc, r + 4), offset: u32(ttc, r + 8), length: u32(ttc, r + 12) };
  });
  const headerLength = 12 + count * 16;
  let size = headerLength;
  for (const r of records) size += (r.length + 3) & ~3;
  const out = Buffer.alloc(size);
  ttc.copy(out, 0, start, start + 12);
  let at = headerLength;
  records.forEach((r, i) => {
    const o = 12 + i * 16;
    r.tag.copy(out, o);
    out.writeUInt32BE(r.checksum, o + 4);
    out.writeUInt32BE(at, o + 8);
    out.writeUInt32BE(r.length, o + 12);
    ttc.copy(out, at, r.offset, r.offset + r.length);
    at += (r.length + 3) & ~3;
  });
  return out;
}
