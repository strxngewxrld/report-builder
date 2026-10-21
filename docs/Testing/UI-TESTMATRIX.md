# Local UI test matrix

English | [Deutsch](UI-TESTMATRIX.de.md)

Separates real webview-DOM tests from desktop operation through macOS MCP. A passing individual workflow does
not accept all combinations or other operating systems.

| Area | Workflow | Evidence/status |
| --- | --- | --- |
| Data sources | Create, invalid/duplicate name, connection, rename with dataset reference, delete | New webview test passes |
| Datasets | Infer SQL fields, duplicates, types, calculated field, delete | New webview test passes |
| Dataset rename | Table bindings and aggregate scopes in plain/rich text | Extended regression passes; scope defect fixed |
| Parameters | Rename, default, query/subreport references, preview | New webview test passes; reference defect fixed |
| Expression editor | Syntax error, live result, categories, accept, Escape unchanged | New webview test passes |
| Expression search | Search/usages, preview, bulk replacement and undo | Existing webview test passes |
| Rich text | Split, add run/paragraph, format, combine | Extended webview test passes |
| Inline text | Cmd+V, umlauts/ampersand, Cmd/Ctrl+Enter, Escape | Paste natively reproduced/fixed; native retest and regression pass |
| Images | Pick/embed/drag/rename with references/Escape/delete | New webview test passes |
| Drag/drop | Dataset to table, field to cell, field to list rectangle | Webview passes; list rectangle also natively checked through macOS MCP |
| Styling | Font size, bold, hyperlink, preview action | New webview test passes |
| Groups | Parent/child, header/footer, sorting/filter/break/reset, column group | New webview test passes |
| Charts | All nineteen types, ranges, invalid axis bounds, combinations/secondary axis, combined preview | Extended webview test passes |
| Import | CSV umlauts/decimal comma; invalid JSON rows preserve existing data | New webview test passes; validation fixed |
| Export | Excel/Word through webview/extension host to written ZIP/XML | New webview test passes |
| PDF/Office | PDF count/size/fonts; open in Preview, Word, Excel | First run passes |
| Data groups | Plus does not collapse; keyboard categories/actions; Enter in select | Fixed; keyboard regression passes |
| Layout blocks | File import, library save/select, insert twice, name conflicts, shared undo | Existing/new webview/unit tests pass |
| AL | Dataset comparison, definitions, labels, columns, layout switch, code | Existing integration passes; actual AL runtime external |
| AI reports | Real Copilot creates invoice RDLC from AL and adjusts revenue groups/totals/chart/styles | [Copilot acceptance](RELEASE-TEST-2026-10-21-COPILOT.md): real build, independent totals, paginated preview, fixed findings; 162 unit and 58 integration tests per language |
| Tables | Columns/rows/footer/undo; multiselect/merge/split | Existing integration passes; Shift-select/merge/split natively checked, saved ColSpan verified |
| Designer | Section height; draw/move/resize rectangle; copy/paste; marquee; equal width/left align | Native checks, unique names/geometry verified in DOM, layout saved |
| Navigation | Outline filter, arrows, zoom without mutation | New webview test passes |
| New report | Save dialog, header/footer, unit/width, save | New webview test passes |
| Display | English/German, small window, light/dark/high contrast | First run checked; not full screen-reader acceptance |
| Persistence | Save, external edits, invalid XML, undo/redo | Existing integration passes |

Second round: 39/39 integration, 143/143 unit and typecheck pass. First full run needed an import-preview retry.
Wait helper now supports async conditions and the test waits for visible data; rerun passes 39/39 without retries.
All sixteen new UI cases also pass with German webview localization without retries. VSIX rebuilt/checked after fixes.

## Not fully accepted locally

21 October macOS follow-up: [log](RELEASE-TEST-2026-10-21-MACOS.md), 162/162 unit, 58/58 integration per language,
Restricted Mode per language, 379/379 corpus and VSIX pass. Native inline paste, Cmd+Enter/save, byte-exact
undo/redo and PDF in Preview checked. No confirmed product defect; Windows CI needs Node 24. The following
remains the boundary of representative acceptance.

21 October additional verification: [filters/drilldown, styling, NVDA, undo](RELEASE-TEST-2026-10-21-ABSICHERN.md).
Representative filter/drilldown/sort and drag/zoom/grid/container combinations checked. Actual NVDA chart/search
announcements checked; chart keyboard navigation, validation announcements and preview switches fixed. Not a
complete NVDA/VoiceOver pass. Column undo from AL with designers previously closed again byte-exact; no prompt.
Final typecheck, 161/161 unit, 55/55 integration per language without retries.

21 October follow-up: [Acrobat via Windows MCP](RELEASE-TEST-2026-10-21-ACROBAT.md). Concrete historical
ABNAHME.md Windows checklist complete including Acrobat. PDF family fix checked with 161/161 unit and 52/52
integration per language; German drag passed on retry, targeted rerun immediate. Acrobat confirms embedded
Segoe UI Light; special characters, logo and two A4 pages natively checked.

20 October Windows state: [fixes and expanded acceptance](RELEASE-TEST-2026-10-20-FIXES.md). Clipboard/image
validation defects fixed and retested natively in installed VSIX. Actual Restricted Mode checked with new test
command/CI check. Also complete: search style/group hits, individual/bulk undo, block conflicts, cross-profile
logo/new-header export/import and undo, combined group/container breaks, fonts/long text versus PDF,
cross-page bookmark and drillthrough parameters. Label undo from designer/AL and column rename/undo work;
no multi-file prompt. Final typecheck, 160/160 unit, 51/51 integration English/German without retries;
Restricted Mode 1/1 per language; final extra table/group variants 2/2 per language.

- Full VoiceOver/NVDA pass and keyboard-only operation of every dialog variant.
- More color variants, every font/border/number-format combination, every insertion tool/direction/grid/zoom/container combination.
- Actual drillthrough-server navigation (local preview intentionally only reports a hint), and variants beyond
  documented filter/drilldown/sorting combinations. Conditional group breaks, reset expressions and sums have
  representative webview evidence.
- Further large image formats, every conflict/design combination and native multi-file undo prompts.

These outstanding areas are not confirmed defects and are explicitly **not** manually accepted merely because
the full suite passed. Logs: `artifacts/qa-2026-10-18/round2/`, `artifacts/qa-remaining/`, `artifacts/qa-fixes/`.
