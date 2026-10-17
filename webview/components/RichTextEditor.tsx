import { useEditor } from '../editor';
import { RawItem } from '../model';
import { locate } from '../ops';
import { RichEdit, RichRun, editRichText, readRichText } from '../richtext';
import { ActionButton, Codicon } from './Icon';
import { PropColor, PropText } from './PropertiesPane';

/**
 * Parts of a textbox with differently formatted text (paragraphs of runs): each part's text or expression and its
 * formatting; parts and paragraphs can be added and removed. `owner` is the raw item holding the textbox (the
 * textbox itself, or a region kept verbatim around it).
 */
export function RichTextEditor({ owner, name }: { owner: string; name: string }) {
  const ed = useEditor();
  const raw = locate(ed.report, owner)?.item as RawItem | undefined;
  const paragraphs = raw?.type === 'raw' ? readRichText(raw.xml, name) : null;
  if (!raw || !paragraphs) return null;
  const apply = (edit: RichEdit) => ed.commit(r => {
    const it = locate(r, owner)!.item as RawItem;
    const next = editRichText(it.xml, name, edit);
    if (next === it.xml) return false;
    it.xml = next;
  });
  return (
    <div className="rich-text">
      {paragraphs.map((p, pi) => (
        <div key={pi} className="rich-paragraph">
          <div className="rich-head">
            <span>Absatz {pi + 1}</span>
            <span className="grow" />
            <ActionButton icon="add" title="Absatz darunter einfügen" onClick={() => apply({ kind: 'addParagraph', after: pi })} />
            <ActionButton icon="trash" title="Absatz entfernen" disabled={paragraphs.length <= 1} onClick={() => apply({ kind: 'removeParagraph', p: pi })} />
          </div>
          {p.runs.map((run, ri) => {
            const set = (patch: Partial<RichRun>) => apply({ kind: 'run', p: pi, r: ri, patch });
            return (
              <div key={ri} className="rich-run">
                <PropText value={run.value} placeholder="Text oder =Ausdruck" expression onCommit={v => set({ value: v })} />
                <div className="rich-run-tools">
                  <ActionButton icon="bold" title="Fett" checked={run.bold} onClick={() => set({ bold: !run.bold })} />
                  <ActionButton icon="italic" title="Kursiv" checked={run.italic} onClick={() => set({ italic: !run.italic })} />
                  <ActionButton icon="whole-word" title="Unterstrichen" checked={run.underline} onClick={() => set({ underline: !run.underline })} />
                  <span className="rich-size"><PropText value={run.fontSize} placeholder="Größe" onCommit={v => set({ fontSize: /^\d+(\.\d+)?$/.test(v) ? `${v}pt` : v })} /></span>
                  <span className="grow" />
                  <ActionButton icon="add" title="Textteil dahinter einfügen" onClick={() => apply({ kind: 'addRun', p: pi, after: ri })} />
                  <ActionButton icon="trash" title="Textteil entfernen" disabled={p.runs.length <= 1} onClick={() => apply({ kind: 'removeRun', p: pi, r: ri })} />
                </div>
                <div className="rich-run-tools">
                  <PropColor value={run.color || undefined} onCommit={v => set({ color: v })} />
                  <span className="rich-format"><PropText value={run.format} placeholder="Format (N2 …)" onCommit={v => set({ format: v })} /></span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="prop-note"><Codicon name="info" /> Jeder Textteil hat eigene Formatierung; alles Übrige am Textfeld bleibt unverändert.</div>
    </div>
  );
}
