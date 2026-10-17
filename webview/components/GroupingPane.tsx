import { useEditor } from '../editor';
import { TableItem } from '../model';
import { locate } from '../ops';
import { columnGroupList, groupList, rowsOfMember } from '../tablix';
import { vsContext } from '../vscode';
import { ActionButton, Codicon, DropdownAction } from './Icon';
import { l10n } from '../l10n';

const breakLabel = (location: string) => ({
  Between: l10n.t('Break between'), Start: l10n.t('Break before'), End: l10n.t('Break after'), StartAndEnd: l10n.t('Break before/after'),
} as Record<string, string>)[location] ?? location;

/** The table of the selection (the table itself, a cell or a selected row/column). */
export function selectedTable(ed: ReturnType<typeof useEditor>): TableItem | null {
  const loc = ed.selection[0] ? locate(ed.report, ed.selection[0]) : null;
  if (loc?.table) return loc.table;
  return loc?.item.type === 'table' ? loc.item : null;
}

/**
 * Row groups of the selected table, like the "Row Groups" pane of Report Builder and Visual Studio: nesting,
 * grouping, sort and page break at a glance; double click or the context menu opens the group's properties.
 */
export function GroupingPane() {
  const ed = useEditor();
  const t = selectedTable(ed);
  if (!t) return null;
  const groups = groupList(t);
  const run = (id: string) => () => ed.commands.get(id)?.();
  return (
    <div className="grouping-pane" {...vsContext({ preventDefaultContextMenuItems: true })}>
      <div className="grouping-head">
        <span className="pane-title">{l10n.t('Grouping')}</span>
        <span className="pane-description">{t.name}</span>
        <span className="grow" />
        <DropdownAction icon="add" title={l10n.t('Add Group')} items={[
          { label: l10n.t('Parent Group…'), icon: 'arrow-up', run: run('table.addParentGroup') },
          { label: l10n.t('Child Group…'), icon: 'arrow-down', run: run('table.addChildGroup') },
          { label: l10n.t('Column Group…'), icon: 'split-horizontal', run: run('table.addColumnGroup') },
        ]} />
      </div>
      {columnGroupList(t).length > 0 && (
        <div className="grouping-list column-groups" role="tree" aria-label={l10n.t('Column groups')}>
          <div className="grouping-sub">{l10n.t('Column Groups')}</div>
          {columnGroupList(t).map(({ member, depth }) => (
            <div key={member.id} role="treeitem" className="group-chip" style={{ marginLeft: depth * 16 }} tabIndex={0}
              title={l10n.t('Column group {0} – double-click: properties', member.group!.name)}
              onDoubleClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })}
              onKeyDown={e => { if (e.key === 'Enter') ed.setDialog({ kind: 'group', table: t.name, member: member.id }); }}>
              {depth > 0 && <Codicon name="arrow-small-right" className="group-nest" />}
              <Codicon name="split-horizontal" className="group-icon" />
              <span className="group-name">{member.group!.name}</span>
              {member.group!.expressions.length > 0 && <span className="group-meta">{member.group!.expressions.join(', ')}</span>}
              {member.sort.length > 0 && <span className="group-meta"><Codicon name="arrow-swap" /> {member.sort.map(s => `${s.value}${s.descending ? ' ↓' : ''}`).join(', ')}</span>}
              <span className="grow" />
              <ActionButton icon="settings-gear" title={l10n.t('Group Properties…')} onClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })} />
              <DropdownAction icon="trash" title={l10n.t('Delete Column Group')} items={[
                { label: l10n.t('Delete Group Only'), icon: 'ungroup-by-ref-type', run: () => ed.commands.get('table.deleteColumnGroupOnly')?.({ member: member.id }) },
                { label: l10n.t('Delete Group and Columns'), icon: 'trash', run: () => ed.commands.get('table.deleteColumnGroup')?.({ member: member.id }) },
              ]} />
            </div>
          ))}
          <div className="grouping-sub">{l10n.t('Row Groups')}</div>
        </div>
      )}
      <div className="grouping-list" role="tree" aria-label={l10n.t('Row groups')}>
        {groups.map(({ member, depth, details }) => {
          const g = member.group!;
          const rows = rowsOfMember(member);
          const selectRows = () => {
            const first = t.rows.findIndex(r => rows.includes(r.id));
            if (first >= 0) ed.select([t.name], { table: t.name, kind: 'row', index: first });
          };
          return (
            <div key={member.id} role="treeitem" className="group-chip" style={{ marginLeft: depth * 16 }} tabIndex={0}
              title={details ? l10n.t('Details group {0} – double-click: properties', g.name) : l10n.t('Group {0} – double-click: properties', g.name)}
              onClick={selectRows}
              onDoubleClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })}
              onKeyDown={e => { if (e.key === 'Enter') ed.setDialog({ kind: 'group', table: t.name, member: member.id }); }}
              {...vsContext({ webviewSection: 'item', itemType: 'tableGroup', inTable: true, inGroup: !details, rowId: rows[0] ?? '' })}>
              {depth > 0 && <Codicon name="arrow-small-right" className="group-nest" />}
              <Codicon name={details ? 'list-flat' : 'group-by-ref-type'} className="group-icon" />
              <span className="group-name">{details ? l10n.t('(Details)') : g.name}</span>
              {g.expressions.length > 0 && <span className="group-meta">{g.expressions.join(', ')}</span>}
              {member.sort.length > 0 && <span className="group-meta" title={l10n.t('Sorting')}><Codicon name="arrow-swap" /> {member.sort.map(s => `${s.value}${s.descending ? ' ↓' : ''}`).join(', ')}</span>}
              {g.filters.length > 0 && <span className="group-meta" title={l10n.t('Filter')}><Codicon name="filter" /> {g.filters.length}</span>}
              {g.pageBreak && <span className="group-meta">{breakLabel(g.pageBreak)}</span>}
              <span className="grow" />
              <ActionButton icon="settings-gear" title={l10n.t('Group Properties…')} onClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
