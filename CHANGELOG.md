# Changelog

English | [Deutsch](CHANGELOG.de.md)

Notable changes to this extension. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-10-18

### Fixed during macOS follow-up (2026-10-21)

- Updated CI to Node 24 so test-file globs work on Windows and build/package tools' Node requirements are met.

### Fixed during Windows acceptance (2026-10-21)

- AI tools: AL build explicitly saves invisible dirty documents and aborts on save failure; locate project root
  through app.json even without workspace association. Text preview uses report language and labels headers/footers
  unpaginated snapshots with page-number placeholders. Chart axes/labels/tooltips use report language. Tool
  descriptions refined from actual Copilot tasks.
- Keyboard: chart types support arrows/Home/End and one Tab stop; validation errors are announced. Preview
  drilldown/sorting are keyboard reachable/operable; drilldown exposes expanded state.
- PDF font lookup supports legacy and typographic family names. Segoe UI Light is embedded correctly instead
  of a wider fallback covering spaces between words.

### Added

- English-default user docs and README with German alternatives and language links. Bilingual AI tools reference;
  Getting Started opens three offline guides according to UI language, defaulting to English.
- Full English versions of historical test reports, UI matrix and changelog, with German counterparts; complete
  documentation inventory and bilingual coverage checks.
- Native English/German Getting Started walkthrough: editable example/data, design, preview, AL dataset and
  export; reopen through Getting Started. User/migration guides with screenshots included offline in VSIX.
- Fourteen Copilot agent-mode vscode.lm tools: layout inspection/XML ranges, validation (including nesting,
  header field references and blank-page width), text preview, AL/symbol context, insertion, tables/groups,
  charts, arrangement, pages, AL columns/labels/rename/build and designer display. Simple properties stay direct
  XML edits. Minimum VS Code now 1.95.
- Startup GitHub release updates with Install (SHA-256-verified VSIX), Open Release and Skip This Version;
  setting bcReportBuilder.checkForUpdates.
- GitHub Release publishing with dry run, built-VSIX verification and bundled dependency licenses in THIRD_PARTY_NOTICES.md.
- Expressions and Usages: before/after search/replace, individual/bulk replacement, syntax checks and field/AL-label
  usage navigation, including groups, styles and preserved XML.
- Layout blocks: profile library/RDLC export, section/position insertion across reports, unique names/adapted
  references, images/code, dependency checks and conflict prevention.
- DOM integration for expression search/block import and undo; historical manual plan at docs/ABNAHME.md.
- PDF subsets of installed TrueType/OpenType fonts, including .ttc collections and all supported Unicode.
  Missing/non-embeddable fonts fall back to standard PDF fonts.
- Charts: funnel, pyramid, range/range-column/range-bar (upper/lower values), polar/radar; moving, exponential,
  weighted, triangular average, mean/median calculated series as dashed lines; point color expressions/markers.
- Column groups with existing headers, further groups and parent groups around matrix groups; corner grows/shrinks
  with header levels.
- VB report code: Try/Catch with When/Finally, Throw, Exit Try, With/End With, arrays (Dim a(5), initializers,
  multiple dimensions, ReDim Preserve, indexed assignment, UBound/LBound, Array.IndexOf/Sort/Reverse), multiple
  variables per Dim; uninitialized numeric values 0 and booleans False.
- English/German UI following VS Code display language for commands, menus, settings, messages, validation,
  designer, dialogs and preview.
- Direct pdf-lib preview export: vector text/borders/backgrounds, embedded images/charts.
- Chart axes (title, formats, min/max), labels, secondary axes, per-series combination types; 100% columns,
  smooth lines, stacked area and scatter types.
- Radial/linear GaugePanel rendering in designer/preview instead of placeholders.
- Add/delete column groups in existing tables; column Hide/Toggled by properties.
- Textbox/image hyperlinks, bookmark links, parameterized drillthrough and bookmark targets, clickable in preview.
- Embedded image management: embed, rename with references, delete and drag onto canvas.
- Split textboxes into text runs and combine runs into a simple textbox.
- Rename columns across AL and all RDLC layouts of a report/extensions in one undo step.
- Report Layouts under Report Data: switch RDLC layouts, open Word/Excel externally.
- Labels with Comment, MaxLength, Locked and XLIFF translation guidance.
- VB loops: For/Next/Step, For Each, While/End While, Do/Loop with leading/trailing While/Until, Select Case
  values/ranges/Is/Else, Exit/Continue For/Do/While, compound *= and /= assignments.
