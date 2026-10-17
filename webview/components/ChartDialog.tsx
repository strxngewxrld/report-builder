import { useState } from 'react';
import { Dialog, useEditor } from '../editor';
import { validateExpression } from '../expr';
import { RawItem, uniqueName } from '../model';
import { locate, rawItem, sectionOf } from '../ops';
import { CHART_KINDS, ChartKind, ChartSpec, PALETTES, chartXml, patchChart, readChart } from '../charts';
import { ActionButton, Codicon } from './Icon';
import { ExpressionInput } from './ExpressionInput';

/** Insert / edit a chart: type, category (x axis), series with their values, title, legend, palette. */
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
    series: [{ name: 'Wert', value: '' }], title: '', legend: true, palette: 'BrightPastel',
  });
  const set = (p: Partial<ChartSpec>) => setSpec({ ...spec, ...p });
  const fields = ed.report.dataSets.find(x => x.name === spec.dataSetName)?.fields ?? [];
  const pie = spec.kind === 'Pie' || spec.kind === 'Doughnut';
  const error = !/^[A-Za-z_]\w*$/.test(spec.name) ? 'Ungültiger Name'
    : !existing && locate(ed.report, spec.name) ? `„${spec.name}“ ist schon vergeben`
    : !spec.dataSetName ? 'Dataset wählen'
    : !spec.series.length || spec.series.some(s => !s.value.trim()) ? 'Jede Reihe braucht einen Wert (z. B. =Sum(Fields!Betrag.Value))'
    : [spec.category, ...spec.series.map(s => s.value)].map(e => (e.trim().startsWith('=') ? validateExpression(e) : null)).find(Boolean) ?? null;

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
    <select className="field-pick" value="" title="Feld wählen" onChange={e => e.target.value && onPick(aggregate ? `=Sum(Fields!${e.target.value}.Value)` : `=Fields!${e.target.value}.Value`)}>
      <option value="">Feld…</option>
      {fields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
    </select>
  );

  return (
    <Modal title={existing ? `Diagrammeigenschaften – ${existing.name}` : 'Diagramm einfügen'} onOk={ok} onCancel={close} error={error} wide okLabel={existing ? 'OK' : 'Einfügen'}>
      <div className="chart-kinds" role="radiogroup" aria-label="Diagrammtyp">
        {CHART_KINDS.map(([k, label, icon]) => (
          <button key={k} role="radio" aria-checked={spec.kind === k} className={`chart-kind ${spec.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k as ChartKind })}>
            <Codicon name={icon} /><span>{label}</span>
          </button>
        ))}
      </div>
      <Field label="Name"><input value={spec.name} disabled={!!existing} onChange={e => set({ name: e.target.value })} /></Field>
      <Field label="Dataset">
        <select value={spec.dataSetName} onChange={e => set({ dataSetName: e.target.value })}>
          {ed.report.dataSets.map(x => <option key={x.name}>{x.name}</option>)}
        </select>
      </Field>
      <div className="form-row"><span>{pie ? 'Segmente' : 'Kategorie (x-Achse)'}</span>
        <span className="expr-prop">
          <ExpressionInput value={spec.category} onChange={v => set({ category: v })} dataSetName={spec.dataSetName} placeholder="leer = eine Kategorie, z. B. =Fields!Region.Value" />
          {fieldPick(v => set({ category: v }), false)}
        </span>
      </div>
      <div className="form-row"><span>{pie ? 'Wert' : 'Reihen'}</span>
        <div className="list-editor">
          {(pie ? spec.series.slice(0, 1) : spec.series).map((s, i) => (
            <div key={i} className="list-row">
              <input className="series-name" value={s.name} placeholder="Name" onChange={e => set({ series: spec.series.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <span className="expr-prop">
                <ExpressionInput value={s.value} onChange={v => set({ series: spec.series.map((x, j) => (j === i ? { ...x, value: v } : x)) })} dataSetName={spec.dataSetName} placeholder="=Sum(Fields!…Value)" />
                {fieldPick(v => set({ series: spec.series.map((x, j) => (j === i ? { ...x, value: v } : x)) }), true)}
              </span>
              <ActionButton icon="trash" title="Reihe entfernen" disabled={spec.series.length <= 1} onClick={() => set({ series: spec.series.filter((_, j) => j !== i) })} />
            </div>
          ))}
          {!pie && <button className="secondary small" onClick={() => set({ series: [...spec.series, { name: `Reihe${spec.series.length + 1}`, value: '' }] })}><Codicon name="add" /> Reihe</button>}
        </div>
      </div>
      <Field label="Titel"><input value={spec.title} onChange={e => set({ title: e.target.value })} placeholder="optional" /></Field>
      <Field label="Darstellung">
        <span className="list-row">
          <label className="check"><input type="checkbox" checked={spec.legend} onChange={e => set({ legend: e.target.checked })} /> Legende</label>
          <select value={spec.palette} onChange={e => set({ palette: e.target.value })} title="Farbpalette">{PALETTES.map(p => <option key={p}>{p}</option>)}</select>
        </span>
      </Field>
      {existing && <div className="prop-note">Geändert werden nur Typ, Kategorie, Reihen, Titel, Legende und Palette – Achsen, Formatierung und alles Weitere bleiben wie im Layout.</div>}
    </Modal>
  );
}
