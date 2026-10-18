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
      if (m.action === 'click') {
        if ((el as HTMLButtonElement).disabled) throw new Error(`Disabled: ${m.selector}`);
        // HTMLElement.click() alone does not move focus as a real pointer click does.
        el.focus();
        el.click();
      } else if (m.action === 'input') {
        const prototype = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, m.value);
        el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
      }
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      post({ type: 'testDomResult', id: m.id, text: document.querySelector(m.selector)?.textContent ?? '', count: document.querySelectorAll(m.selector).length });
    } catch (e) { post({ type: 'testDomResult', id: m.id, error: (e as Error).message }); }
  });
}
