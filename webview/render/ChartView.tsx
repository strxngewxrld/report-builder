// SVG rendering of a chart from the render engine (column, bar, line, area, scatter – also mixed and stacked –, pie
// and doughnut). Sizes come from the report item; colors from the report's palette.

import type { CSSProperties } from 'react';
import { RChart } from './types';

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
    const stacked = chart.series.some(s => s.stacked);
    const n = chart.categories.length || 1;
    const sums = chart.categories.map((_, ci) => chart.series.reduce((a, s) => a + Math.max(0, s.values[ci] ?? 0), 0));
    const all = stacked ? [...sums, 0] : [0, ...chart.series.flatMap(s => s.values.filter((v): v is number => v !== null))];
    const { lo, hi, step } = axis(Math.min(...all), Math.max(...all));
    const labelW = Math.min(plot.w * 0.3, 8 + Math.max(...[lo, hi].map(v => fmt(v).length)) * 6);
    const area = { x: plot.x + (horizontal ? Math.min(plot.w * 0.3, 6 + Math.max(...chart.categories.map(c => c.length)) * 5.5) : labelW), y: plot.y, w: 0, h: 0 };
    area.w = plot.x + plot.w - area.x;
    area.h = plot.h - 16;
    const val = (v: number) => (horizontal ? area.x + ((v - lo) / (hi - lo)) * area.w : area.y + area.h - ((v - lo) / (hi - lo)) * area.h);
    const band = (horizontal ? area.h : area.w) / n;
    // gridlines and value labels
    for (let v = lo; v <= hi + step / 2; v += step) {
      const p = val(v);
      body.push(horizontal
        ? <g key={`g${v}`}><line x1={p} x2={p} y1={area.y} y2={area.y + area.h} stroke="#e0e0e0" /><text x={p} y={area.y + area.h + 11} textAnchor="middle" {...font}>{fmt(v)}</text></g>
        : <g key={`g${v}`}><line x1={area.x} x2={area.x + area.w} y1={p} y2={p} stroke="#e0e0e0" /><text x={area.x - 4} y={p + 3} textAnchor="end" {...font}>{fmt(v)}</text></g>);
    }
    chart.categories.forEach((c, ci) => {
      const mid = (horizontal ? area.y : area.x) + band * (ci + 0.5);
      body.push(horizontal
        ? <text key={`c${ci}`} x={area.x - 4} y={mid + 3} textAnchor="end" {...font}>{c}</text>
        : <text key={`c${ci}`} x={mid} y={area.y + area.h + 12} textAnchor="middle" {...font}>{c.length > band / 5.5 ? `${c.slice(0, Math.max(1, Math.floor(band / 5.5) - 1))}…` : c}</text>);
    });
    const barSeries = chart.series.filter(s => s.type === 'Column' || s.type === 'Bar');
    const bw = band * 0.7 / (stacked ? 1 : Math.max(1, barSeries.length));
    const stackBase = chart.categories.map(() => 0);
    chart.series.forEach((s, si) => {
      const color = pal[si % pal.length];
      if (s.type === 'Column' || s.type === 'Bar') {
        const k = barSeries.indexOf(s);
        s.values.forEach((v, ci) => {
          if (v === null) return;
          const from = stacked ? stackBase[ci] : 0;
          const to = from + v;
          if (stacked) stackBase[ci] = to;
          const start = (horizontal ? area.y : area.x) + band * ci + band * 0.15 + (stacked ? 0 : k * bw);
          const a = val(from), b = val(to);
          body.push(horizontal
            ? <rect key={`b${si}-${ci}`} x={Math.min(a, b)} y={start} width={Math.abs(b - a)} height={bw} fill={color}><title>{`${s.name} – ${chart.categories[ci]}: ${fmt(v)}`}</title></rect>
            : <rect key={`b${si}-${ci}`} x={start} y={Math.min(a, b)} width={bw} height={Math.abs(b - a)} fill={color}><title>{`${s.name} – ${chart.categories[ci]}: ${fmt(v)}`}</title></rect>);
        });
      } else {
        const pts = s.values.map((v, ci) => (v === null ? null : [area.x + band * (ci + 0.5), val(v)] as const)).filter((p): p is readonly [number, number] => !!p);
        if (!pts.length) return;
        if (s.type === 'Area') {
          body.push(<path key={`a${si}`} d={`M${pts[0][0]},${val(Math.max(lo, 0))}${pts.map(p => `L${p[0]},${p[1]}`).join('')}L${pts[pts.length - 1][0]},${val(Math.max(lo, 0))}Z`} fill={color} opacity={0.6} />);
        }
        if (s.type !== 'Scatter') body.push(<polyline key={`l${si}`} points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth={2} />);
        pts.forEach((p, i) => body.push(<circle key={`p${si}-${i}`} cx={p[0]} cy={p[1]} r={s.type === 'Scatter' ? 3.5 : 2.5} fill={color} />));
      }
    });
    body.unshift(<rect key="frame" x={area.x} y={area.y} width={area.w} height={area.h} fill="none" stroke="#bbb" />);
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
      {chart.sample && <text x={W - 4} y={H - 4} textAnchor="end" {...font} fontSize={9} fill="#999">Beispielwerte</text>}
    </svg>
  );
}
