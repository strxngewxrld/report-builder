import { useState } from 'react';
import { Dialog, useEditor } from '../editor';
import { validateExpression } from '../expr';
import { RawItem, uniqueName } from '../model';
import { locate, rawItem, sectionOf } from '../ops';
import {
  chartKinds, ChartAxisSpec, ChartKind, ChartSpec, MARKERS, PALETTES, SERIES_KINDS, TrendFormula, chartXml, emptyAxis, isCartesian, isPolar, isRange,
  isShape, patchChart, readChart, trendFormulas,
} from '../charts';
import { ActionButton, Codicon } from './Icon';
import { ExpressionInput } from './ExpressionInput';
import { l10n } from '../l10n';

/**
 * Insert / edit a chart: type, category (x axis), series with their values (high/low for range charts), colors and
 * markers of their data points, calculated series (moving average, mean, …), title, legend, palette, axes.
 */
export function ChartDialog({ d, close, Modal, Field }: {
  d: Extract<Dialog, { kind: 'chart' }>; close: () => void;
  Modal: (p: { title: string; children: React.ReactNode; onOk?: () => void; onCancel: () => void; okLabel?: string; error?: string | null; wide?: boolean }) => JSX.Element;
  Field: (p: { label: string; children: React.ReactNode }) => JSX.Element;
}) {
  const ed = useEditor();
  const existing = d.name ? locate(ed.report, d.name)?.item as RawItem | undefined : undefined;
  const initial = existing ? readChart(existing.xml) : null;
  const ds0 = ed.report.dataSets.find(x => x.name === 'DataSet_Result') ?? ed.report.dataSets[0];
  const [spec, setSpec] = useState<ChartSpec>(initial ?? {
    name: uniqueName(ed.report, 'Chart'), dataSetName: ds0?.name ?? '', kind: 'Column', category: '',
    series: [{ name: l10n.t('Value'), value: '' }], title: '', legend: true, palette: 'BrightPastel',
    dataLabels: false, categoryAxis: emptyAxis(), valueAxis: emptyAxis(), secondaryAxis: emptyAxis(),
  });
  const set = (p: Partial<ChartSpec>) => setSpec({ ...spec, ...p });
  const fields = ed.report.dataSets.find(x => x.name === spec.dataSetName)?.fields ?? [];
  const pie = isShape(spec.kind);
  const horizontal = spec.kind === 'Bar' || spec.kind === 'StackedBar' || spec.kind === 'RangeBar';
  const cartesian = isCartesian(spec.kind);
  const kindOf = (s: ChartSpec['series'][number]) => s.kind ?? spec.kind;
  const withMarkers = (k: ChartKind) => ['Line', 'SmoothLine', 'Scatter', 'Area', 'StackedArea', 'Polar', 'Radar'].includes(k);
  const bound = (v: string) => v === '' || v.startsWith('=') || Number.isFinite(Number(v.replace(',', '.')));
  const axes = [spec.valueAxis, spec.secondaryAxis];
  const error = !/^[A-Za-z_]\w*$/.test(spec.name) ? l10n.t('Invalid name')
    : !existing && locate(ed.report, spec.name) ? l10n.t('"{0}" is taken already', spec.name)
    : !spec.dataSetName ? l10n.t('Choose a dataset')
    : !spec.series.length || spec.series.some(s => !s.value.trim()) ? l10n.t('Every series needs a value (e.g. =Sum(Fields!Amount.Value))')
    : spec.series.some(s => isRange(kindOf(s)) && !s.low?.trim()) ? l10n.t('Range charts need a low and a high value')
    : spec.series.some(s => s.trend && !(s.trend.period >= 1)) ? l10n.t('The period of a moving average is a whole number from 1')
    : axes.some(a => !bound(a.min) || !bound(a.max)) ? l10n.t('Minimum/maximum: a number, =expression or empty (automatic)')
    : [spec.category, ...spec.series.flatMap(s => [s.value, s.low ?? '', s.color ?? ''])].map(e => (e.trim().startsWith('=') ? validateExpression(e) : null)).find(Boolean) ?? null;
  const setSeries = (i: number, p: Partial<ChartSpec['series'][number]>) => set({ series: spec.series.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const axisFields = (label: string, a: ChartAxisSpec, key: 'categoryAxis' | 'valueAxis' | 'secondaryAxis', values: boolean) => (
    <div className="form-row"><span>{label}</span>
      <div className="list-editor">
        <div className="list-row">
          <input value={a.title} placeholder={l10n.t('Title (optional)')} onChange={e => set({ [key]: { ...a, title: e.target.value } })} />
          {values && <input className="axis-format" value={a.format} placeholder={l10n.t('Format (N0, P0 …)')} title={l10n.t('Number format of the axis labels')} onChange={e => set({ [key]: { ...a, format: e.target.value } })} />}
        </div>
        {values && (
          <div className="list-row">
            <input value={a.min} placeholder={l10n.t('Minimum (automatic)')} onChange={e => set({ [key]: { ...a, min: e.target.value.replace(',', '.') } })} />
            <input value={a.max} placeholder={l10n.t('Maximum (automatic)')} onChange={e => set({ [key]: { ...a, max: e.target.value.replace(',', '.') } })} />
          </div>
        )}
      </div>
    </div>
  );

  const ok = () => {
    ed.commit(r => {
      if (existing) {
        const it = locate(r, existing.name)!.item as RawItem;
        const next = patchChart(it.xml, spec);
        if (next === it.xml) return false;
        it.xml = next;
        return;
      }
      const box = { top: d.create?.top ?? 0.25, left: d.create?.left ?? 0.25, width: 4, height: 2.5 };
      sectionOf(r, d.create?.section ?? 'body').items.push(rawItem('Chart', spec.name, chartXml(spec, box), box));
    });
    if (!existing) ed.select([spec.name]);
    close();
  };
  const fieldPick = (onPick: (f: string) => void, aggregate: boolean) => (
    <select className="field-pick" value="" title={l10n.t('Choose a field')} onChange={e => e.target.value && onPick(aggregate ? `=Sum(Fields!${e.target.value}.Value)` : `=Fields!${e.target.value}.Value`)}>
      <option value="">{l10n.t('Field…')}</option>
      {fields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
    </select>
  );

  return (
    <Modal title={existing ? l10n.t('Chart Properties – {0}', existing.name) : l10n.t('Insert Chart')} onOk={ok} onCancel={close} error={error} wide okLabel={existing ? 'OK' : l10n.t('Insert')}>
      <div className="chart-kinds" role="radiogroup" aria-label={l10n.t('Chart type')}>
        {chartKinds().map(([k, label, icon]) => (
          <button key={k} role="radio" aria-checked={spec.kind === k} className={`chart-kind ${spec.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k as ChartKind })}>
            <Codicon name={icon} /><span>{label}</span>
          </button>
        ))}
      </div>
      <Field label={l10n.t('Name')}><input value={spec.name} disabled={!!existing} onChange={e => set({ name: e.target.value })} /></Field>
      <Field label={l10n.t('Dataset')}>
        <select value={spec.dataSetName} onChange={e => set({ dataSetName: e.target.value })}>
          {ed.report.dataSets.map(x => <option key={x.name}>{x.name}</option>)}
        </select>
      </Field>
      <div className="form-row"><span>{pie ? l10n.t('Segments') : l10n.t('Category (x axis)')}</span>
        <span className="expr-prop">
          <ExpressionInput value={spec.category} onChange={v => set({ category: v })} dataSetName={spec.dataSetName} placeholder={l10n.t('empty = one category, e.g. =Fields!Region.Value')} />
          {fieldPick(v => set({ category: v }), false)}
        </span>
      </div>
      <div className="form-row"><span>{pie ? l10n.t('Value') : l10n.t('Series')}</span>
        <div className="list-editor">
          {(pie ? spec.series.slice(0, 1) : spec.series).map((s, i) => (
            <div key={i} className="list-row">
              <input className="series-name" value={s.name} placeholder={l10n.t('Name')} onChange={e => setSeries(i, { name: e.target.value })} />
              <span className="expr-prop">
                <ExpressionInput value={s.value} onChange={v => set({ series: spec.series.map((x, j) => (j === i ? { ...x, value: v } : x)) })} dataSetName={spec.dataSetName} placeholder="=Sum(Fields!…Value)" />
                {fieldPick(v => set({ series: spec.series.map((x, j) => (j === i ? { ...x, value: v } : x)) }), true)}
              </span>
              {cartesian && !horizontal && !isRange(spec.kind) && <>
                <select value={s.kind ?? ''} title={l10n.t('Type of this series (combined chart)')} onChange={e => setSeries(i, { kind: (e.target.value || undefined) as ChartKind | undefined })}>
                  <option value="">{l10n.t('as chart')}</option>
                  {SERIES_KINDS.map(k => <option key={k} value={k}>{chartKinds().find(c => c[0] === k)![1]}</option>)}
                </select>
                <label className="check" title={l10n.t('Plot on the secondary value axis (right)')}><input type="checkbox" checked={!!s.secondary} onChange={e => setSeries(i, { secondary: e.target.checked || undefined })} /> {l10n.t('right')}</label>
              </>}
              <ActionButton icon="trash" title={l10n.t('Remove Series')} disabled={spec.series.length <= 1} onClick={() => set({ series: spec.series.filter((_, j) => j !== i) })} />
            </div>
          )).flatMap((row, i) => {
            const s = spec.series[i];
            const k = kindOf(s);
            // second line per series: low value (range), color of the points, marker, calculated series
            return [row, (
              <div key={`x${i}`} className="list-row series-extra">
                {isRange(k) && (
                  <span className="expr-prop" title={l10n.t('Low value of each point (the value above is the high value)')}>
                    <ExpressionInput value={s.low ?? ''} onChange={v => setSeries(i, { low: v })} dataSetName={spec.dataSetName} placeholder={l10n.t('Low value, e.g. =Min(Fields!…Value)')} />
                    {fieldPick(v => setSeries(i, { low: v }), true)}
                  </span>
                )}
                <span className="expr-prop" title={l10n.t('Color of the data points: a color name, #RRGGBB or an expression per point')}>
                  <ExpressionInput value={s.color ?? ''} onChange={v => setSeries(i, { color: v || undefined })} dataSetName={spec.dataSetName} placeholder={l10n.t('Color (palette), e.g. =IIf(Fields!…Value < 0, "Red", "Green")')} />
                </span>
                {withMarkers(k) && (
                  <select value={s.marker ?? ''} title={l10n.t('Marker of the data points')} onChange={e => setSeries(i, { marker: e.target.value || undefined })}>
                    <option value="">{l10n.t('Marker: automatic')}</option>
                    {MARKERS.map(m => <option key={m} value={m}>{m === 'None' ? l10n.t('no marker') : m}</option>)}
                  </select>
                )}
                {cartesian && !horizontal && (
                  <select value={s.trend?.formula ?? ''} title={l10n.t('Calculated series derived from this series (shown as a dashed line)')}
                    onChange={e => setSeries(i, { trend: e.target.value ? { formula: e.target.value as TrendFormula, period: s.trend?.period ?? 2 } : undefined })}>
                    <option value="">{l10n.t('No calculated series')}</option>
                    {trendFormulas().map(([f, label]) => <option key={f} value={f}>{label}</option>)}
                  </select>
                )}
                {s.trend && s.trend.formula.endsWith('MovingAverage') && (
                  <input className="axis-format" type="number" min={1} step={1} value={s.trend.period} title={l10n.t('Period: number of points averaged')}
                    onChange={e => setSeries(i, { trend: { ...s.trend!, period: Math.round(Number(e.target.value)) } })} />
                )}
              </div>
            )];
          })}
          {!pie && <button className="secondary small" onClick={() => set({ series: [...spec.series, { name: l10n.t('Series{0}', spec.series.length + 1), value: '' }] })}><Codicon name="add" /> {l10n.t('Series')}</button>}
        </div>
      </div>
      <Field label={l10n.t('Title')}><input value={spec.title} onChange={e => set({ title: e.target.value })} placeholder={l10n.t('optional')} /></Field>
      <Field label={l10n.t('Appearance')}>
        <span className="list-row">
          <label className="check"><input type="checkbox" checked={spec.legend} onChange={e => set({ legend: e.target.checked })} /> {l10n.t('Legend')}</label>
          <label className="check"><input type="checkbox" checked={spec.dataLabels} onChange={e => set({ dataLabels: e.target.checked })} /> {l10n.t('Data labels')}</label>
          <select value={spec.palette} onChange={e => set({ palette: e.target.value })} title={l10n.t('Color palette')}>{PALETTES.map(p => <option key={p}>{p}</option>)}</select>
        </span>
      </Field>
      {cartesian && <>
        {axisFields(horizontal ? l10n.t('Category axis (y)') : l10n.t('Category axis (x)'), spec.categoryAxis, 'categoryAxis', false)}
        {axisFields(horizontal ? l10n.t('Value axis (x)') : l10n.t('Value axis (y)'), spec.valueAxis, 'valueAxis', true)}
        {spec.series.some(x => x.secondary) && !horizontal && axisFields(l10n.t('Secondary value axis (right)'), spec.secondaryAxis, 'secondaryAxis', true)}
      </>}
      {isPolar(spec.kind) && axisFields(l10n.t('Value axis (radius)'), spec.valueAxis, 'valueAxis', true)}
      {existing && <div className="prop-note">{l10n.t('Only what is set here changes – further formatting of the chart stays as in the layout.')}</div>}
    </Modal>
  );
}
