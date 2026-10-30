import type { BcLayout } from '../webview/bc';

/** Workspace-declared layout paths are untrusted data, never arbitrary OS launch targets. */
export function layoutOpenMode(uri: string, layouts: BcLayout[] | undefined, trusted: boolean): 'designer' | 'external' | undefined {
  if (!layouts?.some(l => l.uri === uri && l.exists)) return undefined;
  try {
    const target = new URL(uri);
    if (target.search || target.hash) return undefined;
    const path = decodeURIComponent(target.pathname);
    if (['file:', 'vscode-remote:'].includes(target.protocol) && /\.rdlc?$/i.test(path)) return 'designer';
    // Office files may contain active content; the OS must only open them in a trusted workspace.
    if (trusted && target.protocol === 'file:' && /\.(docx|xlsx)$/i.test(path)) return 'external';
  } catch { /* malformed or unsupported URI */ }
  return undefined;
}
