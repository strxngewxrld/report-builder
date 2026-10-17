// Completeness of the localization: every message in the code has a German translation (and no stale ones remain),
// placeholders match, the manifest's %keys% exist in both languages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { l10n, setLocalization } from '../webview/l10n';

const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
});
const sources = [...files('src'), ...files('webview')].filter(f => !f.endsWith('l10n.ts'));
const unescape = (s: string) => s.replace(/\\(.)/g, '$1');
const placeholders = (s: string) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort().join();

const used = new Map<string, string>();
for (const f of sources) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/l10n\.t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) used.set(unescape(m[1] ?? m[2]), f);
  // translations are looked up by their literal source text only
  for (const m of text.matchAll(/l10n\.t\(\s*(?!['"])/g)) assert.fail(`${f}: l10n.t() with a non-literal message at offset ${m.index}`);
}
const de: Record<string, string> = JSON.parse(readFileSync('l10n/bundle.l10n.de.json', 'utf8'));

test('jede Meldung im Code hat eine deutsche Übersetzung, keine verwaisten Einträge', () => {
  const missing = [...used].filter(([k]) => !(k in de)).map(([k, f]) => `${f}: ${k}`);
  assert.deepEqual(missing, []);
  const stale = Object.keys(de).filter(k => !used.has(k));
  assert.deepEqual(stale, []);
});

test('Platzhalter {0}, {1} … stimmen zwischen Quelle und Übersetzung überein', () => {
  const wrong = Object.entries(de).filter(([k, v]) => placeholders(k) !== placeholders(v)).map(([k, v]) => `${k} → ${v}`);
  assert.deepEqual(wrong, []);
});

test('Manifest: alle %Schlüssel% in package.nls.json und package.nls.de.json', () => {
  const pkg = readFileSync('package.json', 'utf8');
  const keys = new Set([...pkg.matchAll(/"%([^%"]+)%"/g)].map(m => m[1]));
  const en = JSON.parse(readFileSync('package.nls.json', 'utf8'));
  const deNls = JSON.parse(readFileSync('package.nls.de.json', 'utf8'));
  assert.deepEqual([...keys].filter(k => !(k in en)), []);
  assert.deepEqual([...keys].filter(k => !(k in deNls)), []);
  assert.deepEqual(Object.keys(en).filter(k => !keys.has(k)), [], 'unbenutzt');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(deNls).sort());
  assert.equal(JSON.parse(pkg).l10n, './l10n');
});

test('l10n.t: Platzhalter, Übersetzung, Bundle-Format von VS Code', () => {
  setLocalization(undefined);
  assert.equal(l10n.t('Page {0} of {1}', 2, 5), 'Page 2 of 5');
  setLocalization({ 'Page {0} of {1}': 'Seite {0} von {1}', 'X': { message: 'Y', comment: ['c'] } }, 'de');
  assert.equal(l10n.t('Page {0} of {1}', 2, 5), 'Seite 2 von 5');
  assert.equal(l10n.t('X'), 'Y');
  assert.equal(l10n.language, 'de');
  setLocalization(undefined);
});
