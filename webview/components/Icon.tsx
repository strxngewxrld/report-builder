import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** A VS Code product icon (codicon), e.g. `<Codicon name="table" />`. */
export const Codicon = ({ name, className = '', title }: { name: string; className?: string; title?: string }) => (
  <i className={`codicon codicon-${name} ${className}`} title={title} aria-hidden={title ? undefined : true} />
);

/** Toolbar button like VS Code's action bar items: icon only, tooltip, optional checked state. */
export function ActionButton(props: {
  title: string; onClick: () => void; icon?: string; children?: ReactNode; checked?: boolean; disabled?: boolean; label?: string;
}) {
  return (
    <button className={`action-item ${props.checked ? 'checked' : ''} ${props.label ? 'with-label' : ''}`} title={props.title}
      aria-label={props.title} aria-pressed={props.checked} disabled={props.disabled} onClick={props.onClick}>
      {props.icon && <Codicon name={props.icon} />}
      {props.children}
      {props.label && <span className="action-label">{props.label}</span>}
    </button>
  );
}

export const Separator = () => <span className="action-separator" role="separator" />;

export type MenuItem =
  | { label: string; icon?: string; checked?: boolean; disabled?: boolean; keybinding?: string; run: () => void }
  | { header: string }
  | 'separator';

/**
 * Dropdown action (icon + chevron) that opens a menu styled like VS Code's menus: check marks on the left,
 * keyboard navigation, closes on Escape, outside click or blur.
 */
export function DropdownAction({ icon, title, items, disabled }: { icon: string; title: string; items: MenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} className={`action-item dropdown-action ${open ? 'active' : ''}`} title={title} aria-label={title}
        aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        <Codicon name={icon} /><Codicon name="chevron-down" className="dropdown-chevron" />
      </button>
      {open && button.current && <Menu anchor={button.current} items={items} onClose={() => { setOpen(false); button.current?.focus(); }} />}
    </>
  );
}

function Menu({ anchor, items, onClose }: { anchor: HTMLElement; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const m = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(a.left, window.innerWidth - m.width - 4)), top: a.bottom + 2 });
    ref.current!.querySelector<HTMLElement>('[role=menuitemcheckbox]:not([aria-disabled=true]), [role=menuitem]:not([aria-disabled=true])')?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (e: Event) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', onClose); };
  }, [anchor, onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    const entries = [...ref.current!.querySelectorAll<HTMLElement>('.menu-item:not([aria-disabled=true])')];
    const i = entries.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') entries[(i + 1) % entries.length]?.focus();
    else if (e.key === 'ArrowUp') entries[(i - 1 + entries.length) % entries.length]?.focus();
    else if (e.key === 'Home') entries[0]?.focus();
    else if (e.key === 'End') entries[entries.length - 1]?.focus();
    else if (e.key === 'Tab') onClose();
    else return;
    e.preventDefault();
  };

  return (
    <div ref={ref} className="menu" role="menu" style={pos} onKeyDown={onKeyDown}>
      {items.map((item, i) => {
        if (item === 'separator') return <div key={i} className="menu-separator" role="separator" />;
        if ('header' in item) return <div key={i} className="menu-header">{item.header}</div>;
        return (
          <div key={i} className="menu-item" tabIndex={-1} role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked} aria-disabled={item.disabled}
            onClick={() => { if (!item.disabled) { onClose(); item.run(); } }}
            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !item.disabled) { e.preventDefault(); onClose(); item.run(); } }}>
            <span className="menu-check">{item.checked && <Codicon name="check" />}</span>
            {item.icon && <Codicon name={item.icon} className="menu-icon" />}
            <span className="menu-label">{item.label}</span>
            {item.keybinding && <span className="menu-keybinding">{item.keybinding}</span>}
          </div>
        );
      })}
    </div>
  );
}
