// Launches the installed VS Code with this extension and runs test/integration/suite.ts inside it.
// Uses an isolated, temporary profile and a temporary copy of samples/; nothing of the user's setup is touched.
//   npm run test:vscode            (VSCODE_PATH=… to use another VS Code executable)

import { runTests } from '@vscode/test-electron';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// bundled to out/test/integration/run.js
const root = resolve(__dirname, '../../..');
const candidates = [
  process.env.VSCODE_PATH,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
  '/usr/share/code/code',
  `${process.env.LOCALAPPDATA}\\Programs\\Microsoft VS Code\\Code.exe`,
].filter((p): p is string => !!p && existsSync(p));

async function main() {
  // When started from a VS Code terminal, inherited variables would make the test instance run as plain Node
  // (ELECTRON_RUN_AS_NODE) or attach to the running VS Code (VSCODE_IPC_HOOK…).
  for (const k of Object.keys(process.env)) if (k.startsWith('ELECTRON_') || k.startsWith('VSCODE_')) delete process.env[k];
  const tmp = mkdtempSync(join(tmpdir(), 'bc-rb-test-'));
  const workspace = join(tmp, 'workspace');
  cpSync(join(root, 'samples'), workspace, { recursive: true });
  try {
    await runTests({
      // without an installed VS Code, test-electron downloads one (~200 MB)
      vscodeExecutablePath: candidates[0],
      extensionDevelopmentPath: root,
      extensionTestsPath: join(root, 'out/test/integration/suite.js'),
      // BC_RB_LOCALE=de runs VS Code in German (translations from l10n/ and package.nls.de.json)
      launchArgs: [workspace, ...(process.env.BC_RB_LOCALE ? [`--locale=${process.env.BC_RB_LOCALE}`] : []), '--disable-extensions', '--user-data-dir', join(tmp, 'user'), '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'],
      extensionTestsEnv: { BC_REPORT_BUILDER_TEST: '1', BC_RB_TIMEOUT_SCALE: process.env.BC_RB_TIMEOUT_SCALE ?? '', BC_RB_KEEP_PDF: process.env.BC_RB_KEEP_PDF ?? '',
        BC_RB_TEST_LANGUAGE: process.env.BC_RB_TEST_LANGUAGE ?? '', BC_RB_ONLY: process.env.BC_RB_ONLY ?? '' },
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
