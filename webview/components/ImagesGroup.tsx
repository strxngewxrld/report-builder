import { useState } from 'react';
import { useEditor } from '../editor';
import { deleteEmbeddedImage, embeddedImages, imageUrl, imageUses, renameEmbeddedImage } from '../images';
import { post } from '../vscode';
import { ActionButton } from './Icon';
import { Group, dragProps } from './ReportDataPane';
import { l10n } from '../l10n';

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
      if (!ok) post({ type: 'error', message: l10n.t('"{0}" is not a valid image name or is taken already (letters, digits, _).', to) });
    }
  };
  return (
    <Group label={l10n.t('Images')} open={open} onToggle={onToggle} onAdd={() => post({ type: 'pickImage' })} addTitle={l10n.t('Embed Image (PNG, JPEG, GIF, BMP, SVG)…')}>
      {images.map(img => {
        const uses = imageUses(ed.report, img.name);
        return (
          <div key={img.name} className="tree-leaf image-entry" {...dragProps({ kind: 'image', name: img.name })}
            title={l10n.t('{0}, {1} KB – {2}; drag onto the design surface', img.mimeType, Math.round(img.data.length * 0.75 / 1024), uses ? l10n.t('used {0}×', uses) : l10n.t('not used'))}
            onDoubleClick={() => setEditing(img.name)}>
            <img className="glyph image-thumb" src={imageUrl(img)} alt="" />
            {editing === img.name
              ? <input autoFocus defaultValue={img.name} aria-label={l10n.t('Image name')} onClick={e => e.stopPropagation()}
                  onBlur={e => rename(img.name, e.currentTarget.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') rename(img.name, e.currentTarget.value);
                    if (e.key === 'Escape') setEditing(null);
                  }} />
              : <span className="grow">{img.name}</span>}
            <span className="row-actions" onClick={e => e.stopPropagation()}>
              <ActionButton icon="edit" title={l10n.t('Rename')} onClick={() => setEditing(img.name)} />
              <ActionButton icon="trash" title={uses ? l10n.t('Delete (used {0}×)', uses) : l10n.t('Delete')}
                onClick={() => ed.commit(r => deleteEmbeddedImage(r, img.name))} />
            </span>
          </div>
        );
      })}
      {!images.length && <div className="tree-empty">{l10n.t('No embedded images')}</div>}
    </Group>
  );
}
