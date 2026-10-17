import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useEditor } from '../editor';
import { validateExpression } from '../expr';
import { ImageItem, Report, ReportItem, RowMember, StyleKey, TableItem, TextboxItem } from '../model';
import { locate, rename, tableHeight, tableWidth, toggleTableRow } from '../ops';
import { toHex } from '../styleCss';
import { fromUnit, toUnit } from '../units';
import { ActionButton, Codicon } from './Icon';
import { ExpressionInput } from './ExpressionInput';
import { RichTextEditor } from './RichTextEditor';
import { hiddenOf, printsOn, setHidden, setPrintsOn, setToggleItem, setUserSort, toggleItemOf, userSortOf } from '../layoutTools';
import { allReportItems } from '../model';
import { leafOfRow, memberProp, setMemberProp } from '../tablix';
import { post } from '../vscode';

export const FONTS = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Segoe UI Light', 'Segoe UI Semibold', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
export const FONT_SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '36pt'];
export const FORMATS: [string, string][] = [
  ['', 'Standard'], ['N0', 'Zahl (0)'], ['N2', 'Zahl (0,00)'], ['C', 'Währung'], ['P0', 'Prozent'], ['P2', 'Prozent (0,00)'],
  ['d', 'Datum kurz'], ['D', 'Datum lang'], ['dd.MM.yyyy', 'TT.MM.JJJJ'], ['g', 'Datum + Uhrzeit'], ['t', 'Uhrzeit'],
];
const BORDER_STYLES = ['None', 'Solid', 'Dashed', 'Dotted', 'Double'];

/** Text input that commits on Enter/blur, so one edit is one undo step. */
export function PropText(props: {
  value: string; onCommit: (v: string) => void; placeholder?: string; invalid?: string | null; multiline?: boolean; readOnly?: boolean;
  /** Expression field: completion for Fields!, Parameters!, ReportItems!, Globals!, Code. and functions. */
  expression?: boolean; dataSetName?: string;
}) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => { if (v !== props.value) props.onCommit(v); };
  const common = {
    value: v,
    readOnly: props.readOnly,
    placeholder: props.placeholder,
    title: props.invalid ?? undefined,
    className: props.invalid ? 'invalid' : undefined,
    onBlur: commit,
  };
  if (props.expression) {
    return <ExpressionInput {...common} multiline={props.multiline} dataSetName={props.dataSetName} onChange={setV}
      onKeyDown={e => {
        if (e.key === 'Enter' && (!props.multiline || e.metaKey || e.ctrlKey)) commit();
        if (e.key === 'Escape') setV(props.value);
      }} />;
  }
  return props.multiline
    ? <textarea {...common} rows={2} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(); if (e.key === 'Escape') setV(props.value); }} />
    : <input {...common} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setV(props.value); }} />;
}

/** Size input in the report unit (in/cm); value and callback are in inches. */
export function PropSize({ value, onCommit, min = 0 }: { value: number; onCommit: (inches: number) => void; min?: number }) {
  const { report } = useEditor();
  const shown = String(toUnit(value, report.unit)).replace('.', ',');
  return (
    <span className="with-unit">
      <PropText value={shown} onCommit={s => {
        const n = parseFloat(s.replace(',', '.'));
        if (!Number.isNaN(n)) onCommit(Math.max(min, fromUnit(n, report.unit)));
      }} />
      <span className="unit">{report.unit}</span>
    </span>
  );
}

export function PropColor({ value, onCommit }: { value: string | undefined; onCommit: (v: string) => void }) {
  return (
    <span className="color-prop">
      <input type="color" value={toHex(value, '#ffffff')} onChange={e => onCommit(e.target.value)} />
      <PropText value={value ?? ''} placeholder="Automatisch" onCommit={onCommit} />
    </span>
  );
}

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="prop-row"><span className="prop-label">{label}</span><span className="prop-value">{children}</span></label>
);

