import { useState } from 'react';
import { BcDataItem } from '../bc';
import { useEditor } from '../editor';
import { post, vsContext } from '../vscode';
import { GLOBALS, Group, Twisty, dragProps } from './ReportDataPane';
import { ActionButton, Codicon } from './Icon';

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
        <div className="tree-node" title={`${d.table} – auf die Fläche ziehen erzeugt eine Tabelle; Doppelklick öffnet die Definition`} onDoubleClick={() => reveal(d.line, d.character)}
          {...dragProps({ kind: 'dataItem', dataSet: dataSet?.name ?? 'DataSet_Result', name: d.name, columns: d.columns.map(c => c.name) })}
          {...vsContext({ webviewSection: 'alDataItem', dataItem: d.name, table: d.table, line: d.line, character: d.character })}>
          <Twisty open={isOpen(key)} onClick={() => toggle(key)} />
          <Codicon name="symbol-class" className="glyph" />{d.name}<span className="tree-meta">{d.table}</span>
          {d.table && <span className="row-actions" onClick={e => e.stopPropagation()}>
            <ActionButton icon="add" title={`Felder von „${d.table.replace(/"/g, '')}“ als Spalten hinzufügen…`}
              onClick={() => post({ type: 'run', command: 'bcReportBuilder.addColumns', args: [{ dataItem: d.name }] })} />
          </span>}
        </div>
        {isOpen(key) && (
          <div className="tree-children">
            {d.columns.map(c => (
              <div key={c.name} className={`tree-leaf field ${c.inLayout ? '' : 'not-built'}`}
                {...dragProps({ kind: 'field', dataSet: dataSet?.name ?? 'DataSet_Result', field: c.name, typeName: typeOf(c.name) })}
                onDoubleClick={() => reveal(c.line, c.character)}
                {...vsContext({ webviewSection: 'alSymbol', line: c.line, character: c.character, expression: `=Fields!${c.name}.Value` })}
                title={`${c.name} = ${c.source}${c.includeCaption ? ' (mit Beschriftung)' : ''}${c.inLayout ? '' : '\nNoch nicht im Layout-Dataset – Projekt erstellen'}\nDoppelklick öffnet die Definition`}>
                <Codicon name="symbol-field" className="glyph" />{c.name}
                {!c.inLayout && <span className="badge warn" title="Projekt erstellen, damit der Compiler das Layout-Dataset aktualisiert">Build</span>}
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
              <Codicon name="symbol-class" /> {bc.kind === 'reportextension' ? 'Report-Extension' : 'Report'} {bc.id} „{bc.reportName}“
            </button>
            <div className="muted">{bc.alFile}</div>
            {!bc.complete && <div className="prop-note warn">Der Basis-Report liegt nicht im Workspace; nur die Erweiterungen sind bekannt.</div>}
            {bc.missingInLayout.length > 0 && (
              <div className="prop-note warn">
                {bc.missingInLayout.length} Spalte(n)/Label(s) sind noch nicht im Layout-Dataset. Nach dem Erstellen des Projekts aktualisiert der AL-Compiler das Layout.
                <button className="secondary small build-button" onClick={() => post({ type: 'run', command: 'bcReportBuilder.buildAl' })}>
                  <Codicon name="package" /> Projekt erstellen
                </button>
              </div>
            )}
            {bc.removedInAl.length > 0 && (
              <div className="prop-note warn">Im Layout, aber nicht mehr im AL-Report: {bc.removedInAl.join(', ')}</div>
            )}
          </div>
        ) : (
          <div className="prop-note">Kein AL-Report im Workspace verweist auf dieses Layout (rendering › LayoutFile bzw. RDLCLayout). Angezeigt wird das Layout-Dataset.</div>
        )}

        {bc ? (
          <Group label="Datenelemente" open={isOpen('items')} onToggle={() => toggle('items')}>
            {bc.dataItems.map(d => item(d, 0))}
            {!bc.dataItems.length && <div className="tree-empty">Keine Datenelemente</div>}
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

        <Group label="Labels und Beschriftungen" open={isOpen('labels')} onToggle={() => toggle('labels')}>
          {bc ? <>
            {bc.labels.map(l => (
              <div key={l.name} className={`tree-leaf ${l.inLayout ? '' : 'not-built'}`} {...dragProps({ kind: 'parameter', name: l.name })}
                onDoubleClick={() => reveal(l.line, l.character)} title={`Label: „${l.text}“`}
                {...vsContext({ webviewSection: 'alSymbol', line: l.line, character: l.character, expression: `=Parameters!${l.name}.Value` })}>
                <Codicon name="symbol-key" className="glyph" />{l.name}<span className="tree-meta">{l.text}</span>
                {!l.inLayout && <span className="badge warn" title="Projekt erstellen, damit der Compiler das Layout-Dataset aktualisiert">Build</span>}
              </div>
            ))}
            {bc.captions.map(c => (
              <div key={c.name} className={`tree-leaf ${c.inLayout ? '' : 'not-built'}`} {...dragProps({ kind: 'parameter', name: c.name })}
                title={`Beschriftung der Spalte ${c.column} (IncludeCaption)`}
                {...vsContext({ webviewSection: 'dataField', expression: `=Parameters!${c.name}.Value` })}>
                <Codicon name="symbol-key" className="glyph" />{c.name}<span className="tree-meta">{c.text}</span>
                {!c.inLayout && <span className="badge warn" title="Projekt erstellen, damit der Compiler das Layout-Dataset aktualisiert">Build</span>}
              </div>
            ))}
            {!bc.labels.length && !bc.captions.length && <div className="tree-empty">Keine Labels</div>}
          </> : report.parameters.map(p => (
            <div key={p.id} className="tree-leaf" {...dragProps({ kind: 'parameter', name: p.name })}
              {...vsContext({ webviewSection: 'dataField', expression: `=Parameters!${p.name}.Value` })}>
              <Codicon name="symbol-key" className="glyph" />{p.name}
            </div>
          ))}
        </Group>

        <Group label="Integrierte Felder" open={isOpen('globals')} onToggle={() => toggle('globals')}>
          {GLOBALS.map(([name, label]) => (
            <div key={name} className="tree-leaf" {...dragProps({ kind: 'global', name })} title={`=Globals!${name}`}
              {...vsContext({ webviewSection: 'dataField', expression: `=Globals!${name}` })}>
              <Codicon name="symbol-constant" className="glyph" />{label}
            </div>
          ))}
        </Group>

        <Group label="Vorschaudaten" open={isOpen('data')} onToggle={() => toggle('data')}>
          <div className="prop-note">
            {rows ? `${rows.length} Zeilen aus ${dataSet?.name}.` : bc ? 'Ohne Daten erzeugt die Vorschau Beispielzeilen entlang der Datenelemente.' : 'Ohne Daten erzeugt die Vorschau Platzhalterwerte.'}
            {' '}In Business Central: Report ausführen › Senden an › Microsoft Excel-Dokument (nur Daten).
          </div>
          <button className="secondary small" onClick={() => post({ type: 'importSampleData', dataSet: dataSet?.name ?? 'DataSet_Result' })}>Daten laden (Excel, CSV, JSON)…</button>
        </Group>
      </div>
      <div className="pane-hint">Spalten, Labels und Felder auf die Entwurfsfläche oder in Tabellenzellen ziehen. Doppelklick öffnet die Definition im AL-Code.</div>
    </div>
  );
}
