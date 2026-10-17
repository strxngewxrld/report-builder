// Layout linting for Business Central: references in expressions (Fields!, Parameters!, Code., ReportItems!) are
// checked against the layout's dataset, its parameters, the Code block and the report items – and, when the AL report
// is known, against what the AL compiler will generate. Pure: positions are text offsets.

import { CodeModule } from '../webview/vb';
import { AlReport, allColumns } from './al/parser';
import { mergedDataItems } from './al/context';

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface LintIssue {
  offset: number;
  length: number;
  severity: Severity;
  message: string;
  code: string;
  /** Innermost report item containing the issue. */
  item?: string;
  /** Rendered faded (unused code). */
  unnecessary?: boolean;
}

/** What the AL report defines for the layout (see expectedDataset). */
export interface AlExpectation { reportName: string; fields: string[]; parameters: string[]; complete: boolean }

const ITEM_TAGS = 'Textbox|Rectangle|Line|Image|Tablix|Chart|Subreport|Map|GaugePanel|CustomReportItem';

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Names and ranges declared in a layout. */
export function layoutDeclarations(text: string) {
  const dataSets = /<DataSets>([\s\S]*?)<\/DataSets>/.exec(text);
  const fields = dataSets ? [...dataSets[1].matchAll(/<Field Name="([^"]+)"/g)].map(m => m[1]) : [];
  const parameters = [...text.matchAll(/<ReportParameter Name="([^"]+)"/g)].map(m => m[1]);
  const items = [...text.matchAll(new RegExp(`<(?:${ITEM_TAGS}) Name="([^"]+)"`, 'g'))].map(m => m[1]);
  const code = /<Code>([\s\S]*?)<\/Code>/.exec(text);
  return {
    fields, parameters, items,
    code: code ? { text: decode(code[1]), start: code.index + 6, end: code.index + code[0].length } : null,
    fieldsAt: dataSets ? dataSets.index : 0,
  };
}

/** Innermost report item at each offset (open/close tags of report items form intervals). */
export function itemAt(text: string): (offset: number) => string | undefined {
  const spans: { start: number; end: number; name: string }[] = [];
  const stack: { start: number; name: string; tag: string }[] = [];
  const re = new RegExp(`<(${ITEM_TAGS}) Name="([^"]+)"|</(${ITEM_TAGS})>`, 'g');
  for (const m of text.matchAll(re)) {
    if (m[1]) stack.push({ start: m.index, name: m[2], tag: m[1] });
    else {
      const open = stack.pop();
      if (open) spans.push({ start: open.start, end: m.index, name: open.name });
    }
  }
  spans.sort((a, b) => a.end - a.start - (b.end - b.start)); // innermost first
  return offset => spans.find(s => s.start <= offset && offset <= s.end)?.name;
}