const Category = ({ title, children }: { title: string; children: ReactNode }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="prop-cat">
      <div className="prop-cat-head" role="button" aria-expanded={open} tabIndex={0} onClick={() => setOpen(!open)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}>
        <Codicon name={open ? 'chevron-down' : 'chevron-right'} /> {title}
      </div>
      {open && <div className="prop-cat-body">{children}</div>}
    </div>
  );
};

/** Pane header like a VS Code view: uppercase title and a description. */
const PaneTitle = ({ description }: { description: string }) => (
  <div className="pane-header"><span className="pane-title">Eigenschaften</span><span className="pane-description" title={description}>{description}</span></div>
);

const TYPE_LABEL: Record<string, string> = {
  textbox: 'Textfeld', rectangle: 'Rechteck', line: 'Linie', image: 'Bild', table: 'Tabelle', raw: 'Nicht editierbares Element',
};

export function PropertiesPane({ width }: { width: number }) {
  const ed = useEditor();
  const { report, selection } = ed;
  const items = selection.map(n => locate(report, n)?.item).filter((x): x is ReportItem => !!x);

  /** Applies a mutation to every selected item (looked up again in the draft). */
  const update = (fn: (it: ReportItem, r: Report) => void) =>
    ed.commit(r => { for (const n of selection) { const loc = locate(r, n); if (loc) fn(loc.item, r); } });
  const setStyle = (key: StyleKey, value: string) => update(it => {
    if (value) it.style[key] = value;
    else delete it.style[key];
  });

  if (!items.length) return <div className="pane props-pane" style={{ width }}><PaneTitle description="Bericht" /><ReportProps /></div>;

  const first = items[0];
  const single = items.length === 1 ? first : null;
  const loc = single ? locate(report, single.name) : null;
  const style = first.style;
  const hasText = items.every(i => i.type === 'textbox');
  const positioned = !!loc?.container;

  return (
    <div className="pane props-pane" style={{ width }}>
      <PaneTitle description={single ? `${single.name} · ${loc?.cell ? 'Tabellenzelle' : TYPE_LABEL[single.type]}` : `${items.length} Elemente`} />
      <div className="props">
        {single && (
          <Category title="Allgemein">
            <Row label="Name">
              <PropText value={single.name} readOnly={single.type === 'raw'} onCommit={v => {
                let ok = false;
                ed.commit(r => (ok = rename(r, single.name, v)));
                if (ok) ed.select([v], ed.tablePart);
              }} />
            </Row>
            {single.type === 'textbox' && <TextboxProps tb={single} dataSetName={loc?.table?.dataSetName} />}
            {single.type === 'image' && <ImageProps img={single} update={update} />}
            {single.type === 'table' && <TableProps t={single} />}
            {single.type === 'raw' && single.kind === 'Chart' && (
              <Row label="Diagramm"><button className="secondary small" onClick={() => ed.setDialog({ kind: 'chart', name: single.name })}><Codicon name="graph" /> Eigenschaften…</button></Row>
            )}
            {single.type === 'raw' && single.kind !== 'Textbox' && single.kind !== 'Chart' && <div className="prop-note">Dieses {single.kind}-Element wird beim Speichern unverändert übernommen. Position und Inhalt lassen sich im XML bearbeiten.</div>}
          </Category>
        )}

        {single?.type === 'raw' && single.kind === 'Textbox' && (
          <Category title="Textteile">
            <RichTextEditor owner={single.name} name={single.name} />
          </Category>
        )}

        {single && single.type !== 'raw' && (
          <Category title="Sichtbarkeit">
            <Row label="Ausblenden">
              <span className="expr-prop">
                <PropText value={hiddenOf(single)} placeholder="leer = sichtbar, true oder =Ausdruck" expression
                  invalid={hiddenOf(single).startsWith('=') ? validateExpression(hiddenOf(single)) : null}
                  onCommit={v => ed.commit(r => setHidden(locate(r, single.name)!.item, v))} />
                <button className="fx action-item" title="Ausdruck bearbeiten…" onClick={() => ed.setDialog({
                  kind: 'expression', title: `Ausblenden von ${single.name}`, value: hiddenOf(single) || '=', dataSetName: loc?.table?.dataSetName,
                  onOk: v => ed.commit(r => setHidden(locate(r, single.name)!.item, v === '=' ? '' : v)),
                })}><Codicon name="symbol-operator" /></button>
              </span>
            </Row>
            <Row label="Umschalten durch">
              <ToggleSelect value={toggleItemOf(single)} exclude={single.name} onChange={v => ed.commit(r => setToggleItem(locate(r, single.name)!.item, v))} />
            </Row>
          </Category>
        )}

        {single && positioned && single.type !== 'raw' && (
          <Category title="Position">
            <Row label="Links"><PropSize value={single.left} onCommit={v => update(it => { it.left = v; })} /></Row>
            <Row label="Oben"><PropSize value={single.top} onCommit={v => update(it => { it.top = v; })} /></Row>
            {single.type !== 'table' && <>
              <Row label="Breite"><PropSize value={single.width} onCommit={v => update(it => { it.width = v; })} /></Row>
              <Row label="Höhe"><PropSize value={single.height} onCommit={v => update(it => { it.height = v; })} /></Row>
            </>}
            {single.type === 'table' && <div className="prop-note">Größe: {toUnit(tableWidth(single), report.unit)} × {toUnit(tableHeight(single), report.unit)} {report.unit} (aus Spalten und Zeilen)</div>}
          </Category>
        )}

        {hasText && (
          <Category title="Schriftart">
            <Row label="Schriftart">
              <select value={style.FontFamily ?? 'Arial'} onChange={e => setStyle('FontFamily', e.target.value)}>
                {[...new Set([style.FontFamily ?? 'Arial', ...FONTS])].map(f => <option key={f}>{f}</option>)}
              </select>
            </Row>
            <Row label="Größe"><PropText value={style.FontSize ?? '10pt'} onCommit={v => setStyle('FontSize', /^\d+(\.\d+)?$/.test(v) ? `${v}pt` : v)} /></Row>
            <Row label="Schnitt">
              <span className="toggle-group">
                <ActionButton icon="bold" title="Fett" checked={style.FontWeight === 'Bold'} onClick={() => setStyle('FontWeight', style.FontWeight === 'Bold' ? '' : 'Bold')} />
                <ActionButton icon="italic" title="Kursiv" checked={style.FontStyle === 'Italic'} onClick={() => setStyle('FontStyle', style.FontStyle === 'Italic' ? '' : 'Italic')} />
                <ActionButton icon="whole-word" title="Unterstrichen" checked={style.TextDecoration === 'Underline'} onClick={() => setStyle('TextDecoration', style.TextDecoration === 'Underline' ? '' : 'Underline')} />
              </span>
            </Row>
            <Row label="Farbe"><PropColor value={style.Color} onCommit={v => setStyle('Color', v)} /></Row>
          </Category>
        )}

        {hasText && (
          <Category title="Ausrichtung">
            <Row label="Horizontal">
              <select value={style.TextAlign ?? 'General'} onChange={e => setStyle('TextAlign', e.target.value === 'General' ? '' : e.target.value)}>
                <option value="General">Standard</option><option value="Left">Links</option><option value="Center">Zentriert</option><option value="Right">Rechts</option>
              </select>
            </Row>
            <Row label="Vertikal">
              <select value={style.VerticalAlign ?? 'Top'} onChange={e => setStyle('VerticalAlign', e.target.value === 'Top' ? '' : e.target.value)}>
                <option value="Top">Oben</option><option value="Middle">Mitte</option><option value="Bottom">Unten</option>
              </select>
            </Row>
            <Row label="Abstand">
              <PropText value={style.PaddingLeft ?? '0pt'} onCommit={v => update(it => {
                for (const k of ['PaddingLeft', 'PaddingRight', 'PaddingTop', 'PaddingBottom'] as StyleKey[]) {
                  if (v) it.style[k] = v;
                  else delete it.style[k];
                }
              })} />
            </Row>
          </Category>
        )}

        {hasText && (
          <Category title="Zahl">
            <Row label="Format">
              <select value={FORMATS.some(f => f[0] === (style.Format ?? '')) ? style.Format ?? '' : '*'} onChange={e => e.target.value !== '*' && setStyle('Format', e.target.value)}>
                {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {!FORMATS.some(f => f[0] === (style.Format ?? '')) && <option value="*">{style.Format}</option>}
              </select>
            </Row>
            <Row label="Formatcode"><PropText value={style.Format ?? ''} placeholder="z. B. #,##0.00" onCommit={v => setStyle('Format', v)} /></Row>
          </Category>
        )}

        {items.every(i => i.type !== 'raw') && (
          <Category title={first.type === 'line' ? 'Linie' : 'Füllung und Rahmen'}>
            {first.type !== 'line' && <Row label="Hintergrund"><PropColor value={style.BackgroundColor} onCommit={v => setStyle('BackgroundColor', v)} /></Row>}
            <Row label="Rahmenart">
              <select value={style.BorderStyle ?? (first.type === 'line' ? 'Solid' : 'None')} onChange={e => setStyle('BorderStyle', e.target.value)}>
                {BORDER_STYLES.map(b => <option key={b}>{b}</option>)}
              </select>
            </Row>
            <Row label="Rahmenfarbe"><PropColor value={style.BorderColor} onCommit={v => setStyle('BorderColor', v)} /></Row>
            <Row label="Rahmenbreite"><PropText value={style.BorderWidth ?? '1pt'} onCommit={v => setStyle('BorderWidth', v)} /></Row>
          </Category>
        )}
      </div>
    </div>
  );
}

function TextboxProps({ tb, dataSetName }: { tb: TextboxItem; dataSetName?: string }) {
  const ed = useEditor();
  const set = (fn: (t: TextboxItem) => void) => ed.commit(r => fn(locate(r, tb.name)!.item as TextboxItem));
  return (
    <>
      <Row label="Wert">
        <span className="expr-prop">
          <PropText value={tb.value} multiline expression dataSetName={dataSetName} invalid={validateExpression(tb.value)} onCommit={v => set(t => { t.value = v; })} />
          <button className="fx action-item" title="Ausdruck bearbeiten…" onClick={() => ed.setDialog({
            kind: 'expression', title: `Wert von ${tb.name}`, value: tb.value, dataSetName,
            onOk: v => set(t => { t.value = v; }),
          })}><Codicon name="symbol-operator" /></button>
        </span>
      </Row>
      <Row label="Interaktiv sortieren">
        <PropText value={userSortOf(tb)} placeholder="z. B. =Fields!Betrag.Value" expression dataSetName={dataSetName}
          onCommit={v => ed.commit(r => setUserSort(locate(r, tb.name)!.item, v))} />
      </Row>
      <Row label="Vergrößerbar">
        <input type="checkbox" checked={tb.canGrow} onChange={e => set(t => { t.canGrow = e.target.checked; })} />
      </Row>
    </>
  );
}

function ImageProps({ img, update }: { img: ImageItem; update: (fn: (it: ReportItem) => void) => void }) {
  const set = (fn: (i: ImageItem) => void) => update(it => fn(it as ImageItem));
  return (
    <>
      <Row label="Quelle">
        <select value={img.source} onChange={e => set(i => { i.source = e.target.value as ImageItem['source']; })}>
          <option value="External">Extern (URL)</option><option value="Embedded">Eingebettet</option><option value="Database">Datenbank</option>
        </select>
      </Row>
      <Row label={img.source === 'External' ? 'URL' : img.source === 'Embedded' ? 'Bildname' : 'Feld'}>
        <PropText value={img.value} placeholder={img.source === 'External' ? 'https://…' : ''} onCommit={v => set(i => { i.value = v; })} />
      </Row>
      <Row label="Größe">
        <select value={img.sizing} onChange={e => set(i => { i.sizing = e.target.value as ImageItem['sizing']; })}>
          <option value="AutoSize">Automatisch</option><option value="Fit">Anpassen</option>
          <option value="FitProportional">Proportional anpassen</option><option value="Clip">Abschneiden</option>
        </select>
      </Row>
    </>
  );
}

function TableProps({ t }: { t: TableItem }) {
  const ed = useEditor();
  const set = (fn: (tt: TableItem, r: Report) => void) => ed.commit(r => fn(locate(r, t.name)!.item as TableItem, r));
  const part = ed.tablePart?.table === t.name ? ed.tablePart : null;
  return (
    <>
      <Row label="Dataset">
        <select value={t.dataSetName} onChange={e => set(tt => { tt.dataSetName = e.target.value; })}>
          <option value="">(keines)</option>
          {ed.report.dataSets.map(d => <option key={d.id}>{d.name}</option>)}
        </select>
      </Row>
      <Row label="Kopfzeile"><input type="checkbox" checked={t.rows.some(r => r.kind === 'header')} onChange={() => set((tt, r) => toggleTableRow(r, tt, 'header'))} /></Row>
      <Row label="Fußzeile"><input type="checkbox" checked={t.rows.some(r => r.kind === 'footer')} onChange={() => set((tt, r) => toggleTableRow(r, tt, 'footer'))} /></Row>
      {part?.kind === 'column' && (
        <Row label={`Spalte ${part.index + 1}`}><PropSize value={t.columns[part.index]} min={0.1} onCommit={v => set(tt => { tt.columns[part.index] = v; })} /></Row>
      )}
      {part?.kind === 'row' && t.rows[part.index] && <RowProps t={t} index={part.index} />}
    </>
  );
}

export function ReportProps() {
  const ed = useEditor();
  const { report } = ed;
  const p = report.page;
  const page = (key: keyof Omit<typeof p, 'extra' | 'origin'>) => (v: number) => ed.commit(r => { r.page[key] = v; });
  return (
    <div className="props">
      <Category title="Bericht">
        <Row label="Maßeinheit">
          <select value={report.unit} onChange={e => ed.commit(r => { r.unit = e.target.value as 'in' | 'cm'; })}>
            <option value="cm">Zentimeter</option><option value="in">Zoll</option>
          </select>
        </Row>
        <Row label="Breite (Text)"><PropSize value={report.width} min={0.5} onCommit={v => ed.commit(r => { r.width = v; })} /></Row>
        <Row label="Höhe (Text)"><PropSize value={report.body.height} min={0.1} onCommit={v => ed.commit(r => { r.body.height = v; })} /></Row>
        <Row label="Seitenkopf"><input type="checkbox" checked={!!report.header} onChange={e => ed.commit(r => { r.header = e.target.checked ? { height: 1, items: [], style: {} } : null; })} /></Row>
        <Row label="Seitenfuß"><input type="checkbox" checked={!!report.footer} onChange={e => ed.commit(r => { r.footer = e.target.checked ? { height: 1, items: [], style: {} } : null; })} /></Row>
        <Row label="Code-Block">
          <button className="secondary small" title="Den <Code>-Block (Visual Basic) im Editor von VS Code bearbeiten"
            onClick={() => post({ type: 'run', command: 'bcReportBuilder.editCode' })}><Codicon name="code" /> Bearbeiten…</button>
        </Row>
      </Category>
      {(['header', 'footer'] as const).map(kind => report[kind] && (
        <Category key={kind} title={kind === 'header' ? 'Seitenkopf' : 'Seitenfuß'}>
          {(['First', 'Last'] as const).map(which => (
            <Row key={which} label={which === 'First' ? 'Auf erster Seite' : 'Auf letzter Seite'}>
              <input type="checkbox" checked={printsOn(report[kind]!, which)}
                onChange={e => ed.commit(r => setPrintsOn(r[kind]!, which, e.target.checked))} />
            </Row>
          ))}
        </Category>
      ))}
      <Category title="Seite">
        <Row label="Seitenbreite"><PropSize value={p.width} onCommit={page('width')} /></Row>
        <Row label="Seitenhöhe"><PropSize value={p.height} onCommit={page('height')} /></Row>
        <Row label="Rand oben"><PropSize value={p.marginTop} onCommit={page('marginTop')} /></Row>
        <Row label="Rand unten"><PropSize value={p.marginBottom} onCommit={page('marginBottom')} /></Row>
        <Row label="Rand links"><PropSize value={p.marginLeft} onCommit={page('marginLeft')} /></Row>
        <Row label="Rand rechts"><PropSize value={p.marginRight} onCommit={page('marginRight')} /></Row>
        {report.width + p.marginLeft + p.marginRight > p.width + 1e-6 && (
          <div className="prop-note warn">Textbreite + Ränder sind breiter als die Seite – beim Drucken entstehen leere Zusatzseiten.</div>
        )}
      </Category>
    </div>
  );
}

const ROW_KIND: Record<string, string> = { header: 'Tabellenkopf', footer: 'Tabellenfuß', groupHeader: 'Gruppenkopf', groupFooter: 'Gruppenfuß', detail: 'Details' };

/** A selected table row: height, repeat on each page, keep with group, visibility (properties of its TablixMember). */
function RowProps({ t, index }: { t: TableItem; index: number }) {
  const ed = useEditor();
  const row = t.rows[index];
  const leaf = leafOfRow(t, row.id)?.member;
  const setMember = (fn: (m: RowMember) => void) => ed.commit(r => {
    const tt = locate(r, t.name)!.item as TableItem;
    const m = leafOfRow(tt, tt.rows[index].id)?.member;
    if (!m) return false;
    fn(m);
  });
  const isStatic = !!leaf && !leaf.group;
  return (
    <>
      <div className="prop-note">Zeile {index + 1}: {ROW_KIND[row.kind]}</div>
      <Row label="Höhe"><PropSize value={row.height} min={0.1} onCommit={v => ed.commit(r => { (locate(r, t.name)!.item as TableItem).rows[index].height = v; })} /></Row>
      {leaf && isStatic && <>
        <Row label="Auf jeder Seite">
          <input type="checkbox" title="RepeatOnNewPage: auf jeder Seite wiederholen (z. B. Spaltenköpfe)" checked={memberProp(leaf, 'RepeatOnNewPage') === 'true'}
            onChange={e => setMember(m => setMemberProp(m, 'RepeatOnNewPage', e.target.checked ? 'true' : undefined))} />
        </Row>
        <Row label="Bei Gruppe halten">
          <select value={memberProp(leaf, 'KeepWithGroup') ?? ''} onChange={e => setMember(m => setMemberProp(m, 'KeepWithGroup', e.target.value || undefined))}>
            <option value="">Nein</option><option value="After">Mit folgender Gruppe</option><option value="Before">Mit vorheriger Gruppe</option>
          </select>
        </Row>
      </>}
      {leaf && <>
        <Row label="Ausblenden">
          <PropText value={hiddenOf(leaf)} placeholder="leer = sichtbar, true oder =Ausdruck" expression dataSetName={t.dataSetName}
            onCommit={v => setMember(m => setHidden(m, v))} />
        </Row>
        <Row label="Umschalten durch">
          <ToggleSelect value={toggleItemOf(leaf)} onChange={v => setMember(m => setToggleItem(m, v))} />
        </Row>
      </>}
    </>
  );
}

/** Textbox that toggles visibility (drilldown): any textbox of the report. */
export function ToggleSelect({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: string }) {
  const { report } = useEditor();
  const names = allReportItems(report).filter(i => i.type === 'textbox' && i.name !== exclude).map(i => i.name).sort();
  return (
    <select value={value} title="Ein Klick auf dieses Textfeld blendet das Element ein/aus (Drilldown)" onChange={e => onChange(e.target.value)}>
      <option value="">(keines)</option>
      {!names.includes(value) && value && <option value={value}>{value}</option>}
      {names.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}
