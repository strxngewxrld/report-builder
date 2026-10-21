// SVG rendering of a chart from the render engine (column, bar, line, area, scatter – also mixed and stacked –, range,
// pie, doughnut, funnel, pyramid, polar and radar, calculated series as dashed lines). Sizes come from the report
// item; colors from the report's palette or the data points' own colors.

import type { CSSProperties } from 'react';
import { formatValue } from '../expr';
import { RChart } from './types';
import { l10n } from '../l10n';

const PALETTES: Record<string, string[]> = {
  BrightPastel: ['#418CF0', '#FCB441', '#E0400A', '#056492', '#BFBFBF', '#1A3B69', '#FFE382', '#129CDD', '#CA6B4B', '#005CDB'],
  Pastel: ['#87CEEB', '#32CD32', '#BA55D3', '#F08080', '#4682B4', '#9ACD32', '#40E0D0', '#FF69B4', '#F0E68C', '#D2B48C'],
  EarthTones: ['#FF8000', '#B8860B', '#C04000', '#6B8E23', '#CD853F', '#C0C000', '#228B22', '#D2691E', '#808000', '#20B2AA'],
  SemiTransparent: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF', '#AA7814', '#FF8000', '#008000', '#800080'],
  Berry: ['#8A2BE2', '#BA55D3', '#4169E1', '#C71585', '#0000FF', '#8A2BE2', '#DA70D6', '#7B68EE', '#C000C0', '#0000CD'],
  Chocolate: ['#A0522D', '#D2691E', '#8B0000', '#CD853F', '#A52A2A', '#F4A460', '#8B4513', '#C04000', '#B22222', '#B65C3A'],
  Fire: ['#FFD700', '#FF0000', '#FF1493', '#DC143C', '#FF8C00', '#FF00FF', '#FFFF00', '#FF4500', '#C71585', '#DDE221'],
  Grayscale: ['#C8C8C8', '#BDBDBD', '#B2B2B2', '#A7A7A7', '#9C9C9C', '#919191', '#868686', '#7B7B7B', '#707070', '#656565'],
};
const colors = (p: string) => PALETTES[p] ?? PALETTES.BrightPastel;