export function lintLayout(text: string, al: AlExpectation | null): LintIssue[] {
  const decl = layoutDeclarations(text);
  const issues: LintIssue[] = [];
  const fields = new Set(decl.fields);
  const params = new Set(decl.parameters);
  const items = new Set(decl.items);
  const alFields = new Set(al?.fields ?? []);
  const alParams = new Set(al?.parameters ?? []);
  const lower = (s: Iterable<string>) => new Map([...s].map(x => [x.toLowerCase(), x]));
  const fieldsLower = lower(fields), paramsLower = lower(params);

  let functions: Set<string> | null = null;
  if (decl.code) {
    try {
      const mod = new CodeModule(decl.code.text);
      functions = new Set(mod.functionNames.map(f => f.toLowerCase()));
      for (const e of mod.errors) issues.push({ offset: decl.code.start, length: 6, severity: 'warning', code: 'code', message: `Code-Block: ${e}` });
    } catch (e) {
      issues.push({ offset: decl.code.start, length: 6, severity: 'warning', code: 'code', message: `Code-Block kann nicht gelesen werden: ${(e as Error).message}` });
    }
  }
  const inCode = (o: number) => !!decl.code && o >= decl.code.start && o < decl.code.end;
  const add = (m: RegExpMatchArray, nameStart: number, name: string, severity: Severity, code: string, message: string) =>
    issues.push({ offset: m.index! + nameStart, length: name.length, severity, code, message });

  for (const m of text.matchAll(/\bFields!(\w+)/gi)) {
    if (inCode(m.index!)) continue;
    const name = m[1];
    const at = m[0].length - name.length;
    if (fields.has(name)) {
      if (al?.complete && !alFields.has(name) && !(name.endsWith('Format') && alFields.has(name.slice(0, -6)))) {
        add(m, at, name, 'warning', 'removed-field', `Feld „${name}“ ist im Layout-Dataset, aber nicht mehr im AL-Report „${al.reportName}“. Beim nächsten Build entfernt der Compiler es, der Verweis schlägt dann fehl.`);
      }
      continue;
    }
    if (alFields.has(name)) {
      add(m, at, name, 'warning', 'stale-field', `Spalte „${name}“ ist im AL-Report „${al!.reportName}“ definiert, fehlt aber noch im Layout-Dataset. Projekt neu erstellen, damit der AL-Compiler das Dataset aktualisiert.`);
      continue;
    }
    const other = fieldsLower.get(name.toLowerCase());
    add(m, at, name, 'error', 'unknown-field', other
      ? `Feld „${name}“ gibt es nicht – Groß-/Kleinschreibung beachten: „${other}“.`
      : `Feld „${name}“ gibt es im Dataset nicht${al ? ` (auch nicht im AL-Report „${al.reportName}“)` : ''}.`);
  }

  for (const m of text.matchAll(/\bParameters!(\w+)/gi)) {
    if (inCode(m.index!)) continue;
    const name = m[1];
    const at = m[0].length - name.length;
    if (params.has(name)) {
      if (al?.complete && !alParams.has(name)) {
        add(m, at, name, 'warning', 'removed-parameter', `Parameter „${name}“ (Label/Beschriftung) ist im Layout, aber nicht mehr im AL-Report „${al.reportName}“.`);
      }
      continue;
    }
    if (alParams.has(name)) {
      add(m, at, name, 'warning', 'stale-parameter', `„${name}“ ist im AL-Report „${al!.reportName}“ definiert (Label oder IncludeCaption), fehlt aber noch im Layout. Projekt neu erstellen.`);
      continue;
    }
    const other = paramsLower.get(name.toLowerCase());
    add(m, at, name, 'error', 'unknown-parameter', other ? `Parameter „${name}“ gibt es nicht – gemeint ist vermutlich „${other}“.` : `Parameter „${name}“ gibt es nicht.`);
  }

  for (const m of text.matchAll(/\bCode\.(\w+)/g)) {
    if (inCode(m.index!)) continue;
    const name = m[1];
    if (!functions) add(m, 5, name, 'error', 'no-code', `Code.${name}: der Bericht hat keinen Code-Block.`);
    else if (!functions.has(name.toLowerCase())) add(m, 5, name, 'error', 'unknown-code', `Code.${name} ist im Code-Block nicht definiert.`);
  }

  for (const m of text.matchAll(/\bReportItems!(\w+)/g)) {
    if (inCode(m.index!)) continue;
    const name = m[1];
    if (!items.has(name)) add(m, 12, name, 'error', 'unknown-item', `Berichtselement „${name}“ gibt es nicht.`);
  }

  // Business Central conventions per textbox
  for (const tb of text.matchAll(/<Textbox Name="([^"]+)">([\s\S]*?)<\/Textbox>/g)) {
    const body = tb[2];
    const bodyAt = tb.index! + tb[0].indexOf('>') + 1;
    const hasFormat = /<Format>/.test(body);
    for (const v of body.matchAll(/<Value(?:\s[^>]*)?>([^<]*)<\/Value>/g)) {
      const value = decode(v[1]).trim();
      const at = bodyAt + v.index! + v[0].indexOf('>') + 1;
      // decimal columns come with "<Column>Format" (currency/precision at run time)
      const field = /^=\s*(?:(?:Sum|First|Last|Min|Max|Avg)\()?Fields!(\w+)\.Value(?:\s*(?:,\s*"[^"]*")?\))?$/i.exec(value)?.[1];
      if (field && !hasFormat && fields.has(`${field}Format`)) {
        issues.push({ offset: at, length: v[1].length, severity: 'info', code: 'bc-format',
          message: `„${tb[1]}“ zeigt „${field}“ ohne Zahlenformat. Business Central liefert dazu „${field}Format“ (Währung/Nachkommastellen) – Format auf =Fields!${field}Format.Value setzen.` });
      }
      // fixed texts are not translated: Business Central layouts use labels/captions instead
      if (al && value && !value.startsWith('=') && /\p{L}{2,}/u.test(value)) {
        issues.push({ offset: at, length: v[1].length, severity: 'info', code: 'literal-text',
          message: `„${tb[1]}“ enthält den festen Text „${value.length > 40 ? value.slice(0, 40) + '…' : value}“, der nicht übersetzt wird. Als Label im AL-Report anlegen (Kontextmenü im Designer: „Als AL-Label anlegen…“).` });
      }
    }
  }

  // dataset as a whole against the AL report (reported once, at <DataSets>)
  if (al?.complete) {
    const missing = [...al.fields.filter(f => !fields.has(f)), ...al.parameters.filter(p => !params.has(p))];
    if (missing.length) {
      issues.push({ offset: decl.fieldsAt, length: 10, severity: 'info', code: 'stale-dataset',
        message: `Das Layout-Dataset ist gegenüber dem AL-Report „${al.reportName}“ veraltet: ${missing.length} Spalte(n)/Label(s) fehlen (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}). Projekt neu erstellen.` });
    }
  }

  const where = itemAt(text);
  for (const i of issues) i.item = where(i.offset);
  return issues;
}

/** Columns and labels of an AL report that none of its RDLC layouts uses (positions in the AL file). */
export function lintAlUsage(rep: AlReport, layoutTexts: string[]): { line: number; character: number; length: number; message: string }[] {
  if (!layoutTexts.length) return [];
  const used = new Set<string>();
  for (const t of layoutTexts) {
    for (const m of t.matchAll(/\b(?:Fields|Parameters)!(\w+)/g)) used.add(m[1]);
  }
  const out: { line: number; character: number; length: number; message: string }[] = [];
  for (const c of allColumns(mergedDataItems(rep))) {
    if (!used.has(c.name) && !used.has(`${c.name}Format`) && !used.has(`${c.name}Caption`)) {
      out.push({ ...c.pos, length: c.name.length, message: `Spalte „${c.name}“ wird in keinem RDLC-Layout dieses Reports verwendet.` });
    }
  }
  for (const l of rep.labels) {
    if (!used.has(l.name)) out.push({ ...l.pos, length: l.name.length, message: `Label „${l.name}“ wird in keinem RDLC-Layout dieses Reports verwendet.` });
  }
  return out;
}
