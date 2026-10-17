/** CSS pixels per inch at 100 % zoom. */
export const PX_PER_IN = 96;

const PER_INCH: Record<string, number> = { in: 1, cm: 2.54, mm: 25.4, pt: 72, pc: 6 };

/** Parses an RDL size ("2.5cm", "1in", "10pt") into inches. Returns `fallback` for empty/invalid input. */
export function parseSize(s: string | null | undefined, fallback = 0): number {
  const m = /^\s*(-?[\d.]+)\s*(in|cm|mm|pt|pc)\s*$/i.exec(s ?? '');
  if (!m) return fallback;
  return parseFloat(m[1]) / PER_INCH[m[2].toLowerCase()];
}

export const round = (v: number, digits = 5) => Math.round(v * 10 ** digits) / 10 ** digits;

export function formatSize(inches: number, unit: 'in' | 'cm'): string {
  return `${round(inches * PER_INCH[unit])}${unit}`;
}

/** Converts a value in the display unit to inches and back – used by numeric inputs in the property grid. */
export const toUnit = (inches: number, unit: 'in' | 'cm') => round(inches * PER_INCH[unit], 3);
export const fromUnit = (v: number, unit: 'in' | 'cm') => v / PER_INCH[unit];

/** RDL sizes such as FontSize "10pt" or BorderWidth "1pt" to CSS. Those are valid CSS lengths already. */
export const cssLength = (s: string | undefined, fallback: string) => (Number.isNaN(parseSize(s, NaN)) ? fallback : s!);
