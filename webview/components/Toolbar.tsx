import { InsertTool, TablePart, useEditor } from '../editor';
import { Report, StyleKey } from '../model';
import { locate, reorder } from '../ops';
import { cellLayout } from '../tablix';
import { toHex } from '../styleCss';
import { ActionButton, Codicon, DropdownAction, MenuItem, Separator } from './Icon';
import { FONTS, FONT_SIZES, formats } from './PropertiesPane';
import { l10n } from '../l10n';

/**
 * Names of the textboxes that text formatting applies to: selected textboxes, all cells of a selected table,
 * or the cells of a selected table column/row.
 */
export function textTargets(r: Report, selection: string[], part: TablePart | null): string[] {
  const out: string[] = [];
  for (const name of selection) {
    const it = locate(r, name)?.item;
    if (it?.type === 'textbox') out.push(name);
    if (it?.type === 'table') {
      it.rows.forEach((row, ri) => cellLayout(row).forEach(({ cell, col, span }) => {
        const hit = part?.kind === 'column' ? part.index >= col && part.index < col + span : ri === part?.index;
        if (!part || part.table !== it.name || hit) out.push(cell.name);
      }));
    }
  }
  return out;
}

const tools = (): [InsertTool, string, string][] => [
  ['textbox', 'symbol-text', l10n.t('Textbox')],
  ['table', 'table', l10n.t('Table')],
  ['image', 'file-media', l10n.t('Image')],
  ['line', 'chrome-minimize', l10n.t('Line')],
  ['rectangle', 'primitive-square', l10n.t('Rectangle')],
];

/**
 * The designer's action bar: insert tools, text formatting, alignment, arrangement and pane toggles – codicons only,
 * like VS Code's own toolbars. Clipboard, preview, view options and report settings live in VS Code's editor title,
 * context menus and keybindings.
 */
