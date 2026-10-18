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
import { partsDiffer, toRichText, toSimpleText } from '../richtext';
import { embeddedImages } from '../images';
import {
  ItemAction, actionOf, bookmarkOf, hiddenOf, printsOn, setAction, setBookmark, setHidden, setPrintsOn, setToggleItem, setUserSort, toggleItemOf,
  userSortOf,
} from '../layoutTools';
import { allReportItems } from '../model';
import { columnLeaf, leafOfRow, memberProp, setMemberProp } from '../tablix';
import { post } from '../vscode';
import { l10n } from '../l10n';

export const FONTS = ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Segoe UI Light', 'Segoe UI Semibold', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
export const FONT_SIZES = ['8pt', '9pt', '10pt', '11pt', '12pt', '14pt', '16pt', '18pt', '20pt', '24pt', '28pt', '36pt'];
/** Number and date formats offered in lists (format code, translated label). */
export const formats = (): [string, string][] => [
  ['', l10n.t('Default')], ['N0', l10n.t('Number (0)')], ['N2', l10n.t('Number (0.00)')], ['C', l10n.t('Currency')], ['P0', l10n.t('Percent')],
  ['P2', l10n.t('Percent (0.00)')], ['d', l10n.t('Short date')], ['D', l10n.t('Long date')], ['dd.MM.yyyy', l10n.t('DD.MM.YYYY')],
  ['g', l10n.t('Date + time')], ['t', l10n.t('Time')],
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
  const shown = String(toUnit(value, report.unit)).replace('.', l10n.language.startsWith('de') ? ',' : '.');
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
      <PropText value={value ?? ''} placeholder={l10n.t('Automatic')} onCommit={onCommit} />
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
  <div className="pane-header"><span className="pane-title">{l10n.t('Properties')}</span><span className="pane-description" title={description}>{description}</span></div>
);

