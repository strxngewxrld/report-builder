// Discovers all project Markdown and checks bilingual coverage, links, JSON examples and tool references.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const pairs = [
  ['docs/USER-GUIDE.md', 'docs/ANWENDERHANDBUCH.md'],
  ['docs/MIGRATION.md', 'docs/UMSTIEG-REPORT-BUILDER.md'],
];
const markdown = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = `${directory}/${entry.name}`;
  return entry.isDirectory() ? markdown(path) : entry.name.endsWith('.md') ? [path] : [];
});
// Original third-party license texts remain English and must not be translated.
const rootDocs = readdirSync('.').filter(name => name.endsWith('.md') && name !== 'THIRD_PARTY_NOTICES.md');
const documents = [...rootDocs, ...markdown('docs')];
const legacy = new Set(pairs.flat());
for (const file of documents.filter(name => !name.endsWith('.de.md') && !legacy.has(name))) {
  const german = file.replace(/\.md$/, '.de.md');
  assert(existsSync(german), `${file}: missing German counterpart ${german}`);
  pairs.push([file, german]);
}
const covered = new Set(pairs.flat());
assert.deepEqual(documents.filter(file => !covered.has(file)), [], 'Unpaired Markdown documents');
const slug = text => text.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-');
let links = 0, examples = 0;
for (const pair of pairs) {
  if (pair[0].startsWith('docs/Testing/')) {
    const english = readFileSync(pair[0], 'utf8');
    const german = readFileSync(pair[1], 'utf8');
    for (const identifier of new Set(german.match(/\b[a-fA-F0-9]{40,64}\b|\b\d+\/\d+\b/g) ?? [])) {
      assert(english.includes(identifier), `${pair[0]}: missing recorded hash/test count ${identifier}`);
    }
  }
  for (const file of pair) {
    const text = readFileSync(file, 'utf8');
    assert(!text.includes('\uFFFD'), `${file}: invalid Unicode`);
    const counterpart = resolve(pair.find(other => other !== file));
    let languageLink = false;
    for (const [, target] of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      const [name, anchor] = target.split('#');
      const path = name ? resolve(dirname(file), name) : resolve(file);
      assert(existsSync(path), `${file}: missing link target ${target}`);
      languageLink ||= path === counterpart;
      if (anchor) {
        assert(statSync(path).isFile(), `${file}: anchor points to directory ${target}`);
        const headings = [...readFileSync(path, 'utf8').matchAll(/^#+ (.+)$/gm)].map(m => slug(m[1].trim()));
        assert(headings.includes(anchor), `${file}: missing heading ${target}`);
      }
      links++;
    }
    assert(languageLink, `${file}: missing language switch`);
    for (const [, json] of text.matchAll(/```json\r?\n([\s\S]*?)```/g)) {
      JSON.parse(json);
      examples++;
    }
  }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
for (const file of ['docs/AI-TOOLS.md', 'docs/AI-TOOLS.de.md']) {
  const text = readFileSync(file, 'utf8');
  const rows = [...text.matchAll(/^\| `(bcReport_\w+)` \| `#(\w+)` \|/gm)];
  assert.equal(rows.length, pkg.contributes.languageModelTools.length, `${file}: incomplete tool table`);
  for (const tool of pkg.contributes.languageModelTools) {
    assert(rows.some(([, id, reference]) => id === tool.name && reference === tool.toolReferenceName),
      `${file}: missing or incorrect reference for ${tool.name}`);
  }
}
console.log(`Documentation verified: ${pairs.length} language pairs, ${links} local links, ${examples} JSON examples, all ${pkg.contributes.languageModelTools.length} tool references in both languages.`);
