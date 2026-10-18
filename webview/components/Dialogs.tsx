import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Dialog, useEditor } from '../editor';
import { EvalContext, evaluate, formatValue, toStr, validateExpression } from '../expr';
import { DataSet, DataSource, Field, Parameter, ParameterType, Report, allReportItems, guid, newId } from '../model';
import { bindRows, inferFields, mockRows } from '../sampleData';
import { post } from '../vscode';
import { ReportProps, ToggleSelect } from './PropertiesPane';
import { ActionButton, Codicon } from './Icon';
import { ExpressionInput } from './ExpressionInput';
import { ExpressionSearchDialog } from './ExpressionSearchDialog';
import { BlockDialog } from './BlockDialog';
import { ChartDialog } from './ChartDialog';
import { BreakLocation, RowMember, SortExpression, TableFilter, TableItem } from '../model';
import { locate } from '../ops';
import { addChildGroup, addColumnGroup, addParentGroup, createMatrix, findMember, uniqueGroupName, usedGroupNames } from '../tablix';
import { sectionOf } from '../ops';
import { hiddenOf, setHidden, setToggleItem, toggleItemOf } from '../layoutTools';
import { l10n } from '../l10n';

const IDENT = /^[A-Za-z_][\w]*$/;

/** VS Code's dialogs put the primary button last on macOS and first elsewhere. */
const PRIMARY_LAST = navigator.platform.startsWith('Mac');

function Modal(props: { title: string; children: ReactNode; onOk?: () => void; onCancel: () => void; okLabel?: string; error?: string | null; wide?: boolean }) {
  // give the focus back to where it was (designer, tree, toolbar) when the dialog closes
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);
  const ok = props.onOk && !props.error ? props.onOk : undefined;
  const buttons = [
    props.onOk && <button key="ok" className="primary" disabled={!!props.error} onClick={props.onOk}>{props.okLabel ?? 'OK'}</button>,
    <button key="cancel" onClick={props.onCancel}>{props.onOk ? l10n.t('Cancel') : l10n.t('Close')}</button>,
  ];
  return (
    <div className="modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) props.onCancel(); }}>
      <div className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Escape') props.onCancel();
          // Enter confirms, except in multi-line fields and on buttons (they handle it themselves)
          const t = e.target as HTMLElement;
          if (e.key === 'Enter' && ok && t.tagName !== 'TEXTAREA' && t.tagName !== 'BUTTON' && !e.nativeEvent.isComposing) { e.preventDefault(); ok(); }
        }}>
        <div className="modal-title"><span className="grow">{props.title}</span><ActionButton icon="close" title={l10n.t('Close (Esc)')} onClick={props.onCancel} /></div>
        <div className="modal-body">{props.children}</div>
        <div className="modal-footer">
          {props.error && <span className="modal-error"><Codicon name="error" /> {props.error}</span>}
          {PRIMARY_LAST ? [...buttons].reverse() : buttons}
        </div>
      </div>
    </div>
  );
}

const Field_ = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="form-row"><span>{label}</span>{children}</label>
);

export function Dialogs() {
  const { dialog, setDialog } = useEditor();
  if (!dialog) return null;
  const close = () => setDialog(null);
  switch (dialog.kind) {
    case 'expressionSearch': return <ExpressionSearchDialog close={close} />;
    case 'insertBlock': return <BlockDialog text={dialog.text} name={dialog.name} close={close} />;
    case 'dataSource': return <DataSourceDialog name={dialog.name} close={close} />;
    case 'dataSet': return <DataSetDialog name={dialog.name} close={close} />;
    case 'parameter': return <ParameterDialog name={dialog.name} close={close} />;
    case 'expression': return <ExpressionDialog d={dialog} close={close} />;
    case 'group': return <GroupDialog d={dialog} close={close} />;
    case 'chart': return <ChartDialog d={dialog} close={close} Modal={Modal} Field={Field_} />;
    case 'matrix': return <MatrixDialog d={dialog} close={close} />;
    case 'reportProperties': return <Modal title={l10n.t('Report Properties')} onCancel={close}><ReportProps /></Modal>;
  }
}

/** Common validation: identifier syntax and uniqueness among siblings. */
function nameError(name: string, taken: string[], what: string): string | null {
  if (!name) return l10n.t('{0}: name missing', what);
  if (!IDENT.test(name)) return l10n.t('{0}: the name may only contain letters, digits and _ and must not start with a digit', what);
  if (taken.includes(name)) return l10n.t('{0} "{1}" already exists', what, name);
  return null;
}

// ---------------------------------------------------------------------------------------------------------------

