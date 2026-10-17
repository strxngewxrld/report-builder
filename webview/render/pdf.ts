// PDF export of the paginated preview: the laid-out pages in the DOM are drawn onto PDF pages – text word by word at
// its position with the standard PDF fonts, backgrounds and borders as vectors, images and SVG (charts, gauges)
// embedded as pictures. What the browser shows is what the PDF contains, without a print dialog.

import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib';

interface Rect { left: number; top: number; right: number; bottom: number }

const intersect = (a: Rect, b: Rect): Rect => ({
  left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom),
});
const empty = (r: Rect) => r.right - r.left < 0.5 || r.bottom - r.top < 0.5;

/** rgb()/rgba() of a computed style as pdf-lib color and opacity; null for transparent. */
function color(css: string): { c: ReturnType<typeof rgb>; a: number } | null {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(css);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if (a === 0) return null;
  return { c: rgb(Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255), a };
}

/** Characters the standard fonts (WinAnsi) cannot show become "?". */
const winAnsi = (s: string) => s.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').replace(/[^\x20-\x7E\xA0-\xFF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, '?');

function fontKey(cs: CSSStyleDeclaration): StandardFonts {
  const family = cs.fontFamily.toLowerCase();
  const bold = Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold';
  const italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
  if (/courier|consolas|mono/.test(family)) {
    return bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : italic ? StandardFonts.CourierOblique : StandardFonts.Courier;
  }
  if (/times|georgia|cambria|serif/.test(family) && !/sans/.test(family)) {
    return bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman;
  }
  return bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
}

const base64Bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/** An image or SVG element as PNG/JPEG bytes (via a canvas when the format is not one PDF embeds directly). */
async function pictureOf(el: Element, width: number, height: number): Promise<{ bytes: Uint8Array; png: boolean } | null> {
  if (el instanceof HTMLImageElement) {
    const data = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(el.src);
    if (data) return { bytes: base64Bytes(data[2]), png: data[1].toLowerCase() === 'png' };
  }
  let source: CanvasImageSource = el as HTMLImageElement;
  if (el instanceof HTMLImageElement) await el.decode();
  if (el instanceof SVGSVGElement) {
    const xml = new XMLSerializer().serializeToString(el);
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
    await img.decode();
    source = img;
  }
  // three times the resolution for sharp charts
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * 3));
  canvas.height = Math.max(1, Math.round(height * 3));
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    return { bytes: base64Bytes(canvas.toDataURL('image/png').split(',')[1]), png: true };
  } catch {
    return null; // an external image without CORS taints the canvas
  }
}

class PageWriter {
  private fonts = new Map<StandardFonts, PDFFont>();
  constructor(private doc: PDFDocument, private page: PDFPage, private origin: DOMRect, private k: number, private height: number) {}

  private x = (px: number) => (px - this.origin.left) * this.k;
  private y = (px: number) => this.height - (px - this.origin.top) * this.k;

  private async font(cs: CSSStyleDeclaration) {
    const key = fontKey(cs);
    let f = this.fonts.get(key);
    if (!f) { f = await this.doc.embedFont(key); this.fonts.set(key, f); }
    return f;
  }

