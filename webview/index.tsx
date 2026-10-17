import './l10nInit';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { post } from './vscode';
import { l10n } from './l10n';

// Runtime errors are reported to the extension (shown as a notification, recorded by the integration tests).
window.addEventListener('error', e => post({ type: 'error', message: l10n.t('Designer error: {0}', e.message) }));
window.addEventListener('unhandledrejection', e => post({ type: 'error', message: l10n.t('Designer error: {0}', String(e.reason)) }));

createRoot(document.getElementById('root')!).render(<App />);
