import { InsertTool, TablePart, useEditor } from '../editor';
import { Report, StyleKey } from '../model';
import { locate, reorder } from '../ops';
import { cellLayout } from '../tablix';
import { toHex } from '../styleCss';
import { ActionButton, Codicon, DropdownAction, MenuItem, Separator } from './Icon';
import { FONTS, FONT_SIZES, FORMATS } from './PropertiesPane';

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

const TOOLS: [InsertTool, string, string][] = [
  ['textbox', 'symbol-text', 'Textfeld'],
  ['table', 'table', 'Tabelle'],
  ['image', 'file-media', 'Bild'],
  ['line', 'chrome-minimize', 'Linie'],
  ['rectangle', 'primitive-square', 'Rechteck'],
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
  const knownFormat = FORMATS.some(f => f[0] === (firstStyle.Format ?? ''));
  const align = firstStyle.TextAlign ?? 'General';
  const valign = firstStyle.VerticalAlign ?? 'Top';

  const alignItems: MenuItem[] = [
    { header: 'Horizontal' },
    ...([['General', 'Standard (Zahlen rechts, Text links)'], ['Left', 'Linksbündig'], ['Center', 'Zentriert'], ['Right', 'Rechtsbündig']] as const)
      .map(([v, label]) => ({ label, checked: align === v, run: () => setStyle('TextAlign', v === 'General' ? undefined : v) })),
    'separator',
    { header: 'Vertikal' },
    ...([['Top', 'Oben', 'fold-up'], ['Middle', 'Mitte', 'fold'], ['Bottom', 'Unten', 'fold-down']] as const)
      .map(([v, label, icon]) => ({ label, icon, checked: valign === v, run: () => setStyle('VerticalAlign', v === 'Top' ? undefined : v) })),
    'separator',
    {
      label: 'Rahmen', icon: 'primitive-square', checked: hasBorder, run: () => ed.commit(r => {
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
    { label: 'In den Vordergrund', icon: 'layers-active', disabled: movable.length !== 1, run: () => ed.commit(r => reorder(locate(r, movable[0])!, true)) },
    { label: 'In den Hintergrund', icon: 'layers', disabled: movable.length !== 1, run: () => ed.commit(r => reorder(locate(r, movable[0])!, false)) },
    'separator',
    { header: 'Am zuerst gewählten Element ausrichten' },
    { label: 'Links', disabled: !multi, run: run('layout.alignLeft') },
    { label: 'Zentriert', disabled: !multi, run: run('layout.alignCenter') },
    { label: 'Rechts', disabled: !multi, run: run('layout.alignRight') },
    { label: 'Oben', icon: 'fold-up', disabled: !multi, run: run('layout.alignTop') },
    { label: 'Mittig', icon: 'fold', disabled: !multi, run: run('layout.alignMiddle') },
    { label: 'Unten', icon: 'fold-down', disabled: !multi, run: run('layout.alignBottom') },
    'separator',
    { label: 'Gleiche Breite', disabled: !multi, run: run('layout.sameWidth') },
    { label: 'Gleiche Höhe', disabled: !multi, run: run('layout.sameHeight') },
    { label: 'Gleiche Größe', disabled: !multi, run: run('layout.sameSize') },
    'separator',
    { label: 'Horizontal gleichmäßig verteilen', disabled: !three, run: run('layout.distributeHorizontal') },
    { label: 'Vertikal gleichmäßig verteilen', disabled: !three, run: run('layout.distributeVertical') },
    { label: 'Im Container horizontal zentrieren', run: run('layout.centerHorizontal') },
    { label: 'Im Container vertikal zentrieren', run: run('layout.centerVertical') },
  ];

  return (
    <div className="toolbar" role="toolbar" aria-label="Entwurf">
      <div className="action-group" aria-label="Einfügen">
        {TOOLS.map(([t, icon, label]) => (
          <ActionButton key={t} icon={icon} title={`${label} einfügen – auf der Entwurfsfläche klicken oder aufziehen`}
            checked={ed.tool === t} onClick={() => ed.setTool(ed.tool === t ? null : t)} />
        ))}
        <ActionButton icon="symbol-array" title="Matrix einfügen…" onClick={() => ed.commands.get('insert.matrix')?.()} />
        <ActionButton icon="graph" title="Diagramm einfügen…" onClick={() => ed.commands.get('insert.chart')?.()} />
      </div>
      <Separator />
      <div className="action-group" aria-label="Schrift">
        <select className="dropdown font-family" title="Schriftart" disabled={noText} value={firstStyle.FontFamily ?? 'Arial'} onChange={e => setStyle('FontFamily', e.target.value)}>
          {[...new Set([firstStyle.FontFamily ?? 'Arial', ...FONTS])].map(f => <option key={f}>{f}</option>)}
        </select>
        <select className="dropdown font-size" title="Schriftgrad" disabled={noText} value={firstStyle.FontSize ?? '10pt'} onChange={e => setStyle('FontSize', e.target.value)}>
          {[...new Set([firstStyle.FontSize ?? '10pt', ...FONT_SIZES])].map(f => <option key={f} value={f}>{f.replace('pt', '')}</option>)}
        </select>
        <ActionButton icon="bold" title="Fett" disabled={noText} checked={firstStyle.FontWeight === 'Bold'} onClick={() => toggle('FontWeight', 'Bold')} />
        <ActionButton icon="italic" title="Kursiv" disabled={noText} checked={firstStyle.FontStyle === 'Italic'} onClick={() => toggle('FontStyle', 'Italic')} />
        <ActionButton icon="whole-word" title="Unterstrichen" disabled={noText} checked={firstStyle.TextDecoration === 'Underline'} onClick={() => toggle('TextDecoration', 'Underline')} />
        <label className={`action-item color-action ${noText ? 'disabled' : ''}`} title="Schriftfarbe">
          <Codicon name="text-size" />
          <span className="color-swatch" style={{ background: toHex(firstStyle.Color) }} />
          <input type="color" disabled={noText} value={toHex(firstStyle.Color)} onChange={e => setStyle('Color', e.target.value)} />
        </label>
        <label className={`action-item color-action ${noText ? 'disabled' : ''}`} title="Hintergrundfarbe">
          <Codicon name="paintcan" />
          <span className="color-swatch" style={{ background: toHex(firstStyle.BackgroundColor, '#ffffff') }} />
          <input type="color" disabled={noText} value={toHex(firstStyle.BackgroundColor, '#ffffff')} onChange={e => setStyle('BackgroundColor', e.target.value)} />
        </label>
      </div>
      <Separator />
      <div className="action-group" aria-label="Absatz und Zahl">
        <DropdownAction icon="list-flat" title="Ausrichtung und Rahmen" disabled={noText} items={alignItems} />
        <select className="dropdown" title="Zahlenformat" disabled={noText} value={knownFormat ? firstStyle.Format ?? '' : '*'}
          onChange={e => e.target.value !== '*' && setStyle('Format', e.target.value || undefined)}>
          {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {!knownFormat && <option value="*">{firstStyle.Format}</option>}
        </select>
      </div>
      <Separator />
      <div className="action-group" aria-label="Anordnen">
        <DropdownAction icon="layers" title="Anordnen, ausrichten, gleiche Größe, verteilen" disabled={!movable.length} items={arrangeItems} />
      </div>
      <span className="grow" />
      <div className="action-group" aria-label="Bereiche">
        <ActionButton icon={view.dataPane ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} title="Gliederung und Berichtsdaten ein-/ausblenden"
          onClick={() => ed.setView({ dataPane: !view.dataPane })} />
        <ActionButton icon={view.propertiesPane ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} title="Eigenschaften ein-/ausblenden"
          onClick={() => ed.setView({ propertiesPane: !view.propertiesPane })} />
      </div>
    </div>
  );
}
