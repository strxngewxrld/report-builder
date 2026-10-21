import * as vscode from 'vscode';
import { l10n } from '../webview/l10n';

/** Check before saving files, starting AL commands or contacting a workspace-configured server. */
export function requireWorkspaceTrust(): void {
  if (!vscode.workspace.isTrusted) {
    throw new Error(l10n.t('Trust this workspace before building, downloading symbols or running a report in Business Central.'));
  }
}

export function checkWorkspaceTrust(): boolean {
  try { requireWorkspaceTrust(); return true; }
  catch (e) { void vscode.window.showWarningMessage((e as Error).message); return false; }
}
