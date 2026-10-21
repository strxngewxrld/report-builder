# Additional verification, 21 October 2026

English | [Deutsch](RELEASE-TEST-2026-10-21-ABSICHERN.de.md)

## Local acceptance cases

Broad TODO items were split into concrete local checks and remaining external prerequisites. Completed cases
do not need manual repetition. Results supplement [Windows acceptance](RELEASE-TEST-2026-10-20-FIXES.md) and
[Acrobat acceptance](RELEASE-TEST-2026-10-21-ACROBAT.md).

### Filters, drilldown and interactive sorting

A BC invoice with two documents and four distinct lines each is opened in the real VS Code webview. Numeric
`>= 100`, `Like Keep*` and then `TopN = 1` filters combine in the nested line table. Each document must show only
its largest matching line; a larger nonmatching line must not win. Existing detail-group filtering remains active.

Line tables start collapsed. Open A with Enter, open B, close A with Space: states remain independent.
Enter/Space interactive sorting cycles to descending; expanded document B stays the same. The layout file is unchanged.

### Styling and dragging

The new webview test draws rectangles in all four directions at 50%, 100% and 200% zoom. Size and normalized
position are read from the changed RDL; each step is undone byte-exactly. A textbox inside a rectangle is moved
with grid, Alt without grid and grid disabled. Parent container stays still; style/format are preserved.

Preview also checks Georgia 14pt/bold/italic with dashed borders and Consolas/Arial with additional border
variants. German N2/C2/P1 yield `1.234,50`, `1.234,50 €`, `12,5 %`. Actual rendered DOM verifies font on TextRun
and border on textbox, matching RDL. Representative combinations, not exhaustive style coverage.

New DOM-driver actions exist only in the explicitly enabled test webview. Existing drag checks now wait for the
asynchronously built source before dropping.

## NVDA: actual keyboard check

NVDA **2026.2 AMD64** was downloaded from NV Access with valid Authenticode signature (NV Access Limited).
Portable copy only in `artifacts/qa-absichern/nvda-portable/`, with its own configuration. No autostart/system-wide
installation. Portable startup/logging follows the [official NVDA manual](https://api.nvaccess.org/documentation/userGuide.html).

Final native session used eSpeak NG, German NVDA output, English VS Code and an isolated installed-VSIX profile.
Real keys were sent through Windows MCP; actual NVDA announcements were read from debug logs. This is not a
subjective assessment of audio/intelligibility.

| Case | Observed NVDA output/result |
| --- | --- |
| Open chart dialog | Insert Chart, dialog; chart types announced as radio buttons |
| Tab to types, Right | Stacked column, radio button, selected, 2 of 19 |
| One more Tab | Name, edit field; no need to tab through nineteen types |
| Clear name | Invalid name announced; Insert disabled |
| Tab through other fields | Dataset, field picker, series type and checkbox named |
| Escape | Focus on Design surface of the report, including keyboard help |
| Expression search | Dialog/Find/Replace named; Umsatz input reports 6 matching expressions |

### Keyboard fixes

1. Chart types had role=radio but no arrow handling and one Tab stop each. They now have one shared stop,
   cyclic arrow selection and Home/End. Focus follows selection; dialog focus containment handles negative tabindex.
2. Shared modal validation lacked live announcements. Errors now have role=alert; native NVDA output verified.
3. Preview drilldown/sort controls were click-only spans. Now button semantics, focus and Enter/Space support;
   drilldown reports aria-expanded. This preview fix is automated in the real webview, not an additional native NVDA pass.

A new integration test covers cycling arrows, Home/End, exactly one Tab stop, validation announcement and an
unchanged document after Escape. Portable NVDA was stopped afterward.

## Multi-file undo

Beyond earlier native label/column tests, all designers were closed and `No_SalesInvHdr` renamed to
`QaNativeDocumentNo` directly in AL. Native success message confirms AL and one layout with six occurrences.
Undo/save restores both original files byte-exactly; evidence `native-undo.json`.

No multi-file prompt appeared. Installed VS Code source shows “all files/this file” only for splittable workspace
undo elements outside a shared undo group. A prompt is not guaranteed for every multi-file undo. Accept/cancel
of an actual prompt is explicitly not claimed tested; normal product workflows have native acceptance.

## Evidence and runs

Typecheck and **161/161 unit tests** passed. Three new targeted cases passed in English/German (**3/3 each**).
Final full runs: **55/55 English**, **55/55 German**, without retries (`final-en.log`, `final-de.log`). During test
development, incorrect selectors were corrected (page container, zoom message, font on TextRun rather than
textbox). Initial setup runs are not final evidence.

Artifacts in `artifacts/qa-absichern/`:

- `nvda.log`: original keyboard finding; `nvda-after.log`, `nvda-speech-transcript.txt`: native retest.
- `nvda-chart-validation.png`: chart dialog with checked validation.
- `native-undo.json`, `undo-before.al`, `undo-before.rdlc`: native undo byte comparison.
- `unit.log`, `targeted-final-en.log`, `targeted-final-de.log`, `final-en.log`, `final-de.log`: final runs.
- `package.log`, `install.log`: package verification/isolated install.

Final VSIX `artifacts/bc-report-builder-1.0.0.vsix`: activation/package check passed (93 commands, 14 language
model tools); installed in separate QA profile. SHA-256:
`B9A2AF398ABCDA110091E032FE2B1380BC986C08732816E125AC008629EEB7EF`.
Supersedes the Acrobat-log package. Includes natively verified fixes; only test-driver/tests/docs changed after
native acceptance.

## Still open

- Real Copilot model decisions: no signed-in session/available model in checked profiles; native UI offers Sign In
  and logs report no session. Tools are integration-tested. modelDescriptions were not changed speculatively
  without observing a model.
- Cloud sandbox/Docker: no targets provided; Docker not installed. Existing BC 29 on-premises acceptance remains
  valid. No new server/container was installed for this follow-up.
- Real drillthrough: local preview only reports target/parameters. No reporting server with matching target
  report; a BC web client alone cannot prove this feature.
- VoiceOver requires macOS; not every NVDA dialog variant is checked. Concrete Windows announcements above are
  complete, comprehensive screen-reader acceptance remains open.
- Representative tests do not prove exhaustive style/container/interaction combinations. Specifically listed
  additional local cases are accepted.

No commits, pushes or publication in this round.
