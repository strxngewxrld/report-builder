// Layout linting for Business Central: references in expressions (Fields!, Parameters!, Code., ReportItems!) are
// checked against the layout's dataset, its parameters, the Code block and the report items – and, when the AL report
// is known, against what the AL compiler will generate. Pure: positions are text offsets.

import { CodeModule } from '../webview/vb';
import { AlReport, allColumns } from './al/parser';
import { mergedDataItems } from './al/context';
import { l10n } from '../webview/l10n';

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
      for (const e of mod.errors) issues.push({ offset: decl.code.start, length: 6, severity: 'warning', code: 'code', message: l10n.t('Code block: {0}', e) });
    } catch (e) {
      issues.push({ offset: decl.code.start, length: 6, severity: 'warning', code: 'code', message: l10n.t('The code block cannot be read: {0}', (e as Error).message) });
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
        add(m, at, name, 'warning', 'removed-field', l10n.t('Field "{0}" is in the layout dataset but no longer in the AL report "{1}". The compiler removes it with the next build, then the reference fails.', name, al.reportName));
      }
      continue;
    }
    if (alFields.has(name)) {
      add(m, at, name, 'warning', 'stale-field', l10n.t('Column "{0}" is defined in the AL report "{1}" but not yet in the layout dataset. Build the project so that the AL compiler updates the dataset.', name, al!.reportName));
      continue;
    }
    const other = fieldsLower.get(name.toLowerCase());
    add(m, at, name, 'error', 'unknown-field', other
      ? l10n.t('Field "{0}" does not exist – mind upper and lower case: "{1}".', name, other)
      : al ? l10n.t('Field "{0}" exists neither in the dataset nor in the AL report "{1}".', name, al.reportName) : l10n.t('Field "{0}" does not exist in the dataset.', name));
  }

  for (const m of text.matchAll(/\bParameters!(\w+)/gi)) {
    if (inCode(m.index!)) continue;
    const name = m[1];
    const at = m[0].length - name.length;
    if (params.has(name)) {
      if (al?.complete && !alParams.has(name)) {
        add(m, at, name, 'warning', 'removed-parameter', l10n.t('Parameter "{0}" (label/caption) is in the layout but no longer in the AL report "{1}".', name, al.reportName));
      }
      continue;
    }
    if (alParams.has(name)) {
      add(m, at, name, 'warning', 'stale-parameter', l10n.t('"{0}" is defined in the AL report "{1}" (label or IncludeCaption) but not yet in the layout. Build the project.', name, al!.reportName));
      continue;
    }
    const other = paramsLower.get(name.toLowerCase());
    add(m, at, name, 'error', 'unknown-parameter', other ? l10n.t('Parameter "{0}" does not exist – probably "{1}" is meant.', name, other) : l10n.t('Parameter "{0}" does not exist.', name));
  }

  for (const m of text.matchAll(/\bCode\.(\w+)/g)) {
    if (inCode(m.index!)) continue;
    const name = m[1];
    if (!functions) add(m, 5, name, 'error', 'no-code', l10n.t('Code.{0}: the report has no code block.', name));
    else if (!functions.has(name.toLowerCase())) add(m, 5, name, 'error', 'unknown-code', l10n.t('Code.{0} is not defined in the code block.', name));
  }

  for (const m of text.matchAll(/\bReportItems!(\w+)/g)) {
    if (inCode(m.index!)) continue;
    const name = m[1];
    if (!items.has(name)) add(m, 12, name, 'error', 'unknown-item', l10n.t('Report item "{0}" does not exist.', name));
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
          message: l10n.t('"{0}" shows "{1}" without a number format. Business Central provides "{1}Format" for it (currency/decimals) – set Format to =Fields!{1}Format.Value.', tb[1], field) });
      }
      // fixed texts are not translated: Business Central layouts use labels/captions instead
      if (al && value && !value.startsWith('=') && /\p{L}{2,}/u.test(value)) {
        issues.push({ offset: at, length: v[1].length, severity: 'info', code: 'literal-text',
          message: l10n.t('"{0}" contains the fixed text "{1}", which is not translated. Create it as a label in the AL report (context menu in the designer: "Create as AL Label…").', tb[1], value.length > 40 ? value.slice(0, 40) + '…' : value) });
      }
    }
  }

  // dataset as a whole against the AL report (reported once, at <DataSets>)
  if (al?.complete) {
    const missing = [...al.fields.filter(f => !fields.has(f)), ...al.parameters.filter(p => !params.has(p))];
    if (missing.length) {
      issues.push({ offset: decl.fieldsAt, length: 10, severity: 'info', code: 'stale-dataset',
        message: l10n.t('The layout dataset is out of date compared with the AL report "{0}": {1} column(s)/label(s) are missing ({2}). Build the project.', al.reportName, missing.length, `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`) });
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
      out.push({ ...c.pos, length: c.name.length, message: l10n.t('Column "{0}" is not used in any RDLC layout of this report.', c.name) });
    }
  }
  for (const l of rep.labels) {
    if (!used.has(l.name)) out.push({ ...l.pos, length: l.name.length, message: l10n.t('Label "{0}" is not used in any RDLC layout of this report.', l.name) });
  }
  return out;
}
