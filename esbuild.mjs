import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');
const corpus = process.argv.includes('--corpus');

const integration = process.argv.includes('--integration');

const configs = integration
  ? [
      { entryPoints: ['test/integration/run.ts'], outfile: 'out/test/integration/run.js', bundle: true, platform: 'node', format: 'cjs', external: ['@vscode/test-electron'] },
      { entryPoints: ['test/integration/suite.ts'], outfile: 'out/test/integration/suite.js', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] },
    ]
  : corpus
  ? [{ entryPoints: ['test/corpus.ts'], outfile: 'out/corpus.js', bundle: true, platform: 'node', format: 'cjs', sourcemap: true }]
  : test
  ? [{
      entryPoints: readdirSync('test').filter(f => f.endsWith('.test.ts')).map(f => `test/${f}`),
      outdir: 'out/test', bundle: true, platform: 'node', format: 'cjs', sourcemap: true,
    }]
  : [
      { entryPoints: ['src/extension.ts'], outfile: 'out/extension.js', bundle: true, platform: 'node',
        format: 'cjs', external: ['vscode'], sourcemap: true },
      { entryPoints: ['webview/index.tsx'], outfile: 'out/webview.js', bundle: true, platform: 'browser',
        format: 'iife', sourcemap: true, minify: !watch, loader: { '.css': 'css' },
        define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' } },
    ];

// Codicons (VS Code's icon font) for the webview
if (!integration && !corpus && !test) {
  mkdirSync('out', { recursive: true });
  for (const f of ['codicon.css', 'codicon.ttf']) copyFileSync(`node_modules/@vscode/codicons/dist/${f}`, `out/${f}`);
}

if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch();
  console.log('watching…');
} else {
  await Promise.all(configs.map(c => esbuild.build(c)));
}
