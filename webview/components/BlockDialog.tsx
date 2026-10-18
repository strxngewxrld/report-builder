import { useDialogFocus } from './dialogFocus';
import { useMemo, useState } from 'react';
import { useEditor } from '../editor';
import { blockMissing, insertBlock } from '../blocks';
import { parseRdl } from '../rdl';
import { locate } from '../ops';
import { SectionKind } from '../model';
import { l10n } from '../l10n';

export function BlockDialog({ text, name, close }: { text: string; name: string; close: () => void }) {
  const ed = useEditor();
  const focusRef = useDialogFocus();
  const loc = ed.selection[0] ? locate(ed.report, ed.selection[0]) : null;
  const [section, setSection] = useState<SectionKind>(loc?.section ?? 'body');
  const [top, setTop] = useState(loc ? loc.item.top + loc.originTop + loc.item.height + 0.125 : 0);
  const [left, setLeft] = useState(loc ? loc.item.left + loc.originLeft : 0);
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => { try { return { block: parseRdl(text), error: '' }; } catch (e) { return { block: null, error: (e as Error).message }; } }, [text]);
  const missing = useMemo(() => parsed.block ? blockMissing(ed.report, parsed.block) : [], [ed.report, parsed]);
  const invalid = parsed.error || error || (!Number.isFinite(top) || !Number.isFinite(left) || top < 0 || left < 0 ? l10n.t('Position must be a non-negative number.') : '');
  const apply = () => {
    if (!parsed.block || invalid || (missing.length && !accept)) return;
    try {
      // Validate dependencies before committing so failures never create a partial edit.
      insertBlock(structuredClone(ed.report), parsed.block, section, top, left);
      let names: string[] = [];
      ed.commit(r => { names = insertBlock(r, parsed.block!, section, top, left).names; });
      ed.setMode('design'); ed.select(names); close();
    } catch (e) { setError((e as Error).message); }
  };
  return <div className="modal-backdrop"><div ref={focusRef} className="modal wide block-dialog" role="dialog" aria-modal="true" aria-label={l10n.t('Insert Layout Block…')}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
    <div className="modal-title">{l10n.t('Insert Layout Block…')} · {name}</div>
    <div className="modal-body">
      <p>{l10n.t('{0} layout items. Item names and internal references are adjusted on insertion.', parsed.block?.body.items.length ?? 0)}</p>
      <label className="form-row"><span>{l10n.t('Section')}</span><select autoFocus value={section} onChange={e => setSection(e.target.value as SectionKind)}>
        <option value="body">{l10n.t('Body')}</option><option value="header">{l10n.t('Page Header')}</option><option value="footer">{l10n.t('Page Footer')}</option></select></label>
      <label className="form-row"><span>{l10n.t('Top (inches)')}</span><input type="number" min="0" step="0.05" value={top} onChange={e => setTop(e.target.valueAsNumber)} /></label>
      <label className="form-row"><span>{l10n.t('Left (inches)')}</span><input type="number" min="0" step="0.05" value={left} onChange={e => setLeft(e.target.valueAsNumber)} /></label>
      {missing.length > 0 && <><p>{l10n.t('These dependencies are missing in the target report. Add them in AL or adjust the inserted expressions:')}</p>
        <ul>{missing.map(m => <li key={m}>{m}</li>)}</ul>
        <label><input type="checkbox" checked={accept} onChange={e => setAccept(e.target.checked)} />{l10n.t('Insert with unresolved references')}</label></>}
      {invalid && <p className="modal-error" role="alert">{invalid}</p>}
    </div><div className="modal-footer"><button className="primary" disabled={!parsed.block || !!invalid || (!!missing.length && !accept)} onClick={apply}>{l10n.t('Insert')}</button><button onClick={close}>{l10n.t('Cancel')}</button></div>
  </div></div>;
}
