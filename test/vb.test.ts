import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvalContext, evaluate } from '../webview/expr';
import { CodeModule } from '../webview/vb';

// Code as found in Microsoft's Business Central layouts (BCApps)
const BC_CODE = `Public Function BlankZero(ByVal Value As Decimal)
    if Value = 0 then
        Return ""
    end if
    Return Value
End Function

Public Function BlankNegAndZero(ByVal Value As Decimal)
    if Value <= 0 then
        Return ""
    end if
    Return Value
End Function

Shared offset as Integer
Shared newPage as Object
Shared currentgroup1 as Object
Shared currentgroup2 as Object
Shared Data1 as Object
Shared hide as Boolean = true
Shared Pct as Decimal

Public Function GetGroupPageNumber(NewPage as Boolean, pagenumber as Integer) as Object
  If NewPage
    offset = pagenumber - 1
  End If
  Return pagenumber - offset
End Function

Public Function IsNewPage(group1 as Object, group2 as Object) As Boolean
newPage = FALSE
If Not (group1 = currentgroup1)
    newPage = TRUE
    currentgroup1 = group1
    currentgroup2 = group2
     ELSE
      If Not (group2 = currentgroup2)
        newPage = TRUE
        currentgroup2 = group2
     End If
  End If
Return newPage
End Function

Public Function GetData(Num as Integer, Group as integer) as Object
if Group = 1 then
   Return Cstr(Choose(Num, Split(Cstr(Data1),Chr(177))))
End If
End Function

Public Function SetData(NewData as Object,Group as integer)
  If Group = 1 and NewData > "" Then
      Data1 = NewData
  End If
  Return True
End Function

Public Function HideOnce As Boolean
  if hide then
    hide = false
    Return true
 end if
 Return false
End Function

Public Function CalcPct(Amount1 as Decimal, Amount2 as Decimal) as Decimal
    if Amount2 <> 0 then
       Pct = Amount1 / Amount2 * 100
    else
       Pct = 0
    end if
    Return ROUND(10*Pct)/10
End Function

Public Function FormatAddress(ByVal Name As String,ByVal City As String)
        Dim FullAddress as String
        FullAddress = Name
        if  City <> "" then
                FullAddress = FullAddress + ", " + City ' comment
        end if
    Return FullAddress
End Function

Public Function UsesOther(v) As Object
  Return BlankZero(v) & "|" & Code_Helper(v)
End Function
Private Function Code_Helper(v)
  Code_Helper = v + 1
End Function`;

const ctx = (code: CodeModule): EvalContext => ({
  row: null, scopeRows: [], dataSets: {}, parameters: {},
  globals: { ExecutionTime: new Date(), PageNumber: 1, TotalPages: 1, ReportName: 'R' }, code,
});

test('Business Central standard functions', () => {
  const code = new CodeModule(BC_CODE);
  const ev = (e: string) => evaluate(e, ctx(code));
  assert.equal(ev('=Code.BlankZero(0)'), '');
  assert.equal(ev('=Code.BlankZero(5)'), 5);
  assert.equal(ev('=Code.BlankNegAndZero(-1)'), '');
  assert.equal(ev('=Code.CalcPct(1, 3)'), 33.3);
  assert.equal(ev('=Code.CalcPct(1, 0)'), 0);
  assert.equal(ev('=Code.FormatAddress("Contoso", "Berlin")'), 'Contoso, Berlin');
  assert.equal(ev('=Code.FormatAddress("Contoso", "")'), 'Contoso');
  assert.equal(ev('=Code.UsesOther(0)'), '|1');
  assert.equal(ev('=Code.HideOnce'), true);
  assert.equal(ev('=Code.HideOnce()'), false);
});

test('SetData/GetData with Chr(177)-separated values', () => {
  const code = new CodeModule(BC_CODE);
  const ev = (e: string) => evaluate(e, ctx(code));
  assert.equal(ev('=Code.SetData("CRONUS" & Chr(177) & "103001" & Chr(177) & "31.01.2026", 1)'), true);
  assert.equal(ev('=Code.GetData(1, 1)'), 'CRONUS');
  assert.equal(ev('=Code.GetData(2, 1)'), '103001');
  assert.equal(ev('=Code.GetData(3, 1)'), '31.01.2026');
  ev('=Code.SetData("", 1)'); // empty data does not overwrite
  assert.equal(ev('=Code.GetData(1, 1)'), 'CRONUS');
});

