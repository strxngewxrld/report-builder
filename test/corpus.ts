// Corpus test against Microsoft's Business Central layouts (github.com/microsoft/BCApps).
// Layouts are streamed into memory – nothing is written to disk.
//
//   npm run test:corpus                       all W1 Base App layouts
//   npm run test:corpus -- Sales/History      only paths containing "Sales/History"
//   XSD=path/to/ReportDefinition2010.xsd npm run test:corpus   additionally validate with xmllint
//
// For every layout: parse, save unchanged, save with everything regenerated (as if every item had been edited),
// and check that nothing is lost, the output is stable, the diff to the original is minimal, and the outline is complete.

import { spawnSync } from 'node:child_process';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { XmlDom, parseRdl, serializeRdl } from '../webview/rdl';
import { Report, allReportItems } from '../webview/model';
import { buildOutline, indexOutline } from '../webview/outline';
import { renderReport } from '../webview/render/engine';
import { mockRows, numericFieldsFromLayout } from '../webview/sampleData';
import { AlReport, expectedDataset, parseAl } from '../src/al/parser';
import { lintLayout } from '../src/lint';
import { previewParameters } from '../webview/bc';

const REPO = 'microsoft/BCApps';
const PREFIX = 'src/Layers/W1/BaseApp/';
const filter = process.argv[2] ?? '';
const xsd = process.env.XSD;

const dom: XmlDom = {
  parse: xml => new DOMParser({ onError: () => {} } as never).parseFromString(xml, 'application/xml') as unknown as Document,
  serialize: node => new XMLSerializer().serializeToString(node as never),
};

