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
import { ChartDialog } from './ChartDialog';
import { BreakLocation, RowMember, SortExpression, TableFilter, TableItem } from '../model';
import { locate } from '../ops';
import { addChildGroup, addParentGroup, createMatrix, findMember, uniqueGroupName, usedGroupNames } from '../tablix';
import { sectionOf } from '../ops';
import { hiddenOf, setHidden, setToggleItem, toggleItemOf } from '../layoutTools';

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
    <button key="cancel" onClick={props.onCancel}>{props.onOk ? 'Abbrechen' : 'Schließen'}</button>,
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
        <div className="modal-title"><span className="grow">{props.title}</span><ActionButton icon="close" title="Schließen (Esc)" onClick={props.onCancel} /></div>
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
    case 'dataSource': return <DataSourceDialog name={dialog.name} close={close} />;
    case 'dataSet': return <DataSetDialog name={dialog.name} close={close} />;
    case 'parameter': return <ParameterDialog name={dialog.name} close={close} />;
    case 'expression': return <ExpressionDialog d={dialog} close={close} />;
    case 'group': return <GroupDialog d={dialog} close={close} />;
    case 'chart': return <ChartDialog d={dialog} close={close} Modal={Modal} Field={Field_} />;
    case 'matrix': return <MatrixDialog d={dialog} close={close} />;
    case 'reportProperties': return <Modal title="Berichtseigenschaften" onCancel={close}><ReportProps /></Modal>;
  }
}

