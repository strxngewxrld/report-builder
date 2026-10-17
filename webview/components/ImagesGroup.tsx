import { useState } from 'react';
import { useEditor } from '../editor';
import { deleteEmbeddedImage, embeddedImages, imageUrl, imageUses, renameEmbeddedImage } from '../images';
import { post } from '../vscode';
import { ActionButton } from './Icon';
import { Group, dragProps } from './ReportDataPane';

/**
 * Embedded images of the report (Report Builder: Report Data › Images): thumbnail, drag onto the design surface,
 * rename (also in the image items that use it), delete; ＋ picks an image file.
 */
export function ImagesGroup({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const ed = useEditor();
  const images = embeddedImages(ed.report);
  const [editing, setEditing] = useState<string | null>(null);
  const rename = (from: string, to: string) => {
    setEditing(null);
    if (to.trim() && to.trim() !== from) {
      let ok = false;
      ed.commit(r => (ok = renameEmbeddedImage(r, from, to)));
      if (!ok) post({ type: 'error', message: `„${to}“ ist kein gültiger oder ein bereits vergebener Bildname (Buchstaben, Ziffern, _).` });
    }
  };
  return (
    <Group label="Bilder" open={open} onToggle={onToggle} onAdd={() => post({ type: 'pickImage' })} addTitle="Bild einbetten (PNG, JPEG, GIF, BMP, SVG)…">
      {images.map(img => {
        const uses = imageUses(ed.report, img.name);
        return (
          <div key={img.name} className="tree-leaf image-entry" {...dragProps({ kind: 'image', name: img.name })}
            title={`${img.mimeType}, ${Math.round(img.data.length * 0.75 / 1024)} KB – ${uses ? `${uses}× verwendet` : 'nicht verwendet'}; auf die Entwurfsfläche ziehen`}
            onDoubleClick={() => setEditing(img.name)}>
            <img className="glyph image-thumb" src={imageUrl(img)} alt="" />
            {editing === img.name
              ? <input autoFocus defaultValue={img.name} aria-label="Bildname" onClick={e => e.stopPropagation()}
                  onBlur={e => rename(img.name, e.currentTarget.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') rename(img.name, e.currentTarget.value);
                    if (e.key === 'Escape') setEditing(null);
                  }} />
              : <span className="grow">{img.name}</span>}
            <span className="row-actions" onClick={e => e.stopPropagation()}>
              <ActionButton icon="edit" title="Umbenennen" onClick={() => setEditing(img.name)} />
              <ActionButton icon="trash" title={uses ? `Löschen (wird ${uses}× verwendet)` : 'Löschen'}
                onClick={() => ed.commit(r => deleteEmbeddedImage(r, img.name))} />
            </span>
          </div>
        );
      })}
      {!images.length && <div className="tree-empty">Keine eingebetteten Bilder</div>}
    </Group>
  );
}
