# Findings fixed and acceptance expanded

English | [Deutsch](RELEASE-TEST-2026-10-20-FIXES.de.md)

20 October 2026, Windows Server 2025, VS Code 1.142.0, Node.js 26, German keyboard, active RDP session.
Continuation of the [follow-up](RELEASE-TEST-2026-10-20-RESTPUNKTE.md). Desktop tests used isolated profiles and
copies of `samples/`; the freshly built VSIX was also installed. Profiles/evidence: `artifacts/qa-fixes/` (Git-ignored).

## Fixes

- **Cross-report clipboard:** Share a portable RDL block through the extension host and distribute it to
  existing/new designers. Embedded images and required code are transferred; names, ReportItems references and
  group scopes adapt. Image/code conflicts abort before mutation. Missing data references are reported. Paste
  is one undo step. Clipboard sharing is within one extension host; transfer between separate VS Code windows
  is not implemented.
- **Broken images:** Validate with the actual browser decoder before embedding, including SVG and truncated
  images with plausible PNG headers. Failure leaves the document unchanged and shows a useful message. The AI
  image-insertion tool uses the same validation. Size warnings remain.
- **Restricted Mode:** Manifest changed to `limited` with localized explanation. Build, BC execution and symbol
  download explicitly check workspace trust before saving, invoking AL commands or contacting configured BC
  servers. The build tool checks trust too.
- **PDF during remeasurement:** The previously known export timeout recurred in a full run. Measurements are
  now tied to the current report/data revision, and export requested during measurement is queued. A new test
  loads 120 rows and immediately requests PDF: page count matches the new multipage preview. Individual tests
  for this and the previous export case pass.

## Native checks in the installed VSIX

| Workflow | Evidence |
| --- | --- |
| Copy from Umsatzbericht to Bericht1 | Ctrl+C/Ctrl+V inserts `Titel` in the second report; missing parameter `Jahr` is reported. Undo/save restores the original SHA-256. |
| Import broken PNG | Real Windows file dialog with `broken.png` (`not a PNG`): error, no embedded image, unchanged file. |
| Expression search | Keyboard input of search/replacement, visible before/after. Escape closes; Tab reaches the next toolbar action. Original unchanged. |
| Block library with logo | Embed actual PNG `Firmen Logo ä.png`, drag to canvas, select image/title and save as `Native Firmenkopf`. |
| Export/import across profiles | Native save dialog exports `native-header.rdlc`; a second profile (different user-data-dir, debug port 9337) imports through the native open dialog. File contains image data and two items. |
| New header and shared undo | Import reports a missing parameter and disables insertion. Keyboard-only choice of page header and 0.25″ position, allow unresolved references, insert/save. Logo/design visible. One Ctrl+Z removes items, embedded image and new header, restoring the original hash. |
| Final PDF smoke test | Final VSIX reinstalled after PDF fix; native revenue preview/export/save dialog. `final-native.pdf`: 75,620 bytes, one page matching preview, A4 (595.28 × 841.89 pt), reloaded with pdf-lib. |

Restored `Bericht1.rdlc` SHA-256:
`C090676F3D520646C0211BD26C070446F4B2527CDBF866369F019DFED411296E`.

Image evidence: `native-copy-other.png`, `native-image-rejected.png`, `native-search-keyboard.png`,
`native-search-focus-return.png`, `native-library-logo.png`, `native-block-export.png`,
`native-import-other-profile.png`, `native-import-header.png`. Export: `native-header.rdlc`.
Final export: `native-final-pdf-dialog.png`, `native-final-pdf-saved.png`, `final-native.pdf`.

## Additional automated acceptance in the real webview

- Clipboard: two reports, paste twice, unique names, adjusted internal references, embedded image/code, undo
  including dependencies, new designer and atomic conflict failure.
- Images: invalid PNG, truncated PNG, invalid SVG and broken image through the AI tool; cancel/accept size
  warning for SVG above 2 MiB and undo import.
- Expression search: text/style/group matches, case, invalid replacement, replace individual/remaining hits,
  bulk undo/redo, preserve literal text and navigate parameter usage to layout.
- Block dialog: missing field/label blocks insertion until allowed; new header and undo; image/code conflicts
  show errors without partial changes.
- Preview/PDF: rectangles with Start, End, StartAndEnd; coincident nested end breaks without blank pages;
  page-number reset; immediate PDF with matching count. Repeated toggles with Arial, Georgia and Consolas;
  long growing text in two fonts with stable pagination/PDF comparison. Tables with all three break variants
  and PDF comparison were also checked.
- Groups: end break after the final group, `Disabled` depending on true/false `Paid`, coincident group/table end
  breaks without extra blank pages; `ResetPageNumber = Not Paid` ends on “Seite 1”/“Seite 2” depending on variant.
  Both documents total 741 in the actual preview.
- Navigation: bookmark scrolls from page 1 to page 2; missing target shows a hint. Drillthrough dialog with
  `DocumentNo = =21*2`; preview message identifies target and evaluated value `42`. Server navigation remains a server task.
- Select new AL label `MengeLbl` in usages, verify exactly one hit and navigate to the table field. Search also
  tested after saving, closing and reopening.

## Reproducing Restricted Mode

`npm run test:vscode:untrusted` opens an actual untrusted workspace in a disposable profile. It requires
`workspace.isTrusted === false`, verifies zero AL calls/network requests on build/BC execution, no implicit
save and rejection of the AI build tool. Design/preview remain usable. Added to Windows/Linux CI; remote CI
was not started here.

`@vscode/test-electron` normally disables Workspace Trust. This test therefore launches VS Code directly with
its own profile paths and without that switch. Normal-profile trust is unchanged. Local result: **1/1 passed**;
see `restricted-final.log`.

## Final checks

- Typecheck passed; 160/160 unit tests passed.
- Full integration: **51/51 English and 51/51 German**, without retries.
- Actual Restricted Mode: **1/1 English and 1/1 German**.
- Tests then expanded with final table-break/group variants: **2/2 English and 2/2 German**; final typecheck passed.
- VSIX built/verified: 93 commands, 14 language model tools, packaged code activation succeeded.

Logs: `typecheck-release.log`, `unit-release.log`, `integration-release-en.log`, `integration-release-de.log`,
`restricted-final.log`, `restricted-release-de.log`, `breaks-complete-en.log`, `breaks-complete-de.log`,
`package-release.log`. An earlier 50-test run needed a PDF retry before the fix; the final 51-test runs above did not.

Package: `artifacts/bc-report-builder-1.0.0.vsix`, SHA-256
`C90FB6F2DE77A11F21A84DA77EF50C6A6DA02CB820C53C966BF3CC2CAF746AE9`.

## Remaining external acceptance

- Copilot agent-mode model decisions require a signed-in account; tool paths themselves are tested.
- WSL/SSH/Dev Container remote update installation; no prepared remote target here.
- BC cloud sandbox/Docker; on-premises accepted in the previous Windows log.
- NVDA/VoiceOver, all dialog variants with screen readers and cross-platform visual checks.
- Separate accept/cancel variants of native multi-file undo prompts: label/column undo is byte-exact, but no
  such prompt appeared during these workflows.
- Not every possible filter/drilldown, font/border/format or drag/zoom/container combination was run. Concrete
  Windows cases from `ABNAHME.md` are checked off except the separate Acrobat visual check.

Completed Windows cases do not require another manual run.
