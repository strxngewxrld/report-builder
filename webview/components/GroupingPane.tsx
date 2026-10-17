import { useEditor } from '../editor';
import { TableItem } from '../model';
import { locate } from '../ops';
import { columnGroupList, groupList, rowsOfMember } from '../tablix';
import { vsContext } from '../vscode';
import { ActionButton, Codicon, DropdownAction } from './Icon';

const BREAK_LABEL: Record<string, string> = { Between: 'Umbruch zwischen', Start: 'Umbruch davor', End: 'Umbruch danach', StartAndEnd: 'Umbruch davor/danach' };

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
        <span className="pane-title">Gruppierung</span>
        <span className="pane-description">{t.name}</span>
        <span className="grow" />
        <DropdownAction icon="add" title="Gruppe hinzufügen" items={[
          { label: 'Übergeordnete Gruppe…', icon: 'arrow-up', run: run('table.addParentGroup') },
          { label: 'Untergeordnete Gruppe…', icon: 'arrow-down', run: run('table.addChildGroup') },
        ]} />
      </div>
      {columnGroupList(t).length > 0 && (
        <div className="grouping-list column-groups" role="tree" aria-label="Spaltengruppen">
          <div className="grouping-sub">Spaltengruppen</div>
          {columnGroupList(t).map(({ member, depth }) => (
            <div key={member.id} role="treeitem" className="group-chip" style={{ marginLeft: depth * 16 }} tabIndex={0}
              title={`Spaltengruppe ${member.group!.name} – Doppelklick: Eigenschaften`}
              onDoubleClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })}
              onKeyDown={e => { if (e.key === 'Enter') ed.setDialog({ kind: 'group', table: t.name, member: member.id }); }}>
              {depth > 0 && <Codicon name="arrow-small-right" className="group-nest" />}
              <Codicon name="split-horizontal" className="group-icon" />
              <span className="group-name">{member.group!.name}</span>
              {member.group!.expressions.length > 0 && <span className="group-meta">{member.group!.expressions.join(', ')}</span>}
              {member.sort.length > 0 && <span className="group-meta"><Codicon name="arrow-swap" /> {member.sort.map(s => `${s.value}${s.descending ? ' ↓' : ''}`).join(', ')}</span>}
              <span className="grow" />
              <ActionButton icon="settings-gear" title="Gruppeneigenschaften…" onClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })} />
            </div>
          ))}
          <div className="grouping-sub">Zeilengruppen</div>
        </div>
      )}
      <div className="grouping-list" role="tree" aria-label="Zeilengruppen">
        {groups.map(({ member, depth, details }) => {
          const g = member.group!;
          const rows = rowsOfMember(member);
          const selectRows = () => {
            const first = t.rows.findIndex(r => rows.includes(r.id));
            if (first >= 0) ed.select([t.name], { table: t.name, kind: 'row', index: first });
          };
          return (
            <div key={member.id} role="treeitem" className="group-chip" style={{ marginLeft: depth * 16 }} tabIndex={0}
              title={`${details ? 'Detailgruppe' : 'Gruppe'} ${g.name} – Doppelklick: Eigenschaften`}
              onClick={selectRows}
              onDoubleClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })}
              onKeyDown={e => { if (e.key === 'Enter') ed.setDialog({ kind: 'group', table: t.name, member: member.id }); }}
              {...vsContext({ webviewSection: 'item', itemType: 'tableGroup', inTable: true, inGroup: !details, rowId: rows[0] ?? '' })}>
              {depth > 0 && <Codicon name="arrow-small-right" className="group-nest" />}
              <Codicon name={details ? 'list-flat' : 'group-by-ref-type'} className="group-icon" />
              <span className="group-name">{details ? `(Details)` : g.name}</span>
              {g.expressions.length > 0 && <span className="group-meta">{g.expressions.join(', ')}</span>}
              {member.sort.length > 0 && <span className="group-meta" title="Sortierung"><Codicon name="arrow-swap" /> {member.sort.map(s => `${s.value}${s.descending ? ' ↓' : ''}`).join(', ')}</span>}
              {g.filters.length > 0 && <span className="group-meta" title="Filter"><Codicon name="filter" /> {g.filters.length}</span>}
              {g.pageBreak && <span className="group-meta">{BREAK_LABEL[g.pageBreak]}</span>}
              <span className="grow" />
              <ActionButton icon="settings-gear" title="Gruppeneigenschaften…" onClick={() => ed.setDialog({ kind: 'group', table: t.name, member: member.id })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
