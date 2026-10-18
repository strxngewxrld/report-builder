// DOM driver for extension-host integration tests. Installed only in an explicitly marked test webview;
// it exercises React's real inputs and buttons and never evaluates arbitrary scripts.
import { post } from './vscode';

export function installDomDriver() {
  if (document.body.dataset.testing !== 'true') return;
  window.addEventListener('message', async e => {
    const m = e.data;
    if (m?.type !== 'testDom') return;
    try {
      let el = document.querySelector<HTMLElement>(m.selector);
      const deadline = Date.now() + 5000;
      while (!el && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 25));
        el = document.querySelector<HTMLElement>(m.selector);
      }
      if (!el) throw new Error(`Element not found: ${m.selector}`);
      let defaultPrevented = false;
      let propagated = false;
      if (m.action === 'focus') {
        el.focus();
      } else if (m.action === 'blur') {
        el.blur();
      } else if (m.action === 'doubleClick') {
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      } else if (m.action === 'drop') {
        const source = document.querySelector<HTMLElement>(m.value);
        if (!source) throw new Error(`Drag source not found: ${m.value}`);
        const dataTransfer = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
        const bounds = el.getBoundingClientRect();
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer, clientX: bounds.left + 20, clientY: bounds.top + 20 }));
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer, clientX: bounds.left + 20, clientY: bounds.top + 20 }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      } else if (m.action === 'keydown') {
        const keys = String(m.value).split('+');
        const event = new KeyboardEvent('keydown', { key: keys.at(-1), shiftKey: keys.includes('Shift'), metaKey: keys.includes('Meta'), ctrlKey: keys.includes('Control'), bubbles: true, cancelable: true });
        const observe = (received: KeyboardEvent) => { if (received === event) propagated = true; };
        window.addEventListener('keydown', observe);
        el.dispatchEvent(event);
        window.removeEventListener('keydown', observe);
        defaultPrevented = event.defaultPrevented;
      } else if (m.action === 'click') {
        if ((el as HTMLButtonElement).disabled) throw new Error(`Disabled: ${m.selector}`);
        // HTMLElement.click() alone does not move focus as a real pointer click does.
        el.focus();
        el.click();
      } else if (m.action === 'input') {
        el.focus();
        const prototype = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, m.value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      }
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const current = document.querySelector<HTMLElement>(m.selector);
      post({ type: 'testDomResult', id: m.id, text: current?.textContent ?? '', count: document.querySelectorAll(m.selector).length,
        focused: current === document.activeElement, focusInside: current?.contains(document.activeElement) ?? false, defaultPrevented, propagated,
        disabled: current instanceof HTMLButtonElement ? current.disabled : undefined });
    } catch (e) { post({ type: 'testDomResult', id: m.id, error: (e as Error).message }); }
  });
}
