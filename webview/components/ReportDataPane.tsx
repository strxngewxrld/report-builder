import { useState } from 'react';
import type { DragEvent as RDragEvent, ReactNode } from 'react';
import { DRAG_MIME, DragPayload, setCurrentDrag, useCommand, useEditor } from '../editor';
import { post, vsContext } from '../vscode';
import { BcDataPane } from './BcDataPane';
import { ActionButton, Codicon } from './Icon';
import { ImagesGroup } from './ImagesGroup';
import { l10n } from '../l10n';

/** The built-in fields (Globals!…) with their display names. */
export const globals = (): [string, string][] => [
  ['ExecutionTime', l10n.t('Execution Time')],
  ['PageNumber', l10n.t('Page Number')],
  ['TotalPages', l10n.t('Total Pages')],
  ['ReportName', l10n.t('Report Name')],
  ['ReportFolder', l10n.t('Report Folder')],
];

export const dragProps = (payload: DragPayload) => ({
  draggable: true,
  onDragStart: (e: RDragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
    setCurrentDrag(payload);
  },
  onDragEnd: () => setCurrentDrag(null),
});

export function ReportDataPane() {
  const ed = useEditor();
  const { report } = ed;
  const [open, setOpen] = useState<Record<string, boolean>>({ globals: false, params: true, sources: true, sets: true });
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !(o[k] ?? true) }));
  const isOpen = (k: string) => open[k] ?? true;
  // native context menu of the entries (package.json › webview/context)
  useCommand('data.edit', arg => {
    const { entryKind, name } = (arg ?? {}) as { entryKind?: 'parameter' | 'dataSource' | 'dataSet'; name?: string };
    if (entryKind && name) ed.setDialog({ kind: entryKind, name });
  });
  useCommand('data.delete', arg => {
    const { entryKind, name } = (arg ?? {}) as { entryKind?: string; name?: string };
    ed.commit(r => {
      if (entryKind === 'parameter') r.parameters = r.parameters.filter(x => x.name !== name);
      else if (entryKind === 'dataSource') r.dataSources = r.dataSources.filter(x => x.name !== name);
      else if (entryKind === 'dataSet') r.dataSets = r.dataSets.filter(x => x.name !== name);
      else return false;
    });
  });
  if (ed.isBc) return <BcDataPane />;

  // No confirm() before deleting: it is blocked in webviews, and deletions can be undone with ⌘Z.
  return (
    <div className="pane-content">
      <div className="tree" {...vsContext({ preventDefaultContextMenuItems: true })}>
        <Group label={l10n.t('Built-in Fields')} open={isOpen('globals')} onToggle={() => toggle('globals')}>
          {globals().map(([name, label]) => (
            <div key={name} className="tree-leaf" {...dragProps({ kind: 'global', name })} title={l10n.t('{0} – drag onto the design surface', `=Globals!${name}`)}
              {...vsContext({ webviewSection: 'dataField', expression: `=Globals!${name}` })}>
              <Codicon name="symbol-constant" className="glyph" />{label}
            </div>
          ))}
        </Group>

        <Group label={l10n.t('Parameters')} open={isOpen('params')} onToggle={() => toggle('params')}
          onAdd={() => ed.setDialog({ kind: 'parameter' })} addTitle={l10n.t('Add Parameter')}>
          {report.parameters.map(p => (
            <div key={p.id} className="tree-leaf" {...dragProps({ kind: 'parameter', name: p.name })}
              {...vsContext({ webviewSection: 'dataEntry', entryKind: 'parameter', name: p.name, expression: `=Parameters!${p.name}.Value` })}
              onDoubleClick={() => ed.setDialog({ kind: 'parameter', name: p.name })} title={l10n.t('{0} – double-click to edit', p.dataType)}>
              <Codicon name="symbol-parameter" className="glyph" />{p.name}
              <RowActions
                onEdit={() => ed.setDialog({ kind: 'parameter', name: p.name })}
                onDelete={() => ed.commit(r => { r.parameters = r.parameters.filter(x => x.name !== p.name); })} />
            </div>
          ))}
          {!report.parameters.length && <div className="tree-empty">{l10n.t('No parameters')}</div>}
        </Group>

        <Group label={l10n.t('Data Sources')} open={isOpen('sources')} onToggle={() => toggle('sources')}
          onAdd={() => ed.setDialog({ kind: 'dataSource' })} addTitle={l10n.t('Add Data Source')}>
          {report.dataSources.map(d => (
            <div key={d.id} className="tree-leaf" onDoubleClick={() => ed.setDialog({ kind: 'dataSource', name: d.name })}
              {...vsContext({ webviewSection: 'dataEntry', entryKind: 'dataSource', name: d.name })}
              title={d.sharedReference ?? d.connectString}>
              <Codicon name="database" className="glyph" />{d.name}
              <RowActions
                onEdit={() => ed.setDialog({ kind: 'dataSource', name: d.name })}
                onDelete={() => ed.commit(r => { r.dataSources = r.dataSources.filter(x => x.name !== d.name); })} />
            </div>
          ))}
          {!report.dataSources.length && <div className="tree-empty">{l10n.t('No data sources')}</div>}
        </Group>

        <Group label="Datasets" open={isOpen('sets')} onToggle={() => toggle('sets')}
          onAdd={() => ed.setDialog({ kind: 'dataSet' })} addTitle={l10n.t('Add Dataset')}>
          {report.dataSets.map(ds => {
            const key = `ds:${ds.name}`;
            const rows = ed.sampleData[ds.name];
            return (
              <div key={ds.id}>
                <div className="tree-node" {...dragProps({ kind: 'dataSet', dataSet: ds.name })}
                  {...vsContext({ webviewSection: 'dataEntry', entryKind: 'dataSet', name: ds.name })}
                  onDoubleClick={() => ed.setDialog({ kind: 'dataSet', name: ds.name })}
                  title={l10n.t('Drag onto the design surface to create a table with all fields')}>
                  <Twisty open={isOpen(key)} onClick={() => toggle(key)} />
                  <Codicon name="table" className="glyph" />{ds.name}
                  {rows && <span className="badge" title={l10n.t('Sample data available')}>{rows.length}</span>}
                  <RowActions
                    onData={() => post({ type: 'importSampleData', dataSet: ds.name })}
                    onEdit={() => ed.setDialog({ kind: 'dataSet', name: ds.name })}
                    onDelete={() => ed.commit(r => { r.dataSets = r.dataSets.filter(x => x.name !== ds.name); })} />
                </div>
                {isOpen(key) && (
                  <div className="tree-children">
                    {ds.fields.map(f => (
                      <div key={f.name} className="tree-leaf field" title={`${f.typeName.replace('System.', '')}${f.value ? ` = ${f.value}` : ''}`}
                        {...dragProps({ kind: 'field', dataSet: ds.name, field: f.name, typeName: f.typeName })}
                        {...vsContext({ webviewSection: 'dataField', expression: `=Fields!${f.name}.Value` })}>
                        <Codicon name={f.value ? 'symbol-operator' : 'symbol-field'} className="glyph" />{f.name}
                      </div>
                    ))}
                    {!ds.fields.length && <div className="tree-empty">{l10n.t('No fields')}</div>}
                  </div>
                )}
              </div>
            );
          })}
          {!report.dataSets.length && <div className="tree-empty">{l10n.t('No datasets')}</div>}
        </Group>

        <ImagesGroup open={isOpen('images')} onToggle={() => toggle('images')} />
      </div>
      <div className="pane-hint">{l10n.t('Drag fields onto the design surface or into table cells. Dragging a dataset onto the surface creates a table.')}</div>
    </div>
  );
}

