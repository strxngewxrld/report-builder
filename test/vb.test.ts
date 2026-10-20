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

test('Code.Variable reads a Shared variable (German Base App: VATViesDeclarationTaxDE, VendorPaymentsList)', () => {
  const code = new CodeModule('Public Shared PageNo As Integer = 1\nPublic Function NextPage()\n  PageNo = PageNo + 1\n  Return PageNo\nEnd Function');
  const ev = (e: string) => evaluate(e, ctx(code));
  assert.equal(ev('=Code.PageNo'), 1);
  assert.equal(ev('=Code.NextPage()'), 2);
  assert.equal(ev('=IIF(Code.PageNo = 0, 0, Code.PageNo)'), 2);
  assert.deepEqual(code.variableNames, ['pageno']);
  assert.throws(() => ev('=Code.Missing'), /not defined/);
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
  Using r As New Object
  End Using
  Return 1
End Function
Public Function Fine()
  Return 2
End Function`);
  assert.equal(evaluate('=Code.Fine()', ctx(code)), 2);
  assert.throws(() => evaluate('=Code.Loop1()', ctx(code)), /unsupported statement/);
  assert.throws(() => evaluate('=Code.Missing()', ctx(code)), /not defined/);
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

test('loops and Select Case', () => {
  const code = new CodeModule(`Shared Total As Decimal
Public Function SumTo(n As Integer) As Integer
  Dim s As Integer = 0
  For i As Integer = 1 To n
    If i = 4 Then Continue For
    s += i
  Next i
  Return s
End Function
Public Function Down() As String
  Dim r As String = ""
  For i = 5 To 1 Step -2
    r &= i
  Next
  Return r
End Function
Public Function Words(t As String) As Integer
  Dim c As Integer = 0
  For Each w As String In Split(t, " ")
    If w = "stop" Then Exit For
    c += 1
  Next
  Return c
End Function
Public Function Halve(x As Decimal) As Integer
  Dim n As Integer = 0
  While x > 1
    x = x / 2
    n += 1
  End While
  Do
    n += 100
  Loop Until n > 300
  Do While False
    n = -1
  Loop
  Return n
End Function
Public Function Grade(p As Integer) As String
  Select Case p
    Case Is >= 90
      Return "A"
    Case 70 To 89, 69
      Return "B"
    Case 1, 2, 3
      Select Case p
        Case 1
          Return "one"
        Case Else
          Exit Select
      End Select
      Return "low"
    Case Else
      Return "C"
  End Select
End Function
Public Sub AddUp(n As Integer)
  For k = 1 To n
    Total = Total + k
  Next
End Sub
Public Function Forever()
  While True
  End While
End Function`);
  assert.deepEqual(code.errors, []);
  const ev = (e: string) => evaluate(e, ctx(code));
  assert.equal(ev('=Code.SumTo(5)'), 11);
  assert.equal(ev('=Code.Down()'), '531');
  assert.equal(ev('=Code.Words("a b stop c")'), 2);
  assert.equal(ev('=Code.Halve(8)'), 303);
  assert.equal(ev('=Code.Grade(95)'), 'A');
  assert.equal(ev('=Code.Grade(69)'), 'B');
  assert.equal(ev('=Code.Grade(75)'), 'B');
  assert.equal(ev('=Code.Grade(1)'), 'one');
  assert.equal(ev('=Code.Grade(2)'), 'low');
  assert.equal(ev('=Code.Grade(10)'), 'C');
  ev('=Code.AddUp(3)');
  assert.equal(ev('=Code.SumTo(0)'), 0);
  assert.throws(() => ev('=Code.Forever()'), /endless loop/);
});

test('Try/Catch/Finally, Throw and With', () => {
  const code = new CodeModule(`Shared Log As String = ""
Public Function GetLog() As String
  Return Log
End Function
Public Function SafeDiv(a As Decimal, b As Decimal) As String
  Try
    If b = 0 Then Throw New Exception("division by zero")
    Return a / b
  Catch ex As Exception When ex.Message = "nothing"
    Return "never"
  Catch ex As Exception
    Return "error: " & ex.Message
  Finally
    Log &= "f"
  End Try
End Function
Public Function Parse(t As String) As Decimal
  Try
    Return CDec(t)
  Catch
    Return -1
  End Try
End Function
Public Function Rethrow()
  Try
    Throw New System.Exception("inner")
  Catch e
    Throw
  End Try
End Function
Public Function Leave() As Integer
  Dim n As Integer
  Try
    n = 1
    Exit Try
    n = 2
  Finally
    n += 10
  End Try
  Return n
End Function
Public Function Nested() As String
  Try
    Try
      Throw New Exception("x")
    Finally
      Log &= "n"
    End Try
  Catch ex As Exception
    Return ex.ToString() & Log
  End Try
End Function
Public Function Loops()
  Try
    While True
    End While
  Catch
    Return "caught"
  End Try
End Function
Public Function WithArray() As Integer
  Dim a() As Integer = {4, 5, 6}
  With a
    Return .Length + a(0)
  End With
End Function
Public Function WithException() As String
  Try
    Throw New Exception("m")
  Catch ex As Exception
    With ex
      Return .Message & "!"
    End With
  End Try
End Function`);
  assert.deepEqual(code.errors, []);
  const ev = (e: string) => evaluate(e, ctx(code));
  assert.equal(ev('=Code.SafeDiv(6, 3)'), 2);
  assert.equal(ev('=Code.SafeDiv(1, 0)'), 'error: division by zero');
  assert.equal(ev('=Code.GetLog()'), 'ff');
  assert.equal(ev('=Code.Parse("12.5")'), 12.5);
  assert.equal(ev('=Code.Parse("abc")'), -1);
  assert.throws(() => ev('=Code.Rethrow()'), /inner/);
  assert.equal(ev('=Code.Leave()'), 11);
  assert.equal(ev('=Code.Nested()'), 'xffn');
  // the endless-loop guard cannot be caught
  assert.throws(() => ev('=Code.Loops()'), /endless loop/);
  assert.equal(ev('=Code.WithArray()'), 7);
  assert.equal(ev('=Code.WithException()'), 'm!');
});

test('arrays: declaration, index assignment, ReDim and Shared arrays', () => {
  const code = new CodeModule(`Shared Totals(3) As Decimal
Shared Names() As String = {"a", "b"}
Public Function Squares(n As Integer) As String
  Dim q(n) As Integer
  For i = 0 To UBound(q)
    q(i) = i * i
  Next
  q(1) += 10
  Return Join(q, ",")
End Function
Public Function Grid() As Integer
  Dim g(1, 2) As Integer
  g(1, 2) = 7
  g(0, 1) = 3
  Return g(1, 2) * 10 + g(0, 1) + g.GetUpperBound(1)
End Function
Public Function Grow() As String
  Dim a As String() = New String() {"x", "y"}
  ReDim Preserve a(3)
  a(3) = "z"
  Dim b(2) As Integer
  b(0) = 5
  ReDim b(1)
  Return Join(a, "-") & "|" & b.Length & b(0) & Array.IndexOf(a, "y")
End Function
Public Sub Add(i As Integer, v As Decimal)
  Totals(i) = Totals(i) + v
End Sub
Public Function GetTotal(i As Integer) As Decimal
  Return Totals(i)
End Function
Public Function Name(i As Integer) As String
  Return Names(i)
End Function
Public Function Out() As String
  Dim a(1) As Integer
  Try
    a(5) = 1
  Catch ex As Exception
    Return ex.Message
  End Try
End Function
Public Function Defaults() As String
  Dim n As Integer, ok As Boolean
  Dim s As String
  Return n & "/" & ok & "/" & IsNothing(s)
End Function`);
  assert.deepEqual(code.errors, []);
  const ev = (e: string) => evaluate(e, ctx(code));
  assert.equal(ev('=Code.Squares(3)'), '0,11,4,9');
  assert.equal(ev('=Code.Grid()'), 75);
  assert.equal(ev('=Code.Grow()'), 'x-y--z|201');
  ev('=Code.Add(2, 5)');
  const v = code.version;
  ev('=Code.Add(2, 1.5)');
  assert.equal(ev('=Code.GetTotal(2)'), 6.5);
  assert.equal(ev('=Code.GetTotal(0)'), 0);
  // the Shared array as it was at an earlier version
  assert.equal(code.atVersion(v, () => ev('=Code.GetTotal(2)')), 5);
  assert.equal(ev('=Code.Name(1)'), 'b');
  assert.match(String(ev('=Code.Out()')), /outside the bounds/);
  assert.equal(ev('=Code.Defaults()'), '0/False/True');
  assert.throws(() => ev('=Code.Name(5)'), /outside the bounds/);
});
