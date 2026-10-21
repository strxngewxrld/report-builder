# Local release test, 18 October 2026

English | [Deutsch](RELEASE-TEST-2026-10-18.de.md)

## Environment and scope

macOS 15.7.5, VS Code 1.142.0, Node.js 24.22.0. Tests ran in a real Extension Development Host with isolated
profiles and copies of `samples/`; desktop operation used macOS MCP. Original examples and the normal VS Code
profile were not modified.

## Findings and fixes

1. **Dialog focus:** The shared dialog frame did not reliably take focus and allowed Tab/Shift+Tab to reach the
   background UI. It now uses the same focus containment and restoration as expression search and block import.
2. **Clipboard:** Dialogs stopped all keyboard events, preventing Cmd+V from reaching the VS Code webview host.
   Pasting into expression inputs failed. Now only handled Escape events are stopped. Reproduced with real Cmd+V
   in the development host and successfully retested after the fix.
3. **English UI:** Outline help text was hardcoded in German. It and the PDF export error message are now localized.
4. **Properties:** Editable charts and rich-text textboxes were incorrectly labeled non-editable in the properties
   header. It now shows the correct item type.
5. **Empty formatted cells:** New group rows showed `0`, `0,00 €` or `dd.MM.yyyy` for empty values. Empty strings
   now remain empty during formatting, while numeric zero is still formatted. Regressions cover number, currency
   and date formats.
6. **High contrast:** Secondary buttons combined a fixed light-gray fallback background with white theme text
   when the theme lacked a background color. The fallback now uses theme input/foreground colors so Cancel and
   additional series remain readable.

## Automated checks

- Typecheck passed.
- 142/142 unit tests passed, including localization, parser/serializer, tables, groups/matrices, charts,
  expressions, blocks, images, fonts, exports and publishing helpers.
- 23/23 integration tests passed in the real VS Code host. Two new tests cover dialog focus, Tab/Shift+Tab,
  Escape, unchanged documents on cancel, and chart/matrix input, validation, insertion and preview. Existing
  dialog tests also check forwarding clipboard shortcuts to the webview host.
- German: 3/3 additional tests passed for localization, focus/shortcuts and chart/matrix dialogs. Targeted
  formatting/localization rerun: 13/13 passed.
- `microsoft/BCApps` corpus: 379/379 layouts were character-identical both unchanged **and fully regenerated**.
  No corpus-test problems. 45,086 editable items; 73 items preserved verbatim. The log records eleven datasets
  already outdated in Microsoft's corpus and evaluation messages relating to generated sample data.
- Fresh VSIX built and checked: 15 extension files, 93 commands, one custom editor; activation against the
  verification API succeeded. This was not a Marketplace publication.
- The VSIX was also installed into a separate extensions directory and used to open `Verkaufsrechnung.rdlc`
  without development/test mode.

## Visual and interactive checks using macOS MCP

- English designer with outline, properties and table cells; native context menus including the Table submenu.
- Installed VSIX with an actual German VS Code language pack: designer and chart dialog checked, including at
  700 × 500 pixels; errors and buttons remained accessible.
- German chart dialog checked in light and dark high-contrast themes. After fixing contrast, retested a fresh
  webview in the reinstalled VSIX; before/after screenshots are included.
- Chart dialog at 1440 × 1000, 900 × 650 and 700 × 500: scrollable content, reachable errors and Cancel/Insert.
- Actual Tab/Shift+Tab boundaries, Escape and clipboard input into expression fields.
- Inserted/saved a line chart with `Region` category and `Sum(Umsatz)` and previewed it with actual sample data.
- Deleted a table cell and restored it with real Cmd+Z. The German keyboard layout requires AppleScript for
  layout-dependent characters/shortcuts when using macOS MCP.
- Added a parent row group with header/footer and previewed it. Additional design rows enlarge the table;
  absolutely positioned items below it must be moved as needed. Automatic rearrangement was outside this test.
- Excel and Word opened generated example exports without repair dialogs; company, invoice number, lines and
  total were visible. Word used compatibility mode.
- PDF opened in macOS Preview: two pages, text and page numbers visible. Integration also checks page size,
  page count and embedded fonts.

