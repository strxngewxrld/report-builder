// Builds the VSIX into artifacts/<name>-<version>.vsix and verifies the packaged extension (scripts/check-package.mjs).
import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { checkPackage } from './check-package.mjs';
import './check-docs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, 'artifacts', `${pkg.name}-${pkg.version}.vsix`);
await mkdir(join(root, 'artifacts'), { recursive: true });
// production build (minified webview, license notices); vsce only packs, the manifest has no vscode:prepublish
const build = spawnSync(process.execPath, [join(root, 'esbuild.mjs')], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
const result = spawnSync(process.execPath, [join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--no-dependencies', '--out', output],
  { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await checkPackage(output);
