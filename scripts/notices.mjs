// Writes THIRD_PARTY_NOTICES.md with the licenses of the packages actually bundled into out/*.js (read from the
// source maps) plus the copied codicon font, so the VSIX carries them without shipping node_modules.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BUNDLES = ['extension', 'webview', 'fontkit'];
/** Copied into out/ by esbuild.mjs instead of being bundled. */
const COPIED = ['@vscode/codicons'];
/**
 * @pdf-lib/fontkit 1.1.1 declares MIT (package.json, README) but neither its npm tarball nor the fork or upstream
 * repository (Hopding/fontkit, foliojs/fontkit) has a license file: the MIT text with the authors from package.json.
 */
const FALLBACK = { '@pdf-lib/fontkit@1.1.1': 'scripts/licenses/pdf-lib-fontkit.LICENSE' };

export async function writeNotices(root) {
  const packages = new Set(COPIED);
  for (const bundle of BUNDLES) {
    const map = JSON.parse(await readFile(join(root, `out/${bundle}.js.map`), 'utf8'));
    for (const source of map.sources) {
      if (!source.includes('node_modules/')) continue;
      const relative = source.split('node_modules/').at(-1);
      packages.add(relative.split('/').slice(0, relative.startsWith('@') ? 2 : 1).join('/'));
    }
  }
  let text = '# Third-party notices\n\nThe extension bundles the following packages. Their licenses follow.\n';
  for (const name of [...packages].sort()) {
    const dir = join(root, 'node_modules', name);
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    const license = (await readdir(dir)).find(file => /^(?:licen[cs]e(?:[.-](?:md|txt|mit))?|copying)$/i.test(file));
    const fallback = FALLBACK[`${name}@${pkg.version}`];
    if (!license && !fallback) throw new Error(`Missing license file for bundled dependency ${name}`);
    text += `\n## ${name} ${pkg.version} (${pkg.license})\n\n`;
    // LF only: a Windows checkout (core.autocrlf) has CRLF files, the generated file must not differ from the commit
    text += (await readFile(license ? join(dir, license) : join(root, fallback), 'utf8')).replace(/\r\n?/g, '\n').trim() + '\n';
  }
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), text);
  console.log(`Third-party licenses: ${packages.size} bundled packages`);
}
