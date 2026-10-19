// Verifies a built VSIX: exactly the files of the .vscodeignore allowlist, a consistent manifest with all
// translations, a PNG icon, and an extension bundle that loads without node_modules and registers every
// contributed command and the custom editor when activated against a stand-in VS Code API.
//   node scripts/check-package.mjs [artifacts/<name>-<version>.vsix]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire, isBuiltin } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { inflateRawSync } from 'node:zlib';

const hostRequire = createRequire(import.meta.url);

/** Entries of a ZIP archive (stored or deflated), read from its central directory. */
export function unzip(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = zip.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  assert(end >= 0, 'Not a ZIP archive');
  const files = {};
  for (let i = 0, at = view.getUint32(end + 16, true); i < view.getUint16(end + 10, true); i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'Broken ZIP central directory');
    const method = view.getUint16(at + 10, true), size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    files[name] = method === 0 ? data : method === 8 ? new Uint8Array(inflateRawSync(data)) : assert.fail(`${name}: compression ${method}`);
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

const EXPECTED = [
  'package.json', 'package.nls.json', 'package.nls.de.json', 'l10n/bundle.l10n.de.json',
  'readme.md', 'changelog.md', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'media/icon.png',
  'out/extension.js', 'out/webview.js', 'out/webview.css', 'out/fontkit.js', 'out/codicon.css', 'out/codicon.ttf',
];

/** A stand-in for any VS Code API object: every property, call and construction yields another stand-in. */
function standIn() {
  const proxy = new Proxy(function () {}, {
    get: (_, key) => key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : key === Symbol.iterator ? [][Symbol.iterator] : proxy,
    apply: () => proxy,
    construct: () => proxy,
    set: () => true,
  });
  return proxy;
}

export async function checkPackage(path) {
  const files = unzip(await readFile(path));
  const names = Object.keys(files).filter(n => n.startsWith('extension/')).map(n => n.slice('extension/'.length));
  assert.deepEqual([...names].sort(), [...EXPECTED].sort(), 'Unexpected package contents (see .vscodeignore)');
  for (const name of ['extension.vsixmanifest', '[Content_Types].xml']) assert(files[name], `Missing ${name}`);
  const text = name => new TextDecoder().decode(files[`extension/${name}`]);
  const pkg = JSON.parse(text('package.json'));

  assert.equal(pkg.name, 'bc-report-builder');
  assert.equal(pkg.main, './out/extension.js');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.match(pkg.repository?.url ?? '', /github\.com\/[\w.-]+\/[\w.-]+/, 'The update check needs repository.url on GitHub');
  assert.match(text('changelog.md'), new RegExp(`^## \\[?${pkg.version.replace(/\./g, '\\.')}\\]?`, 'm'), `CHANGELOG.md has no section for ${pkg.version}`);
  assert(pkg.contributes.configuration.properties['bcReportBuilder.checkForUpdates'], 'Missing setting bcReportBuilder.checkForUpdates');
  const en = JSON.parse(text('package.nls.json')), de = JSON.parse(text('package.nls.de.json'));
  for (const match of JSON.stringify(pkg).matchAll(/"%([^%"]+)%"/g)) assert(en[match[1]] && de[match[1]], `Missing translation: ${match[1]}`);
  JSON.parse(text('l10n/bundle.l10n.de.json'));
  assert.match(text('THIRD_PARTY_NOTICES.md'), /## react /, 'THIRD_PARTY_NOTICES.md lists no bundled packages');

  const png = files['extension/media/icon.png'];
  assert.equal(pkg.icon, 'media/icon.png');
  assert.equal(png[0], 137, 'Icon must be PNG');
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert(header.getUint32(16) >= 128 && header.getUint32(20) >= 128, 'Icon is too small (at least 128×128)');

  // load the packaged CommonJS bundle with only the VS Code API replaced: catches missing bundles and
  // dependencies that are not bundled (the package has no node_modules)
  const commands = new Set(), editors = new Set(), tools = new Set();
  const api = standIn();
  const bundle = text('out/extension.js');
  // esbuild's namespace import copies the module's own keys: list every API name the bundle uses
  const vscode = Object.fromEntries([...bundle.matchAll(/\bvscode\d*\.([A-Za-z_$][\w$]*)/g)].map(m => [m[1], api]));
  vscode.commands = new Proxy({}, { get: (_, k) => k === 'registerCommand' ? (id) => { commands.add(id); return api; } : api });
  vscode.window = new Proxy({}, { get: (_, k) => k === 'registerCustomEditorProvider' ? (id) => { editors.add(id); return api; } : api });
  vscode.lm = new Proxy({}, { get: (_, k) => k === 'registerTool' ? (id) => { tools.add(id); return api; } : api });
  vscode.l10n = { bundle: undefined, t: (m) => m };
  vscode.env = new Proxy({ language: 'en' }, { get: (t, k) => k in t ? t[k] : api });
  const module = { exports: {} };
  runInNewContext(bundle, {
    module, exports: module.exports, process, console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextEncoder, TextDecoder, URL, Buffer, AbortSignal, structuredClone, fetch: () => new Promise(() => {}),
    require(name) {
      if (isBuiltin(name)) return hostRequire(name);
      assert.equal(name, 'vscode', `Unbundled dependency: ${name}`);
      return vscode;
    },
  }, { filename: 'extension/out/extension.js', timeout: 10_000 });
  const context = { subscriptions: [], extensionUri: api, globalState: api, workspaceState: api, extension: { packageJSON: pkg }, extensionMode: 3 };
  module.exports.activate(context);
  const missing = pkg.contributes.commands.map(c => c.command).filter(id => !commands.has(id));
  assert.deepEqual(missing, [], 'Contributed commands that activate() does not register');
  const unregistered = (pkg.contributes.languageModelTools ?? []).map(t => t.name).filter(id => !tools.has(id));
  assert.deepEqual(unregistered, [], 'Contributed language model tools that activate() does not register');
  for (const editor of pkg.contributes.customEditors) assert(editors.has(editor.viewType), `Unregistered editor ${editor.viewType}`);

  console.log(`VSIX verified: ${names.length} files, ${commands.size} commands, ${tools.size} language model tools, ${editors.size} editor; packaged extension activates.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  await checkPackage(process.argv[2] ?? fileURLToPath(new URL(`artifacts/${pkg.name}-${pkg.version}.vsix`, root)));
}
