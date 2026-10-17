// SVG rendering of a chart from the render engine (column, bar, line, area, scatter – also mixed and stacked –, pie
// and doughnut). Sizes come from the report item; colors from the report's palette.

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

const fmt = (v: number) => (Math.abs(v) >= 1000 || !Number.isInteger(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : String(v));

/** "Nice" axis bounds and step (1, 2, 5 × 10^n). */
function axis(min: number, max: number) {
  if (min === max) { max = min + 1; }
  const raw = (max - min) / 5;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1));
  const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= raw) ?? raw;
  return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
}

export function ChartView({ chart, S, style }: { chart: RChart; S: number; style: CSSProperties }) {
  const W = chart.width * S, H = chart.height * S;
  const pal = colors(chart.palette);
  const font = { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: 10, fill: '#333' };
  const pie = chart.series[0] && (chart.series[0].type === 'Pie' || chart.series[0].type === 'Doughnut');
  const legendItems = pie ? chart.categories : chart.series.map(s => s.name);
  const showLegend = chart.legend && legendItems.length > (pie ? 0 : 1);
  const titleH = chart.title ? 18 : 4;
  const legendW = showLegend ? Math.min(W * 0.32, 12 + Math.max(...legendItems.map(l => l.length)) * 6) : 0;
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
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`;
      const inner = chart.series[0].type === 'Doughnut' ? r * 0.5 : 0;
      const d = v >= total
        ? `M${p(0, r)}A${r},${r} 0 1 1 ${p(Math.PI, r)}A${r},${r} 0 1 1 ${p(0, r)}Z`
        : inner
          ? `M${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, inner)}A${inner},${inner} 0 ${large} 0 ${p(a0, inner)}Z`
          : `M${cx},${cy}L${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}Z`;
      a0 = a1;
      return <path key={i} d={d} fill={pal[i % pal.length]} stroke="white" strokeWidth={1}><title>{`${chart.categories[i]}: ${fmt(v)}`}</title></path>;
    });
  } else {
    const horizontal = chart.series.some(s => s.type === 'Bar');
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
      const all = [0, ...sums, ...idx.filter(i => !chart.series[i].stacked).flatMap(i => values[i].filter((v): v is number => v !== null))];
      const spec = secondary ? chart.secondaryAxis : chart.valueAxis;
      const nice = axis(spec?.min ?? Math.min(...all), spec?.max ?? Math.max(...all));
      const lo = spec?.min ?? nice.lo, hi = spec?.max ?? nice.hi;
      const percent = idx.some(i => chart.series[i].percent);
      const label = (v: number) => (spec?.format ? formatValue(v, spec.format) : `${fmt(v)}${percent ? ' %' : ''}`);
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

    const barSeries = chart.series.filter(s => s.type === 'Column' || s.type === 'Bar');
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
      if (s.type === 'Column' || s.type === 'Bar') {
        const k = barSeries.indexOf(s);
        vs.forEach((v, ci) => {
          if (v === null) return;
          const from = s.stacked ? stackBase[side][ci] : 0;
          const to = from + v;
          if (s.stacked) stackBase[side][ci] = to;
          const start = (horizontal ? area.y : area.x) + band * ci + band * 0.15 + (anyStackedBars ? 0 : k * bw);
          const a = toPx(from), b = toPx(to);
          const tip = <title>{`${s.name} – ${chart.categories[ci]}: ${fmt(s.values[ci] ?? 0)}`}</title>;
          body.push(horizontal
            ? <rect key={`b${si}-${ci}`} x={Math.min(a, b)} y={start} width={Math.abs(b - a)} height={bw} fill={color}>{tip}</rect>
            : <rect key={`b${si}-${ci}`} x={start} y={Math.min(a, b)} width={bw} height={Math.abs(b - a)} fill={color}>{tip}</rect>);
          if (horizontal) dataLabel(`d${si}-${ci}`, Math.max(a, b) + 3, start + bw / 2 + 3, s.values[ci] ?? v, si, 'start');
          else dataLabel(`d${si}-${ci}`, start + bw / 2, (s.stacked ? (a + b) / 2 + 3 : Math.min(a, b) - 3), s.values[ci] ?? v, si);
        });
      } else {
        const x = (ci: number) => area.x + band * (ci + 0.5);
        const stackedArea = s.type === 'Area' && s.stacked;
        const top = vs.map((v, ci) => (v === null ? null : stackedArea ? areaBase[side][ci] + v : v));
        const pts = top.map((v, ci) => (v === null ? null : [x(ci), toPx(v)] as const)).filter((p): p is readonly [number, number] => !!p);
        if (!pts.length) return;
        if (s.type === 'Area') {
          const lower = stackedArea
            ? top.map((v, ci) => (v === null ? null : [x(ci), toPx(areaBase[side][ci])] as const)).filter((p): p is readonly [number, number] => !!p).reverse()
            : [[pts[pts.length - 1][0], toPx(Math.max(scaleFor(si).sc.lo, 0))] as const, [pts[0][0], toPx(Math.max(scaleFor(si).sc.lo, 0))] as const];
          body.push(<path key={`a${si}`} d={`M${pts.map(p => p.join(',')).join('L')}L${lower.map(p => p.join(',')).join('L')}Z`} fill={color} opacity={0.6} />);
          if (stackedArea) vs.forEach((v, ci) => { if (v !== null) areaBase[side][ci] += v; });
        }
        if (s.type !== 'Scatter') {
          body.push(s.smooth
            ? <path key={`l${si}`} d={smoothPath(pts)} fill="none" stroke={color} strokeWidth={2} />
            : <polyline key={`l${si}`} points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={2} />);
        }
        pts.forEach((p, i) => body.push(<circle key={`p${si}-${i}`} cx={p[0]} cy={p[1]} r={s.type === 'Scatter' ? 3.5 : 2.5} fill={color} />));
        vs.forEach((v, ci) => { if (v !== null && top[ci] !== null) dataLabel(`d${si}-${ci}`, x(ci), toPx(top[ci]!) - 6, s.values[ci] ?? v, si); });
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
          <rect width={9} height={9} fill={pal[i % pal.length]} />
          <text x={13} y={8} {...font}>{l.length > (legendW - 16) / 5.5 ? `${l.slice(0, Math.max(1, Math.floor((legendW - 16) / 5.5) - 1))}…` : l}</text>
        </g>
      ))}
      {chart.sample && <text x={W - 4} y={H - 4} textAnchor="end" {...font} fontSize={9} fill="#999">{l10n.t('Sample values')}</text>}
    </svg>
  );
}