export function Toolbar() {
  const ed = useEditor();
  const { report, selection, view } = ed;
  const targets = textTargets(report, selection, ed.tablePart);
  const firstStyle = targets.length ? locate(report, targets[0])?.item.style ?? {} : {};
  const noText = targets.length === 0;
  const movable = selection.filter(n => locate(report, n)?.container);

  const setStyle = (key: StyleKey, value: string | undefined) => ed.commit(r => {
    for (const n of textTargets(r, selection, ed.tablePart)) {
      const it = locate(r, n)!.item;
      if (value) it.style[key] = value;
      else delete it.style[key];
    }
  });
  const toggle = (key: StyleKey, on: string) => setStyle(key, firstStyle[key] === on ? undefined : on);
  const hasBorder = !!firstStyle.BorderStyle && firstStyle.BorderStyle !== 'None';
  const knownFormat = formats().some(f => f[0] === (firstStyle.Format ?? ''));
  const align = firstStyle.TextAlign ?? 'General';
  const valign = firstStyle.VerticalAlign ?? 'Top';

  const alignItems: MenuItem[] = [
    { header: l10n.t('Horizontal') },
    ...([['General', l10n.t('Default (numbers right, text left)')], ['Left', l10n.t('Align left')], ['Center', l10n.t('Center')], ['Right', l10n.t('Align right')]] as const)
      .map(([v, label]) => ({ label, checked: align === v, run: () => setStyle('TextAlign', v === 'General' ? undefined : v) })),
    'separator',
    { header: l10n.t('Vertical') },
    ...([['Top', l10n.t('Top'), 'fold-up'], ['Middle', l10n.t('Middle'), 'fold'], ['Bottom', l10n.t('Bottom'), 'fold-down']] as const)
      .map(([v, label, icon]) => ({ label, icon, checked: valign === v, run: () => setStyle('VerticalAlign', v === 'Top' ? undefined : v) })),
    'separator',
    {
      label: l10n.t('Border'), icon: 'primitive-square', checked: hasBorder, run: () => ed.commit(r => {
        for (const n of textTargets(r, selection, ed.tablePart)) {
          const s = locate(r, n)!.item.style;
          s.BorderStyle = hasBorder ? 'None' : 'Solid';
          if (!hasBorder) { s.BorderColor ??= 'LightGrey'; s.BorderWidth ??= '1pt'; }
        }
      }),
    },
  ];
  const run = (id: string) => () => ed.commands.get(id)?.();
  const multi = movable.length > 1, three = movable.length > 2;
  const arrangeItems: MenuItem[] = [
    { label: l10n.t('Bring to Front'), icon: 'layers-active', disabled: movable.length !== 1, run: () => ed.commit(r => reorder(locate(r, movable[0])!, true)) },
    { label: l10n.t('Send to Back'), icon: 'layers', disabled: movable.length !== 1, run: () => ed.commit(r => reorder(locate(r, movable[0])!, false)) },
    'separator',
    { header: l10n.t('Align to the first selected item') },
    { label: l10n.t('Lefts'), disabled: !multi, run: run('layout.alignLeft') },
    { label: l10n.t('Centers'), disabled: !multi, run: run('layout.alignCenter') },
    { label: l10n.t('Rights'), disabled: !multi, run: run('layout.alignRight') },
    { label: l10n.t('Tops'), icon: 'fold-up', disabled: !multi, run: run('layout.alignTop') },
    { label: l10n.t('Middles'), icon: 'fold', disabled: !multi, run: run('layout.alignMiddle') },
    { label: l10n.t('Bottoms'), icon: 'fold-down', disabled: !multi, run: run('layout.alignBottom') },
    'separator',
    { label: l10n.t('Same Width'), disabled: !multi, run: run('layout.sameWidth') },
    { label: l10n.t('Same Height'), disabled: !multi, run: run('layout.sameHeight') },
    { label: l10n.t('Same Size'), disabled: !multi, run: run('layout.sameSize') },
    'separator',
    { label: l10n.t('Distribute Horizontally'), disabled: !three, run: run('layout.distributeHorizontal') },
    { label: l10n.t('Distribute Vertically'), disabled: !three, run: run('layout.distributeVertical') },
    { label: l10n.t('Center Horizontally in Container'), run: run('layout.centerHorizontal') },
    { label: l10n.t('Center Vertically in Container'), run: run('layout.centerVertical') },
  ];

  return (
    <div className="toolbar" role="toolbar" aria-label={l10n.t('Design')}>
      <div className="action-group" aria-label={l10n.t('Insert')}>
        {tools().map(([t, icon, label]) => (
          <ActionButton key={t} icon={icon} title={l10n.t('Insert {0} – click or drag on the design surface', label)}
            checked={ed.tool === t} onClick={() => ed.setTool(ed.tool === t ? null : t)} />
        ))}
        <ActionButton icon="symbol-array" title={l10n.t('Insert Matrix…')} onClick={() => ed.commands.get('insert.matrix')?.()} />
        <ActionButton icon="graph" title={l10n.t('Insert Chart…')} onClick={() => ed.commands.get('insert.chart')?.()} />
      </div>
      <Separator />
      <div className="action-group">
        <ActionButton icon="search" title={l10n.t('Expressions and References')} onClick={() => ed.commands.get('findExpressions')?.()} />
        <DropdownAction icon="library" title={l10n.t('Layout Blocks')} items={[
          { label: l10n.t('Save Selection as Block…'), disabled: !movable.length, run: run('saveBlock') },
          { label: l10n.t('Insert Layout Block…'), run: run('insertBlock') },
        ]} />
      </div>
      <Separator />
      <div className="action-group" aria-label={l10n.t('Text format')}>
        <select className="dropdown font-family" title={l10n.t('Font')} disabled={noText} value={firstStyle.FontFamily ?? 'Arial'} onChange={e => setStyle('FontFamily', e.target.value)}>
          {[...new Set([firstStyle.FontFamily ?? 'Arial', ...FONTS])].map(f => <option key={f}>{f}</option>)}
        </select>
        <select className="dropdown font-size" title={l10n.t('Font size')} disabled={noText} value={firstStyle.FontSize ?? '10pt'} onChange={e => setStyle('FontSize', e.target.value)}>
          {[...new Set([firstStyle.FontSize ?? '10pt', ...FONT_SIZES])].map(f => <option key={f} value={f}>{f.replace('pt', '')}</option>)}
        </select>
        <ActionButton icon="bold" title={l10n.t('Bold')} disabled={noText} checked={firstStyle.FontWeight === 'Bold'} onClick={() => toggle('FontWeight', 'Bold')} />
        <ActionButton icon="italic" title={l10n.t('Italic')} disabled={noText} checked={firstStyle.FontStyle === 'Italic'} onClick={() => toggle('FontStyle', 'Italic')} />
        <ActionButton icon="whole-word" title={l10n.t('Underline')} disabled={noText} checked={firstStyle.TextDecoration === 'Underline'} onClick={() => toggle('TextDecoration', 'Underline')} />
        <label className={`action-item color-action ${noText ? 'disabled' : ''}`} title={l10n.t('Font color')}>
          <Codicon name="text-size" />
          <span className="color-swatch" style={{ background: toHex(firstStyle.Color) }} />
          <input type="color" disabled={noText} value={toHex(firstStyle.Color)} onChange={e => setStyle('Color', e.target.value)} />
        </label>
        <label className={`action-item color-action ${noText ? 'disabled' : ''}`} title={l10n.t('Background color')}>
          <Codicon name="paintcan" />
          <span className="color-swatch" style={{ background: toHex(firstStyle.BackgroundColor, '#ffffff') }} />
          <input type="color" disabled={noText} value={toHex(firstStyle.BackgroundColor, '#ffffff')} onChange={e => setStyle('BackgroundColor', e.target.value)} />
        </label>
      </div>
      <Separator />
      <div className="action-group" aria-label={l10n.t('Paragraph and number')}>
        <DropdownAction icon="list-flat" title={l10n.t('Alignment and Border')} disabled={noText} items={alignItems} />
        <select className="dropdown" title={l10n.t('Number format')} disabled={noText} value={knownFormat ? firstStyle.Format ?? '' : '*'}
          onChange={e => e.target.value !== '*' && setStyle('Format', e.target.value || undefined)}>
          {formats().map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {!knownFormat && <option value="*">{firstStyle.Format}</option>}
        </select>
      </div>
      <Separator />
      <div className="action-group" aria-label={l10n.t('Arrange')}>
        <DropdownAction icon="layers" title={l10n.t('Arrange, align, make same size, distribute')} disabled={!movable.length} items={arrangeItems} />
      </div>
      <span className="grow" />
      <div className="action-group" aria-label={l10n.t('Panes')}>
        <ActionButton icon={view.dataPane ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} title={l10n.t('Show/Hide Outline and Report Data')}
          onClick={() => ed.setView({ dataPane: !view.dataPane })} />
        <ActionButton icon={view.propertiesPane ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} title={l10n.t('Show/Hide Properties')}
          onClick={() => ed.setView({ propertiesPane: !view.propertiesPane })} />
      </div>
    </div>
  );
}
