// Imported first by the webview entry point: the translations are in place before any other module is evaluated
// (modules may build translated constants at load time).
import { setLocalization } from './l10n';

try {
  const { bundle, language } = JSON.parse(document.getElementById('l10n')?.textContent || '{}');
  setLocalization(bundle, language);
} catch { /* untranslated */ }
