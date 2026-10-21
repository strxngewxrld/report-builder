# Follow-up of outstanding TODOs on Windows

English | [Deutsch](RELEASE-TEST-2026-10-20-RESTPUNKTE.de.md)

**The findings below have since been fixed and retested.** Current status and additional acceptance:
[Findings fixed and acceptance expanded](RELEASE-TEST-2026-10-20-FIXES.md). This log preserves original
reproduction steps and findings.

20 October 2026, Windows Server 2025, VS Code 1.142.0, active RDP session at 1620 × 952 pixels. The built working
state was tested in an Extension Development Host with a separate profile and copy of `samples/` under
`artifacts/qa-remaining/`. Normal VS Code profile and BC installation unchanged. Native input used
`C:\QA\tools\ui.ps1` (Win32 SendInput); DOM checks used debug port 9335.

## Confirmed defect: cross-report clipboard

1. Open `Verkaufsrechnung.rdlc`, select `CompanyName`, Ctrl+C.
2. Ctrl+V in the same designer creates `Textbox1`; undo.
3. Open `Umsatzbericht.rdl` in the same window, focus the canvas, Ctrl+V and save.
4. Nothing is inserted. The target SHA-256 remains identical to the starting report:
   `EF7A5BC1C7FD599CFF5D8A1EE4AD15E00818F03B9675D8E83FC262911DA79044`.

Cause: `webview/App.tsx` keeps `clipboard` as local React state per webview. Copy writes and paste reads only
that local reference. Nothing is transferred between designer instances. No product fix in this test task.
Evidence: `copy-same.png`, `copy-other.png`.

## Confirmed defect: broken image without an error message

Choose `broken.png`, containing `not a PNG`, through Report Data → Images → Embed. It is embedded as PNG
without an error. Drag onto canvas, save and preview: the image stays invisible. DOM: `complete=true`,
`naturalWidth=0`, `naturalHeight=0`, source `data:image/png;base64,bm90IGEgUE5H`. The layout contains embedded
data and `<Value>broken</Value>`. The rest of the report remains usable and renders.

`pickImage` in `src/reportEditorProvider.ts` derives MIME type solely from the extension and does not validate
content. A useful error is expected on import or rendering at the latest. Evidence: `broken-embedded.png`,
`broken-preview.png`. No product fix in this test task.

## Native checks

| Workflow | Result |
| --- | --- |
| Block library: cancel replacement | Save `Titel` from Umsatzbericht as `QA-Restabnahme`, make bold and save again with the same name. Escape in native Replace keeps the previous file without FontWeight. |
| Block library: confirm replacement | Save again and confirm Replace. Library file now additionally contains `<FontWeight>Bold</FontWeight>`, with no other difference between saved block files. |
| Native color picker | Open Titel's font color through toolbar; change red from 31 to 200 (green 78, blue 121). Saved layout contains `#c84e79`. |
| Multi-file AL-label undo | Create `QaUndoLbl` from `DocumentNo_Lbl`. Ctrl+Z in designer reverts label/reference together. Redo and undo from AL editor also checked. No “all files?” prompt appeared, so prompt accept/cancel remains unaccepted. |
| Rename column and undo | Rename `CompanyName` to `QaCompanyName` through Report Data context menu. AL/layout update; Ctrl+Z in AL resets both. Saved SHA-256 matches starting files. No prompt here either. |
| Large image | Import valid 320 × 200 SVG with a 2 MiB comment. Size warning appears; Embed Anyway, then drag onto canvas. Designer/preview show SVG; DOM confirms natural size 320 × 200. Not a stress test of very large raster images. |

Evidence: `block-replace.png`, `block-after-cancel.rdlc`, `block-after-replace.rdlc`, `block-replaced.png`,
`color-picker.png`, `color-result.png`, `label-options.png`, `undo-label.png`, `undo-label-from-al.png`,
`renamed.png`, `rename-undo.png`, `before-rename.rdlc`, `large-warning.png`, `large-embedded.png`.

After label undo, AL/RDLC were byte-identical to `samples/` (SHA-256 checked). For column undo, the post-image-test
layout state was saved as the comparison baseline.

## Additional webview integration tests

Tests operate actual React dialogs in the VS Code webview through DOM events. They do not replace native
keyboard/screen-reader acceptance.

- All six calculated chart series: MovingAverage, ExponentialMovingAverage, WeightedMovingAverage,
  TriangularMovingAverage, Mean, Median. Period 0 blocks confirmation; 3 is accepted. Enter conditional point
  color using IIf, check RDL formulas and combined preview without rendering errors.
- Enter bookmark action/target, save and click in preview. Target is on the same title: tests successful
  resolution, **not** navigation between pages.
- Enter drillthrough target and click preview action: message names target report. Actual report-server
  navigation is outside local preview.
- Extend the group test with a second column group around an existing column group.

Full runs after test additions:

- `npm run typecheck`: passed.
- `npm test`: 160/160 passed.
- `npm run test:vscode`: 43/43 passed, no retries.
- `BC_RB_LOCALE=de BC_RB_TEST_LANGUAGE=de npm run test:vscode`: 43/43 passed, no retries.

The first new navigation test failed because `Untertitel` was an unsuitable target with different properties.
Changed to a bookmark on the title; isolated test and both full runs then passed. No product change required.
Logs: `typecheck.log`, `unit.log`, `integration-en.log`, `integration-de.log`.

## Screenshot

`media/preview.png` was captured directly from the isolated VS Code window and embedded in README. Two views
of the same unchanged revenue example: design/outline on the left, report data/preview on the right. No
generated or recreated product UI; crop contains only the editor area.

## Restricted Mode: code finding

The manifest still declares `untrustedWorkspaces.supported: true`. `buildAl`/`runInBc` in `src/bcCommands.ts`
do not check `vscode.workspace.isTrusted`. `runInBc` reads workspace configuration and queries metadata before
the open/publish prompt; Windows authentication can invoke PowerShell with `UseDefaultCredentials`. Changing
only supported to limited would not block those paths. Explicit trust checks and Restricted Mode acceptance
remain necessary. This is a code finding, not an attack test performed here.

## Remaining limits

- WSL reports not installed. Docker is not on PATH; no remote target used.
- Isolated profile is not signed into Copilot; no acceptance of agent-mode model decisions.
- NVDA is not on PATH; no screen-reader acceptance. VoiceOver requires macOS.
- No cloud sandbox or Docker BC environment tested.
- Still open: cross-page bookmarks, drillthrough parameters/server navigation, complex filter/drilldown
  combinations, combined preview breaks, all block-conflict dialogs, additional large image formats, broken-image
  handling, further design/drag variants and native multi-file undo prompts.

Untested combinations remain open in TODO and the UI matrix. Local raw logs/screenshots:
`artifacts/qa-remaining/` (Git-ignored).