/** Multiset of leaf texts and attributes; order and nesting of styles are ignored. */
function signature(xml: string): Map<string, number> {
  const m = new Map<string, number>();
  const add = (k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const walk = (el: Element) => {
    for (const a of Array.from(el.attributes as ArrayLike<Attr>)) if (!a.name.startsWith('xmlns')) add(`@${el.localName}.${a.name}=${a.value}`);
    const kids = Array.from(el.childNodes as ArrayLike<Node>).filter((n): n is Element => n.nodeType === 1);
    if (!kids.length) {
      const t = (el.textContent ?? '').trim();
      if (t) add(`${el.localName}=${t.replace(/\s+/g, ' ')}`);
    }
    kids.forEach(walk);
  };
  walk(dom.parse(xml).documentElement);
  return m;
}
const lost = (a: Map<string, number>, b: Map<string, number>) => [...a].filter(([k, n]) => n > (b.get(k) ?? 0)).map(([k]) => k);

/** Changed lines after removing common leading/trailing lines (0 = identical). */
function changed(a: string, b: string): number {
  if (a === b) return 0;
  const A = a.split(/\r?\n/), B = b.split(/\r?\n/);
  let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let j = 0; while (j < A.length - i && j < B.length - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;
  return Math.max(A.length - i - j, B.length - i - j, 1);
}

function forceRegenerate(r: Report) {
  const mark = (o: { origin?: { key: string } } | null) => { if (o?.origin) o.origin = { ...o.origin, key: 'edited' } as never; };
  for (const it of allReportItems(r)) if (it.type !== 'raw') mark(it);
  [r.header, r.body, r.footer, ...r.dataSources, ...r.dataSets, ...r.parameters].forEach(mark);
}

const valid = (xml: string) => spawnSync('xmllint', ['--noout', '--schema', xsd!, '-'], {
  input: xml.replace(/^﻿/, '').replace(/2016\/01\/reportdefinition"/g, '2010/01/reportdefinition"')
    .replace(/<ReportParametersLayout>[\s\S]*?<\/ReportParametersLayout>/, '')
    .replace(/<df:DefaultFontFamily>[\s\S]*?<\/df:DefaultFontFamily>/, '').replace(' MustUnderstand="df"', ''),
  maxBuffer: 1 << 28,
}).status === 0;

async function main() {
  // on CI the API's anonymous rate limit is shared between runners: use the workflow token when there is one
  const auth: Record<string, string> = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const tree = await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`, { headers: auth })).json() as { tree?: { path: string }[]; message?: string };
  if (!tree.tree) throw new Error(`GitHub: ${tree.message}`);
  const paths = tree.tree.map(t => t.path).filter(p => p.startsWith(PREFIX) && /\.rdlc?$/i.test(p) && p.includes(filter));
  // AL reports of the same layer: check the AL parser against what the compiler wrote into each layout
  const alPaths = tree.tree.map(t => t.path).filter(p => p.startsWith(PREFIX) && /\.Report\.al$/i.test(p));
  const reportsByLayout = new Map<string, AlReport>();
  const alQueue = [...alPaths];
  await Promise.all(Array.from({ length: 12 }, async () => {
    for (let p = alQueue.shift(); p; p = alQueue.shift()) {
      const src = await (await fetch(`https://raw.githubusercontent.com/${REPO}/main/${encodeURI(p)}`)).text();
      for (const rep of parseAl(src)) {
        for (const l of rep.layouts) if (/rdlc?$/i.test(l.file)) reportsByLayout.set(l.file.split(/[\\/]/).pop()!.toLowerCase(), rep);
      }
    }
  }));
  const alStats = { matched: 0, exact: 0 };
  const stale: string[] = [];
  /** Lint errors on Microsoft's own layouts: should be none (anything here is a false positive or a real bug in the layout). */
  const lintErrors: string[] = [];
  const lintCounts = new Map<string, number>();
  console.log(`${paths.length} Layouts aus ${REPO} (${PREFIX}${filter ? `, Filter "${filter}"` : ''})`);

  const problems: string[] = [];
  /** Evaluation messages of the preview engine, grouped by message (with generated data some are expected). */
  const evalMessages = new Map<string, { count: number; example: string }>();
  let renderMs = 0;
  let slowest = '';
  const rawKinds = new Map<string, number>();
  const stats = { identicalNoop: 0, identicalRegen: 0, maxDiff: 0, ms: 0, validOrig: 0, validRegen: 0, raw: 0, editable: 0 };
  let done = 0;
  const queue = [...paths];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const name = p.slice(PREFIX.length);
      const src = await (await fetch(`https://raw.githubusercontent.com/${REPO}/main/${encodeURI(p)}`)).text();
      try {
        const t0 = performance.now();
        const r = parseRdl(src, dom);
        const saved = serializeRdl(r, dom);
        if (performance.now() - t0 > stats.ms) slowest = name;
        stats.ms = Math.max(stats.ms, performance.now() - t0);
        // empty table cells are modelled as content-less raw items: they count as editable
        for (const it of allReportItems(r)) it.type === 'raw' && it.kind !== 'Empty' ? stats.raw++ : stats.editable++;
        // why items stay verbatim (for deciding what to model next)
        for (const it of allReportItems(r)) {
          if (it.type !== 'raw' || it.kind === 'Empty') continue;
          const why = it.kind !== 'Tablix' ? it.kind
            : /<TablixColumnHierarchy>[\s\S]*?<Group /.test(it.xml) ? 'Tablix: Spaltengruppen (Matrix)'
            : /<TablixHeader>/.test(it.xml) ? 'Tablix: Zeilenkopf-Spalten'
            : /<RowSpan>/.test(it.xml) ? 'Tablix: RowSpan' : 'Tablix: sonstiges';
          rawKinds.set(why, (rawKinds.get(why) ?? 0) + 1);
          if (process.env.SHOW_RAW && it.kind === 'Tablix') console.log(`  roh: ${name} › ${it.name} (${why})`);
        }

        const rg = parseRdl(src, dom);
        forceRegenerate(rg);
        const regen = serializeRdl(rg, dom);
        const rg2 = parseRdl(regen, dom);
        forceRegenerate(rg2);

        const sig = signature(src);
        for (const [label, out] of [['ungeändert', saved], ['neu erzeugt', regen]] as const) {
          const l = lost(sig, signature(out));
          if (l.length) problems.push(`${name}: Verlust (${label}): ${l.slice(0, 3).join(' | ')}`);
        }
        if (serializeRdl(parseRdl(saved, dom), dom) !== saved || serializeRdl(rg2, dom) !== regen) problems.push(`${name}: instabil`);
        const d1 = changed(src, saved), d2 = changed(src, regen);
        if (!d1) stats.identicalNoop++;
        if (!d2) stats.identicalRegen++;
        // SHOW_DIFF=1: where a regenerated file differs from the original
        if (d2 && process.env.SHOW_DIFF) {
          const A = src.split(/\r?\n/), B = regen.split(/\r?\n/);
          let k = 0; while (A[k] === B[k]) k++;
          console.log(`\n${name} (${d2} Zeilen), ab Zeile ${k + 1}:\n  - ${A.slice(k, k + 4).join('\n  - ')}\n  + ${B.slice(k, k + 4).join('\n  + ')}`);
        }
        stats.maxDiff = Math.max(stats.maxDiff, d1, d2);

        const outline = indexOutline(buildOutline(saved, dom));
        const missing = [...src.matchAll(/<(Textbox|Rectangle|Line|Image|Tablix|Chart|Subreport|Map|GaugePanel|CustomReportItem) Name="([^"]+)"/g)]
          .map(m => m[2]).filter(n => !outline.has(`item:${n}`));
        if (missing.length) problems.push(`${name}: fehlt in Gliederung: ${missing.slice(0, 3).join(', ')}`);

        // AL dataset vs. the dataset the compiler generated into the layout
        const rep = reportsByLayout.get(name.split('/').pop()!.toLowerCase());
        if (rep) {
          alStats.matched++;
          const exp = expectedDataset(rep);
          const fields = r.dataSets.flatMap(d => d.fields.map(f => f.name));
          const params = r.parameters.map(p => p.name);
          const cols = new Set(exp.fields);
          const extraFields = fields.filter(f => !cols.has(f) && !(f.endsWith('Format') && cols.has(f.slice(0, -6))));
          const missingFields = exp.fields.filter(f => !fields.includes(f));
          const paramDiff = [...exp.parameters.filter(p => !params.includes(p)), ...params.filter(p => !exp.parameters.includes(p))];
          // Differences are real: layouts in the repository that were not regenerated after AL changes.
          // The linter reports exactly these; here they are listed for information.
          if (!extraFields.length && !missingFields.length && !paramDiff.length) alStats.exact++;
          else stale.push(`${name}: Felder nur im Layout ${extraFields.length}, nur in AL ${missingFields.length}, Parameter-Abweichungen ${paramDiff.length}`);
        }

        // linter against the AL report (when found)
        const expAl = rep && expectedDataset(rep);
        for (const issue of lintLayout(src, expAl ? { reportName: rep!.name, fields: expAl.fields, parameters: expAl.parameters, complete: true } : null)) {
          lintCounts.set(issue.code, (lintCounts.get(issue.code) ?? 0) + 1);
          if (issue.severity === 'error') lintErrors.push(`${name}: ${issue.message}`);
        }

        // preview engine: design mode and preview with generated data must not crash
        const t1 = performance.now();
        renderReport(saved, { dom, mode: 'design' });
        const numeric = numericFieldsFromLayout(saved);
        const data = Object.fromEntries(r.dataSets.map(d => [d.name, mockRows(d, 6, numeric)]));
        // parameters as the designer fills them (labels/captions are provided by Business Central at run time)
        const preview = renderReport(saved, { dom, mode: 'preview', data, locale: 'de-DE', parameters: previewParameters(r, null) });
        renderMs = Math.max(renderMs, performance.now() - t1);
        for (const [, msg] of preview.errors) {
          const k = msg.replace(/"[^"]*"|„[^“]*“|'[^']*'|\b\w+![\w.]+|\d+/g, '…');
          const e = evalMessages.get(k) ?? { count: 0, example: `${name}: ${msg}` };
          e.count++;
          evalMessages.set(k, e);
        }

        if (xsd) {
          const vo = valid(src), vr = valid(regen);
          if (vo) stats.validOrig++;
          if (vr) stats.validRegen++;
          if (vo && !vr) problems.push(`${name}: neu erzeugte Datei verletzt das Schema`);
        }
      } catch (e) {
        problems.push(`${name}: Fehler: ${(e as Error).message}`);
      }
      if (++done % 50 === 0) console.log(`  ${done}/${paths.length}`);
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));

  console.log(`\nunverändert gespeichert identisch: ${stats.identicalNoop}/${paths.length}`);
  console.log(`alles neu erzeugt identisch:      ${stats.identicalRegen}/${paths.length} (max. ${stats.maxDiff} abweichende Zeilen)`);
  console.log(`Elemente: ${stats.editable} bearbeitbar, ${stats.raw} unverändert durchgereicht; langsamstes Layout ${Math.round(stats.ms)} ms (${slowest})`);
  console.log(`  unverändert durchgereicht: ${[...rawKinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (xsd) console.log(`Schema gültig: Original ${stats.validOrig}, neu erzeugt ${stats.validRegen}`);
  console.log(`AL-Reports: ${alPaths.length} Dateien, ${alStats.matched} Layouts zugeordnet, davon ${alStats.exact} mit exakt übereinstimmendem Dataset`);
  if (stale.length) console.log(`  ${stale.length} Layouts sind gegenüber ihrem AL-Report veraltet (vom Linter gemeldet):\n    ${stale.join('\n    ')}`);
  console.log(`Lint: ${[...lintCounts].map(([k, v]) => `${k} ${v}`).join(', ') || 'keine Funde'}`);
  if (lintErrors.length) console.log(`  Fehler:\n    ${lintErrors.slice(0, 20).join('\n    ')}`);
  console.log(`Vorschau-Engine: langsamstes Layout ${Math.round(renderMs)} ms; Auswertungsmeldungen mit generierten Daten:`);
  for (const [, e] of [...evalMessages].sort((a, b) => b[1].count - a[1].count).slice(0, 15)) console.log(`  ${String(e.count).padStart(5)} × ${e.example.slice(0, 150)}`);
  console.log(problems.length ? `\n${problems.length} Probleme:\n${problems.join('\n')}` : '\nKeine Probleme.');
  process.exitCode = problems.length ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
