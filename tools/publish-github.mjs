#!/usr/bin/env node
// Builds and verifies the extension, then attaches the VSIX to a GitHub Release v<version> – the release the
// update check in the extension (src/updateCheck.ts) finds and installs.
//   npm run publish:github -- [--owner <user-or-org>] [--dry-run] [--draft]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}
function output(command, args) {
  return run(command, args, { stdio: 'pipe', encoding: 'utf8' }).trim();
}
function npm(args) {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args]);
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { shell: process.platform === 'win32' });
}

export function releaseRepository(source, ownerOverride) {
  const match = /^(?:git\+https:\/\/github\.com\/|https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([a-z\d-]+)\/([a-z\d_.-]+?)\/?$/i.exec(source.replace(/\.git\/?$/, ''));
  if (!match) throw new Error('Kein GitHub-Repository gefunden. repository.url oder origin prüfen.');
  const owner = (ownerOverride ?? match[1]).trim().toLowerCase();
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/.test(owner)) throw new Error('Ungültiger GitHub-Owner.');
  return `${owner}/${match[2]}`;
}

export function releaseArgs({ repository, tag, asset, notes, title, draft }) {
  return ['release', 'create', tag, asset, '--repo', repository, '--verify-tag', '--title', title,
    '--notes-file', notes, ...(draft ? ['--draft'] : [])];
}

