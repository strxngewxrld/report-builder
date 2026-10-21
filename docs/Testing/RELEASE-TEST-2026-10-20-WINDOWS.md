# Windows acceptance, 20 October 2026

English | [Deutsch](RELEASE-TEST-2026-10-20-WINDOWS.de.md)

Adds Windows coverage to the [18 October macOS run](RELEASE-TEST-2026-10-18.md). Desktop interaction used real
mouse/keyboard input (Win32 SendInput) and screenshots. Verification used the webview DOM through a separate
instance's Chromium debug port. All tests used isolated profiles and copies of `samples/`.

## Environment

Windows Server 2025 (10.0.26100), RDP at 1620 × 952 and 100%, German keyboard, VS Code 1.142.0 x64 installed
system-wide under `C:\Program Files`, Node.js 26. Tested the fresh VSIX in a separate profile and the Extension
Development Host. One workspace used spaces, umlauts and `&` (`…\Mein Projekt Ä&Ö\`). Examples had CRLF through
`core.autocrlf`, as typical on Windows.

## Automated checks

- Typecheck passed; 152/152 unit tests, including new preview-data/AL-label regressions.
- Real VS Code integration on Windows: 41/41 English and 41/41 German (`BC_RB_LOCALE=de BC_RB_TEST_LANGUAGE=de`),
  without retries. Three tests formerly asserting English “Table cell”/“in the Designer” are now language-neutral.
- VSIX built, checked (15 files, 93 commands, 14 language model tools) and installed with `--install-extension`.
- CI adds Windows alongside Ubuntu for unit/integration/German webview tests and VSIX.

## Native Windows checks

- **German keyboard:** All AltGr characters `{ } [ ] \ @ € | ~` and umlauts in properties. Windows AltGr is
  Ctrl+Alt but did not conflict with zoom Ctrl+Alt+0/−/= (zoom stayed 121%). Ctrl+Enter, Escape, Ctrl+Z/Y/Shift+Z/S,
  F5 and F2/Enter/Tab on the canvas worked.
- **Clipboard:** Ctrl+V of `QA & Überprüfung <b>€</b>` into the inline editor saved literal text; this was the macOS defect.
- **Saving:** CRLF preserved throughout RDLC/AL, including Create AL Label; no BOM added.
- **Native dialogs:** PDF/Excel/Word export through Windows Save to the special-character path, filename
  `Rechnung Prüfung €.pdf`; image embedding through Open from `Bilder Ü\Firmen Logo ä.png`.
- **PDF:** Two A4 pages. Arial/Arial Bold subsets embedded from `C:\Windows\Fonts`. Opened in the default
  Windows viewer (Edge with Acrobat engine) with lines, total and page number.
- **Excel/Word:** Well-formed ZIP/XML, all lines present, numeric cells are numbers. Office was not installed
  at this stage, so files were not opened in Office.
- **Context menus:** Right-click cell/item/canvas, Table submenu (insert right column, undo), keyboard-only
  navigation to dialog and back.
- **Real drag/drop:** Field from Report Data into a list rectangle; image into page header.
- **AL:** Context found under the special-character path; Create AL Label edits AL/layout in one operation.
- **Persistence:** Unsaved change survived Reload Window in a normal window. Development hosts do not write
  backups by VS Code design; this is not an extension defect.
- **Opening:** Explorer double-click, `code datei.rdl` into an existing instance and cold start with a file
  argument opened in the designer. Only the very first launch after CLI installation opened XML once because
  the extension was not yet registered; not reproducible afterward in this pass.

## Found and fixed defects

1. **BC preview without lines:** `bindRows` used only first-row columns. BC begins with a header without line
   columns, so all line values became null, including sample JSON. It now considers columns from all rows.
2. **#Error after Create AL Label:** Preview knew only layout parameters; AL labels/captions awaiting a build
   now return their text.
3. **Focus after inline edit:** Escape/Ctrl+Enter left focus on body, breaking Tab/Enter/F2/arrows/Delete.
   Fixing this exposed a regression: restoring focus before removing the editor triggered blur and committed
   canceled text. Both issues are fixed.
4. **Shift+F10/context-menu key:** Events hit the canvas without menu context. They now open the selected item's
   or section's menu. Shift+F10 previously did nothing on macOS too.
5. **Focus after native menu/dialog:** Focus fell to body and now returns to the canvas.
6. **Inserted items beyond edges:** Dropping/clicking near the right edge put a 1.5″ field outside body/list
   rectangles, expanded the body and caused blank print pages. Position/width are now bounded by the container.
7. **Designer versus preview line height:** Designer used 1.2× font size, preview/PDF used font metrics. Descenders
   and underscores clipped earlier in design than output.
8. **Designer sessions:** Intermittent full-run PDF retries were caused by a genuine bug: delayed dispose of a
   closed designer unregistered the newly opened designer for the same file, making commands no-ops. Split-editor
   title commands also targeted the last-opened rather than focused designer. New regression fails without the fix.
9. **Windows release:** Notices inherited checkout CRLF, changing the file every build and causing publish:github
   to abort after packaging because the working state changed.
10. **Tests:** Three integration tests assumed English text. CRLF AL insertion and finding VS Code under Program
    Files had already been prepared.

Issues 1, 2 and 4–8 are platform-independent and also affect macOS.

## BC/Office acceptance

Second pass on the same server against actual **Business Central 29.0 DE on-premises** (DVD installation,
instance BC290, web client `http://localhost:8080/BC290/`, Windows authentication, CRONUS AG) and **Microsoft 365
Word/Excel** (not activated). Real mouse/keyboard, screenshots and webview/workbench DOM through Chromium debug
port. Installed VSIX (`-Mode Vsix`), rebuilt/reinstalled after each fix. Evidence: `C:\QA\screens`, `C:\QA\logs`.

| Case | Result |
| --- | --- |
| A1 BC preview to Excel/Word | Passed after fixes: no repair dialog; quantity 530 (N0, cell value 529.5), prices 167,10, amounts 1.141,80, document date as Excel date (Date format, no warning triangle); Word tables, umlauts, A4. Compatibility mode, all documents on one page and date 15.01.26 were fixed in 7/8 below. |
| A2 Umsatzbericht.rdl | Data, totals and date passed after fixes. Excel C format lacked €; fixed in 9, now recognized as currency. |
| B1 Build Project | AL compiler rewrites BOM/dataset, character-identical to Verkaufsrechnung.alc-output.rdlc. Designer reloads and stale notice disappears. Bold/save: three-line diff, BOM/CRLF preserved. Undo/save: identical. |
| B2 Create AL Label | Issue 2 fixed; successful build, ReportParameter present, preview shows Rechnungsnr.; published to BC and checked in PDF. One undo reverts AL/layout. |
| B3 Run Report in BC | Issue 1 reproduced (HTTP 500), fixed: opens http://localhost:8080/BC290/?report=50100 with request page. Publish First uses al.publishNoDebug then opens report. |
| B4 BC comparison | With BC Excel data (57 rows after fix 3), preview and BC PDF both show 30 pages, one per document, page 1 reset on each, same lines/totals: 103001: 25/120 × 83,00, total 12.035,00; 103002: 10.043,00. Generated numeric data after build fixed in 4; page header fixed in 5. |
| B5 Symbols/add fields | Without .alpackages, offers Download Symbols and downloads all five BC290 packages. Picker lists actual Sales Invoice Line fields with number/type; column(ShipmentDate_Line; "Shipment Date") created and compiles. |
| B6 Report extension | reportextension 50110 extending Standard Sales - Invoice with two RDLC layouts; reports base not in workspace, switches layouts, Run in BC reports unknown base ID. |
| C1 Base App in designer | Twelve layouts open error-free and never dirty: StandardSalesInvoice, Reminder, Customer Statement, BankAccountStatement, InventoryValuation, InventoryPickingList, TrialBalance, Check, VATStatement, VATViesDeclarationTaxDE, VendorPaymentsList, CostAcctgStatement. Open/Ctrl+S preserves every SHA-256. Bold field: one-line diff, BOM/CRLF preserved. |
| C2 All 399 layouts | 399/399 unchanged layouts character-identical (BOM/CRLF), 399/399 regenerated stable, no render errors. Umlaut identifiers, Code.SharedVariable, Microsoft.VisualBasic.Strings.Len and .Replace issues found and fixed in 6. |
| D1 Cold start with file | Reproduced, VS Code behavior: code --new-window folder file opens text before custom-editor lookup, activating via workspaceContains instead of onCustomEditor. Same in fresh/used profiles and .rdl. Reuse-window, Explorer and window restoration open designer. No extension change; see outstanding items. |
| D2 Excel comparison | Passed; see A1. |

### Found and fixed defects

1. **Dead BC address:** On-premises reportUrl combined server/instance without the web-client port. Now queries
   `…:7049/<instance>/dev/metadata` and uses webEndpoint, like AL's usePublicURLFromServer. Windows authentication
   uses PowerShell because fetch cannot perform Negotiate.
2. **AL0926 after label creation:** New labels block was after dataset but before rendering.
3. **Zero BC Excel rows:** BC 29 prefixes worksheet/row/c elements with x:. Reader expected no prefixes; now strips them.
4. **Generated data became numeric after build:** numericFieldsFromLayout treated the `<` in `</Value>` as a
   comparison. After builds without rd:TypeName, company/description became 1254.1.
5. **BC header empty while preview filled:** Example called Code.SetData in a Hidden=true textbox value. BC does
   not evaluate hidden textbox values (only page 1 appeared in the BC PDF header), but preview did. Preview now
   evaluates them only when ReportItems reads them. Example calls SetData in Hidden, like Base App; after
   publishing, BC PDF and preview both show company/document number on each page.
6. **German Base App layouts:** Umlaut identifiers in tokenizer/validation/usage search; Code.PageNo Shared
   variables in preview/validation; Microsoft.VisualBasic.* and string methods.
7. **Date format d:** Intl de-DE produced 24.01.28 versus .NET/BC 24.01.2028; also g/G.
8. **Word export:** Missing page breaks and compatibility mode due to missing word/settings.xml.
9. **Excel export:** C without currency symbol.

Unit regressions for all; then typecheck, 160/160 unit tests, 41/41 English and 41/41 German integration tests.

### Observations without changes

- VS Code hides informational buttons after a few seconds; a later click at that position does nothing.
  Notification Center retains the message. This standard behavior explained apparently ineffective clicks.
- Open in Designer from XML creates a second tab rather than replacing XML.
- Generated untyped date fields are left-aligned strings; BC Date columns are right-aligned dates. Loaded BC
  data gives correct alignment.
- Base report IDs could be read from symbols for report extensions; currently only a hint is available.

## Not covered

- Acrobat, NVDA, Windows forced-colors themes and display scaling above 100%. System-wide RDP settings were unchanged.
- BC SaaS/Docker execution; on-premises NavUserPassword (only Windows authentication tested).
- Other outstanding TODO items (historical TODO file) and the [UI matrix](UI-TESTMATRIX.md).

Logs: `artifacts/qa-windows/` (Git-ignored).

## BC/Office follow-up

The Run in BC fix originally interpolated launch.json's server address into PowerShell. A crafted typographic
quote plus a 401/Negotiate server could enable command execution. The address is now normalized as http(s) and
passed in an environment variable; regression added and BC290 retested (webEndpoint
`http://localhost:8080/BC290/`). Then 160/160 unit and 41/41 integration tests passed.

Open: PDF export required a retry (“PDF written”) in one of five full runs; not reproducible in isolation or
with the preceding test.