const typeLabel = (type: string): string => ({
  textbox: l10n.t('Textbox'), rectangle: l10n.t('Rectangle'), line: l10n.t('Line'), image: l10n.t('Image'), table: l10n.t('Table'), raw: l10n.t('Item that is not editable'),
} as Record<string, string>)[type] ?? type;

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

  if (!items.length) return <div className="pane props-pane" style={{ width }}><PaneTitle description={l10n.t('Report')} /><ReportProps /></div>;

  const first = items[0];
  const single = items.length === 1 ? first : null;
  const loc = single ? locate(report, single.name) : null;
  const style = first.style;
  const hasText = items.every(i => i.type === 'textbox');
  const positioned = !!loc?.container;

  return (
    <div className="pane props-pane" style={{ width }}>
      <PaneTitle description={single ? `${single.name} · ${loc?.cell ? l10n.t('Table cell') : single.type === 'raw' && single.kind === 'Chart' ? l10n.t('Chart') : single.type === 'raw' && single.kind === 'Textbox' ? l10n.t('Textbox') : typeLabel(single.type)}` : l10n.t('{0} items', items.length)} />
      <div className="props">
        {single && (
          <Category title={l10n.t('General')}>
            <Row label={l10n.t('Name')}>
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
              <Row label={l10n.t('Chart')}><button className="secondary small" onClick={() => ed.setDialog({ kind: 'chart', name: single.name })}><Codicon name="graph" /> {l10n.t('Properties…')}</button></Row>
            )}
            {single.type === 'raw' && single.kind !== 'Textbox' && single.kind !== 'Chart' && <div className="prop-note">{l10n.t('This {0} item is saved unchanged. Position and content can be edited in the XML.', single.kind)}</div>}
          </Category>
        )}

        {single?.type === 'raw' && single.kind === 'Textbox' && (
          <Category title={l10n.t('Text Parts')}>
            <RichTextEditor owner={single.name} name={single.name} />
            <Row label={l10n.t('Convert')}>
              <button className="secondary small" title={l10n.t('Join the text parts into one value (formatting of the first part)')}
                onClick={() => ed.commit(r => toSimpleText(r, single.name))}><Codicon name="whole-word" /> {l10n.t('To Simple Textbox')}</button>
            </Row>
            {partsDiffer(single) && <div className="prop-note">{l10n.t('When converting, the formatting of the first text part applies to the whole text.')}</div>}
          </Category>
        )}

        {single && single.type !== 'raw' && (
          <Category title={l10n.t('Visibility')}>
            <Row label={l10n.t('Hide')}>
              <span className="expr-prop">
                <PropText value={hiddenOf(single)} placeholder={l10n.t('empty = visible, true or =expression')} expression
                  invalid={hiddenOf(single).startsWith('=') ? validateExpression(hiddenOf(single)) : null}
                  onCommit={v => ed.commit(r => setHidden(locate(r, single.name)!.item, v))} />
                <button className="fx action-item" title={l10n.t('Edit Expression…')} onClick={() => ed.setDialog({
                  kind: 'expression', title: l10n.t('Hide {0}', single.name), value: hiddenOf(single) || '=', dataSetName: loc?.table?.dataSetName,
                  onOk: v => ed.commit(r => setHidden(locate(r, single.name)!.item, v === '=' ? '' : v)),
                })}><Codicon name="symbol-operator" /></button>
              </span>
            </Row>
            <Row label={l10n.t('Toggled by')}>
              <ToggleSelect value={toggleItemOf(single)} exclude={single.name} onChange={v => ed.commit(r => setToggleItem(locate(r, single.name)!.item, v))} />
            </Row>
          </Category>
        )}

        {single && (single.type === 'textbox' || single.type === 'image') && (
          <Category title={l10n.t('Action')}>
            <ActionProps item={single} dataSetName={loc?.table?.dataSetName} />
          </Category>
        )}

        {single && positioned && single.type !== 'raw' && (
          <Category title={l10n.t('Position')}>
            <Row label={l10n.t('Left')}><PropSize value={single.left} onCommit={v => update(it => { it.left = v; })} /></Row>
            <Row label={l10n.t('Top')}><PropSize value={single.top} onCommit={v => update(it => { it.top = v; })} /></Row>
            {single.type !== 'table' && <>
              <Row label={l10n.t('Width')}><PropSize value={single.width} onCommit={v => update(it => { it.width = v; })} /></Row>
              <Row label={l10n.t('Height')}><PropSize value={single.height} onCommit={v => update(it => { it.height = v; })} /></Row>
            </>}
            {single.type === 'table' && <div className="prop-note">{l10n.t('Size: {0} × {1} {2} (from columns and rows)', toUnit(tableWidth(single), report.unit), toUnit(tableHeight(single), report.unit), report.unit)}</div>}
          </Category>
        )}

        {hasText && (
          <Category title={l10n.t('Font')}>
            <Row label={l10n.t('Font')}>
              <select value={style.FontFamily ?? 'Arial'} onChange={e => setStyle('FontFamily', e.target.value)}>
                {[...new Set([style.FontFamily ?? 'Arial', ...FONTS])].map(f => <option key={f}>{f}</option>)}
              </select>
            </Row>
            <Row label={l10n.t('Size')}><PropText value={style.FontSize ?? '10pt'} onCommit={v => setStyle('FontSize', /^\d+(\.\d+)?$/.test(v) ? `${v}pt` : v)} /></Row>
            <Row label={l10n.t('Style')}>
              <span className="toggle-group">
                <ActionButton icon="bold" title={l10n.t('Bold')} checked={style.FontWeight === 'Bold'} onClick={() => setStyle('FontWeight', style.FontWeight === 'Bold' ? '' : 'Bold')} />
                <ActionButton icon="italic" title={l10n.t('Italic')} checked={style.FontStyle === 'Italic'} onClick={() => setStyle('FontStyle', style.FontStyle === 'Italic' ? '' : 'Italic')} />
                <ActionButton icon="whole-word" title={l10n.t('Underline')} checked={style.TextDecoration === 'Underline'} onClick={() => setStyle('TextDecoration', style.TextDecoration === 'Underline' ? '' : 'Underline')} />
              </span>
            </Row>
            <Row label={l10n.t('Color')}><PropColor value={style.Color} onCommit={v => setStyle('Color', v)} /></Row>
          </Category>
        )}

        {hasText && (
          <Category title={l10n.t('Alignment')}>
            <Row label={l10n.t('Horizontal')}>
              <select value={style.TextAlign ?? 'General'} onChange={e => setStyle('TextAlign', e.target.value === 'General' ? '' : e.target.value)}>
                <option value="General">{l10n.t('Default')}</option><option value="Left">{l10n.t('Left')}</option><option value="Center">{l10n.t('Center')}</option><option value="Right">{l10n.t('Right')}</option>
              </select>
            </Row>
            <Row label={l10n.t('Vertical')}>
              <select value={style.VerticalAlign ?? 'Top'} onChange={e => setStyle('VerticalAlign', e.target.value === 'Top' ? '' : e.target.value)}>
                <option value="Top">{l10n.t('Top')}</option><option value="Middle">{l10n.t('Middle')}</option><option value="Bottom">{l10n.t('Bottom')}</option>
              </select>
            </Row>
            <Row label={l10n.t('Padding')}>
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
          <Category title={l10n.t('Number')}>
            <Row label={l10n.t('Format')}>
              <select value={formats().some(f => f[0] === (style.Format ?? '')) ? style.Format ?? '' : '*'} onChange={e => e.target.value !== '*' && setStyle('Format', e.target.value)}>
                {formats().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                {!formats().some(f => f[0] === (style.Format ?? '')) && <option value="*">{style.Format}</option>}
              </select>
            </Row>
            <Row label={l10n.t('Format code')}><PropText value={style.Format ?? ''} placeholder={l10n.t('e.g. #,##0.00')} onCommit={v => setStyle('Format', v)} /></Row>
          </Category>
        )}

        {items.every(i => i.type !== 'raw') && (
          <Category title={first.type === 'line' ? l10n.t('Line') : l10n.t('Fill and Border')}>
            {first.type !== 'line' && <Row label={l10n.t('Background')}><PropColor value={style.BackgroundColor} onCommit={v => setStyle('BackgroundColor', v)} /></Row>}
            <Row label={l10n.t('Border style')}>
              <select value={style.BorderStyle ?? (first.type === 'line' ? 'Solid' : 'None')} onChange={e => setStyle('BorderStyle', e.target.value)}>
                {BORDER_STYLES.map(b => <option key={b}>{b}</option>)}
              </select>
            </Row>
            <Row label={l10n.t('Border color')}><PropColor value={style.BorderColor} onCommit={v => setStyle('BorderColor', v)} /></Row>
            <Row label={l10n.t('Border width')}><PropText value={style.BorderWidth ?? '1pt'} onCommit={v => setStyle('BorderWidth', v)} /></Row>
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
      <Row label={l10n.t('Value')}>
        <span className="expr-prop">
          <PropText value={tb.value} multiline expression dataSetName={dataSetName} invalid={validateExpression(tb.value)} onCommit={v => set(t => { t.value = v; })} />
          <button className="fx action-item" title={l10n.t('Edit Expression…')} onClick={() => ed.setDialog({
            kind: 'expression', title: l10n.t('Value of {0}', tb.name), value: tb.value, dataSetName,
            onOk: v => set(t => { t.value = v; }),
          })}><Codicon name="symbol-operator" /></button>
        </span>
      </Row>
      <Row label={l10n.t('Interactive sort')}>
        <PropText value={userSortOf(tb)} placeholder={l10n.t('e.g. =Fields!Amount.Value')} expression dataSetName={dataSetName}
          onCommit={v => ed.commit(r => setUserSort(locate(r, tb.name)!.item, v))} />
      </Row>
      <Row label={l10n.t('Can grow')}>
        <input type="checkbox" checked={tb.canGrow} onChange={e => set(t => { t.canGrow = e.target.checked; })} />
      </Row>
      <Row label={l10n.t('Text parts')}>
        <button className="secondary small" title={l10n.t('Split the value into parts that can be formatted separately (e.g. "Page " and a bold page number)')}
          onClick={() => ed.commit(r => toRichText(r, tb.name))}><Codicon name="symbol-text" /> {l10n.t('Split…')}</button>
      </Row>
    </>
  );
}

function ImageProps({ img, update }: { img: ImageItem; update: (fn: (it: ReportItem) => void) => void }) {
  const set = (fn: (i: ImageItem) => void) => update(it => fn(it as ImageItem));
  const images = embeddedImages(useEditor().report);
  return (
    <>
      <Row label={l10n.t('Source')}>
        <select value={img.source} onChange={e => set(i => { i.source = e.target.value as ImageItem['source']; })}>
          <option value="External">{l10n.t('External (URL)')}</option><option value="Embedded">{l10n.t('Embedded')}</option><option value="Database">{l10n.t('Database')}</option>
        </select>
      </Row>
      {img.source === 'Embedded' && !img.value.startsWith('=') ? (
        <Row label={l10n.t('Image')}>
          <select value={img.value} onChange={e => {
            if (e.target.value === '*add') post({ type: 'pickImage' });
            else set(i => { i.value = e.target.value; });
          }}>
            {!images.some(i => i.name === img.value) && <option value={img.value}>{img.value || l10n.t('(none)')}</option>}
            {images.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
            <option value="*add">{l10n.t('Embed Image…')}</option>
          </select>
        </Row>
      ) : (
        <Row label={img.source === 'External' ? 'URL' : img.source === 'Embedded' ? l10n.t('Image name') : l10n.t('Field')}>
          <PropText value={img.value} placeholder={img.source === 'External' ? 'https://…' : ''} onCommit={v => set(i => { i.value = v; })} />
        </Row>
      )}
      <Row label={l10n.t('Size')}>
        <select value={img.sizing} onChange={e => set(i => { i.sizing = e.target.value as ImageItem['sizing']; })}>
          <option value="AutoSize">{l10n.t('Automatic')}</option><option value="Fit">{l10n.t('Fit')}</option>
          <option value="FitProportional">{l10n.t('Fit proportionally')}</option><option value="Clip">{l10n.t('Clip')}</option>
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
      <Row label={l10n.t('Dataset')}>
        <select value={t.dataSetName} onChange={e => set(tt => { tt.dataSetName = e.target.value; })}>
          <option value="">{l10n.t('(none)')}</option>
          {ed.report.dataSets.map(d => <option key={d.id}>{d.name}</option>)}
        </select>
      </Row>
      <Row label={l10n.t('Header row')}><input type="checkbox" checked={t.rows.some(r => r.kind === 'header')} onChange={() => set((tt, r) => toggleTableRow(r, tt, 'header'))} /></Row>
      <Row label={l10n.t('Footer row')}><input type="checkbox" checked={t.rows.some(r => r.kind === 'footer')} onChange={() => set((tt, r) => toggleTableRow(r, tt, 'footer'))} /></Row>
      {part?.kind === 'column' && <ColumnProps t={t} index={part.index} />}
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
      <Category title={l10n.t('Report')}>
        <Row label={l10n.t('Unit of measurement')}>
          <select value={report.unit} onChange={e => ed.commit(r => { r.unit = e.target.value as 'in' | 'cm'; })}>
            <option value="cm">{l10n.t('Centimeters')}</option><option value="in">{l10n.t('Inches')}</option>
          </select>
        </Row>
        <Row label={l10n.t('Width (body)')}><PropSize value={report.width} min={0.5} onCommit={v => ed.commit(r => { r.width = v; })} /></Row>
        <Row label={l10n.t('Height (body)')}><PropSize value={report.body.height} min={0.1} onCommit={v => ed.commit(r => { r.body.height = v; })} /></Row>
        <Row label={l10n.t('Page header')}><input type="checkbox" checked={!!report.header} onChange={e => ed.commit(r => { r.header = e.target.checked ? { height: 1, items: [], style: {} } : null; })} /></Row>
        <Row label={l10n.t('Page footer')}><input type="checkbox" checked={!!report.footer} onChange={e => ed.commit(r => { r.footer = e.target.checked ? { height: 1, items: [], style: {} } : null; })} /></Row>
        <Row label={l10n.t('Code block')}>
          <button className="secondary small" title={l10n.t('Edit the <Code> block (Visual Basic) in VS Code\'s editor')}
            onClick={() => post({ type: 'run', command: 'bcReportBuilder.editCode' })}><Codicon name="code" /> {l10n.t('Edit…')}</button>
        </Row>
      </Category>
      {(['header', 'footer'] as const).map(kind => report[kind] && (
        <Category key={kind} title={kind === 'header' ? l10n.t('Page Header') : l10n.t('Page Footer')}>
          {(['First', 'Last'] as const).map(which => (
            <Row key={which} label={which === 'First' ? l10n.t('On first page') : l10n.t('On last page')}>
              <input type="checkbox" checked={printsOn(report[kind]!, which)}
                onChange={e => ed.commit(r => setPrintsOn(r[kind]!, which, e.target.checked))} />
            </Row>
          ))}
        </Category>
      ))}
      <Category title={l10n.t('Page')}>
        <Row label={l10n.t('Page width')}><PropSize value={p.width} onCommit={page('width')} /></Row>
        <Row label={l10n.t('Page height')}><PropSize value={p.height} onCommit={page('height')} /></Row>
        <Row label={l10n.t('Top margin')}><PropSize value={p.marginTop} onCommit={page('marginTop')} /></Row>
        <Row label={l10n.t('Bottom margin')}><PropSize value={p.marginBottom} onCommit={page('marginBottom')} /></Row>
        <Row label={l10n.t('Left margin')}><PropSize value={p.marginLeft} onCommit={page('marginLeft')} /></Row>
        <Row label={l10n.t('Right margin')}><PropSize value={p.marginRight} onCommit={page('marginRight')} /></Row>
        {report.width + p.marginLeft + p.marginRight > p.width + 1e-6 && (
          <div className="prop-note warn">{l10n.t('Body width + margins are wider than the page – printing produces extra empty pages.')}</div>
        )}
      </Category>
    </div>
  );
}

/** Action on click (hyperlink, bookmark link, drillthrough) and the item's own bookmark. */
function ActionProps({ item, dataSetName }: { item: ReportItem; dataSetName?: string }) {
  const ed = useEditor();
  const action = actionOf(item);
  const set = (a: ItemAction) => ed.commit(r => setAction(locate(r, item.name)!.item, a));
  const params = action.kind === 'drillthrough' ? action.parameters : [];
  return (
    <>
      <Row label={l10n.t('On click')}>
        <select value={action.kind} onChange={e => {
          const kind = e.target.value as ItemAction['kind'];
          set(kind === 'none' ? { kind } : kind === 'drillthrough' ? { kind, report: '', parameters: [] }
            : { kind, value: 'value' in action ? action.value : '' });
        }}>
          <option value="none">{l10n.t('No action')}</option>
          <option value="hyperlink">{l10n.t('Go to URL')}</option>
          <option value="bookmarkLink">{l10n.t('Go to bookmark')}</option>
          <option value="drillthrough">{l10n.t('Go to report (drillthrough)')}</option>
        </select>
      </Row>
      {(action.kind === 'hyperlink' || action.kind === 'bookmarkLink') && (
        <Row label={action.kind === 'hyperlink' ? 'URL' : l10n.t('Bookmark')}>
          <PropText value={action.value} expression dataSetName={dataSetName}
            placeholder={action.kind === 'hyperlink' ? l10n.t('https://… or =expression') : l10n.t('Name or =expression')}
            invalid={action.value.startsWith('=') ? validateExpression(action.value) : null}
            onCommit={v => set({ ...action, value: v })} />
        </Row>
      )}
      {action.kind === 'drillthrough' && <>
        <Row label={l10n.t('Report')}>
          <PropText value={action.report} placeholder={l10n.t('Name of the target report')} onCommit={v => set({ ...action, report: v })} />
        </Row>
        {params.map((p, i) => (
          <div key={i} className="prop-row action-param">
            <PropText value={p.name} placeholder={l10n.t('Parameter')} onCommit={v => set({ ...action, parameters: params.map((q, k) => (k === i ? { ...q, name: v } : q)) })} />
            <PropText value={p.value} placeholder={l10n.t('Value or =expression')} expression dataSetName={dataSetName}
              onCommit={v => set({ ...action, parameters: params.map((q, k) => (k === i ? { ...q, value: v } : q)) })} />
            <ActionButton icon="trash" title={l10n.t('Remove Parameter')} onClick={() => set({ ...action, parameters: params.filter((_, k) => k !== i) })} />
          </div>
        ))}
        <Row label={l10n.t('Parameters')}>
          <button className="secondary small" onClick={() => set({ ...action, parameters: [...params, { name: `Parameter${params.length + 1}`, value: '' }] })}>
            <Codicon name="add" /> {l10n.t('Add')}
          </button>
        </Row>
      </>}
      <Row label={l10n.t('Bookmark (target)')}>
        <PropText value={bookmarkOf(item)} expression dataSetName={dataSetName} placeholder={l10n.t('Target of "Go to bookmark"')}
          onCommit={v => ed.commit(r => setBookmark(locate(r, item.name)!.item, v))} />
      </Row>
    </>
  );
}

/** A selected table column: width, visibility and toggle (properties of its leaf TablixMember). */
function ColumnProps({ t, index }: { t: TableItem; index: number }) {
  const ed = useEditor();
  const leaf = columnLeaf(t, index);
  const setMember = (fn: (m: RowMember) => void) => ed.commit(r => {
    const m = columnLeaf(locate(r, t.name)!.item as TableItem, index);
    if (!m) return false;
    fn(m);
  });
  return (
    <>
      <Row label={l10n.t('Column {0}', index + 1)}>
        <PropSize value={t.columns[index]} min={0.1} onCommit={v => ed.commit(r => { (locate(r, t.name)!.item as TableItem).columns[index] = v; })} />
      </Row>
      {leaf && <>
        <Row label={l10n.t('Hide')}>
          <PropText value={hiddenOf(leaf)} placeholder={l10n.t('empty = visible, true or =expression')} expression dataSetName={t.dataSetName}
            invalid={hiddenOf(leaf).startsWith('=') ? validateExpression(hiddenOf(leaf)) : null}
            onCommit={v => setMember(m => setHidden(m, v))} />
        </Row>
        <Row label={l10n.t('Toggled by')}>
          <ToggleSelect value={toggleItemOf(leaf)} onChange={v => setMember(m => setToggleItem(m, v))} />
        </Row>
        {leaf.group && <div className="prop-note">{l10n.t('The column repeats for each value of the column group "{0}".', leaf.group.name)}</div>}
      </>}
    </>
  );
}

const rowKind = (kind: string) => ({
  header: l10n.t('Table header'), footer: l10n.t('Table footer'), groupHeader: l10n.t('Group header'), groupFooter: l10n.t('Group footer'), detail: l10n.t('Details'),
} as Record<string, string>)[kind] ?? kind;

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
      <div className="prop-note">{l10n.t('Row {0}: {1}', index + 1, rowKind(row.kind))}</div>
      <Row label={l10n.t('Height')}><PropSize value={row.height} min={0.1} onCommit={v => ed.commit(r => { (locate(r, t.name)!.item as TableItem).rows[index].height = v; })} /></Row>
      {leaf && isStatic && <>
        <Row label={l10n.t('On every page')}>
          <input type="checkbox" title={l10n.t('RepeatOnNewPage: repeat on every page (e.g. column headings)')} checked={memberProp(leaf, 'RepeatOnNewPage') === 'true'}
            onChange={e => setMember(m => setMemberProp(m, 'RepeatOnNewPage', e.target.checked ? 'true' : undefined))} />
        </Row>
        <Row label={l10n.t('Keep with group')}>
          <select value={memberProp(leaf, 'KeepWithGroup') ?? ''} onChange={e => setMember(m => setMemberProp(m, 'KeepWithGroup', e.target.value || undefined))}>
            <option value="">{l10n.t('No')}</option><option value="After">{l10n.t('With the following group')}</option><option value="Before">{l10n.t('With the previous group')}</option>
          </select>
        </Row>
      </>}
      {leaf && <>
        <Row label={l10n.t('Hide')}>
          <PropText value={hiddenOf(leaf)} placeholder={l10n.t('empty = visible, true or =expression')} expression dataSetName={t.dataSetName}
            onCommit={v => setMember(m => setHidden(m, v))} />
        </Row>
        <Row label={l10n.t('Toggled by')}>
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
    <select value={value} title={l10n.t('A click on this textbox shows/hides the item (drilldown)')} onChange={e => onChange(e.target.value)}>
      <option value="">{l10n.t('(none)')}</option>
      {!names.includes(value) && value && <option value={value}>{value}</option>}
      {names.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}