const providers = (): [string, string][] => [
  ['SQL', 'Microsoft SQL Server'], ['SQLAZURE', l10n.t('Microsoft Azure SQL Database')], ['OLEDB', 'OLE DB'], ['ODBC', 'ODBC'],
  ['ORACLE', 'Oracle'], ['XML', 'XML'], ['SHAREPOINTLIST', l10n.t('SharePoint List')], ['ENTERDATA', l10n.t('Enter Data')],
];

function DataSourceDialog({ name, close }: { name?: string; close: () => void }) {
  const ed = useEditor();
  const existing = ed.report.dataSources.find(d => d.name === name);
  const [d, setD] = useState<DataSource>(() => existing ? { ...existing } : {
    id: guid(), name: uniqueIn(ed.report.dataSources.map(x => x.name), 'DataSource'), provider: 'SQL',
    connectString: 'Data Source=localhost;Initial Catalog=AdventureWorks', extra: [], connExtra: [],
  });
  const shared = d.sharedReference !== undefined;
  const error = nameError(d.name, ed.report.dataSources.filter(x => x !== existing).map(x => x.name), l10n.t('Data source'));

  const ok = () => {
    ed.commit(r => {
      if (existing) {
        r.dataSources = r.dataSources.map(x => (x.name === existing.name ? d : x));
        for (const ds of r.dataSets) if (ds.dataSourceName === existing.name) ds.dataSourceName = d.name;
      } else {
        r.dataSources.push(d);
      }
    });
    close();
  };

  return (
    <Modal title={existing ? l10n.t('Data Source Properties') : l10n.t('New Data Source')} onOk={ok} onCancel={close} error={error}>
      <Field_ label={l10n.t('Name')}><input autoFocus value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field_>
      <div className="radio-group">
        <label><input type="radio" checked={shared} onChange={() => setD({ ...d, sharedReference: `/${l10n.t('Data Sources')}/` })} /> {l10n.t('Use a shared data source')}</label>
        <label><input type="radio" checked={!shared} onChange={() => setD({ ...d, sharedReference: undefined })} /> {l10n.t('Use a connection embedded in my report')}</label>
      </div>
      {shared ? (
        <Field_ label={l10n.t('Path')}><input value={d.sharedReference} onChange={e => setD({ ...d, sharedReference: e.target.value })} placeholder={`/${l10n.t('Data Sources')}/AdventureWorks`} /></Field_>
      ) : (
        <>
          <Field_ label={l10n.t('Connection type')}>
            <select value={d.provider} onChange={e => setD({ ...d, provider: e.target.value })}>
              {[...new Set([d.provider, ...providers().map(p => p[0])])].map(p => <option key={p} value={p}>{providers().find(x => x[0] === p)?.[1] ?? p}</option>)}
            </select>
          </Field_>
          <Field_ label={l10n.t('Connection string')}>
            <textarea rows={3} value={d.connectString} onChange={e => setD({ ...d, connectString: e.target.value })} spellCheck={false} />
          </Field_>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------

const TYPES = ['System.String', 'System.Int32', 'System.Int64', 'System.Decimal', 'System.Double', 'System.DateTime', 'System.Boolean', 'System.Byte[]'];

/** Best-effort column list from "SELECT a, b AS c, t.d FROM …" – what Report Builder gets by running the query. */
export function fieldsFromSql(sql: string): Field[] {
  const m = /select\s+(?:distinct\s+)?(?:top\s+\(?\d+\)?\s+)?([\s\S]+?)\s+from\s/i.exec(sql);
  if (!m) return [];
  const cols: string[] = [];
  let depth = 0, cur = '';
  for (const ch of m[1]) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { cols.push(cur); cur = ''; } else cur += ch;
  }
  cols.push(cur);
  return cols.map(c => c.trim()).filter(c => c && c !== '*').map(c => {
    const alias = /\s+as\s+\[?(\w+)\]?$/i.exec(c) ?? /\s\[?(\w+)\]?$/.exec(c) ?? /(?:^|\.)\[?(\w+)\]?$/.exec(c);
    const name = alias?.[1] ?? c.replace(/\W/g, '_');
    return { name, dataField: name, typeName: 'System.String' };
  });
}

function DataSetDialog({ name, close }: { name?: string; close: () => void }) {
  const ed = useEditor();
  const existing = ed.report.dataSets.find(d => d.name === name);
  const [d, setD] = useState<DataSet>(() => existing ? structuredClone(existing) : {
    id: newId(), name: uniqueIn(ed.report.dataSets.map(x => x.name), 'DataSet'),
    dataSourceName: ed.report.dataSources[0]?.name ?? '', commandText: 'SELECT\n  \nFROM ', fields: [], extra: [], queryExtra: [],
  });
  const [tab, setTab] = useState<'query' | 'fields'>('query');
  const sample = ed.sampleData[d.name];
  const fieldNames = d.fields.map(f => f.name);
  const error = nameError(d.name, ed.report.dataSets.filter(x => x !== existing).map(x => x.name), 'Dataset')
    ?? (d.fields.some(f => !IDENT.test(f.name)) ? l10n.t('Invalid field name') : null)
    ?? (new Set(fieldNames).size !== fieldNames.length ? l10n.t('Field names must be unique') : null);

  const setField = (i: number, patch: Partial<Field>) => setD({ ...d, fields: d.fields.map((f, j) => (i === j ? { ...f, ...patch } : f)) });
  const mergeFields = (found: Field[]) => setD({
    ...d,
    fields: [...d.fields, ...found.filter(f => !fieldNames.includes(f.name))].map(f => {
      const better = found.find(x => x.name === f.name);
      return better && (f.typeName === 'System.String' || !f.typeName) ? { ...f, typeName: better.typeName } : f;
    }),
  });

  const ok = () => {
    ed.commit(r => {
      if (existing) {
        r.dataSets = r.dataSets.map(x => (x.name === existing.name ? d : x));
        if (d.name !== existing.name) {
          for (const it of allReportItems(r)) if (it.type === 'table' && it.dataSetName === existing.name) it.dataSetName = d.name;
        }
      } else {
        r.dataSets.push(d);
      }
    });
    close();
  };

  return (
    <Modal title={existing ? l10n.t('Dataset Properties') : l10n.t('New Dataset')} onOk={ok} onCancel={close} error={error} wide>
      <div className="tabs">
        <button className={tab === 'query' ? 'on' : ''} onClick={() => setTab('query')}>{l10n.t('Query')}</button>
        <button className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>{l10n.t('Fields ({0})', d.fields.length)}</button>
      </div>
      {tab === 'query' ? (
        <>
          <Field_ label={l10n.t('Name')}><input autoFocus value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field_>
          <Field_ label={l10n.t('Data source')}>
            <select value={d.dataSourceName} onChange={e => setD({ ...d, dataSourceName: e.target.value })}>
              {!ed.report.dataSources.some(s => s.name === d.dataSourceName) && <option value={d.dataSourceName}>{d.dataSourceName || l10n.t('(none)')}</option>}
              {ed.report.dataSources.map(s => <option key={s.id}>{s.name}</option>)}
            </select>
          </Field_>
          <Field_ label={l10n.t('Query')}>
            <textarea className="code" rows={10} value={d.commandText} spellCheck={false} onChange={e => setD({ ...d, commandText: e.target.value })} />
          </Field_>
          <div className="button-row">
            <button onClick={() => { mergeFields(fieldsFromSql(d.commandText)); setTab('fields'); }}>{l10n.t('Derive Fields from Query')}</button>
          </div>
        </>
      ) : (
        <>
          <table className="grid">
            <thead><tr><th>{l10n.t('Field name')}</th><th>{l10n.t('Field source')}</th><th>{l10n.t('Type')}</th><th /></tr></thead>
            <tbody>
              {d.fields.map((f, i) => (
                <tr key={i}>
                  <td><input value={f.name} onChange={e => setField(i, { name: e.target.value })} /></td>
                  <td>
                    {f.value !== undefined
                      ? <input value={f.value} title={l10n.t('Calculated field')} onChange={e => setField(i, { value: e.target.value })} />
                      : <input value={f.dataField} onChange={e => setField(i, { dataField: e.target.value })} />}
                  </td>
                  <td>
                    <select value={f.typeName} onChange={e => setField(i, { typeName: e.target.value })}>
                      {[...new Set([f.typeName, ...TYPES])].map(t => <option key={t} value={t}>{t ? t.replace('System.', '') : l10n.t('(not specified)')}</option>)}
                    </select>
                  </td>
                  <td><ActionButton icon="trash" title={l10n.t('Remove')} onClick={() => setD({ ...d, fields: d.fields.filter((_, j) => j !== i) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="button-row">
            <button onClick={() => setD({ ...d, fields: [...d.fields, { name: uniqueIn(fieldNames, 'Field'), dataField: '', typeName: 'System.String' }] })}>{l10n.t('Add Query Field')}</button>
            <button onClick={() => setD({ ...d, fields: [...d.fields, { name: uniqueIn(fieldNames, 'Calculated'), dataField: '', typeName: 'System.String', value: '=' }] })}>{l10n.t('Add Calculated Field')}</button>
            <button onClick={() => post({ type: 'importSampleData', dataSet: d.name })}>{l10n.t('Load Sample Data (Excel, CSV, JSON)…')}</button>
            <button disabled={!sample?.length} onClick={() => mergeFields(inferFields(sample))}>{l10n.t('Take Fields from Sample Data')}</button>
          </div>
          <div className="prop-note">
            {sample ? l10n.t('{0} rows of sample data available for the preview.', sample.length) : l10n.t('Without sample data the preview generates placeholder values. Sample data (Excel, CSV or JSON) is saved next to the report as <Name>.data.json.')}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------

function ParameterDialog({ name, close }: { name?: string; close: () => void }) {
  const ed = useEditor();
  const existing = ed.report.parameters.find(p => p.name === name);
  const [p, setP] = useState<Parameter>(() => existing ? { ...existing } : {
    id: newId(), name: uniqueIn(ed.report.parameters.map(x => x.name), 'ReportParameter'),
    dataType: 'String', prompt: '', defaultValue: '', allowBlank: false, nullable: false, extra: [],
  });
  const error = nameError(p.name, ed.report.parameters.filter(x => x !== existing).map(x => x.name), l10n.t('Parameter'));

  const ok = () => {
    ed.commit(r => {
      if (existing) {
        r.parameters = r.parameters.map(x => (x.name === existing.name ? p : x));
        if (p.name !== existing.name) renameParameterRefs(r, existing.name, p.name);
      } else {
        r.parameters.push({ ...p, prompt: p.prompt || p.name });
      }
    });
    close();
  };

  return (
    <Modal title={existing ? l10n.t('Report Parameter Properties') : l10n.t('New Report Parameter')} onOk={ok} onCancel={close} error={error}>
      <Field_ label={l10n.t('Name')}><input autoFocus value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field_>
      <Field_ label={l10n.t('Prompt')}><input value={p.prompt} placeholder={p.name} onChange={e => setP({ ...p, prompt: e.target.value })} /></Field_>
      <Field_ label={l10n.t('Data type')}>
        <select value={p.dataType} onChange={e => setP({ ...p, dataType: e.target.value as ParameterType })}>
          <option value="String">{l10n.t('Text')}</option><option value="Integer">{l10n.t('Integer')}</option><option value="Float">{l10n.t('Float')}</option>
          <option value="DateTime">{l10n.t('Date/Time')}</option><option value="Boolean">{l10n.t('Boolean')}</option>
        </select>
      </Field_>
      <Field_ label={l10n.t('Default value')}><input value={p.defaultValue} placeholder={l10n.t('(no default value)')} onChange={e => setP({ ...p, defaultValue: e.target.value })} /></Field_>
      <label className="check"><input type="checkbox" checked={p.allowBlank} onChange={e => setP({ ...p, allowBlank: e.target.checked })} /> {l10n.t('Allow blank value ("")')}</label>
      <label className="check"><input type="checkbox" checked={p.nullable} onChange={e => setP({ ...p, nullable: e.target.checked })} /> {l10n.t('Allow null value')}</label>
      {p.extra.length > 0 && <div className="prop-note">{l10n.t('Available values and further settings from the file are kept.')}</div>}
    </Modal>
  );
}

function renameParameterRefs(r: Report, from: string, to: string) {
  const re = new RegExp(`Parameters!${from}\\b`, 'g');
  for (const it of allReportItems(r)) {
    if (it.type === 'textbox') it.value = it.value.replace(re, `Parameters!${to}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------

const functions = (): [string, string][] => [
  ['Sum(Fields!X.Value)', l10n.t('Sum')], ['Avg(Fields!X.Value)', l10n.t('Average')], ['Count(Fields!X.Value)', l10n.t('Count')],
  ['CountDistinct(Fields!X.Value)', l10n.t('Count distinct')], ['Min(Fields!X.Value)', l10n.t('Minimum')], ['Max(Fields!X.Value)', l10n.t('Maximum')],
  ['First(Fields!X.Value)', l10n.t('First value')], [l10n.t('IIf(Condition, TrueValue, FalseValue)'), l10n.t('If-then')], [l10n.t('Format(Value, "N2")'), l10n.t('Format a value')],
  [l10n.t('FormatCurrency(Value)'), l10n.t('As currency')], [l10n.t('FormatPercent(Value, 1)'), l10n.t('As percent')], [l10n.t('UCase(Text)'), l10n.t('Upper case')],
  [l10n.t('Left(Text, 3)'), l10n.t('Left')], [l10n.t('Len(Text)'), l10n.t('Length')], ['Today()', l10n.t('Today')], ['Now()', l10n.t('Now')], [l10n.t('Year(Date)'), l10n.t('Year')],
  [l10n.t('DateAdd("d", 1, Date)'), l10n.t('Add to date')], [l10n.t('IsNothing(Value)'), l10n.t('Is empty')], ['RowNumber(Nothing)', l10n.t('Row number')],
];
const OPERATORS = ['&', '+', '-', '*', '/', '=', '<>', '<', '>', 'And', 'Or', 'Not'];

function ExpressionDialog({ d, close }: { d: Extract<Dialog, { kind: 'expression' }>; close: () => void }) {
  const ed = useEditor();
  const [value, setValue] = useState(d.value.startsWith('=') ? d.value : d.value ? `="${d.value.replace(/"/g, '""')}"` : '=');
  const [category, setCategory] = useState<'fields' | 'params' | 'globals' | 'functions' | 'operators'>('fields');
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const error = validateExpression(value);

  const insert = (text: string) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const next = value.slice(0, s) + text + value.slice(e);
    setValue(next.startsWith('=') ? next : `=${next}`);
    requestAnimationFrame(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + text.length; });
  };

  const dataSets = d.dataSetName ? ed.report.dataSets.filter(x => x.name === d.dataSetName) : ed.report.dataSets;
  const items: [string, string][] = useMemo(() => {
    switch (category) {
      case 'fields': return dataSets.flatMap(ds => ds.fields.map(f => [
        d.dataSetName ? `Fields!${f.name}.Value` : `First(Fields!${f.name}.Value, "${ds.name}")`, `${ds.name}.${f.name}`] as [string, string]));
      case 'params': return ed.report.parameters.map(p => [`Parameters!${p.name}.Value`, p.name]);
      case 'globals': return ['ExecutionTime', 'PageNumber', 'TotalPages', 'ReportName', 'ReportFolder'].map(g => [`Globals!${g}`, g]);
      case 'functions': return functions().map(([f, l]) => [f, `${f.split('(')[0]} – ${l}`]);
      case 'operators': return OPERATORS.map(o => [` ${o} `, o]);
    }
  }, [category, dataSets, d.dataSetName, ed.report.parameters]);

  // Live result against the first row of sample (or generated) data.
  const result = useMemo(() => {
    if (error) return null;
    const sets: Record<string, Record<string, unknown>[]> = {};
    for (const ds of ed.report.dataSets) sets[ds.name] = bindRows(ds, ed.sampleData[ds.name] ?? mockRows(ds));
    const scope = d.dataSetName ? sets[d.dataSetName] ?? [] : [];
    const ctx: EvalContext = {
      row: scope[0] ?? null, scopeRows: scope, dataSets: sets,
      parameters: Object.fromEntries(ed.report.parameters.map(p => [p.name, p.defaultValue || null])),
      globals: { ExecutionTime: new Date(), PageNumber: 1, TotalPages: 1, ReportName: l10n.t('Report'), ReportFolder: '/' },
    };
    try { return formatValue(evaluate(value, ctx), ''); } catch (e) { return l10n.t('Error: {0}', (e as Error).message); }
  }, [value, error, ed.report, ed.sampleData, d.dataSetName]);

  return (
    <Modal title={d.title} onOk={() => { d.onOk(value === '=' ? '' : value); close(); }} onCancel={close} error={error} wide>
      <ExpressionInput inputRef={el => { ref.current = el as HTMLTextAreaElement | null; }} className="code expr-editor" multiline rows={5} autoFocus
        dataSetName={d.dataSetName} value={value} onChange={setValue} />
      <div className="expr-hint">{l10n.t('Ctrl+Space shows suggestions; after {0} automatically.', 'Fields!, Parameters!, Code. …')}</div>
      <div className="expr-result">{result !== null && <>{d.dataSetName ? l10n.t('Result (first row)') : l10n.t('Result')}: <code>{toStr(result) || l10n.t('(empty)')}</code></>}</div>
      <div className="expr-picker">
        <div className="expr-cats">
          {([['fields', l10n.t('Fields')], ['params', l10n.t('Parameters')], ['globals', l10n.t('Built-in Fields')], ['functions', l10n.t('Functions')], ['operators', l10n.t('Operators')]] as const).map(([k, l]) => (
            <button key={k} className={category === k ? 'on' : ''} onClick={() => setCategory(k)}>{l}</button>
          ))}
        </div>
        <div className="expr-items">
          {items.map(([code, label]) => <button key={code + label} title={code} onClick={() => insert(code)}>{label}</button>)}
          {!items.length && <div className="tree-empty">{l10n.t('No entries')}</div>}
        </div>
      </div>
    </Modal>
  );
}

function uniqueIn(names: string[], prefix: string) {
  let n = 1;
  while (names.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

const OPERATORS_FILTER: [string, string][] = [
  ['Equal', '='], ['NotEqual', '<>'], ['GreaterThan', '>'], ['GreaterThanOrEqual', '>='], ['LessThan', '<'], ['LessThanOrEqual', '<='],
  ['Like', 'Like'], ['In', 'In'], ['Between', 'Between'], ['TopN', 'Top N'], ['BottomN', 'Bottom N'],
];
const breaks = (): [BreakLocation, string][] => [
  ['', l10n.t('No page break')], ['Between', l10n.t('Between the groups')], ['Start', l10n.t('Before each group')], ['End', l10n.t('After each group')],
  ['StartAndEnd', l10n.t('Before and after each group')],
];
const RESET = '<ResetPageNumber>true</ResetPageNumber>';

/** Add Group / Group Properties of Report Builder: grouping, header/footer rows, sorting, filters, page breaks, visibility. */
function GroupDialog({ d, close }: { d: Extract<Dialog, { kind: 'group' }>; close: () => void }) {
  const ed = useEditor();
  const table = locate(ed.report, d.table)?.item as TableItem | undefined;
  const existing = table && d.member ? findMember(table, d.member)?.member : undefined;
  const details = !!existing?.group && !existing.group.expressions.length && !existing.children.length;
  const [name, setName] = useState(existing?.group?.name ?? uniqueGroupName(ed.report));
  const [expressions, setExpressions] = useState<string[]>(existing?.group?.expressions.length ? existing.group.expressions : details ? [] : ['']);
  const [header, setHeader] = useState(true);
  const [footer, setFooter] = useState(false);
  const [sort, setSort] = useState<SortExpression[]>(existing?.sort ?? []);
  const [filters, setFilters] = useState<TableFilter[]>(existing?.group?.filters ?? []);
  const verbatimFilters = !!existing?.group?.extra.some(x => x.startsWith('<Filters'));
  const [pageBreak, setPageBreak] = useState<BreakLocation>(existing?.group?.pageBreak ?? '');
  const [reset, setReset] = useState(!!existing?.group?.pageBreakExtra.includes(RESET));
  const [hidden, setHiddenValue] = useState(existing ? hiddenOf(existing) : '');
  const [toggle, setToggle] = useState(existing ? toggleItemOf(existing) : '');
  if (!table) return null;

  // group names share one namespace with data sets and report items
  const taken = new Set([...usedGroupNames(ed.report), ...[...ed.report.dataSets.map(x => x.name), ...allReportItems(ed.report).map(i => i.name)].map(n => n.toLowerCase())]);
  const error = !IDENT.test(name) ? l10n.t('Invalid group name')
    : name.toLowerCase() !== existing?.group?.name.toLowerCase() && taken.has(name.toLowerCase()) ? l10n.t('"{0}" is taken already', name)
    : !details && !expressions.some(e => e.trim()) ? l10n.t('Group by: at least one expression')
    : [...expressions, ...sort.map(x => x.value), ...filters.map(f => f.expression)].map(e => (e.trim().startsWith('=') ? validateExpression(e) : null)).find(Boolean) ?? null;

  const apply = (m: RowMember) => {
    m.group!.name = name;
    m.group!.expressions = expressions.map(e => e.trim()).filter(Boolean);
    m.sort = sort.filter(x => x.value.trim());
    if (!verbatimFilters) m.group!.filters = filters.filter(f => f.expression.trim());
    m.group!.pageBreak = pageBreak;
    m.group!.pageBreakExtra = [...m.group!.pageBreakExtra.filter(x => x !== RESET), ...(reset && pageBreak ? [RESET] : [])];
    setHidden(m, hidden);
    setToggleItem(m, toggle);
  };
  const ok = () => {
    ed.commit(r => {
      const t = locate(r, d.table)!.item as TableItem;
      if (d.create) {
        const opts = { name, expression: expressions[0]?.trim() ?? '', header, footer };
        const c = d.create;
        const m = c.mode === 'column' ? addColumnGroup(r, t, c.column, opts)
          : c.mode === 'parent' ? addParentGroup(r, t, c.rowId, opts) : addChildGroup(r, t, c.rowId, opts);
        if (!m) return false;
        apply(m);
      } else {
        const m = findMember(t, d.member!)?.member;
        if (!m?.group) return false;
        apply(m);
      }
    });
    close();
  };
  const fieldOptions = (ed.report.dataSets.find(x => x.name === table.dataSetName) ?? ed.report.dataSets[0])?.fields ?? [];
  const exprInput = (value: string, onChange: (v: string) => void, placeholder = '=Fields!…Value') => (
    <span className="expr-prop">
      <ExpressionInput value={value} onChange={onChange} dataSetName={table.dataSetName} placeholder={placeholder} />
      <select className="field-pick" value="" title={l10n.t('Choose a field')} onChange={e => e.target.value && onChange(`=Fields!${e.target.value}.Value`)}>
        <option value="">{l10n.t('Field…')}</option>
        {fieldOptions.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
      </select>
    </span>
  );

  return (
    <Modal title={d.create ? ({ parent: l10n.t('Add Parent Group'), child: l10n.t('Add Child Group'), column: l10n.t('Add Column Group') })[d.create.mode] : l10n.t('Group Properties – {0}', existing?.group?.name ?? '')}
      onOk={ok} onCancel={close} error={error} wide okLabel={d.create ? l10n.t('Add') : 'OK'}>
      <Field_ label={l10n.t('Name')}><input autoFocus value={name} onChange={e => setName(e.target.value)} /></Field_>
      {details ? <div className="prop-note">{l10n.t('Details group: one row per record – sorting, filters and visibility apply to the details.')}</div> : (
        <div className="form-row"><span>{l10n.t('Group by')}</span>
          <div className="list-editor">
            {expressions.map((e, i) => (
              <div key={i} className="list-row">
                {exprInput(e, v => setExpressions(expressions.map((x, j) => (j === i ? v : x))))}
                <ActionButton icon="trash" title={l10n.t('Remove')} disabled={expressions.length <= 1} onClick={() => setExpressions(expressions.filter((_, j) => j !== i))} />
              </div>
            ))}
            <button className="secondary small" onClick={() => setExpressions([...expressions, ''])}><Codicon name="add" /> {l10n.t('Expression')}</button>
          </div>
        </div>
      )}
      {d.create?.mode === 'column' && <div className="prop-note">{l10n.t('The column repeats for each group value; a header row above the table shows the value. Values in the column are usually aggregates, e.g. =Sum(Fields!Amount.Value).')}</div>}
      {d.create && d.create.mode !== 'column' && <>
        <label className="check"><input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} /> {l10n.t('Add group header')}</label>
        <label className="check"><input type="checkbox" checked={footer} onChange={e => setFooter(e.target.checked)} /> {l10n.t('Add group footer (e.g. for totals)')}</label>
      </>}
      <div className="form-row"><span>{l10n.t('Sorting')}</span>
        <div className="list-editor">
          {sort.map((x, i) => (
            <div key={i} className="list-row">
              {exprInput(x.value, v => setSort(sort.map((y, j) => (j === i ? { ...y, value: v } : y))))}
              <select value={x.descending ? 'd' : 'a'} onChange={e => setSort(sort.map((y, j) => (j === i ? { ...y, descending: e.target.value === 'd' } : y)))}>
                <option value="a">{l10n.t('Ascending')}</option><option value="d">{l10n.t('Descending')}</option>
              </select>
              <ActionButton icon="trash" title={l10n.t('Remove')} onClick={() => setSort(sort.filter((_, j) => j !== i))} />
            </div>
          ))}
          <button className="secondary small" onClick={() => setSort([...sort, { value: expressions[0] || '', descending: false }])}><Codicon name="add" /> {l10n.t('Sorting')}</button>
        </div>
      </div>
      <div className="form-row"><span>{l10n.t('Filter')}</span>
        {verbatimFilters ? <div className="prop-note">{l10n.t('The filters of this group use advanced options and stay unchanged (editable via "Open as XML").')}</div> : (
          <div className="list-editor">
            {filters.map((f, i) => (
              <div key={i} className="list-row">
                {exprInput(f.expression, v => setFilters(filters.map((y, j) => (j === i ? { ...y, expression: v } : y))))}
                <select value={f.operator} onChange={e => setFilters(filters.map((y, j) => (j === i ? { ...y, operator: e.target.value } : y)))}>
                  {OPERATORS_FILTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input className="filter-value" value={f.values.join(', ')} placeholder={l10n.t('Value')} title={l10n.t('Separate several values (In) with commas')}
                  onChange={e => setFilters(filters.map((y, j) => (j === i ? { ...y, values: f.operator === 'In' || f.operator === 'Between' ? e.target.value.split(/\s*,\s*/) : [e.target.value] } : y)))} />
                <ActionButton icon="trash" title={l10n.t('Remove')} onClick={() => setFilters(filters.filter((_, j) => j !== i))} />
              </div>
            ))}
            <button className="secondary small" onClick={() => setFilters([...filters, { expression: '', operator: 'Equal', values: [''] }])}><Codicon name="add" /> {l10n.t('Filter')}</button>
          </div>
        )}
      </div>
      {!details && (
        <div className="form-row"><span>{l10n.t('Page break')}</span>
          <div className="list-editor">
            <select value={pageBreak} onChange={e => setPageBreak(e.target.value as BreakLocation)}>{breaks().map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <label className="check"><input type="checkbox" disabled={!pageBreak} checked={reset && !!pageBreak} onChange={e => setReset(e.target.checked)} /> {l10n.t('Restart page numbers for each group (e.g. per document)')}</label>
          </div>
        </div>
      )}
      <Field_ label={l10n.t('Hide')}>
        <ExpressionInput value={hidden} onChange={setHiddenValue} dataSetName={table.dataSetName} placeholder={l10n.t('empty = visible, true or =expression')} />
      </Field_>
      <Field_ label={l10n.t('Toggled by')}>
        <ToggleSelect value={toggle} onChange={setToggle} />
      </Field_>
      <div className="prop-note">{l10n.t('Drilldown: "Hide" set to true and a textbox of the group above as toggle – in the preview and in Business Central each entry expands on its own.')}</div>
    </Modal>
  );
}

/** Insert › Matrix: rows grouped by one expression, columns by another, a value per intersection, optional totals. */
function MatrixDialog({ d, close }: { d: Extract<Dialog, { kind: 'matrix' }>; close: () => void }) {
  const ed = useEditor();
  const ds0 = ed.report.dataSets.find(x => x.name === 'DataSet_Result') ?? ed.report.dataSets[0];
  const [dataSetName, setDataSetName] = useState(ds0?.name ?? '');
  const [rowGroup, setRowGroup] = useState('');
  const [columnGroup, setColumnGroup] = useState('');
  const [value, setValue] = useState('');
  const [rowTotal, setRowTotal] = useState(true);
  const [columnTotal, setColumnTotal] = useState(true);
  const fields = ed.report.dataSets.find(x => x.name === dataSetName)?.fields ?? [];
  const error = !dataSetName ? l10n.t('Choose a dataset') : !rowGroup.trim() || !columnGroup.trim() ? l10n.t('Specify the row and column grouping') : !value.trim() ? l10n.t('Specify a value, e.g. =Sum(Fields!Amount.Value)')
    : [rowGroup, columnGroup, value].map(e => (e.trim().startsWith('=') ? validateExpression(e) : null)).find(Boolean) ?? null;
  const pick = (set: (v: string) => void, sum: boolean) => (
    <select className="field-pick" value="" title={l10n.t('Choose a field')} onChange={e => e.target.value && set(sum ? `=Sum(Fields!${e.target.value}.Value)` : `=Fields!${e.target.value}.Value`)}>
      <option value="">{l10n.t('Field…')}</option>{fields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
    </select>
  );
  const row = (label: string, v: string, set: (v: string) => void, sum: boolean, placeholder: string) => (
    <div className="form-row"><span>{label}</span>
      <span className="expr-prop"><ExpressionInput value={v} onChange={set} dataSetName={dataSetName} placeholder={placeholder} />{pick(set, sum)}</span>
    </div>
  );
  const ok = () => {
    let name = '';
    ed.commit(r => {
      const m = createMatrix(r, { top: d.create.top, left: d.create.left }, { dataSetName, rowGroup, columnGroup, value, rowTotal, columnTotal });
      sectionOf(r, d.create.section).items.push(m);
      name = m.name;
    });
    if (name) ed.select([name]);
    close();
  };
  return (
    <Modal title={l10n.t('Insert Matrix')} onOk={ok} onCancel={close} error={error} wide okLabel={l10n.t('Insert')}>
      <Field_ label={l10n.t('Dataset')}><select value={dataSetName} onChange={e => setDataSetName(e.target.value)}>{ed.report.dataSets.map(x => <option key={x.name}>{x.name}</option>)}</select></Field_>
      {row(l10n.t('Group rows by'), rowGroup, setRowGroup, false, l10n.t('=Fields!Customer.Value'))}
      {row(l10n.t('Group columns by'), columnGroup, setColumnGroup, false, l10n.t('=Fields!Month.Value'))}
      {row(l10n.t('Value'), value, setValue, true, l10n.t('=Sum(Fields!Amount.Value)'))}
      <label className="check"><input type="checkbox" checked={rowTotal} onChange={e => setRowTotal(e.target.checked)} /> {l10n.t('Total row')}</label>
      <label className="check"><input type="checkbox" checked={columnTotal} onChange={e => setColumnTotal(e.target.checked)} /> {l10n.t('Total column')}</label>
    </Modal>
  );
}
