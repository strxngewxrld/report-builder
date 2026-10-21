# Copilot acceptance on Windows, 21 October 2026

English | [Deutsch](RELEASE-TEST-2026-10-21-COPILOT.de.md)

## Environment and scope

VS Code 1.142.0, GitHub Copilot 0.70.0, agent mode with automatic model selection (GPT-6 Luna for both tasks),
Windows Server 2025. Operated through Windows MCP. Separate Report Builder Copilot QA profile, installed Report
Builder VSIX and Microsoft AL extension; project copy `C:\QA\copilot-report-e2e-fixed` outside the repository.
No deployment or changes to BC server settings.

## New invoice report: passed

Business task: additional RDLC rendering for Contoso Verkaufsrechnung, A4, line table, translatable headings,
two sample invoices, validation and AL build. Copilot used the existing invoice design as a template and created
`KIRechnungsuebersicht.rdlc`, AL rendering and its own data file. This tests an additional layout for an existing
AL report, not a new AL dataset or a report created entirely without a template.

- Product tools: inspectLayout, getReportData, insertItems, createAlLabel, previewReport, setPageLayout,
  editTable, buildProject, validateLayout, showInDesigner; supplemented by general file/XML tools.
- Five new AL labels present on disk and as layout parameters after building. Correct app.json-relative
  reference: `./KIRechnungsuebersicht.rdlc`.
- Actual AL compiler reported “Success: The package is created”; output and generated app checked. A successful
  tool invocation alone would not prove compilation.
- Four lines: 2.501,00 + 1.499,97 = **4.000,97**, and 301,00 + 179,00 = **480,00**. Stored data/rendered totals
  independently checked; no validation problems.
- Both pages checked natively: correct company, number, date, lines and invoice total. Screenshots
  `02-invoice-page1.png`, `03-invoice-page2.png`.
- Another actual Copilot call confirmed German number formats and both totals after format correction.

## Revenue report adjustment: functional run passed

Task: group eight existing rows by region, subtotals/grand total, column chart below the table, dark-blue styling.
Copilot created the region group through the table tool, filled footers with sums, inserted/edited the chart,
arranged items, validated and opened designer preview. Simple styles were changed directly in XML. In the resumed
run it first attempted longer XML edits and discovered product tools later, then used table/chart tools.

Independent file validation: no problems; data file SHA-256 identical to original copy; all eight rows retained.

| Region | Quantity | Revenue |
| --- | ---: | ---: |
| Nord | 15 | 4.992,50 € |
| Ost | 49 | 14.515,75 € |
| Süd | 32 | 11.415,25 € |
| West | 20 | 6.599,90 € |
| Total | 116 | 37.523,40 € |

Chart contains exactly these four values. Native preview: table on page 1, chart and existing note/subreport
placeholder on page 2, without overlap. Existing subreport execution is not tested locally. The model's “one
page” claim was wrong: text preview had only a page-number placeholder. This model error was reported back
and the description tightened. A follow-up used the table tool to merge the first three group-footer cells,
improving wrapping of labels without changing totals.

During this run and an MCP UI-tree request, the shared VS Code main process hung. Cause unresolved; not safely
attributable to a product component. Intermediate state was saved; the user restarted VS Code, then the task finished.

## Fixed findings

1. Tool edits could remain in invisible AL working copies. Build now explicitly saves dirty file-backed
   documents and does not start on save failure.
2. AL URIs outside workspace association incorrectly used src as project root. Search now reaches parent
   app.json while respecting workspace boundaries.
3. Text preview forced the VS Code language; now uses report language, such as de-DE in English VS Code.
4. Text header/footer output is labeled an unpaginated snapshot, not page 1. Page-dependent Code/ReportItems
   need designer preview. Additional warning explains PageNumber/TotalPages placeholders and prohibits deriving
   page count or overlap-free layout from this output.
5. German charts showed dollars/English separators. Render tree now passes report language to axes, labels
   and tooltips. New SVG regression covers de-DE/en-US, columns, secondary axis, radar and pie.

modelDescriptions were refined from actual failed attempts: AL data-item rather than table names, app.json-relative
paths, register rendering before labels, repeating containers, save/build behavior and text-preview limits.
An earlier aborted run remains failure evidence and does not count as success.

## Evidence

Local `artifacts/qa-copilot-e2e/`: `create-fixed-chat.json` (actual Copilot), `create-validation-final.json`
(independent file validation), `modify-before-window-recovery.rdl` and `modify-intermediate-validation.json`
(incomplete modification run).

Typecheck and **162/162 unit tests** passed; three new Copilot regressions **3/3**. First integration run **57/58**
during concurrent desktop input: inline-text test timed out twice, then passed **1/1** in isolation. Focus is a
plausible link, not independently proven. Next full run interrupted by IDE restart. After restart **58/58 per
language** without test retries. German run first failed cleanup after Exit 0 due to a Windows file lock; runner
now retries removal a bounded number of times. After chart correction, final **58/58 per language**, Exit 0
including cleanup, no retries (`integration-en-chart-final.log`, `integration-de-chart-final.log`). VSIX built,
checked and installed in QA profile; SHA-256:
`3c34fd42fbfeb815b6a973b6336bb790fa4f9e7ffb8e8a67ef09649af4afb4b7`.

The final RDP session disconnected, preventing Windows MCP screenshots. Final visual verification therefore
used the local Chromium debug connection of another isolated VS Code instance with **installed VSIX** and actual
Copilot files: `06-revenue-final-page2.png`, `07-revenue-final-page1.png`, `final-designer-proof.json`. Confirmed
two pages, German euro axes/labels, four correct chart values, four merged total cells (colspan=3), unchanged
grand total. No extra manual visual check of these workflows required. This is designer/webview verification,
not another native mouse/keyboard pass after the chart fix. These tasks do not test every model or arbitrary XML.