- Accessibility: Tab canvas navigation, Alt+arrow resizing, Enter/F2 editing, screen-reader labels/announcements,
  high-contrast highlighting.
- CI typecheck/unit/integration/corpus workflow, LICENSE and changelog.

### Changed

- Create AL Label edits label/textbox in one operation and one undo step.
- Integration timeouts scale with BC_RB_TIMEOUT_SCALE; one retry per test; wait for previous designer closure;
  new label/column/rename/layout/PDF/table command tests.

### Fixed

- PDF requested during preview remeasurement is queued; page counts/export use only current report/data measurements.
- Cross-report copy/paste uses shared designer clipboard, carrying images/code, unique names/adapted references;
  atomic conflict failure and shared undo.
- Broken images are decoded/rejected before embedding; same check for AI image insertion.
- Restricted Mode requires trust for build, symbols and BC, including metadata/Windows authentication; build
  tool blocked too. Design/preview remain available (limited).
- Rectangle/data-region breaks before/after; group end breaks include last instance; expression Disabled/
  ResetPageNumber; coincident breaks preserve number resets.
- Preview/PDF wait for fonts before measuring/exporting.
- Chart legend no longer truncates short categories (J… instead of Jan).
- Empty elements written as `<X></X>` remain so rather than `<X />`; all 379 Base App layouts stay character-identical
  even after full regeneration.
- Generated BC line rows no longer empty: data binding uses columns across all rows, not just first header;
  also fixes sample data whose first row omits fields.
- Newly created AL labels display their text before build instead of #Error.
- AL labels/columns/add blocks preserve source line endings (Windows CRLF).
- Focus returns to canvas after inline edit, context menu or resulting dialog; Shift+F10/context key opens
  selected-item menu (previously no menu/no macOS response).
- Click/drop insertion is bounded by body/list rectangle right edge, preventing body growth and blank print pages.
- Designer text uses font line metrics like preview/PDF rather than 1.2×; avoids premature descender/underscore clipping.
- Split editors/rapid reopen route title/CodeLens commands to focused designer, not last-opened; delayed disposal
  cannot unregister another designer for the same file.
- Excel numbers preserve textbox formats N0/N2/F/P/D/custom patterns rather than uniform #,##0.##; prevents
  167,1 instead of 167,10 and 530 with trailing comma. Dates become real formatted Excel dates rather than text dates.
- THIRD_PARTY_NOTICES uses LF, preventing Windows autocrlf build changes and post-build publishing aborts.
- On-premises Run in BC uses developer metadata webEndpoint/PublicWebBaseUrl with Windows authentication like
  usePublicURLFromServer, instead of a server URL missing the web-client port (localhost/BC290 giving HTTP 500
  versus DVD port 8080). Existing fallback remains on no response. Workspace server addresses are normalized
  http(s) URLs passed as PowerShell data, never interpolated commands.
- New labels blocks follow dataset/requestpage/rendering instead of preceding them, avoiding BC 29 AL0926
  section-order errors.
- BC 29 Excel data-only files with x:row/x:c namespace prefixes no longer import zero rows.
- Generated data for compiler layouts lacking rd:TypeName no longer turns company/description/number/date
  into numbers by reading closing Value tags as comparisons; Format companion fields indicate decimals, NoOf
  names indicate numbers.
- Hidden textbox values are evaluated only if ReportItems reads them, matching BC. SetData in a hidden value
  previously filled preview headers that stayed empty in BC. Invoice example now calls SetData from Hidden,
  like Base App; checked against BC 29.
- German Base App umlaut fields work in preview/validation; Shared Code.PageNo variables recognized;
  Microsoft.VisualBasic.Strings.Len and string Replace/StartsWith/EndsWith/IndexOf evaluated.
- d/g/G standard formats use four-digit years and no comma before time, matching .NET/BC (24.01.2028 rather
  than 24.01.28) in preview/PDF/Word.
- Word export preserves report page breaks (one document per page) and avoids compatibility mode.
- Excel C format preserves currency symbol (4.380,50 € rather than 4.380,50).

## [0.1.0] – 2026-10-17

Initial visual RDLC designer with document outline, AL dataset/context and AL editing, Problems validation,
paginated preview/VB interpreter, tables/groups/lists/matrices/charts, source-preserving saves and
Excel/Word/HTML preview export.
