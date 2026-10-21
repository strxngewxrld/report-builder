import { useEffect, useRef } from 'react';

/** Keep keyboard navigation inside a modal and restore the previously focused control when it closes. */
export function useDialogFocus() {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const focusable = () => Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(e => e.tabIndex >= 0 && e.offsetParent !== null);
    if (!el.contains(document.activeElement)) focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = focusable(), first = all[0], last = all.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', trap);
    return () => {
      el.removeEventListener('keydown', trap);
      // opened from a native menu or a VS Code command, nothing in the webview had the focus: back to the design surface
      const back = previous.current && previous.current !== document.body && previous.current.isConnected
        ? previous.current : document.querySelector<HTMLElement>('.designer');
      back?.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