/** Common validation: identifier syntax and uniqueness among siblings. */
function nameError(name: string, taken: string[], what: string): string | null {
  if (!name) return `${what}: Name fehlt`;
  if (!IDENT.test(name)) return `${what}: Name darf nur Buchstaben, Ziffern und _ enthalten und nicht mit einer Ziffer beginnen`;
  if (taken.includes(name)) return `${what} „${name}“ existiert bereits`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------

const PROVIDERS: [string, string][] = [
  ['SQL', 'Microsoft SQL Server'], ['SQLAZURE', 'Microsoft Azure SQL-Datenbank'], ['OLEDB', 'OLE DB'], ['ODBC', 'ODBC'],
  ['ORACLE', 'Oracle'], ['XML', 'XML'], ['SHAREPOINTLIST', 'SharePoint-Liste'], ['ENTERDATA', 'Daten eingeben'],
];

function DataSourceDialog({ name, close }: { name?: string; close: () => void }) {
  const ed = useEditor();
  const existing = ed.report.dataSources.find(d => d.name === name);
  const [d, setD] = useState<DataSource>(() => existing ? { ...existing } : {
    id: guid(), name: uniqueIn(ed.report.dataSources.map(x => x.name), 'DataSource'), provider: 'SQL',
    connectString: 'Data Source=localhost;Initial Catalog=AdventureWorks', extra: [], connExtra: [],
  });
  const shared = d.sharedReference !== undefined;
  const error = nameError(d.name, ed.report.dataSources.filter(x => x !== existing).map(x => x.name), 'Datenquelle');

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
    <Modal title={existing ? 'Datenquelleneigenschaften' : 'Neue Datenquelle'} onOk={ok} onCancel={close} error={error}>
      <Field_ label="Name"><input autoFocus value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field_>
      <div className="radio-group">
        <label><input type="radio" checked={shared} onChange={() => setD({ ...d, sharedReference: '/Datenquellen/' })} /> Freigegebene Datenquelle verwenden</label>
        <label><input type="radio" checked={!shared} onChange={() => setD({ ...d, sharedReference: undefined })} /> In meinen Bericht eingebettete Verbindung</label>
      </div>
      {shared ? (
        <Field_ label="Pfad"><input value={d.sharedReference} onChange={e => setD({ ...d, sharedReference: e.target.value })} placeholder="/Datenquellen/AdventureWorks" /></Field_>
      ) : (
        <>
          <Field_ label="Verbindungstyp">
            <select value={d.provider} onChange={e => setD({ ...d, provider: e.target.value })}>
              {[...new Set([d.provider, ...PROVIDERS.map(p => p[0])])].map(p => <option key={p} value={p}>{PROVIDERS.find(x => x[0] === p)?.[1] ?? p}</option>)}
            </select>
          </Field_>
          <Field_ label="Verbindungszeichenfolge">
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
    ?? (d.fields.some(f => !IDENT.test(f.name)) ? 'Ungültiger Feldname' : null)
    ?? (new Set(fieldNames).size !== fieldNames.length ? 'Feldnamen müssen eindeutig sein' : null);

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
    <Modal title={existing ? 'Dataseteigenschaften' : 'Neues Dataset'} onOk={ok} onCancel={close} error={error} wide>
      <div className="tabs">
        <button className={tab === 'query' ? 'on' : ''} onClick={() => setTab('query')}>Abfrage</button>
        <button className={tab === 'fields' ? 'on' : ''} onClick={() => setTab('fields')}>Felder ({d.fields.length})</button>
      </div>
      {tab === 'query' ? (
        <>
          <Field_ label="Name"><input autoFocus value={d.name} onChange={e => setD({ ...d, name: e.target.value })} /></Field_>
          <Field_ label="Datenquelle">
            <select value={d.dataSourceName} onChange={e => setD({ ...d, dataSourceName: e.target.value })}>
              {!ed.report.dataSources.some(s => s.name === d.dataSourceName) && <option value={d.dataSourceName}>{d.dataSourceName || '(keine)'}</option>}
              {ed.report.dataSources.map(s => <option key={s.id}>{s.name}</option>)}
            </select>
          </Field_>
          <Field_ label="Abfrage">
            <textarea className="code" rows={10} value={d.commandText} spellCheck={false} onChange={e => setD({ ...d, commandText: e.target.value })} />
          </Field_>
          <div className="button-row">
            <button onClick={() => { mergeFields(fieldsFromSql(d.commandText)); setTab('fields'); }}>Felder aus Abfrage ableiten</button>
          </div>
        </>
      ) : (
        <>
          <table className="grid">
            <thead><tr><th>Feldname</th><th>Feldquelle</th><th>Typ</th><th /></tr></thead>
            <tbody>
              {d.fields.map((f, i) => (
                <tr key={i}>
                  <td><input value={f.name} onChange={e => setField(i, { name: e.target.value })} /></td>
                  <td>
                    {f.value !== undefined
                      ? <input value={f.value} title="Berechnetes Feld" onChange={e => setField(i, { value: e.target.value })} />
                      : <input value={f.dataField} onChange={e => setField(i, { dataField: e.target.value })} />}
                  </td>
                  <td>
                    <select value={f.typeName} onChange={e => setField(i, { typeName: e.target.value })}>
                      {[...new Set([f.typeName, ...TYPES])].map(t => <option key={t} value={t}>{t ? t.replace('System.', '') : '(nicht angegeben)'}</option>)}
                    </select>
                  </td>
                  <td><ActionButton icon="trash" title="Entfernen" onClick={() => setD({ ...d, fields: d.fields.filter((_, j) => j !== i) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="button-row">
            <button onClick={() => setD({ ...d, fields: [...d.fields, { name: uniqueIn(fieldNames, 'Field'), dataField: '', typeName: 'System.String' }] })}>Abfragefeld hinzufügen</button>
            <button onClick={() => setD({ ...d, fields: [...d.fields, { name: uniqueIn(fieldNames, 'Calculated'), dataField: '', typeName: 'System.String', value: '=' }] })}>Berechnetes Feld hinzufügen</button>
            <button onClick={() => post({ type: 'importSampleData', dataSet: d.name })}>Beispieldaten laden (Excel, CSV, JSON)…</button>
            <button disabled={!sample?.length} onClick={() => mergeFields(inferFields(sample))}>Felder aus Beispieldaten übernehmen</button>
          </div>
          <div className="prop-note">
            {sample ? `${sample.length} Zeilen Beispieldaten für die Vorschau vorhanden.` : 'Ohne Beispieldaten erzeugt die Vorschau Platzhalterwerte. Beispieldaten (Excel, CSV oder JSON) werden neben dem Bericht als <Name>.data.json gespeichert.'}
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
  const error = nameError(p.name, ed.report.parameters.filter(x => x !== existing).map(x => x.name), 'Parameter');

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
    <Modal title={existing ? 'Berichtsparametereigenschaften' : 'Neuer Berichtsparameter'} onOk={ok} onCancel={close} error={error}>
      <Field_ label="Name"><input autoFocus value={p.name} onChange={e => setP({ ...p, name: e.target.value })} /></Field_>
      <Field_ label="Eingabeaufforderung"><input value={p.prompt} placeholder={p.name} onChange={e => setP({ ...p, prompt: e.target.value })} /></Field_>
      <Field_ label="Datentyp">
        <select value={p.dataType} onChange={e => setP({ ...p, dataType: e.target.value as ParameterType })}>
          <option value="String">Text</option><option value="Integer">Ganze Zahl</option><option value="Float">Gleitkommazahl</option>
          <option value="DateTime">Datum/Uhrzeit</option><option value="Boolean">Boolesch</option>
        </select>
      </Field_>
      <Field_ label="Standardwert"><input value={p.defaultValue} placeholder="(kein Standardwert)" onChange={e => setP({ ...p, defaultValue: e.target.value })} /></Field_>
      <label className="check"><input type="checkbox" checked={p.allowBlank} onChange={e => setP({ ...p, allowBlank: e.target.checked })} /> Leeren Wert zulassen ("")</label>
      <label className="check"><input type="checkbox" checked={p.nullable} onChange={e => setP({ ...p, nullable: e.target.checked })} /> NULL-Wert zulassen</label>
      {p.extra.length > 0 && <div className="prop-note">Verfügbare Werte und weitere Einstellungen aus der Datei bleiben erhalten.</div>}
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

const FUNCTIONS: [string, string][] = [
  ['Sum(Fields!X.Value)', 'Summe'], ['Avg(Fields!X.Value)', 'Mittelwert'], ['Count(Fields!X.Value)', 'Anzahl'],
  ['CountDistinct(Fields!X.Value)', 'Anzahl eindeutig'], ['Min(Fields!X.Value)', 'Minimum'], ['Max(Fields!X.Value)', 'Maximum'],
  ['First(Fields!X.Value)', 'Erster Wert'], ['IIf(Bedingung, Wahr, Falsch)', 'Wenn-Dann'], ['Format(Wert, "N2")', 'Formatieren'],
  ['FormatCurrency(Wert)', 'Als Währung'], ['FormatPercent(Wert, 1)', 'Als Prozent'], ['UCase(Text)', 'Großbuchstaben'],
  ['Left(Text, 3)', 'Links'], ['Len(Text)', 'Länge'], ['Today()', 'Heute'], ['Now()', 'Jetzt'], ['Year(Datum)', 'Jahr'],
  ['DateAdd("d", 1, Datum)', 'Datum addieren'], ['IsNothing(Wert)', 'Ist leer'], ['RowNumber(Nothing)', 'Zeilennummer'],
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
      case 'functions': return FUNCTIONS.map(([f, l]) => [f, `${f.split('(')[0]} – ${l}`]);
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
      globals: { ExecutionTime: new Date(), PageNumber: 1, TotalPages: 1, ReportName: 'Bericht', ReportFolder: '/' },
    };
    try { return formatValue(evaluate(value, ctx), ''); } catch (e) { return `Fehler: ${(e as Error).message}`; }
  }, [value, error, ed.report, ed.sampleData, d.dataSetName]);

  return (
    <Modal title={d.title} onOk={() => { d.onOk(value === '=' ? '' : value); close(); }} onCancel={close} error={error} wide>
      <ExpressionInput inputRef={el => { ref.current = el as HTMLTextAreaElement | null; }} className="code expr-editor" multiline rows={5} autoFocus
        dataSetName={d.dataSetName} value={value} onChange={setValue} />
      <div className="expr-hint">Strg+Leertaste zeigt Vorschläge; nach <code>Fields!</code>, <code>Parameters!</code>, <code>Code.</code> … automatisch.</div>
      <div className="expr-result">{result !== null && <>Ergebnis{d.dataSetName ? ' (erste Zeile)' : ''}: <code>{toStr(result) || '(leer)'}</code></>}</div>
      <div className="expr-picker">
        <div className="expr-cats">
          {([['fields', 'Felder'], ['params', 'Parameter'], ['globals', 'Integrierte Felder'], ['functions', 'Funktionen'], ['operators', 'Operatoren']] as const).map(([k, l]) => (
            <button key={k} className={category === k ? 'on' : ''} onClick={() => setCategory(k)}>{l}</button>
          ))}
        </div>
        <div className="expr-items">
          {items.map(([code, label]) => <button key={code + label} title={code} onClick={() => insert(code)}>{label}</button>)}
          {!items.length && <div className="tree-empty">Keine Einträge</div>}
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
  ['Like', 'Like'], ['In', 'In'], ['Between', 'Zwischen'], ['TopN', 'Top N'], ['BottomN', 'Bottom N'],
];
const BREAKS: [BreakLocation, string][] = [['', 'Kein Seitenumbruch'], ['Between', 'Zwischen den Gruppen'], ['Start', 'Vor jeder Gruppe'], ['End', 'Nach jeder Gruppe'], ['StartAndEnd', 'Vor und nach jeder Gruppe']];
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
  const error = !IDENT.test(name) ? 'Ungültiger Gruppenname'
    : name.toLowerCase() !== existing?.group?.name.toLowerCase() && taken.has(name.toLowerCase()) ? `„${name}“ ist schon vergeben`
    : !details && !expressions.some(e => e.trim()) ? 'Gruppieren nach: mindestens ein Ausdruck'
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
        const m = d.create.mode === 'parent' ? addParentGroup(r, t, d.create.rowId, opts) : addChildGroup(r, t, d.create.rowId, opts);
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
      <select className="field-pick" value="" title="Feld wählen" onChange={e => e.target.value && onChange(`=Fields!${e.target.value}.Value`)}>
        <option value="">Feld…</option>
        {fieldOptions.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
      </select>
    </span>
  );

  return (
    <Modal title={d.create ? (d.create.mode === 'parent' ? 'Übergeordnete Gruppe hinzufügen' : 'Untergeordnete Gruppe hinzufügen') : `Gruppeneigenschaften – ${existing?.group?.name}`}
      onOk={ok} onCancel={close} error={error} wide okLabel={d.create ? 'Hinzufügen' : 'OK'}>
      <Field_ label="Name"><input autoFocus value={name} onChange={e => setName(e.target.value)} /></Field_>
      {details ? <div className="prop-note">Detailgruppe: eine Zeile je Datensatz – Sortierung, Filter und Sichtbarkeit gelten für die Details.</div> : (
        <div className="form-row"><span>Gruppieren nach</span>
          <div className="list-editor">
            {expressions.map((e, i) => (
              <div key={i} className="list-row">
                {exprInput(e, v => setExpressions(expressions.map((x, j) => (j === i ? v : x))))}
                <ActionButton icon="trash" title="Entfernen" disabled={expressions.length <= 1} onClick={() => setExpressions(expressions.filter((_, j) => j !== i))} />
              </div>
            ))}
            <button className="secondary small" onClick={() => setExpressions([...expressions, ''])}><Codicon name="add" /> Ausdruck</button>
          </div>
        </div>
      )}
      {d.create && <>
        <label className="check"><input type="checkbox" checked={header} onChange={e => setHeader(e.target.checked)} /> Gruppenkopf hinzufügen</label>
        <label className="check"><input type="checkbox" checked={footer} onChange={e => setFooter(e.target.checked)} /> Gruppenfuß hinzufügen (z. B. für Summen)</label>
      </>}
      <div className="form-row"><span>Sortierung</span>
        <div className="list-editor">
          {sort.map((x, i) => (
            <div key={i} className="list-row">
              {exprInput(x.value, v => setSort(sort.map((y, j) => (j === i ? { ...y, value: v } : y))))}
              <select value={x.descending ? 'd' : 'a'} onChange={e => setSort(sort.map((y, j) => (j === i ? { ...y, descending: e.target.value === 'd' } : y)))}>
                <option value="a">Aufsteigend</option><option value="d">Absteigend</option>
              </select>
              <ActionButton icon="trash" title="Entfernen" onClick={() => setSort(sort.filter((_, j) => j !== i))} />
            </div>
          ))}
          <button className="secondary small" onClick={() => setSort([...sort, { value: expressions[0] || '', descending: false }])}><Codicon name="add" /> Sortierung</button>
        </div>
      </div>
      <div className="form-row"><span>Filter</span>
        {verbatimFilters ? <div className="prop-note">Die Filter dieser Gruppe nutzen erweiterte Optionen und bleiben unverändert (bearbeitbar über „Als XML öffnen“).</div> : (
          <div className="list-editor">
            {filters.map((f, i) => (
              <div key={i} className="list-row">
                {exprInput(f.expression, v => setFilters(filters.map((y, j) => (j === i ? { ...y, expression: v } : y))))}
                <select value={f.operator} onChange={e => setFilters(filters.map((y, j) => (j === i ? { ...y, operator: e.target.value } : y)))}>
                  {OPERATORS_FILTER.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input className="filter-value" value={f.values.join(', ')} placeholder="Wert" title="Mehrere Werte (In) durch Komma trennen"
                  onChange={e => setFilters(filters.map((y, j) => (j === i ? { ...y, values: f.operator === 'In' || f.operator === 'Between' ? e.target.value.split(/\s*,\s*/) : [e.target.value] } : y)))} />
                <ActionButton icon="trash" title="Entfernen" onClick={() => setFilters(filters.filter((_, j) => j !== i))} />
              </div>
            ))}
            <button className="secondary small" onClick={() => setFilters([...filters, { expression: '', operator: 'Equal', values: [''] }])}><Codicon name="add" /> Filter</button>
          </div>
        )}
      </div>
      {!details && (
        <div className="form-row"><span>Seitenumbruch</span>
          <div className="list-editor">
            <select value={pageBreak} onChange={e => setPageBreak(e.target.value as BreakLocation)}>{BREAKS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <label className="check"><input type="checkbox" disabled={!pageBreak} checked={reset && !!pageBreak} onChange={e => setReset(e.target.checked)} /> Seitenzahl je Gruppe neu beginnen (z. B. je Beleg)</label>
          </div>
        </div>
      )}
      <Field_ label="Ausblenden">
        <ExpressionInput value={hidden} onChange={setHiddenValue} dataSetName={table.dataSetName} placeholder="leer = sichtbar, true oder =Ausdruck" />
      </Field_>
      <Field_ label="Umschalten durch">
        <ToggleSelect value={toggle} onChange={setToggle} />
      </Field_>
      <div className="prop-note">Drilldown: „Ausblenden“ auf true und ein Textfeld der Gruppe darüber als Schalter – in der Vorschau und in Business Central klappt jeder Eintrag einzeln auf.</div>
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
  const error = !dataSetName ? 'Dataset wählen' : !rowGroup.trim() || !columnGroup.trim() ? 'Zeilen- und Spaltengruppierung angeben' : !value.trim() ? 'Wert angeben, z. B. =Sum(Fields!Betrag.Value)'
    : [rowGroup, columnGroup, value].map(e => (e.trim().startsWith('=') ? validateExpression(e) : null)).find(Boolean) ?? null;
  const pick = (set: (v: string) => void, sum: boolean) => (
    <select className="field-pick" value="" title="Feld wählen" onChange={e => e.target.value && set(sum ? `=Sum(Fields!${e.target.value}.Value)` : `=Fields!${e.target.value}.Value`)}>
      <option value="">Feld…</option>{fields.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
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
    <Modal title="Matrix einfügen" onOk={ok} onCancel={close} error={error} wide okLabel="Einfügen">
      <Field_ label="Dataset"><select value={dataSetName} onChange={e => setDataSetName(e.target.value)}>{ed.report.dataSets.map(x => <option key={x.name}>{x.name}</option>)}</select></Field_>
      {row('Zeilen gruppieren nach', rowGroup, setRowGroup, false, '=Fields!Kunde.Value')}
      {row('Spalten gruppieren nach', columnGroup, setColumnGroup, false, '=Fields!Monat.Value')}
      {row('Wert', value, setValue, true, '=Sum(Fields!Betrag.Value)')}
      <label className="check"><input type="checkbox" checked={rowTotal} onChange={e => setRowTotal(e.target.checked)} /> Gesamtzeile</label>
      <label className="check"><input type="checkbox" checked={columnTotal} onChange={e => setColumnTotal(e.target.checked)} /> Gesamtspalte</label>
    </Modal>
  );
}