Screenshots and console logs are local in `artifacts/qa-2026-10-18/` (Git-ignored). Exports are in `out/test/export/`.

## Acceptance limits

This local run is not full release approval. Still required:

- Windows/Linux and remote extension hosts (WSL, SSH, Dev Container), especially VSIX updates.
- Real AL symbol packages and report execution in cloud sandbox, Docker and on-premises.
- Actual Restricted Mode workspaces and invoked AL commands.
- Full VoiceOver/NVDA pass and every dialog variant/combination from `ABNAHME.md`; focus regressions do not replace it.
- Multi-file undo with native VS Code prompts in real AL projects.
- Acrobat and Windows/Linux export comparison, and detailed business/layout acceptance of Office output.
  Word/Excel exports are data/document outputs, not evidence of pixel-identical rendering of every RDL element.

No releases published and no commits created.

## Follow-up after the first pass

The first pass did not cover every locally testable feature. The detailed [UI test matrix](UI-TESTMATRIX.md)
records the second pass by workflow and test type. Sixteen additional integration tests brought the total to
39. The full run passed 39/39, including insertion/rendering of all 19 chart types. The import-preview test
needed a retry in the first full run because the first ready signal preceded visible data. The wait helper
now supports asynchronous conditions and waits for visible data. The rerun passed 39/39 without retries.
Unit tests: 143/143 passed; typecheck and fresh VSIX checked. All sixteen new UI workflows also passed in
German without retries. Outstanding local operation/edge-case checks are listed separately in the matrix.

Additional reproduced and fixed issues:

- **Plus buttons:** Adding an entry also collapsed its data group. Click events now stay within the action,
  leaving the new entry visible.
- **Parameter renaming:** Previously updated only simple textboxes. Now includes queries, subreports, styles,
  groups and preserved XML expressions. Reference detection handles collection syntax and case without
  rewriting text inside string literals.
- **Dataset renaming:** Aggregate scopes such as `CountRows("Umsaetze")` were left behind. Renaming now updates
  dataset bindings and actual scope arguments, preserving equal string literals and ReportItems references.
- **Preview data:** Arrays containing null, numbers or strings could replace valid data. Invalid rows are now
  rejected before writing.
- **Keyboard:** Data groups and hover-only actions were inaccessible. Categories/entries are focusable,
  actions appear on focus and Enter/Space toggles categories.
- **Enter in selects:** Enter confirmed the whole dialog while operating a select. Selects, checkboxes, radio
  buttons and color inputs no longer trigger this confirmation path.
- **Inline text editor:** Like the dialogs, it blocked all keyboard events and Cmd+V. Natively reproduced,
  fixed and retested with real paste of `QA & Überprüfung`, Cmd+Enter and save.

Additional native macOS MCP checks: dragging section height, drawing/moving/resizing a rectangle, unique copy
with Cmd+C/Cmd+V, marquee multiselection, equal width and left alignment. Positions/dimensions were checked
through the running host's DOM. A field was dragged into a BC list rectangle and saved as its child. Two actual
table cells were Shift-selected, merged (`ColSpan=2`) and split again; saved files were checked each time.

These mouse checks also used a separate development host's local Chromium debug port for DOM inspection.
Only temporary copies were tested; the debug host was stopped afterward. Logs and checked layout copies:
`artifacts/qa-2026-10-18/round2/`; native screenshots are in its parent directory.

## TODO review and release dry run

On 18 October, `npm run publish:github -- --dry-run` also passed: typecheck, 143/143 tests and package check
(15 extension files, 93 commands, one custom editor). It creates the VSIX, `artifacts/v1.0.0-release-plan.json`
and local release notes; it does not contact GitHub, create a tag or publish. Log:
`artifacts/qa-2026-10-18/round2/report-builder-release-dry-run.log`.

The TODO list now separates evidenced local checks from remaining manual variants and external environments.
Current QA fixes were still uncommitted; the earlier checked commit/CI item is not evidence for this working
state. Commit/push and CI for the exact final state are required before release. Full manual acceptance under
`docs/ABNAHME.md` explicitly remains open.
