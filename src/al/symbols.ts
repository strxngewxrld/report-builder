// Tables and their fields from the symbol packages of an AL project (.alpackages/*.app): the SymbolReference.json
// inside each package. Lets the designer offer fields of a data item's table (e.g. "Sales Invoice Line" from the
// Base Application) as new report columns. Pure – the caller reads the files.

import { unzip } from '../xlsx';
import { AlTable } from './parser';

interface SymField { Id?: number; Name: string; TypeDefinition?: { Name?: string; Length?: number } }
interface SymTable { Id?: number; Name: string; Fields?: SymField[] }
interface SymExtension { Name: string; TargetObject?: string; Fields?: SymField[] }
interface SymNamespace { Tables?: SymTable[]; TableExtensions?: SymExtension[]; Namespaces?: SymNamespace[] }

const typeOf = (f: SymField) => {
  const t = f.TypeDefinition?.Name ?? '';
  return f.TypeDefinition?.Length ? `${t}[${f.TypeDefinition.Length}]` : t;
};

/** Tables and table extensions declared in a SymbolReference.json (also nested in namespaces). */
export function tablesFromSymbols(json: string): AlTable[] {
  const root = JSON.parse(json.replace(/^﻿/, '')) as SymNamespace;
  const out: AlTable[] = [];
  const walk = (ns: SymNamespace) => {
    for (const t of ns.Tables ?? []) {
      out.push({ kind: 'table', id: t.Id ?? null, name: t.Name, fields: (t.Fields ?? []).map(f => ({ id: f.Id ?? null, name: f.Name, type: typeOf(f) })) });
    }
    for (const e of ns.TableExtensions ?? []) {
      out.push({ kind: 'tableextension', id: null, name: e.Name, extends: e.TargetObject, fields: (e.Fields ?? []).map(f => ({ id: f.Id ?? null, name: f.Name, type: typeOf(f) })) });
    }
    for (const n of ns.Namespaces ?? []) walk(n);
  };
  walk(root);
  return out;
}

/** Tables of an .app package (NAVX header + zip with SymbolReference.json). */
export function tablesFromApp(bytes: Uint8Array): AlTable[] {
  const files = unzip(bytes);
  const entry = [...files.keys()].find(k => k.toLowerCase() === 'symbolreference.json');
  return entry ? tablesFromSymbols(new TextDecoder().decode(files.get(entry)!)) : [];
}

/** Fields of a table: the table itself plus all extensions of it (names compared case-insensitively). */
export function fieldsOfTable(tables: AlTable[], tableName: string) {
  const key = tableName.replace(/"/g, '').trim().toLowerCase();
  const base = tables.find(t => t.kind === 'table' && t.name.toLowerCase() === key);
  const ext = tables.filter(t => t.kind === 'tableextension' && t.extends?.replace(/"/g, '').toLowerCase() === key);
  return { found: !!base || ext.length > 0, fields: [...(base?.fields ?? []), ...ext.flatMap(e => e.fields)] };
}
