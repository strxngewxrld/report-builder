import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvalContext, designLabel, evaluate, formatValue, validateExpression } from '../webview/expr';
import { parseCsv } from '../src/csv';

const rows = [
  { Name: 'Anna', Umsatz: 100, Datum: new Date(2026, 0, 5) },
  { Name: 'Bernd', Umsatz: 250.5, Datum: new Date(2026, 1, 10) },
  { Name: 'Anna', Umsatz: null, Datum: new Date(2026, 2, 15) },
];
const ctx = (row: Record<string, unknown> | null = rows[0]): EvalContext => ({
  row, scopeRows: rows, dataSets: { DS: rows }, parameters: { Jahr: 2026, Name: 'Anna' },
  globals: { ExecutionTime: new Date(2026, 9, 16, 14, 30), PageNumber: 2, TotalPages: 5, ReportName: 'R' }, locale: 'de-DE',
});
const ev = (s: string, row?: Record<string, unknown> | null) => evaluate(s, ctx(row));

test('literals and fields', () => {
  assert.equal(ev('Hallo'), 'Hallo');
  assert.equal(ev('=Fields!Name.Value'), 'Anna');
  assert.equal(ev('="Seite " & Globals!PageNumber & " von " & Globals!TotalPages'), 'Seite 2 von 5');
  assert.equal(ev('=Parameters!Jahr.Value + 1'), 2027);
  assert.equal(ev('="a ""b"""'), 'a "b"');
});

test('operators and precedence', () => {
  assert.equal(ev('=1 + 2 * 3'), 7);
  assert.equal(ev('=(1 + 2) * 3'), 9);
  assert.equal(ev('=2 ^ 3 ^ 2'), 512);
  assert.equal(ev('=7 Mod 3'), 1);
  assert.equal(ev('=7 \\ 2'), 3);
  assert.equal(ev('=-2 + 5'), 3);
  assert.equal(ev('=1 < 2 And Not (3 = 4)'), true);
  assert.equal(ev('="abc" Like "a*"'), true);
  assert.equal(ev('="a" & 1 + 2'), 'a3');
});

test('aggregates with implicit and explicit scope', () => {
  assert.equal(ev('=Sum(Fields!Umsatz.Value)'), 350.5);
  assert.equal(ev('=Count(Fields!Umsatz.Value)'), 2);
  assert.equal(ev('=CountRows()'), 3);
  assert.equal(ev('=CountDistinct(Fields!Name.Value, "DS")', null), 2);
  assert.equal(ev('=Max(Fields!Umsatz.Value, "DS")', null), 250.5);
  assert.equal(ev('=Avg(Fields!Umsatz.Value)'), 175.25);
  assert.equal(ev('=First(Fields!Name.Value)'), 'Anna');
  assert.equal(ev('=Last(Fields!Name.Value)'), 'Anna');
  assert.throws(() => ev('=Sum(Fields!Umsatz.Value, "Nope")'), /Bereich/);
});

test('functions', () => {
  assert.equal(ev('=IIf(Fields!Umsatz.Value > 50, "hoch", "niedrig")'), 'hoch');
  assert.equal(ev('=UCase(Left(Fields!Name.Value, 2))'), 'AN');
  assert.equal(ev('=Len("Bericht")'), 7);
  assert.equal(ev('=Year(Fields!Datum.Value)'), 2026);
  assert.equal(ev('=IsNothing(Fields!Umsatz.Value)', rows[2]), true);
  assert.equal(ev('=Fields!Name.Value.ToUpper()'), 'ANNA');
  assert.equal(ev('=Switch(1 = 2, "a", 2 = 2, "b")'), 'b');
  assert.equal(ev('=RowNumber(Nothing)', rows[1]), 2);
  assert.equal(ev('=Format(1234.5, "N2")'), '1.234,50');
  assert.equal(ev('=Format(Fields!Datum.Value, "dd.MM.yyyy")'), '05.01.2026');
});

test('errors', () => {
  // outside a data region: implicit First() over the only dataset, an error with several datasets
  assert.equal(ev('=Fields!Name.Value', null), 'Anna');
  assert.throws(() => evaluate('=Fields!Name.Value', { ...ctx(null), scopeRows: [], dataSets: { A: rows, B: rows } }), /Datenbereich/);
  assert.throws(() => ev('=Foo(1)'), /Unbekannte Funktion/);
  assert.match(validateExpression('=1 +') ?? '', /unvollständig/);
  assert.equal(validateExpression('=Sum(Fields!X.Value)'), null);
  assert.equal(validateExpression('kein Ausdruck'), null);
});

test('.NET style formatting', () => {
  assert.equal(formatValue(1234.567, 'N0', 'de-DE'), '1.235');
  assert.equal(formatValue(0.256, 'P1', 'en-US'), '25.6 %');
  assert.equal(formatValue(1234.5, '#,##0.00', 'en-US'), '1,234.50');
  assert.equal(formatValue(42, 'D5', 'en-US'), '00042');
  assert.equal(formatValue(5, '0.0 kg', 'en-US'), '5.0 kg');
  assert.match(formatValue(9.5, 'C', 'de-DE'), /9,50\s€/);
  assert.equal(formatValue(new Date(2026, 9, 16, 9, 5), 'yyyy-MM-dd HH:mm', 'de-DE'), '2026-10-16 09:05');
  assert.equal(formatValue(null, 'N2'), '');
});

test('design labels like Report Builder', () => {
  assert.equal(designLabel('=Fields!Umsatz.Value'), '[Umsatz]');
  assert.equal(designLabel('=Sum(Fields!Umsatz.Value)'), '[Sum(Umsatz)]');
  assert.equal(designLabel('=Parameters!Jahr.Value'), '[@Jahr]');
  assert.equal(designLabel('=Globals!ExecutionTime'), '[&ExecutionTime]');
  assert.equal(designLabel('="a" & "b"'), '«Expr»');
  assert.equal(designLabel('Text'), 'Text');
});

test('CSV import', () => {
  assert.deepEqual(parseCsv('Name;Betrag\n"Müller; Co";1,5\nX;\n'), [
    { Name: 'Müller; Co', Betrag: 1.5 },
    { Name: 'X', Betrag: null },
  ]);
  assert.deepEqual(parseCsv('a,b\r\n1,"x ""y"""\r\n'), [{ a: 1, b: 'x "y"' }]);
});

test('Sum über einen leeren Bereich ist Nothing (leere Matrixzelle)', () => {
  assert.equal(evaluate('=Sum(Fields!A.Value)', { row: null, scopeRows: [], dataSets: {}, parameters: {} } as unknown as EvalContext), null);
});