  async element(el: Element, clip: Rect) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || el.classList.contains('rv-interactive')) return;
    const r = el.getBoundingClientRect();
    const own: Rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    const visible = intersect(own, clip);
    if (cs.visibility !== 'hidden' && !empty(visible)) {
      if (el instanceof HTMLImageElement || el instanceof SVGSVGElement) {
        await this.picture(el, own, visible);
        return;
      }
      this.box(cs, own, visible);
    }
    const inner = cs.overflow !== 'visible' ? intersect(clip, own) : clip;
    if (empty(inner) && cs.overflow !== 'visible') return;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) { if (cs.visibility !== 'hidden') await this.text(node as Text, cs, inner); }
      else if (node instanceof Element) await this.element(node, inner);
    }
  }

  /** Background and borders, cut to the visible part. */
  private box(cs: CSSStyleDeclaration, r: Rect, v: Rect) {
    const bg = color(cs.backgroundColor);
    if (bg) {
      this.page.drawRectangle({ x: this.x(v.left), y: this.y(v.bottom), width: (v.right - v.left) * this.k, height: (v.bottom - v.top) * this.k, color: bg.c, opacity: bg.a });
    }
    const side = (name: 'Top' | 'Right' | 'Bottom' | 'Left', from: [number, number], to: [number, number], inside: boolean) => {
      const style = cs.getPropertyValue(`border-${name.toLowerCase()}-style`);
      const width = parseFloat(cs.getPropertyValue(`border-${name.toLowerCase()}-width`));
      const c = color(cs.getPropertyValue(`border-${name.toLowerCase()}-color`));
      if (!inside || style === 'none' || style === 'hidden' || !width || !c) return;
      const w = width * this.k;
      this.page.drawLine({
        start: { x: this.x(from[0]), y: this.y(from[1]) }, end: { x: this.x(to[0]), y: this.y(to[1]) }, thickness: w, color: c.c, opacity: c.a,
        dashArray: style === 'dashed' ? [w * 3, w * 2] : style === 'dotted' ? [w, w] : undefined,
      });
    };
    // a border is drawn where the element's edge is visible; half the line width lies inside the box
    const half = (n: string) => parseFloat(cs.getPropertyValue(`border-${n}-width`)) / 2 || 0;
    side('Top', [v.left, r.top + half('top')], [v.right, r.top + half('top')], r.top >= v.top - 0.5);
    side('Bottom', [v.left, r.bottom - half('bottom')], [v.right, r.bottom - half('bottom')], r.bottom <= v.bottom + 0.5);
    side('Left', [r.left + half('left'), v.top], [r.left + half('left'), v.bottom], r.left >= v.left - 0.5);
    side('Right', [r.right - half('right'), v.top], [r.right - half('right'), v.bottom], r.right <= v.right + 0.5);
  }

  private async picture(el: Element, r: Rect, v: Rect) {
    // pictures are not split: one that is mostly cut away belongs to another page
    if ((v.bottom - v.top) < (r.bottom - r.top) * 0.5) return;
    const pic = await pictureOf(el, r.right - r.left, r.bottom - r.top).catch(() => null);
    if (!pic) return;
    let image: PDFImage;
    try { image = pic.png ? await this.doc.embedPng(pic.bytes) : await this.doc.embedJpg(pic.bytes); } catch { return; }
    const fit = el instanceof HTMLImageElement ? getComputedStyle(el).objectFit : 'fill';
    let { left, top, right, bottom } = r;
    if (fit === 'contain') {
      // proportional inside the box, top left (as the preview shows it)
      const s = Math.min((right - left) / image.width, (bottom - top) / image.height);
      right = left + image.width * s;
      bottom = top + image.height * s;
    }
    this.page.drawImage(image, { x: this.x(left), y: this.y(bottom), width: (right - left) * this.k, height: (bottom - top) * this.k });
  }

  /** A text node word by word at the positions the browser laid them out. */
  private async text(node: Text, cs: CSSStyleDeclaration, clip: Rect) {
    const content = node.data;
    if (!content.trim()) return;
    const font = await this.font(cs);
    const c = color(cs.color) ?? { c: rgb(0, 0, 0), a: 1 };
    const sizePx = parseFloat(cs.fontSize);
    const size = sizePx * this.k;
    const underline = cs.textDecorationLine.includes('underline');
    const range = document.createRange();
    for (const m of content.matchAll(/\S+/g)) {
      range.setStart(node, m.index!);
      range.setEnd(node, m.index! + m[0].length);
      // a word broken across lines (overflow-wrap) has several boxes
      for (const box of Array.from(range.getClientRects())) {
        const mid = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
        if (mid.x < clip.left || mid.x > clip.right || mid.y < clip.top || mid.y > clip.bottom) continue;
        const word = range.getClientRects().length > 1 ? textIn(node, m.index!, m[0], box) : m[0];
        const baseline = box.top + (box.height - sizePx) / 2 + sizePx * 0.8;
        const text = winAnsi(word);
        if (!text) continue;
        try {
          this.page.drawText(text, { x: this.x(box.left), y: this.y(baseline), size, font, color: c.c, opacity: c.a });
        } catch { continue; }
        if (underline) {
          const y = this.y(baseline + sizePx * 0.12);
          this.page.drawLine({ start: { x: this.x(box.left), y }, end: { x: this.x(box.right), y }, thickness: Math.max(0.5, size / 15), color: c.c });
        }
      }
    }
  }
}

/** The part of a word that lies in one of its line boxes (words broken by overflow-wrap). */
function textIn(node: Text, start: number, word: string, box: DOMRect): string {
  const range = document.createRange();
  let out = '';
  for (let i = 0; i < word.length; i++) {
    range.setStart(node, start + i);
    range.setEnd(node, start + i + 1);
    const r = range.getBoundingClientRect();
    if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1) out += word[i];
  }
  return out || word;
}

/**
 * Draws the preview pages (elements of the paginated preview, rendered at zoom 1) into a PDF with the report's
 * page size in inches.
 */
export async function pagesToPdf(pages: HTMLElement[], size: { width: number; height: number }, title: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator('Business Central Report Builder');
  doc.setProducer('Business Central Report Builder (pdf-lib)');
  const W = size.width * 72, H = size.height * 72;
  for (const el of pages) {
    const page = doc.addPage([W, H]);
    const origin = el.getBoundingClientRect();
    const writer = new PageWriter(doc, page, origin, W / origin.width, H);
    await writer.element(el, { left: origin.left, top: origin.top, right: origin.right, bottom: origin.bottom });
  }
  return doc.save();
}
