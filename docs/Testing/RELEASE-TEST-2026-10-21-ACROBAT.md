# Windows MCP and Acrobat acceptance, 21 October 2026

English | [Deutsch](RELEASE-TEST-2026-10-21-ACROBAT.de.md)

## Result

The concrete Windows checklist in the historical `ABNAHME.md` is complete. Acrobat Reader 64-bit
**26.2.22031.0** was operated through Windows MCP with actual mouse/keyboard input. The first-run Adobe license
agreement was accepted after the user's explicit approval. Windows Server 2025, VS Code 1.142.0, active RDP
desktop at 1620 × 952.

## Found and fixed defect

Earlier export showed “Umsatzbericht2026” despite a gap in preview. Segoe UI Light's font file names Segoe UI
as typographic family and Segoe UI Light as legacy family. The font index considered only the preferred name
and selected a fallback whose different glyph widths covered the space between separately positioned words.

`src/fonts.ts` now indexes both families, including localized names. Weight/italic selection and embedding-rights
checks remain. A cross-platform unit test uses a font with differing legacy/typographic names; a webview test
checks actual Segoe UI Light embedding when installed.

## Native Acrobat checks

- Revenue report: correct title gap, Arial normal/bold/italic, Segoe UI/Segoe UI Light. Acrobat lists all used
  fonts as Embedded, TrueType (CID), Identity-H.
- “Süd”, “Bergmann & Söhne”, “Größter Einzelumsatz”, euro, dash and German number formats are readable. Copying
  PDF text preserves “Umsatzbericht 2026” and special characters. Total quantity 116, revenue 37.523,40 €,
  highlighted single sale 12.400,00 €.
- Invoice: both A4 pages viewed individually; navigation works; properties confirm two 210 × 297 mm pages,
  PDF 1.7. Generated examples contain Header 1/Header 2; RDL page number resets to 1 per document. No repair/format dialog.
- Fresh VSIX installed in another isolated profile; revenue report opened by command picker, previewed and
  exported through the real Save dialog to `installed-vsix.pdf`. Acrobat reconfirms title, umlauts, colors,
  table, total and embedded PNG logo. This inherited QA file intentionally overlaps logo/table header;
  preview shows the same position.

Evidence in `artifacts/qa-2026-10-21/` (local, unversioned):

| Evidence | File |
| --- | --- |
| Corrected title/fonts | acrobat-title-fixed.png, acrobat-fonts-fixed.png |
| Multipage report/properties | acrobat-page-1.png, acrobat-page-2.png, acrobat-properties.png |
| Installed-package export | installed-vsix.pdf, acrobat-installed-vsix.png |
| Copied Unicode text | acrobat-extracted-text.txt |
| Actual webview exports | acrobat.pdf, acrobat-fonts.pdf |

## Automated checks and package

- Typecheck passed; **161/161 unit tests** passed.
- **52/52 English**, **52/52 German** integration tests passed. German drag test initially missed its not-yet
  present DOM source, then passed on the supported retry. A separate German rerun passed immediately. This
  retry is not evidence of complete freedom from flakes.
- PDF export/new font regression separately **2/2** passed.
- VSIX build/activation/package check passed: 93 commands, 14 language model tools.
- Separate QA-profile install succeeded; native export inspected as above.

Logs: `unit.log`, `pdf-integration.log`, `integration-en.log`, `integration-de.log`, `drag-de-repeat.log`,
`package.log`, `install.log`. Previous Restricted Mode checks were not repeated for this font-only change.

Package `artifacts/bc-report-builder-1.0.0.vsix`, SHA-256:
`13255A6E6C175E279DAAEA6A07B049B7C98C110AEE998FF437736C0BE8A5F9FD`.
Supersedes the previous log's artifact. After adding the changelog, rebuilt, verified and installed again in
the same isolated profile; unchanged product code had already been checked natively.

## Remaining limits

No manual repeat of this completed Acrobat acceptance is needed. Broader TODO items explicitly remain open:

- Copilot decisions need a signed-in session/available model; isolated tests report none. Tool calls themselves
  are integration-tested.
- No supplied cloud sandbox/Docker BC target; on-premises acceptance remains valid.
- NVDA not installed at this stage; VoiceOver needs macOS. Webview tests do not replace screen-reader passes.
- Further filter/drilldown, design/drag and cross-platform variants, plus multi-file undo confirmation dialogs
  that did not appear, were not additionally checked. Label/column undo already has native byte-exact evidence;
  an artificially forced prompt would not substitute for the actual workflow.
- Local drillthrough shows evaluated target/parameters; executing a target requires the reporting server and
  is not claimed here.

User-checked remote/commit items were not retested this round. No commit created and nothing published.
