// Release script (tools/publish-github.mjs) and package check (scripts/check-package.mjs); plain ESM, run by
// node --test directly instead of being bundled like the .ts tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { ensureRemoteTag, releaseArgs, releaseNotes, releaseRepository, verifyRemoteTag } from '../tools/publish-github.mjs';
import { unzip } from '../scripts/check-package.mjs';

/** A stand-in for the gh CLI: answers the calls in order and records them. */
function gh(...answers) {
  const calls = [];
  const read = (command, args) => {
    calls.push([command, args]);
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return Object.assign(read, { calls });
}

test('Release: HTTPS- und SSH-Repositorys, Owner überschreibbar', () => {
  for (const source of ['git+https://github.com/Example/report-builder.git', 'https://github.com/Example/report-builder', 'git@github.com:Example/report-builder.git', 'ssh://git@github.com/Example/report-builder.git']) {
    assert.equal(releaseRepository(source), 'example/report-builder');
  }
  assert.equal(releaseRepository('https://github.com/example/report-builder.git', 'Other'), 'other/report-builder');
  assert.throws(() => releaseRepository('https://example.org/example/report-builder'), /Kein GitHub-Repository/);
  assert.throws(() => releaseRepository('https://github.com/example/report-builder', '../bad'), /Ungültiger/);
});

test('Release: prüft den Tag beim Hochladen, optional als Entwurf, ohne Überschreiben', () => {
  const input = { repository: 'example/report-builder', tag: 'v1.0.0', asset: '/path with spaces/x.vsix', notes: '/tmp/notes.md', title: 'Report Builder 1.0.0', draft: false };
  const args = releaseArgs(input);
  assert.deepEqual(args.slice(0, 4), ['release', 'create', 'v1.0.0', input.asset]);
  assert(args.includes('--verify-tag'));
  assert(!args.includes('--clobber'));
  assert(!args.includes('--draft'));
  assert(releaseArgs({ ...input, draft: true }).includes('--draft'));
});

test('Release: einfacher Tag nur auf dem gebauten Commit, annotierte Tags werden aufgelöst', () => {
  const light = gh(JSON.stringify([{ ref: 'refs/tags/v1.0.0', object: { type: 'commit', sha: 'head' } }]));
  assert.equal(verifyRemoteTag('example/report-builder', 'v1.0.0', 'head', light), true);
  assert.deepEqual(light.calls[0], ['gh', ['api', 'repos/example/report-builder/git/matching-refs/tags/v1.0.0']]);
  assert.throws(() => verifyRemoteTag('example/report-builder', 'v1.0.0', 'different-head', light), /nicht auf den aktuellen Commit/);

  const annotated = gh(JSON.stringify([{ ref: 'refs/tags/v1.0.0', object: { type: 'tag', sha: 'annotation' } }]), JSON.stringify({ type: 'commit', sha: 'head' }));
  verifyRemoteTag('example/report-builder', 'v1.0.0', 'head', annotated);
  assert.deepEqual(annotated.calls[1], ['gh', ['api', 'repos/example/report-builder/git/tags/annotation', '--jq', '.object']]);

  assert.throws(() => verifyRemoteTag('example/report-builder', 'v1.0.0', 'head', gh(new Error('HTTP 404'))), /404/);
  const cycle = gh(JSON.stringify([{ ref: 'refs/tags/v1.0.0', object: { type: 'tag', sha: 'cycle' } }]), JSON.stringify({ type: 'tag', sha: 'cycle' }));
  assert.throws(() => verifyRemoteTag('example/report-builder', 'v1.0.0', 'head', cycle), /nicht auf den aktuellen Commit/);
  assert.equal(cycle.calls.length, 17);
});

test('Release: fehlender Tag wird auf dem Commit angelegt, vorhandene werden nie verschoben', () => {
  const missing = gh(JSON.stringify([{ ref: 'refs/tags/v1.0.0-beta', object: { type: 'commit', sha: 'other' } }]), '{}');
  assert.equal(ensureRemoteTag('example/report-builder', 'v1.0.0', 'head', missing), true);
  assert.deepEqual(missing.calls.at(-1), ['gh', ['api', '--method', 'POST', 'repos/example/report-builder/git/refs', '-f', 'ref=refs/tags/v1.0.0', '-f', 'sha=head']]);

  const existing = gh(JSON.stringify([{ ref: 'refs/tags/v1.0.0', object: { type: 'commit', sha: 'head' } }]));
  assert.equal(ensureRemoteTag('example/report-builder', 'v1.0.0', 'head', existing), false);
  assert.throws(() => ensureRemoteTag('example/report-builder', 'v1.0.0', 'other', existing), /nicht auf den aktuellen Commit/);
  assert.equal(existing.calls.length, 2);
  assert(existing.calls.every(([, args]) => !args.includes('POST')));

  const failing = gh('[]', new Error('HTTP 422'));
  assert.throws(() => ensureRemoteTag('example/report-builder', 'v1.0.0', 'head', failing), /422/);
  assert.equal(failing.calls.length, 2);
});

test('Release Notes: nur der Abschnitt der Version (Keep a Changelog) und der Installationshinweis', () => {
  const changelog = '# Änderungsprotokoll\n\n## [1.0.1] - 2026-11-01\n- Zukunft\n\n## [1.0.0] - 2026-10-18\n\n### Hinzugefügt\n- Aktuell\n\n## [0.9.0]\n- Alt\n';
  const notes = releaseNotes(changelog, '1.0.0', 'bc-report-builder-1.0.0.vsix');
  assert.match(notes, /### Hinzugefügt\n- Aktuell/);
  assert.doesNotMatch(notes, /Zukunft|Alt/);
  assert.match(notes, /bc-report-builder-1\.0\.0\.vsix/);
  assert.match(notes, /Install from VSIX/);
  assert.doesNotMatch(releaseNotes(changelog, '1.0', 'x.vsix'), /Aktuell/);
  assert.match(releaseNotes('## 1.0.0\n- Ohne Klammern\n', '1.0.0', 'x.vsix'), /Ohne Klammern/);
  assert.equal(releaseNotes('# Leer', '1.0.0', 'x.vsix').includes('\n\n'), false);
});

test('Paketprüfung: liest gespeicherte und komprimierte ZIP-Einträge', () => {
  const entries = [['a.txt', new TextEncoder().encode('stored'), 0], ['dir/b.txt', new TextEncoder().encode('deflated '.repeat(20)), 8]];
  const local = [], central = [];
  let offset = 0;
  for (const [name, data, method] of entries) {
    const packed = method === 8 ? deflateRawSync(data) : Buffer.from(data);
    const fileName = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(fileName.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(fileName.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, fileName, packed);
    central.push(entry, fileName);
    offset += header.length + fileName.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const files = unzip(new Uint8Array(Buffer.concat([...local, directory, end])));
  assert.deepEqual(Object.keys(files), ['a.txt', 'dir/b.txt']);
  assert.equal(new TextDecoder().decode(files['a.txt']), 'stored');
  assert.equal(new TextDecoder().decode(files['dir/b.txt']), 'deflated '.repeat(20));
  assert.throws(() => unzip(new Uint8Array(30)), /Not a ZIP/);
});
