// Embedded images of a report (<EmbeddedImages>, e.g. a company logo). The element stays verbatim XML in
// Report.extraXml; adding, renaming and deleting patch only the image concerned.

import { Report, allReportItems } from './model';
import { l10n } from './l10n';

export interface EmbeddedImage { name: string; mimeType: string; data: string }

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const IMAGE = /<EmbeddedImage\s+Name="([^"]*)"\s*>([\s\S]*?)<\/EmbeddedImage>/g;
const indexOf = (r: Report) => r.extraXml.findIndex(x => /^<EmbeddedImages[\s>/]/.test(x.trim()));

export function embeddedImages(r: Report): EmbeddedImage[] {
  const xml = r.extraXml[indexOf(r)] ?? '';
  return Array.from(xml.matchAll(IMAGE), m => ({
    name: decode(m[1]),
    mimeType: decode(/<MIMEType>([\s\S]*?)<\/MIMEType>/.exec(m[2])?.[1] ?? 'image/png'),
    data: (/<ImageData>([\s\S]*?)<\/ImageData>/.exec(m[2])?.[1] ?? '').replace(/\s+/g, ''),
  }));
}

/** data: URL of an image for display. */
export const imageUrl = (img: EmbeddedImage) => `data:${img.mimeType};base64,${img.data}`;

/** Decode with the same browser engine that displays the image, before changing the report. */
export function validateImage(img: EmbeddedImage): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (ok) resolve();
      else reject(new Error(l10n.t('Image "{0}" cannot be decoded. The file is damaged or is not a supported image.', img.name)));
    };
    const timer = setTimeout(() => finish(false), 10000);
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    image.src = imageUrl(img);
  });
}

/** Image names must be unique and follow the rules for RDL names (letters, digits, underscore). */
export function imageName(r: Report, wanted: string): string {
  const base = (wanted.replace(/\.[^.]*$/, '').replace(/[^\p{L}\p{N}_]/gu, '_').replace(/^(?=[\p{N}_])/u, l10n.t('Image')) || l10n.t('Image')).slice(0, 60);
  const taken = new Set(embeddedImages(r).map(i => i.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base}${n}`.toLowerCase())) n++;
  return `${base}${n}`;
}

function setXml(r: Report, xml: string | null) {
  const i = indexOf(r);
  if (xml === null) { if (i >= 0) r.extraXml.splice(i, 1); return; }
  if (i >= 0) r.extraXml[i] = xml;
  else r.extraXml.push(xml);
}

/** Adds an image (data as base64); returns its name, made unique. */
export function addEmbeddedImage(r: Report, wanted: string, mimeType: string, data: string): string {
  const name = imageName(r, wanted);
  const entry = `<EmbeddedImage Name="${encode(name)}"><MIMEType>${encode(mimeType)}</MIMEType><ImageData>${data}</ImageData></EmbeddedImage>`;
  const xml = r.extraXml[indexOf(r)];
  setXml(r, xml && /<\/EmbeddedImages>$/.test(xml.trim())
    ? xml.trim().replace(/<\/EmbeddedImages>$/, `${entry}</EmbeddedImages>`)
    : `<EmbeddedImages>${entry}</EmbeddedImages>`);
  return name;
}

/** Image items that show the embedded image `name` (a literal value, not an expression). */
const users = (r: Report, name: string) =>
  allReportItems(r).filter(it => it.type === 'image' && it.source === 'Embedded' && it.value === name);

export const imageUses = (r: Report, name: string) => users(r, name).length;

/** Renames an image and the image items that use it; false if the new name is invalid or taken. */
export function renameEmbeddedImage(r: Report, from: string, to: string): boolean {
  to = to.trim();
  if (!to || to === from || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(to)) return false;
  if (embeddedImages(r).some(i => i.name.toLowerCase() === to.toLowerCase() && i.name !== from)) return false;
  const i = indexOf(r);
  if (i < 0) return false;
  let found = false;
  r.extraXml[i] = r.extraXml[i].replace(IMAGE, (m, n: string) => {
    if (decode(n) !== from) return m;
    found = true;
    return m.replace(`Name="${n}"`, `Name="${encode(to)}"`);
  });
  if (!found) return false;
  for (const it of users(r, from)) if (it.type === 'image') it.value = to;
  return true;
}

/** Deletes an image; the element <EmbeddedImages> goes when it is empty. */
export function deleteEmbeddedImage(r: Report, name: string): boolean {
  const i = indexOf(r);
  if (i < 0) return false;
  let found = false;
  const xml = r.extraXml[i].replace(IMAGE, (m, n: string) => {
    if (decode(n) !== name) return m;
    found = true;
    return '';
  });
  if (!found) return false;
  setXml(r, /<EmbeddedImage[\s>]/.test(xml) ? xml : null);
  return true;
}