/** Section of the version in CHANGELOG.md (Keep a Changelog: "## [1.0.0] - 2026-10-18") plus the install hint. */
export function releaseNotes(changelog, version, vsixName) {
  const heading = new RegExp(`^## \\[?v?${version.replace(/\./g, '\\.')}\\]?(?:\\s|$)`);
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex(line => heading.test(line.trim()));
  const end = start < 0 ? -1 : lines.findIndex((line, index) => index > start && /^## /.test(line));
  const changes = start < 0 ? '' : lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
  return (changes ? `${changes}\n\n` : '') +
    `Die Datei \`${vsixName}\` unter Assets herunterladen und in VS Code über „Extensions: Install from VSIX…“ installieren. ` +
    'Bereits installierte Versionen bieten das Update beim Start selbst an.\n';
}

/** Return false for a missing tag; reject existing tags on a different commit. */
export function verifyRemoteTag(repository, tag, head, read = output) {
  const refs = JSON.parse(read('gh', ['api', `repos/${repository}/git/matching-refs/tags/${tag}`]));
  let object = refs.find(ref => ref.ref === `refs/tags/${tag}`)?.object;
  if (!object) return false;
  for (let depth = 0; object.type === 'tag' && depth < 16; depth++) {
    object = JSON.parse(read('gh', ['api', `repos/${repository}/git/tags/${object.sha}`, '--jq', '.object']));
  }
  if (object.type !== 'commit' || object.sha !== head) {
    throw new Error(`Der GitHub-Tag ${tag} zeigt nicht auf den aktuellen Commit. Passenden Release-Commit auschecken.`);
  }
  return true;
}

export function tagArgs(repository, tag, head) {
  return ['api', '--method', 'POST', `repos/${repository}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${head}`];
}

/** Create only missing tags, never move or replace an existing version tag. */
export function ensureRemoteTag(repository, tag, head, read = output) {
  if (verifyRemoteTag(repository, tag, head, read)) return false;
  read('gh', tagArgs(repository, tag, head));
  return true;
}

export function main() {
  const { values } = parseArgs({ options: {
    owner: { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, draft: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('npm run publish:github -- [--owner <user-oder-org>] [--dry-run] [--draft]\n' +
      'Lädt die geprüfte VSIX als GitHub-Release-Asset hoch. Keine Marketplace- oder npm-Veröffentlichung.\n' +
      'Voraussetzung: GitHub CLI (gh), Anmeldung und gepushter Release-Commit. Der Versionstag wird automatisch auf GitHub angelegt.\n' +
      '--dry-run baut und prüft lokal, schreibt einen Release-Plan und ruft GitHub nicht auf.\n' +
      'Die Version vorab mit npm version patch|minor|major --no-git-tag-version anheben, CHANGELOG.md ergänzen, committen und pushen.');
    return;
  }
  const dryRun = values['dry-run'];
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const source = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  const repository = releaseRepository(source || output('git', ['remote', 'get-url', 'origin']), values.owner ?? process.env.GITHUB_OWNER);
  const version = manifest.version, tag = `v${version}`;
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const vsixName = `${manifest.name}-${version}.vsix`;
  if (!releaseNotes(changelog, version, vsixName).includes('\n\n')) {
    throw new Error(`CHANGELOG.md hat keinen Abschnitt „## [${version}]“. Änderungen der Version vorher eintragen.`);
  }
  const head = output('git', ['rev-parse', 'HEAD']);
  const dirty = () => output('git', ['status', '--porcelain']);
  if (!dryRun) {
    if (dirty()) throw new Error('Vor der Veröffentlichung alle Änderungen committen und pushen. Für lokale Prüfungen --dry-run verwenden.');
    try { output('gh', ['--version']); }
    catch { throw new Error('GitHub CLI (gh) installieren und gh auth login ausführen oder GH_TOKEN/GITHUB_TOKEN setzen.'); }
    run('gh', ['auth', 'status', '--hostname', 'github.com']);
    try {
      const remoteHead = output('gh', ['api', `repos/${repository}/commits/${head}`, '--jq', '.sha']);
      if (remoteHead !== head) throw new Error('Commit stimmt nicht überein.');
    } catch { throw new Error(`Release-Commit ist in ${repository} nicht erreichbar. HEAD vor dem Veröffentlichen pushen und Repository-Zugriff prüfen.`); }
    try { verifyRemoteTag(repository, tag, head); }
    catch (error) { throw new Error(`Release-Tag prüfen: ${error.message}`); }
  } else {
    console.log('Dry-Run: keine Versionsänderung, kein GitHub-Aufruf und kein Upload.');
  }

  console.log('\nTypprüfung und Tests ausführen');
  npm(['run', 'typecheck']);
  npm(['test']);
  console.log('\nVSIX bauen und prüfen');
  npm(['run', 'package']);
  if (!dryRun && (dirty() || output('git', ['rev-parse', 'HEAD']) !== head)) {
    throw new Error('Der Arbeitsstand wurde während des Builds verändert. Vor Veröffentlichung prüfen und erneut starten.');
  }

  const asset = join(root, 'artifacts', vsixName);
  const notes = join(root, 'artifacts', `${tag}-release-notes.md`);
  const title = `${manifest.displayName} ${version}`;
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(notes, releaseNotes(changelog, version, vsixName));
  const args = releaseArgs({ repository, tag, asset, notes, title, draft: values.draft });
  const plan = join(root, 'artifacts', `${tag}-release-plan.json`);
  writeFileSync(plan, JSON.stringify({ repository, tag, commit: head, version, asset,
    sha256: createHash('sha256').update(readFileSync(asset)).digest('hex'),
    draft: values.draft, command: ['gh', ...args],
    tagCommandIfMissing: ['gh', ...tagArgs(repository, tag, head)],
  }, null, 2) + '\n');
  console.log(`\nRelease-Plan: ${plan}`);
  if (dryRun) {
    console.log(`Geplant: ${repository} / ${tag}${values.draft ? ' (Entwurf)' : ''}, Asset ${vsixName}. Fehlenden Tag auf ${head} anlegen. Nichts veröffentlicht.`);
    return;
  }
  console.log(`\nVersionstag ${tag} prüfen und bei Bedarf auf GitHub anlegen`);
  ensureRemoteTag(repository, tag, head);
  // gh uploads assets to a draft before publishing; existing releases are not overwritten
  run('gh', args);
  console.log(`\nFertig: ${repository} / ${tag}${values.draft ? ' (Entwurf)' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) {
    console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
