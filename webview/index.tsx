import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { post } from './vscode';

// Runtime errors are reported to the extension (shown as a notification, recorded by the integration tests).
window.addEventListener('error', e => post({ type: 'error', message: `Designer-Fehler: ${e.message}` }));
window.addEventListener('unhandledrejection', e => post({ type: 'error', message: `Designer-Fehler: ${String(e.reason)}` }));

createRoot(document.getElementById('root')!).render(<App />);
