// SVG rendering of a gauge from the render engine: a radial gauge (240° arc with ranges, ticks and needle) or a
// linear gauge (bar with ranges and a marker); the value below it.

import type { CSSProperties } from 'react';
import { formatValue } from '../expr';
import { RGauge } from './types';

export function GaugeView({ gauge, S, style }: { gauge: RGauge; S: number; style: CSSProperties }) {
  const W = gauge.width * S, H = gauge.height * S;
  const { min, max } = gauge;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const frac = (v: number) => (clamp(v) - min) / (max - min);
  const font = { fontFamily: 'Arial, Helvetica, sans-serif', fill: '#333' };
  const label = gauge.value === null ? '–' : gauge.format ? formatValue(gauge.value, gauge.format) : gauge.value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const ticks = Array.from({ length: 6 }, (_, i) => min + ((max - min) * i) / 5);
  const tickLabel = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 1 });

  let body: JSX.Element;
  if (gauge.shape === 'radial') {
    const r = Math.max(8, Math.min(W / 2, H * 0.62) - 10);
    const cx = W / 2, cy = Math.min(H - 18, r + 10);
    // 240° arc from lower left (210°) clockwise to lower right (-30°)
    const angle = (v: number) => ((210 - 240 * frac(v)) * Math.PI) / 180;
    const at = (a: number, rr: number) => [cx + rr * Math.cos(a), cy - rr * Math.sin(a)] as const;
    const arc = (from: number, to: number, rr: number, w: number, color: string, key: string) => {
      const [a0, a1] = [angle(from), angle(to)];
      const large = Math.abs(a0 - a1) > Math.PI ? 1 : 0;
      const p0 = at(a0, rr), p1 = at(a1, rr);
      return <path key={key} d={`M${p0[0]},${p0[1]}A${rr},${rr} 0 ${large} 1 ${p1[0]},${p1[1]}`} fill="none" stroke={color} strokeWidth={w} />;
    };
    const needle = gauge.value === null ? null : at(angle(gauge.value), r * 0.82);
    body = <>
      {arc(min, max, r, 2, '#999', 'scale')}
      {gauge.ranges.map((x, i) => arc(Math.min(x.start, x.end), Math.max(x.start, x.end), r - 6, 8, x.color, `r${i}`))}
      {ticks.map((v, i) => {
        const [x0, y0] = at(angle(v), r), [x1, y1] = at(angle(v), r - 5), [tx, ty] = at(angle(v), r - 16);
        return <g key={`t${i}`}><line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#666" /><text x={tx} y={ty + 3} textAnchor="middle" {...font} fontSize={8}>{tickLabel(v)}</text></g>;
      })}
      {needle && <line x1={cx} y1={cy} x2={needle[0]} y2={needle[1]} stroke="#c00000" strokeWidth={2.5} strokeLinecap="round" />}
      <circle cx={cx} cy={cy} r={4} fill="#444" />
      <text x={cx} y={Math.min(H - 4, cy + r * 0.45)} textAnchor="middle" {...font} fontSize={12} fontWeight="bold">{label}</text>
    </>;
  } else {
    const x0 = 12, x1 = W - 12, y = H / 2 - 6, h = Math.min(16, H / 4);
    const px = (v: number) => x0 + (x1 - x0) * frac(v);
    body = <>
      <rect x={x0} y={y} width={x1 - x0} height={h} fill="#eee" stroke="#999" />
      {gauge.ranges.map((x, i) => <rect key={`r${i}`} x={px(Math.min(x.start, x.end))} y={y} width={Math.abs(px(x.end) - px(x.start))} height={h} fill={x.color} />)}
      {gauge.value !== null && <rect x={x0} y={y + h * 0.3} width={px(gauge.value) - x0} height={h * 0.4} fill="#418CF0" />}
      {gauge.value !== null && <path d={`M${px(gauge.value)},${y - 2}l-5,-7h10z`} fill="#c00000" />}
      {ticks.map((v, i) => <g key={`t${i}`}><line x1={px(v)} y1={y + h} x2={px(v)} y2={y + h + 4} stroke="#666" /><text x={px(v)} y={y + h + 13} textAnchor="middle" {...font} fontSize={8}>{tickLabel(v)}</text></g>)}
      <text x={W / 2} y={Math.max(12, y - 12)} textAnchor="middle" {...font} fontSize={12} fontWeight="bold">{label}</text>
    </>;
  }
  return (
    <svg width={W} height={H} style={style} viewBox={`0 0 ${W} ${H}`}>
      <rect width={W} height={H} fill="white" />
      {body}
      {gauge.sample && <text x={W - 4} y={H - 4} textAnchor="end" {...font} fontSize={9} fill="#999">Beispielwert</text>}
    </svg>
  );
}
