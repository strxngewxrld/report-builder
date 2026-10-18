import { useDialogFocus } from './dialogFocus';
import { useMemo, useState } from 'react';
import { useEditor } from '../editor';
import { expressionReferences, expressionsIn, patchExpressions, replaceLiteral } from '../expressionSearch';
import { validateExpression } from '../expr';
import { parseRdl, serializeRdl } from '../rdl';
import { allReportItems } from '../model';
import { browserDom } from '../rdl';
import { locate } from '../ops';
import { l10n } from '../l10n';

export function ExpressionSearchDialog({ close }: { close: () => void }) {
  const ed = useEditor();
  const focusRef = useDialogFocus();
  const [mode, setMode] = useState<'search' | 'uses'>('search');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [reference, setReference] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const xml = useMemo(() => serializeRdl(ed.report), [ed.report]);
  const all = useMemo(() => expressionsIn(xml), [xml]);
  const refs = useMemo(() => [...new Set([
    ...ed.report.dataSets.flatMap(ds => ds.fields.map(f => `Fields!${f.name}`)),
    ...ed.report.parameters.map(p => `Parameters!${p.name}`),
    ...all.flatMap(e => expressionReferences(e.value).map(r => `${r.kind}!${r.name}`)),
  ])].sort(), [all, ed.report]);
  const results = all.filter(e => mode === 'uses'
    ? expressionReferences(e.value).some(r => `${r.kind}!${r.name}` === reference)
    : !!query && (matchCase ? e.value.includes(query) : e.value.toLowerCase().includes(query.toLowerCase())));
  const changes = results.map(location => ({ location, value: replaceLiteral(location.value, query, replacement, matchCase) })).filter(c => c.location.value !== c.value);
  const invalid = mode === 'search' ? changes.map(c => validateExpression(c.value.trimStart())).find(Boolean) : null;
  const apply = (ids?: number[]) => {
    const selected = ids ? changes.filter(c => ids.includes(c.location.id)) : changes;
    if (!selected.length || invalid) return;
    try {
      const next = parseRdl(patchExpressions(xml, selected));
      ed.commit(r => { Object.assign(r, next); });
      setNotice(l10n.t('{0} expressions replaced. Undo restores the previous values.', selected.length));
      setError('');
    } catch (e) { setError((e as Error).message); }
  };
  const reveal = (item: string) => {
    ed.setMode('design');
    if (locate(ed.report, item)) ed.select([item]);
    else {
      const raw = allReportItems(ed.report).find(i => i.type === 'raw' && Array.from(browserDom.parse(`<w>${i.xml}</w>`).getElementsByTagName('*')).some(e => e.getAttribute('Name') === item));
      if (raw) { ed.select([raw.name]); ed.setNested(item); }
    }
    close();
    requestAnimationFrame(() => document.querySelector(`.designer [data-name="${CSS.escape(item)}"]`)?.scrollIntoView({ block: 'nearest' }));
  };
  return <div className="modal-backdrop"><div ref={focusRef} className="modal wide expression-search" role="dialog" aria-modal="true" aria-label={l10n.t('Expressions and References')}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
    <div className="modal-title">{l10n.t('Expressions and References')}</div>
    <div className="modal-body">
      <label className="form-row"><span>{l10n.t('Mode')}</span><select value={mode} onChange={e => { setMode(e.target.value as typeof mode); setNotice(''); }}>
        <option value="search">{l10n.t('Find and Replace')}</option><option value="uses">{l10n.t('Field and Label References')}</option></select></label>
      {mode === 'search' ? <>
        <label className="form-row"><span>{l10n.t('Find')}</span><input autoFocus value={query} onChange={e => { setQuery(e.target.value); setNotice(''); }} /></label>
        <label className="form-row"><span>{l10n.t('Replace with')}</span><input value={replacement} onChange={e => setReplacement(e.target.value)} /></label>
        <label><input type="checkbox" checked={matchCase} onChange={e => setMatchCase(e.target.checked)} />{l10n.t('Match Case')}</label>
        <p>{l10n.t('Searches expressions throughout this layout, including groups, styles and preserved elements. Literal text and AL source are unchanged.')}</p>
      </> : <label className="form-row"><span>{l10n.t('Field or Label')}</span><select autoFocus value={reference} onChange={e => setReference(e.target.value)}>
        <option value="">{l10n.t('Select a field or label')}</option>{refs.map(r => <option key={r}>{r}</option>)}</select></label>}
      <p role="status">{notice || l10n.t('{0} matching expressions', results.length)}</p>
      {(invalid || error) && <p className="modal-error" role="alert">{invalid || error}</p>}
      <div className="expression-results">{results.map(e => <div className="expression-result" key={e.id}>
        <div><strong>{e.item ?? e.property}</strong> · {e.property}</div><small>{e.path}</small><pre>{e.value}</pre>
        {mode === 'search' && <pre className="replacement-preview">{replaceLiteral(e.value, query, replacement, matchCase)}</pre>}
        {e.item && <button onClick={() => reveal(e.item!)}>{l10n.t('Reveal in Layout')}</button>}
        {mode === 'search' && <button disabled={!!invalid || !changes.some(c => c.location.id === e.id)} onClick={() => apply([e.id])}>{l10n.t('Replace')}</button>}
      </div>)}</div>
    </div><div className="modal-footer">
      {mode === 'search' && <button className="primary" disabled={!changes.length || !!invalid} onClick={() => apply()}>{l10n.t('Replace All ({0})', changes.length)}</button>}
      <button onClick={close}>{l10n.t('Close')}</button>
    </div>
  </div></div>;
}
