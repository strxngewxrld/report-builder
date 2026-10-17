import { useState } from 'react';
import { BcDataItem } from '../bc';
import { useEditor } from '../editor';
import { post, vsContext } from '../vscode';
import { Group, Twisty, dragProps, globals } from './ReportDataPane';
import { ImagesGroup } from './ImagesGroup';
import { ActionButton, Codicon } from './Icon';
import { l10n } from '../l10n';

/**
 * Report data of a Business Central layout: the AL report is the data source. Data items and columns come from AL,
 * labels and captions are the layout's parameters. What the layout dataset does not contain yet is marked
 * (the AL compiler adds it on the next build).
 */
export function BcDataPane() {
  const ed = useEditor();
  const { bc, report } = ed;
  const [open, setOpen] = useState<Record<string, boolean>>({ globals: false });
  const isOpen = (k: string) => open[k] ?? true;
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !isOpen(k) }));
  const dataSet = report.dataSets.find(d => d.name === 'DataSet_Result') ?? report.dataSets[0];
  const typeOf = (field: string) => dataSet?.fields.find(f => f.name === field)?.typeName ?? '';
  const reveal = (line: number, character: number) => post({ type: 'revealAl', line, character });
  const rows = ed.sampleData[dataSet?.name ?? ''];

  const item = (d: BcDataItem, depth: number) => {
    const key = `di:${d.name}:${depth}`;
    return (
      <div key={key}>
        <div className="tree-node" title={l10n.t('{0} – drag onto the surface to create a table; double-click opens the definition', d.table)} onDoubleClick={() => reveal(d.line, d.character)}
          {...dragProps({ kind: 'dataItem', dataSet: dataSet?.name ?? 'DataSet_Result', name: d.name, columns: d.columns.map(c => c.name) })}
          {...vsContext({ webviewSection: 'alDataItem', dataItem: d.name, table: d.table, line: d.line, character: d.character })}>
          <Twisty open={isOpen(key)} onClick={() => toggle(key)} />
          <Codicon name="symbol-class" className="glyph" />{d.name}<span className="tree-meta">{d.table}</span>
          {d.table && <span className="row-actions" onClick={e => e.stopPropagation()}>
            <ActionButton icon="add" title={l10n.t('Add Fields of "{0}" as Columns…', d.table.replace(/"/g, ''))}
              onClick={() => post({ type: 'run', command: 'bcReportBuilder.addColumns', args: [{ dataItem: d.name }] })} />
          </span>}
        </div>
        {isOpen(key) && (
          <div className="tree-children">
            {d.columns.map(c => (
              <div key={c.name} className={`tree-leaf field ${c.inLayout ? '' : 'not-built'}`}
                {...dragProps({ kind: 'field', dataSet: dataSet?.name ?? 'DataSet_Result', field: c.name, typeName: typeOf(c.name) })}
                onDoubleClick={() => reveal(c.line, c.character)}
                {...vsContext({ webviewSection: 'alSymbol', line: c.line, character: c.character, expression: `=Fields!${c.name}.Value`, column: c.name })}
                title={`${c.name} = ${c.source}${c.includeCaption ? ` ${l10n.t('(with caption)')}` : ''}${c.inLayout ? '' : `\n${l10n.t('Not in the layout dataset yet – build the project')}`}\n${l10n.t('Double-click opens the definition')}`}>
                <Codicon name="symbol-field" className="glyph" />{c.name}
                {!c.inLayout && <span className="badge warn" title={l10n.t('Build the project so that the compiler updates the layout dataset')}>Build</span>}
              </div>
            ))}
            {d.children.map(ch => item(ch, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pane-content">
      <div className="tree" {...vsContext({ preventDefaultContextMenuItems: true })}>
        {bc ? (
          <div className="al-head">
            <button className="link" onClick={() => reveal(bc.line, bc.character)} title={bc.alFile}>
              <Codicon name="symbol-class" /> {bc.kind === 'reportextension' ? l10n.t('Report extension {0} "{1}"', bc.id, bc.reportName) : l10n.t('Report {0} "{1}"', bc.id, bc.reportName)}
            </button>
            <div className="muted">{bc.alFile}</div>
            {!bc.complete && <div className="prop-note warn">{l10n.t('The base report is not in the workspace; only the extensions are known.')}</div>}
            {bc.missingInLayout.length > 0 && (
              <div className="prop-note warn">
                {l10n.t('{0} column(s)/label(s) are not in the layout dataset yet. When the project is built, the AL compiler updates the layout.', bc.missingInLayout.length)}
                <button className="secondary small build-button" onClick={() => post({ type: 'run', command: 'bcReportBuilder.buildAl' })}>
                  <Codicon name="package" /> {l10n.t('Build Project')}
                </button>
              </div>
            )}
            {bc.removedInAl.length > 0 && (
              <div className="prop-note warn">{l10n.t('In the layout but no longer in the AL report: {0}', bc.removedInAl.join(', '))}</div>
            )}
          </div>
        ) : (
          <div className="prop-note">{l10n.t('No AL report in the workspace refers to this layout (rendering › LayoutFile or RDLCLayout). The layout dataset is shown.')}</div>
        )}

        {bc?.layouts && bc.layouts.length > 1 && (
          <Group label={l10n.t('Layouts of the Report')} open={isOpen('layouts')} onToggle={() => toggle('layouts')}>
            {bc.layouts.map(l => {
              const rdlc = /^rdlc$/i.test(l.type);
              return (
                <div key={l.uri} className={`tree-leaf layout-entry ${l.current ? 'current' : ''} ${l.exists ? '' : 'missing'}`}
                  title={`${l.path}${l.owner !== bc.reportName ? ` ${l10n.t('(from {0})', l.owner)}` : ''}${l.exists ? '' : `\n${l10n.t('File missing')}`}${rdlc ? '' : `\n${l10n.t('The designer does not edit Word and Excel layouts – opens in Word or Excel')}`}`}
                  onClick={() => !l.current && l.exists && post({ type: 'openLayout', uri: l.uri })}>
                  <Codicon name={l.current ? 'check' : rdlc ? 'layout' : l.type.toLowerCase() === 'excel' ? 'table' : 'file-text'} className="glyph" />
                  <span className="grow">{l.name}</span>
                  <span className="tree-meta">{l.type}</span>
                </div>
              );
            })}
            {bc.layouts.some(l => !/^rdlc$/i.test(l.type)) && (
              <div className="prop-note">{l10n.t('Word and Excel layouts use the same dataset but are not edited here; a click opens them in Word or Excel.')}</div>
            )}
          </Group>
        )}

        {bc ? (
          <Group label={l10n.t('Data Items')} open={isOpen('items')} onToggle={() => toggle('items')}>
            {bc.dataItems.map(d => item(d, 0))}
            {!bc.dataItems.length && <div className="tree-empty">{l10n.t('No data items')}</div>}
          </Group>
        ) : (
          <Group label={dataSet?.name ?? 'Dataset'} open={isOpen('fields')} onToggle={() => toggle('fields')}>
            {dataSet?.fields.map(f => (
              <div key={f.name} className="tree-leaf field" {...dragProps({ kind: 'field', dataSet: dataSet.name, field: f.name, typeName: f.typeName })}
                {...vsContext({ webviewSection: 'dataField', expression: `=Fields!${f.name}.Value` })}>
                <Codicon name="symbol-field" className="glyph" />{f.name}
              </div>
            ))}
          </Group>
        )}

        <Group label={l10n.t('Labels and Captions')} open={isOpen('labels')} onToggle={() => toggle('labels')}>
          {bc ? <>
            {bc.labels.map(l => (
              <div key={l.name} className={`tree-leaf ${l.inLayout ? '' : 'not-built'}`} {...dragProps({ kind: 'parameter', name: l.name })}
                onDoubleClick={() => reveal(l.line, l.character)} title={[l10n.t('Label: "{0}"', l.text), l.comment && l10n.t('Note: {0}', l.comment), l.maxLength && l10n.t('Maximum length: {0}', l.maxLength), l.locked && l10n.t('Not translated (Locked)')].filter(Boolean).join('\n')}
                {...vsContext({ webviewSection: 'alSymbol', line: l.line, character: l.character, expression: `=Parameters!${l.name}.Value` })}>
                <Codicon name="symbol-key" className="glyph" />{l.name}<span className="tree-meta">{l.text}</span>
                {!l.inLayout && <span className="badge warn" title={l10n.t('Build the project so that the compiler updates the layout dataset')}>Build</span>}
              </div>
            ))}
            {bc.captions.map(c => (
              <div key={c.name} className={`tree-leaf ${c.inLayout ? '' : 'not-built'}`} {...dragProps({ kind: 'parameter', name: c.name })}
                title={l10n.t('Caption of column {0} (IncludeCaption)', c.column)}
                {...vsContext({ webviewSection: 'dataField', expression: `=Parameters!${c.name}.Value` })}>
                <Codicon name="symbol-key" className="glyph" />{c.name}<span className="tree-meta">{c.text}</span>
                {!c.inLayout && <span className="badge warn" title={l10n.t('Build the project so that the compiler updates the layout dataset')}>Build</span>}
              </div>
            ))}
            {!bc.labels.length && !bc.captions.length && <div className="tree-empty">{l10n.t('No labels')}</div>}
          </> : report.parameters.map(p => (
            <div key={p.id} className="tree-leaf" {...dragProps({ kind: 'parameter', name: p.name })}
              {...vsContext({ webviewSection: 'dataField', expression: `=Parameters!${p.name}.Value` })}>
              <Codicon name="symbol-key" className="glyph" />{p.name}
            </div>
          ))}
        </Group>

        <Group label={l10n.t('Built-in Fields')} open={isOpen('globals')} onToggle={() => toggle('globals')}>
          {globals().map(([name, label]) => (
            <div key={name} className="tree-leaf" {...dragProps({ kind: 'global', name })} title={`=Globals!${name}`}
              {...vsContext({ webviewSection: 'dataField', expression: `=Globals!${name}` })}>
              <Codicon name="symbol-constant" className="glyph" />{label}
            </div>
          ))}
        </Group>

        <ImagesGroup open={isOpen('images')} onToggle={() => toggle('images')} />

        <Group label={l10n.t('Preview Data')} open={isOpen('data')} onToggle={() => toggle('data')}>
          <div className="prop-note">
            {rows ? l10n.t('{0} rows from {1}.', rows.length, dataSet?.name ?? '') : bc ? l10n.t('Without data the preview generates sample rows along the data items.') : l10n.t('Without data the preview generates placeholder values.')}
            {' '}{l10n.t('In Business Central: run the report › Send to › Microsoft Excel Document (data only).')}
          </div>
          <button className="secondary small" onClick={() => post({ type: 'importSampleData', dataSet: dataSet?.name ?? 'DataSet_Result' })}>{l10n.t('Load Data (Excel, CSV, JSON)…')}</button>
        </Group>
      </div>
      <div className="pane-hint">{l10n.t('Drag columns, labels and fields onto the design surface or into table cells. Double-click opens the definition in the AL code.')}</div>
    </div>
  );
}