/** A smooth line through the points (Catmull-Rom as cubic Bézier segments). */
function smoothPath(pts: readonly (readonly [number, number])[]): string {
  if (pts.length < 3) return `M${pts.map(p => p.join(',')).join('L')}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** A data point marker (RDL ChartMarker/Type); null for 'None'. */
function markerShape(type: string | undefined, x: number, y: number, r: number, fill: string, key: string): JSX.Element | null {
  switch (type) {
    case 'None': return null;
    case 'Square': return <rect key={key} x={x - r} y={y - r} width={2 * r} height={2 * r} fill={fill} />;
    case 'Diamond': return <path key={key} d={`M${x},${y - r * 1.3}L${x + r * 1.3},${y}L${x},${y + r * 1.3}L${x - r * 1.3},${y}Z`} fill={fill} />;
    case 'Triangle': return <path key={key} d={`M${x},${y - r * 1.3}L${x + r * 1.2},${y + r}L${x - r * 1.2},${y + r}Z`} fill={fill} />;
    case 'Cross': return <path key={key} d={`M${x - r},${y - r}L${x + r},${y + r}M${x + r},${y - r}L${x - r},${y + r}`} stroke={fill} strokeWidth={Math.max(1.5, r / 2)} />;
    case 'Star4': case 'Star5': case 'Star6': case 'Star10': {
      const n = Number(type.slice(4));
      const pts = Array.from({ length: n * 2 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / n, rr = i % 2 ? r * 0.5 : r * 1.4;
        return `${x + rr * Math.cos(a)},${y + rr * Math.sin(a)}`;
      });
      return <polygon key={key} points={pts.join(' ')} fill={fill} />;
    }
    default: return <circle key={key} cx={x} cy={y} r={r} fill={fill} />;
  }
}

/** "Nice" axis bounds and step (1, 2, 5 × 10^n). */
function axis(min: number, max: number) {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / 5;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= raw) ?? raw;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

export function ChartView({ chart, S, style }: { chart: RChart; S: number; style: CSSProperties }) {
  const fmt = (v: number) => (Math.abs(v) >= 1000 || !Number.isInteger(v)
    ? v.toLocaleString(chart.locale ?? 'en-US', { maximumFractionDigits: 2 }) : String(v));
  const W = chart.width * S, H = chart.height * S;
  const pal = colors(chart.palette);
  const font = { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 10, fill: '#333' };
  const first = chart.series[0];
  const pie = !!first && (first.type === 'Pie' || first.type === 'Doughnut');
  /** Segments of one series: pie, doughnut, funnel, pyramid (the legend lists the categories). */
  const shape = !!first && (pie || first.type === 'Funnel' || first.type === 'Pyramid');
  const polar = !!first && (first.type === 'Polar' || first.type === 'Radar');
  const legendItems = shape ? chart.categories : chart.series.map(s => s.name);
  const showLegend = chart.legend && legendItems.length > (shape ? 0 : 1);
  /** Color of a point: its own (data point color) or the palette's – by category for shapes, by series otherwise. */
  const colorOf = (si: number, ci: number) => chart.series[si]?.colors?.[ci] || pal[(shape ? ci : si) % pal.length];
  const legendColor = (i: number) => (shape ? colorOf(0, i) : pal[i % pal.length]);
  const markerR = (si: number, fallback: number) => (chart.series[si].marker?.size ? (chart.series[si].marker!.size! / 72) * S / 2 : fallback);
  const titleH = chart.title ? 18 : 4;
  const legendW = showLegend ? Math.min(W * 0.32, 22 + Math.max(...legendItems.map(l => l.length)) * 6) : 0;
  const plot = { x: 8, y: titleH + 4, w: W - legendW - 16, h: H - titleH - 12 };

  let body: JSX.Element[] = [];
  if (pie) {
    const values = chart.series[0].values.map(v => Math.max(0, v ?? 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const r = Math.max(4, Math.min(plot.w, plot.h) / 2 - 4);
    const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
    let a0 = -Math.PI / 2;
    body = values.map((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2;
      if (v <= 0) return <g key={i} />;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      const inner = chart.series[0].type === 'Doughnut' ? r * 0.5 : 0;
      const d = v >= total
        ? `M${p(0, r)}A${r},${r} 0 1 1 ${p(Math.PI, r)}A${r},${r} 0 1 1 ${p(0, r)}Z`
        : inner
          ? `M${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, inner)}A${inner},${inner} 0 ${large} 0 ${p(a0, inner)}Z`
          : `M${cx},${cy}L${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}Z`;
      a0 = a1;
      return <path key={i} d={d} fill={colorOf(0, i)} stroke="white" strokeWidth={1}><title>{`${chart.categories[i]}: ${fmt(v)}`}</title></path>;
    });
  } else if (shape) {
    // funnel: segments from the top, the height of each proportional to its value, narrowing to a neck;
    // pyramid: the first point at the base
    const s0 = chart.series[0];
    const values = s0.values.map(v => Math.max(0, v ?? 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const funnel = s0.type === 'Funnel';
    const cx = plot.x + plot.w / 2, w = Math.max(10, plot.w - 8), h = Math.max(10, plot.h - 4), top = plot.y + 2;
    const neckW = w * 0.25, neckY = h * 0.75;
    const widthAt = (y: number) => (funnel ? (y >= neckY ? neckW : w - (w - neckW) * (y / neckY)) : w * (y / h));
    const order = funnel ? values.map((_, i) => i) : values.map((_, i) => values.length - 1 - i);
    let y = 0;
    for (const i of order) {
      const y0 = y, y1 = y + (values[i] / total) * h;
      y = y1;
      if (values[i] <= 0) continue;
      const ys = [y0, ...(funnel && y0 < neckY && y1 > neckY ? [neckY] : []), y1];
      const left = ys.map(yy => `${cx - widthAt(yy) / 2},${top + yy}`);
      const right = ys.map(yy => `${cx + widthAt(yy) / 2},${top + yy}`).reverse();
      body.push(<polygon key={`s${i}`} points={[...left, ...right].join(' ')} fill={colorOf(0, i)} stroke="white" strokeWidth={1}><title>{`${chart.categories[i]}: ${fmt(s0.values[i] ?? 0)}`}</title></polygon>);
      if (chart.dataLabels && y1 - y0 > 9) {
        body.push(<text key={`d${i}`} x={cx} y={top + (y0 + y1) / 2 + 3} textAnchor="middle" {...font} fontSize={9}>{fmt(s0.values[i] ?? 0)}</text>);
      }
    }
  } else if (polar) {
    // categories at equal angles from the top, clockwise; values as distance from the center
    const n = Math.max(1, chart.categories.length);
    const r = Math.max(4, Math.min(plot.w, plot.h) / 2 - 14);
    const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
    const all = [0, ...chart.series.flatMap(s => s.values.filter((v): v is number => v !== null))];
    const nice = axis(chart.valueAxis?.min ?? Math.min(...all), chart.valueAxis?.max ?? Math.max(...all));
    const lo = chart.valueAxis?.min ?? nice.lo, hi = Math.max(chart.valueAxis?.max ?? nice.hi, lo + 1e-9);
    const at = (ci: number, v: number) => {
      const a = -Math.PI / 2 + (ci / n) * Math.PI * 2, d = ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * r;
      return [cx + d * Math.cos(a), cy + d * Math.sin(a)] as const;
    };
    const radar = first.type === 'Radar';
    for (let v = lo + nice.step; v <= hi + nice.step / 2; v += nice.step) {
      body.push(radar
        ? <polygon key={`g${v}`} points={chart.categories.map((_, ci) => at(ci, v).join(',')).join(' ')} fill="none" stroke="#e0e0e0" />
        : <circle key={`g${v}`} cx={cx} cy={cy} r={((v - lo) / (hi - lo)) * r} fill="none" stroke="#e0e0e0" />);
      // the outermost ring is not labelled: its label would cover the first category's
      if (v < hi - nice.step / 2) body.push(<text key={`gl${v}`} x={cx + 2} y={at(0, v)[1] - 2} {...font} fontSize={8} fill="#777">{chart.valueAxis?.format ? formatValue(v, chart.valueAxis.format, chart.locale) : fmt(v)}</text>);
    }
    chart.categories.forEach((c, ci) => {
      const [x, y] = at(ci, hi);
      body.push(<line key={`sp${ci}`} x1={cx} y1={cy} x2={x} y2={y} stroke="#e0e0e0" />);
      const [lx, ly] = [cx + (x - cx) * 1.08, cy + (y - cy) * 1.08];
      body.push(<text key={`c${ci}`} x={lx} y={ly + 3} textAnchor={Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end'} {...font}>{c}</text>);
    });
    chart.series.forEach((s, si) => {
      const color = pal[si % pal.length];
      const pts = s.values.map((v, ci) => (v === null ? null : at(ci, v)));
      const present = pts.filter((p): p is readonly [number, number] => !!p);
      if (radar && present.length > 1) {
        body.push(<polygon key={`r${si}`} points={present.map(p => p.join(',')).join(' ')} fill={color} fillOpacity={s.derived ? 0 : 0.35} stroke={color} strokeWidth={2} strokeDasharray={s.derived ? '5 3' : undefined} />);
      } else if (s.derived && present.length > 1) {
        body.push(<polygon key={`r${si}`} points={present.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="5 3" />);
      }
      if (!s.derived) {
        pts.forEach((p, ci) => {
          if (!p) return;
          const m = markerShape(s.marker?.type ?? (radar ? 'None' : 'Circle'), p[0], p[1], markerR(si, 3), colorOf(si, ci), `p${si}-${ci}`);
          if (m) body.push(m);
          if (chart.dataLabels) body.push(<text key={`d${si}-${ci}`} x={p[0]} y={p[1] - 6} textAnchor="middle" {...font} fontSize={9}>{fmt(s.values[ci] ?? 0)}</text>);
        });
      }
    });
  } else {
    const horizontal = chart.series.some(s => s.type === 'Bar' || s.type === 'RangeBar');
    const n = chart.categories.length || 1;
    // 100 % stacking: each category's stack sums to 100
    const values = chart.series.map(s => (s.percent
      ? s.values.map((v, ci) => {
        const total = chart.series.filter(x => x.percent && !!x.secondary === !!s.secondary).reduce((a, x) => a + Math.max(0, x.values[ci] ?? 0), 0);
        return v === null ? null : total ? (Math.max(0, v) / total) * 100 : 0;
      })
      : s.values));
    const onSecondary = (si: number) => !horizontal && !!chart.series[si].secondary;
    const scaleOf = (secondary: boolean) => {
      const idx = chart.series.map((_, i) => i).filter(i => onSecondary(i) === secondary);
      if (!idx.length) return null;
      const stackedIdx = idx.filter(i => chart.series[i].stacked);
      const sums = chart.categories.map((_, ci) => stackedIdx.reduce((a, i) => a + Math.max(0, values[i][ci] ?? 0), 0));
      const all = [0, ...sums, ...idx.filter(i => !chart.series[i].stacked).flatMap(i => [...values[i], ...chart.series[i].low ?? []].filter((v): v is number => v !== null))];
      const spec = secondary ? chart.secondaryAxis : chart.valueAxis;
      const nice = axis(spec?.min ?? Math.min(...all), spec?.max ?? Math.max(...all));
      const lo = spec?.min ?? nice.lo, hi = spec?.max ?? nice.hi;
      const percent = idx.some(i => chart.series[i].percent);
      const label = (v: number) => (spec?.format ? formatValue(v, spec.format, chart.locale) : `${fmt(v)}${percent ? ' %' : ''}`);
      return { lo, hi: hi > lo ? hi : lo + 1, step: nice.step, label };
    };
    const primary = scaleOf(false) ?? { lo: 0, hi: 1, step: 1, label: fmt };
    const secondary = scaleOf(true);
    const labelWidth = (sc: { lo: number; hi: number; label: (v: number) => string }) => 8 + Math.max(...[sc.lo, sc.hi].map(v => sc.label(v).length)) * 6;
    const titleSpace = (t?: string) => (t ? 14 : 0);
    const catLabelW = horizontal ? Math.min(plot.w * 0.3, 6 + Math.max(0, ...chart.categories.map(c => c.length)) * 5.5) : 0;
    const left = plot.x + titleSpace(horizontal ? chart.categoryAxis?.title : chart.valueAxis?.title) + (horizontal ? catLabelW : Math.min(plot.w * 0.3, labelWidth(primary)));
    const right = plot.x + plot.w - (secondary ? Math.min(plot.w * 0.25, labelWidth(secondary)) + titleSpace(chart.secondaryAxis?.title) : 0);
    const bottomTitle = titleSpace(horizontal ? chart.valueAxis?.title : chart.categoryAxis?.title);
    const area = { x: left, y: plot.y, w: Math.max(10, right - left), h: Math.max(10, plot.h - 16 - bottomTitle) };
    const valOf = (sc: { lo: number; hi: number }) => (v: number) => (horizontal
      ? area.x + ((v - sc.lo) / (sc.hi - sc.lo)) * area.w
      : area.y + area.h - ((v - sc.lo) / (sc.hi - sc.lo)) * area.h);
    const val = valOf(primary);
    const valSec = secondary ? valOf(secondary) : val;
    const scaleFor = (si: number) => (onSecondary(si) && secondary ? { v: valSec, sc: secondary } : { v: val, sc: primary });
    const band = (horizontal ? area.h : area.w) / n;
    // gridlines and value labels (secondary: labels on the right, no gridlines)
    for (let v = primary.lo; v <= primary.hi + primary.step / 2; v += primary.step) {
      const p = val(v);
      body.push(horizontal
        ? <g key={`g${v}`}><line x1={p} x2={p} y1={area.y} y2={area.y + area.h} stroke="#e0e0e0" /><text x={p} y={area.y + area.h + 11} textAnchor="middle" {...font}>{primary.label(v)}</text></g>
        : <g key={`g${v}`}><line x1={area.x} x2={area.x + area.w} y1={p} y2={p} stroke="#e0e0e0" /><text x={area.x - 4} y={p + 3} textAnchor="end" {...font}>{primary.label(v)}</text></g>);
    }
    if (secondary) {
      for (let v = secondary.lo; v <= secondary.hi + secondary.step / 2; v += secondary.step) {
        body.push(<text key={`s${v}`} x={area.x + area.w + 4} y={valSec(v) + 3} {...font}>{secondary.label(v)}</text>);
      }
    }
    chart.categories.forEach((c, ci) => {
      const mid = (horizontal ? area.y : area.x) + band * (ci + 0.5);
      body.push(horizontal
        ? <text key={`c${ci}`} x={area.x - 4} y={mid + 3} textAnchor="end" {...font}>{c}</text>
        : <text key={`c${ci}`} x={mid} y={area.y + area.h + 12} textAnchor="middle" {...font}>{c.length > band / 5.5 ? `${c.slice(0, Math.max(1, Math.floor(band / 5.5) - 1))}…` : c}</text>);
    });
    // axis titles
    const vTitle = (t: string | undefined, x: number, key: string) => t && (
      <text key={key} transform={`translate(${x}, ${area.y + area.h / 2}) rotate(-90)`} textAnchor="middle" {...font} fontWeight="bold">{t}</text>);
    const hTitle = (t: string | undefined, key: string) => t && (
      <text key={key} x={area.x + area.w / 2} y={area.y + area.h + 26} textAnchor="middle" {...font} fontWeight="bold">{t}</text>);
    if (horizontal) {
      body.push(...[vTitle(chart.categoryAxis?.title, plot.x + 8, 'tc'), hTitle(chart.valueAxis?.title, 'tv')].filter((x): x is JSX.Element => !!x));
    } else {
      body.push(...[vTitle(chart.valueAxis?.title, plot.x + 8, 'tv'), hTitle(chart.categoryAxis?.title, 'tc'),
        vTitle(chart.secondaryAxis?.title, plot.x + plot.w - 4, 'ts')].filter((x): x is JSX.Element => !!x));
    }

    const isBar = (s: { type: string }) => s.type === 'Column' || s.type === 'Bar' || s.type === 'RangeColumn' || s.type === 'RangeBar';
    const barSeries = chart.series.filter(isBar);
    const anyStackedBars = barSeries.some(s => s.stacked);
    const bw = band * 0.7 / (anyStackedBars ? 1 : Math.max(1, barSeries.length));
    const stackBase = [false, true].map(() => chart.categories.map(() => 0));
    const areaBase = [false, true].map(() => chart.categories.map(() => 0));
    const labels: JSX.Element[] = [];
    const dataLabel = (key: string, x: number, y: number, v: number, si: number, anchor: 'middle' | 'start' = 'middle') => {
      if (!chart.dataLabels) return;
      labels.push(<text key={key} x={x} y={y} textAnchor={anchor} {...font} fontSize={9}>{scaleFor(si).sc.label(v)}</text>);
    };
    chart.series.forEach((s, si) => {
      const color = pal[si % pal.length];
      const { v: toPx } = scaleFor(si);
      const side = onSecondary(si) ? 1 : 0;
      const vs = values[si];
      if (isBar(s)) {
        const k = barSeries.indexOf(s);
        const range = s.type === 'RangeColumn' || s.type === 'RangeBar';
        vs.forEach((v, ci) => {
          if (v === null || (range && s.low?.[ci] == null)) return;
          const from = range ? s.low![ci]! : s.stacked ? stackBase[side][ci] : 0;
          const to = range ? v : from + v;
          if (s.stacked) stackBase[side][ci] = to;
          const start = (horizontal ? area.y : area.x) + band * ci + band * 0.15 + (anyStackedBars ? 0 : k * bw);
          const a = toPx(from), b = toPx(to);
          const tip = <title>{`${s.name} – ${chart.categories[ci]}: ${range ? `${fmt(from)} – ` : ''}${fmt(s.values[ci] ?? 0)}`}</title>;
          const fill = colorOf(si, ci);
          body.push(horizontal
            ? <rect key={`b${si}-${ci}`} x={Math.min(a, b)} y={start} width={Math.abs(b - a)} height={bw} fill={fill}>{tip}</rect>
            : <rect key={`b${si}-${ci}`} x={start} y={Math.min(a, b)} width={bw} height={Math.abs(b - a)} fill={fill}>{tip}</rect>);
          if (horizontal) dataLabel(`d${si}-${ci}`, Math.max(a, b) + 3, start + bw / 2 + 3, s.values[ci] ?? v, si, 'start');
          else dataLabel(`d${si}-${ci}`, start + bw / 2, (s.stacked ? (a + b) / 2 + 3 : Math.min(a, b) - 3), s.values[ci] ?? v, si);
        });
      } else {
        const x = (ci: number) => area.x + band * (ci + 0.5);
        const stackedArea = s.type === 'Area' && s.stacked;
        const top = vs.map((v, ci) => (v === null ? null : stackedArea ? areaBase[side][ci] + v : v));
        const pts = top.map((v, ci) => (v === null ? null : [x(ci), toPx(v)] as const)).filter((p): p is readonly [number, number] => !!p);
        if (!pts.length) return;
        if (s.type === 'Range') {
          // the band between the low and the high values
          const lows = (s.low ?? []).map((v, ci) => (v === null || vs[ci] === null ? null : [x(ci), toPx(v)] as const)).filter((p): p is readonly [number, number] => !!p);
          const upper = s.smooth ? smoothPath(pts) : `M${pts.map(p => p.join(',')).join('L')}`;
          const lower = [...lows].reverse();
          body.push(<path key={`a${si}`} d={`${upper}L${lower.map(p => p.join(',')).join('L')}Z`} fill={color} opacity={0.6}><title>{s.name}</title></path>);
          vs.forEach((v, ci) => { if (v !== null) dataLabel(`d${si}-${ci}`, x(ci), toPx(v) - 6, v, si); });
          return;
        }
        if (s.type === 'Area') {
          const lower = stackedArea
            ? top.map((v, ci) => (v === null ? null : [x(ci), toPx(areaBase[side][ci])] as const)).filter((p): p is readonly [number, number] => !!p).reverse()
            : [[pts[pts.length - 1][0], toPx(Math.max(scaleFor(si).sc.lo, 0))] as const, [pts[0][0], toPx(Math.max(scaleFor(si).sc.lo, 0))] as const];
          body.push(<path key={`a${si}`} d={`M${pts.map(p => p.join(',')).join('L')}L${lower.map(p => p.join(',')).join('L')}Z`} fill={color} opacity={0.6} />);
          if (stackedArea) vs.forEach((v, ci) => { if (v !== null) areaBase[side][ci] += v; });
        }
        if (s.type !== 'Scatter') {
          const dash = s.derived ? '6 3' : undefined, width = s.derived ? 1.5 : 2;
          body.push(s.smooth
            ? <path key={`l${si}`} d={smoothPath(pts)} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} />
            : <polyline key={`l${si}`} points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash}><title>{s.name}</title></polyline>);
        }
        if (!s.derived) {
          // markers: the series' own shape, the data point colors
          vs.forEach((v, ci) => {
            if (v === null || top[ci] === null) return;
            const m = markerShape(s.marker?.type, x(ci), toPx(top[ci]!), markerR(si, s.type === 'Scatter' ? 3.5 : 2.5), colorOf(si, ci), `p${si}-${ci}`);
            if (m) body.push(m);
          });
        }
        if (!s.derived) vs.forEach((v, ci) => { if (v !== null && top[ci] !== null) dataLabel(`d${si}-${ci}`, x(ci), toPx(top[ci]!) - 6, s.values[ci] ?? v, si); });
      }
    });
    body.unshift(<rect key="frame" x={area.x} y={area.y} width={area.w} height={area.h} fill="none" stroke="#bbb" />);
    body.push(...labels);
  }

  return (
    <svg width={W} height={H} style={style} viewBox={`0 0 ${W} ${H}`}>
      <rect width={W} height={H} fill="white" />
      {chart.title && <text x={W / 2} y={13} textAnchor="middle" {...font} fontSize={12} fontWeight="bold">{chart.title}</text>}
      {body}
      {showLegend && legendItems.map((l, i) => (
        <g key={`lg${i}`} transform={`translate(${W - legendW + 4}, ${titleH + 6 + i * 14})`}>
          {!shape && chart.series[i]?.derived
            ? <line x1={0} x2={9} y1={4.5} y2={4.5} stroke={pal[i % pal.length]} strokeWidth={2} strokeDasharray="3 2" />
            : <rect width={9} height={9} fill={legendColor(i)} />}
          <text x={13} y={8} {...font}>{l.length > (legendW - 16) / 5.5 ? `${l.slice(0, Math.max(1, Math.floor((legendW - 16) / 5.5) - 1))}…` : l}</text>
        </g>
      ))}
      {chart.sample && <text x={W - 4} y={H - 4} textAnchor="end" {...font} fontSize={9} fill="#999">{l10n.t('Sample values')}</text>}
    </svg>
  );
}