export function Group(props: { label: string; open: boolean; onToggle: () => void; onAdd?: () => void; addTitle?: string; children: ReactNode }) {
  return (
    <div className="tree-group">
      <div className="tree-group-head" onClick={props.onToggle} role="button" aria-expanded={props.open}>
        <Twisty open={props.open} />
        <span className="grow">{props.label}</span>
        {props.onAdd && <span className="row-actions"><ActionButton icon="add" title={props.addTitle!} onClick={() => props.onAdd!()} /></span>}
      </div>
      {props.open && <div className="tree-children">{props.children}</div>}
    </div>
  );
}

function RowActions({ onEdit, onDelete, onData }: { onEdit: () => void; onDelete: () => void; onData?: () => void }) {
  return (
    <span className="row-actions" onClick={e => e.stopPropagation()}>
      {onData && <ActionButton icon="cloud-download" title={l10n.t('Load Preview Data (Excel, CSV, JSON)')} onClick={onData} />}
      <ActionButton icon="edit" title={l10n.t('Edit')} onClick={onEdit} />
      <ActionButton icon="trash" title={l10n.t('Delete')} onClick={onDelete} />
    </span>
  );
}

/** Expand/collapse chevron of a tree row. */
export const Twisty = ({ open, onClick }: { open: boolean; onClick?: () => void }) => (
  <span className="twisty" onClick={onClick && (e => { e.stopPropagation(); onClick(); })}>
    <Codicon name={open ? 'chevron-down' : 'chevron-right'} />
  </span>
);