test('IsNewPage and GetGroupPageNumber', () => {
  const code = new CodeModule(BC_CODE);
  const ev = (e: string) => evaluate(e, ctx(code));
  assert.equal(ev('=Code.IsNewPage("A", "1")'), true);
  assert.equal(ev('=Code.IsNewPage("A", "1")'), false);
  assert.equal(ev('=Code.IsNewPage("A", "2")'), true);
  assert.equal(ev('=Code.IsNewPage("B", "2")'), true);
  assert.equal(ev('=Code.GetGroupPageNumber(True, 3)'), 1);
  assert.equal(ev('=Code.GetGroupPageNumber(False, 4)'), 2);
});

test('state at a version: body state per page, section writes persist', () => {
  const code = new CodeModule(BC_CODE);
  const ev = (e: string) => evaluate(e, ctx(code));
  ev('=Code.SetData("Doc1", 1)');
  const page1 = code.version;
  ev('=Code.SetData("Doc2", 1)');
  const page2 = code.version;
  assert.equal(code.atVersion(page1, () => ev('=Code.GetData(1, 1)')), 'Doc1');
  assert.equal(code.atVersion(page2, () => ev('=Code.GetData(1, 1)')), 'Doc2');
  // header-side state (offset) carries over between page evaluations
  code.atVersion(page1, () => ev('=Code.GetGroupPageNumber(True, 5)'));
  assert.equal(code.atVersion(page2, () => ev('=Code.GetGroupPageNumber(False, 6)')), 2);
  // and does not leak into the body state
  assert.equal(ev('=Code.GetData(1, 1)'), 'Doc2');
});

test('unsupported statements fail only when executed', () => {
  const code = new CodeModule(`Public Function Loop1()
  For i = 1 To 3
  Next
  Return 1
End Function
Public Function Fine()
  Return 2
End Function`);
  assert.equal(evaluate('=Code.Fine()', ctx(code)), 2);
  assert.throws(() => evaluate('=Code.Loop1()', ctx(code)), /nicht unterstützt/);
  assert.throws(() => evaluate('=Code.Missing()', ctx(code)), /nicht definiert/);
});

test('Convert, Choose/Split, Previous, ReportItems, named scopes', () => {
  const rows = [{ A: 1 }, { A: 2 }];
  const c: EvalContext = {
    row: rows[1], scopeRows: rows, dataSets: { DS: rows }, parameters: {},
    globals: { ExecutionTime: new Date(), PageNumber: 1, TotalPages: 1, ReportName: 'R' },
    previousRow: rows[0], scopes: { Group1: [rows[0]] },
    reportItems: n => (n === 'Tb' ? ['x', 'y'] : undefined),
  };
  assert.equal(evaluate('=Convert.ToBase64String("QUJD")', c), 'QUJD');
  assert.equal(evaluate('=Choose(2, Split("a;b;c", ";"))', c), 'b');
  assert.equal(evaluate('=Previous(Fields!A.Value)', c), 1);
  assert.equal(evaluate('=ReportItems!Tb.Value', c), 'x');
  assert.equal(evaluate('=Last(ReportItems!Tb.Value)', c), 'y');
  assert.equal(evaluate('=Sum(Fields!A.Value, "Group1")', c), 1);
  assert.equal(evaluate('=Sum(Fields!A.Value, "DS")', c), 3);
  assert.equal(evaluate('=System.String.IsNullOrEmpty(Fields!A.Value)', c), false);
  assert.equal(evaluate('=String.IsNullOrEmpty("")', c), true);
  assert.equal(evaluate('=Math.Round(2.345, 2)', c), 2.35);
  assert.equal(evaluate('="Nr. " + 5', c), 'Nr. 5');
  assert.equal(evaluate('="2" + 5', c), 7);
  const multi = new CodeModule('Shared Data1, Data2 As Object\nPublic Function F()\n  Data2 = 3\n  Return Data2\nEnd Function');
  assert.deepEqual(multi.errors, []);
  assert.equal(evaluate('=Code.F()', { ...c, code: multi }), 3);
  assert.equal(evaluate('=RunningValue(Fields!A.Value, Sum, "DS")', c), 3);
  assert.equal(evaluate('=RunningValue(Fields!A.Value, Sum, "DS")', { ...c, row: rows[0] }), 1);
});
