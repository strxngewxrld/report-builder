import type { CSSProperties } from 'react';
import { Style } from './model';

const FONT_WEIGHT: Record<string, number> = {
  thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, heavy: 900,
};

const BORDER: Record<string, string> = { none: 'none', solid: 'solid', dotted: 'dotted', dashed: 'dashed', double: 'double' };

/**
 * Converts an RDL style to CSS. `resolve` maps expression values ("=IIf(…)") to a concrete value; in the designer
 * expressions are ignored (resolve returns undefined), in the preview they are evaluated.
 */
export function styleToCss(style: Style, resolve: (v: string) => string | undefined = v => (v.startsWith('=') ? undefined : v)): CSSProperties {
  const s = (k: keyof Style) => {
    const v = style[k];
    return v === undefined ? undefined : resolve(v);
  };
  const css: CSSProperties = {
    fontFamily: s('FontFamily') ?? 'Arial',
    fontSize: s('FontSize') ?? '10pt',
    color: s('Color') ?? 'Black',
    paddingLeft: s('PaddingLeft'),
    paddingRight: s('PaddingRight'),
    paddingTop: s('PaddingTop'),
    paddingBottom: s('PaddingBottom'),
  };
  const fw = s('FontWeight');
  if (fw) css.fontWeight = FONT_WEIGHT[fw.toLowerCase()] ?? 400;
  if (s('FontStyle')?.toLowerCase() === 'italic') css.fontStyle = 'italic';
  const td = s('TextDecoration')?.toLowerCase();
  if (td && td !== 'none') css.textDecoration = td === 'linethrough' ? 'line-through' : td;
  const bg = s('BackgroundColor');
  if (bg && bg.toLowerCase() !== 'transparent') css.backgroundColor = bg;
  const bs = BORDER[s('BorderStyle')?.toLowerCase() ?? 'none'] ?? 'solid';
  if (bs !== 'none') css.border = `${s('BorderWidth') ?? '1pt'} ${bs} ${s('BorderColor') ?? 'Black'}`;
  return css;
}

/** RDL TextAlign "General" aligns numbers and dates right, everything else left. */
export function textAlign(style: Style, value?: unknown): CSSProperties['textAlign'] {
  const a = style.TextAlign?.toLowerCase();
  if (a === 'center' || a === 'right' || a === 'left') return a;
  return typeof value === 'number' || value instanceof Date ? 'right' : 'left';
}

export function verticalAlign(style: Style): CSSProperties['justifyContent'] {
  const v = style.VerticalAlign?.toLowerCase();
  return v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
}

let ctx2d: CanvasRenderingContext2D | null | undefined;
/** Normalizes any CSS color (incl. names like "LightGrey") to #rrggbb for <input type=color>. */
export function toHex(color: string | undefined, fallback = '#000000'): string {
  if (!color || color.startsWith('=')) return fallback;
  if (ctx2d === undefined) ctx2d = document.createElement('canvas').getContext('2d');
  if (!ctx2d) return fallback;
  ctx2d.fillStyle = fallback;
  ctx2d.fillStyle = color;
  const v = ctx2d.fillStyle;
  return v.startsWith('#') ? v : fallback;
}
