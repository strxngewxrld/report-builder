# Business Central Report Builder

English | [Deutsch](README.de.md)

A visual designer for Business Central report layouts (`.rdlc` and `.rdl`) in VS Code, inspired by Microsoft
Report Builder. It combines a searchable **document outline**, familiar layout tools and the **AL report as the
source of the dataset**.

![Designer with outline, report data and preview in a split editor](media/preview.png)

## Documentation

The [complete documentation index](docs/README.md) includes bilingual test reports, the UI test matrix and changelog.

Start with **Business Central Report Builder: Getting Started** in the Command Palette. The native walkthrough
opens an editable example with preview data and introduces design, preview, AL datasets and export. Its guides
are included in the VSIX and work offline. English is the default; German guides are available as well.

| Guide | English | Deutsch |
| --- | --- | --- |
| User guide: installation, design, AL, preview, export and troubleshooting | [User guide](docs/USER-GUIDE.md) | [Anwenderhandbuch](docs/ANWENDERHANDBUCH.md) |
| Moving from standalone Microsoft Report Builder to VS Code | [Migration guide](docs/MIGRATION.md) | [Umstiegsanleitung](docs/UMSTIEG-REPORT-BUILDER.md) |
| AI tools: all 14 tools, inputs, examples and verification | [AI tools](docs/AI-TOOLS.md) | [KI-Werkzeuge](docs/AI-TOOLS.de.md) |

## Installation

Download `bc-report-builder-<version>.vsix` from [GitHub Releases](https://github.com/strxngewxrld/report-builder/releases).
In VS Code, run **Extensions: Install from VSIX…**, or use:

```sh
code --install-extension bc-report-builder-1.0.0.vsix
```

Requires VS Code 1.95 or newer. The package contains all runtime dependencies.
Design and preview are available in Restricted Mode. Building projects, downloading symbols and running reports
in Business Central require a trusted workspace.

**Updates:** At startup, the extension checks GitHub Releases and offers **Install**, **Open Release** or
**Skip This Version**. Installation downloads the VSIX and checks its SHA-256 checksum against GitHub's metadata.
The check queries the public GitHub API; it does not upload report data. Disable it with `bcReportBuilder.checkForUpdates`.

## Business Central

### The AL report as the data source

The AL compiler generates a BC layout's dataset from the report object. The designer finds the report referencing
the layout through `rendering › layout › LayoutFile` or `RDLCLayout`, including report extensions. **Report Data** shows:

- **Data items and columns** as a tree: drag them onto the canvas or into cells; double-click to open the AL definition.
- **Labels and captions** (`labels`, `IncludeCaption` → `<Column>Caption`) as parameters.
- A **Build** marker for columns or labels not yet present in the layout dataset. Build the project to let the compiler update it.

Data source, dataset and parameter dialogs are hidden for BC layouts.

### Edit AL from the designer

- **Add Fields as Columns…** on a data item lets you select table fields from the workspace and symbol packages
  (`.alpackages/*.app`, such as Base Application). Columns follow Base App naming conventions (`UnitPrice_Line`)
  and are inserted into the data item, or into an `add(…)` block for report extensions.
- **Create AL Label…** on a textbox with literal text creates an entry in the report's `labels` block and changes
  the textbox to `=Parameters!<Label>.Value`.
- **Build Project (AL: Package)** regenerates an outdated layout dataset.
- **Run Report in Business Central** opens the report in the web client configured in `.vscode/launch.json`
  (cloud, Docker or on-premises), optionally after publishing.
- **CodeLens** on AL columns and labels shows their usage count in layouts. Click to select the textbox;
  the report itself has an action to open its layout.
- **Go to Definition** and **Copy Expression** are available in Report Data.
- **Rename Column (AL and Layouts)…** updates AL and all RDLC layouts of the report and its extensions, including
  field references, `<Column>Format`, `<Column>Caption`, dataset declarations and same-named textboxes, in one undoable edit.
- Labels support `Comment`, `MaxLength` and `Locked`. Translations use XLIFF files in `Translations/` with
  `TranslationFile` enabled in `app.json`. Label creation and the textbox change share one undo step.
- **Report Layouts** lists layouts from the report and its extensions. RDLC opens in the designer; Word and Excel
  layouts open in their respective applications. Missing files are marked.

### BC conventions when designing

- Dragging a decimal field with a `<Column>Format` companion sets `Format = =Fields!<Column>Format.Value` and right alignment.
- Table headers use `=Parameters!<Column>Caption.Value` when `IncludeCaption` provides a translated caption.
- Dragging a data item onto the canvas creates a table, leaving out `…Format` helper fields.

### Validation in the Problems panel

Validation runs for workspace layouts whenever they change. Findings also appear on the affected outline item.

| Finding | Severity |
| --- | --- |
| Unknown `Fields!`, `Parameters!`, `Code.` or `ReportItems!` reference, including case mismatch hints | Error |
| AL column/label is not yet in the layout dataset | Warning |
| Layout field/parameter no longer exists in AL and will disappear on the next build | Warning |
| Layout dataset is outdated overall | Hint |
| Unused AL column/label across all layouts, when all report layouts are RDLC | Hint |
| Decimal field lacks a number format although BC provides `<Column>Format` | Information |
| Literal text in a BC layout that should be a translatable label | Information |

### Preview

The local preview evaluates grouped Tablix structures used by BC reports: groups and details, nested tables,
filters, sorting, headers, `ColSpan`, conditional visibility, individual borders, formatted text runs and
database/embedded images.

- **Pagination:** page size and margins, group `PageBreak`, `KeepTogether`, repeated headers (`RepeatOnNewPage`)
  and `ResetPageNumber`.
- **Per-page headers and footers:** page numbers, page-specific `ReportItems!`, `First/Last(ReportItems!…)`.
- **Gauges:** radial and linear, including scales, ranges and pointers.
- **Report code:** a VB subset with `For`, `For Each`, `While`, `Do`, `Select Case`, `Try/Catch/Finally`, `With`
  and arrays; BC helpers such as `BlankZero`, `SetData/GetData`, `IsNewPage/GetGroupPageNumber`, `SetRowColor`
  and `CalcPct`. Page headers see their own page's code state.
- **Expressions:** scoped aggregates, `RunningValue`, `Previous`, `RowNumber`, `IIf/Switch/Choose`, text/date/format
  functions, `Convert.*`, `System.String.*`, `Math.*` and .NET format codes.
- **Data:** load Excel, CSV or JSON via **Report Data › Load Preview Data**. For BC, export a report using
  **Send to › Microsoft Excel Document (data only)**. Imported data is stored in `<Layout>.data.json`.
  Without a data file, generated rows follow the AL data-item hierarchy.
- **Output:** direct PDF export with vector text, borders and backgrounds, embedded images/charts and subsets of
  installed TrueType/OpenType fonts. Print opens the paginated preview in a browser. HTML, Excel and Word export are available.

### Tables, groups, lists and matrices

The designer handles the Tablix regions in the 379 tested Base App layouts, including BC document lists with
one rectangle per document and a nested line table.

- Add parent/child groups, group headers/footers, grouping expressions, sorting, filters, page breaks, page-number
  resets, visibility and toggles. Delete a group with or without its rows.
- The **Grouping** pane beneath the canvas shows row and column groups; row brackets identify group boundaries.
- Insert rows inside or outside a group. Row properties include **Repeat on Every Page**, **Keep with Group**,
  **Hide** and **Toggled by**.
- Merge/split cells; column insertion and deletion account for merged cells.
- Drag fields into list-cell rectangles; items inside can be moved independently.
- Insert matrices with row/column groups, value and totals. Headers and corner cells are normal textboxes.
- Insert/edit charts: column, stacked/100% column, bar, line, smooth line, area, stacked area, scatter, pie,
  doughnut, funnel, pyramid, range, range column/bar, polar and radar. Supports combinations, secondary axes,
  point colors/expressions, markers, moving-average/mean/median calculated series, axis titles/formats/ranges,
  data labels, title, legend and palette. Existing chart XML is patched selectively.
- Add column groups to tables/matrices, including additional header levels around existing groups. Delete just
  the group or the group and its columns; configure column visibility and toggle textboxes.
- Split textboxes into separately formatted text runs, or combine runs into a simple textbox.
- Configure URL, bookmark and drillthrough actions on textboxes/images. The preview opens external http/https/mailto
  links and supports bookmark navigation.
- Manage embedded PNG, JPEG, GIF, BMP and SVG images in Report Data: embed, rename with reference updates,
  delete and drag onto the canvas.

### Source-preserving saves

Unchanged elements are written verbatim for small Git diffs. Edited elements retain unmodeled content
(`Visibility`, `ZIndex`, page borders and more), property style levels, item order, attributes such as
`EvaluationMode` and original units (`pt`, `in`, `cm`). Schema version, `MustUnderstand`, `rd:ReportUnitType`
(including `Invalid`), line endings and BOM are preserved.

## Expressions, usages and reusable blocks

The **magnifier** opens **Expressions and Usages…** to search/replace expressions across the layout, including
styles, groups and preserved elements. Review before/after results and replace individual matches or all matches
in one undo step. **Field and Label Usages** shows item name, property and path; **Show in Layout** selects a use.
Literal text and AL source are not changed by expression replacement.

Use the **library** icon to save selected items as a reusable block, such as a company header or address area.
The library belongs to the VS Code profile. Export/import RDLC blocks to share them. Insertion lets you choose
section and position; names and internal references are adjusted, and required embedded images/report code are
carried over. Conflicting code or images with different content are not overwritten. Missing fields, labels and
datasets are reported before insertion and must be supplied in the target report. Data sources and AL datasets
are not transferred.

Preview honors breaks before/after rectangles and data regions, including conditional `Disabled` and
`ResetPageNumber` expressions. An end break applies to the last group instance too. Pages are measured again
once report fonts have loaded. Search, usage navigation and block actions are also available in the Command Palette.

## Document outline

The left-hand outline shows page header/body/footer, report items, row/column groups and cell contents at any
nesting depth. Hidden/conditionally hidden markers, grouping, filters, sorting, breaks and diagnostics help locate
items. Search names and expressions; selection stays synchronized with the canvas. Standard tree keyboard navigation applies.

## VS Code integration

- **Editor title:** Insert, Show Preview/Show Design, Print and Open as XML. The overflow menu contains View,
  zoom, report properties, header/footer, preview-data import and Open AL Report. The XML editor offers Open in Designer.
- **Native context menus** on the canvas, outline and Report Data expose item/table editing, clipboard,
  arrangement, insertion, AL navigation and data actions.
- **Status bar** while a designer is active shows selection/tool, preview page, clickable unit and zoom, and the
  associated AL report. Diagnostics use VS Code's Problems panel.
- **Keyboard:** F5 toggles design/preview; Ctrl+Alt+=/-/0 (Cmd+Option on macOS) controls zoom; Ctrl/Cmd+wheel zooms.
- **Settings:** `bcReportBuilder.designer.*` controls grid, snapping, ruler and default zoom.
- **Explorer:** New Report Layout… on folders and under File › New File…; Open in Designer/Open as XML on layouts.
- Codicons, theme colors, resizable panes, tree guides, filter inputs, dialogs and scrollbars follow the current
  light, dark or high-contrast theme.

## AI assistance (GitHub Copilot)

The extension registers 14 tools for Copilot agent mode and other chats using VS Code's `vscode.lm` tools.
Reference tools in chat, for example `#reportLayout` or `#previewReport`. Full inputs, examples, workflow guidance
and limits are documented in the [AI tools guide](docs/AI-TOOLS.md).

| Task | Tool |
| --- | --- |
| Inspect names, XML line ranges, datasets and page setup | `bcReport_inspectLayout` |
| Validate XML, references, width and preview evaluation | `bcReport_validateLayout` |
| Read evaluated values, grouped table rows and chart values as text | `bcReport_previewReport` |
| Inspect AL data items, labels, available table fields and preview data | `bcReport_getReportData` |
| Insert textboxes, rectangles, lines, images, tables, matrices or charts | `bcReport_insertItems` |
| Change table rows/columns/groups, spans and cells | `bcReport_editTable` |
| Read or change charts | `bcReport_editChart` |
| Position, align, size, distribute, reorder or delete items | `bcReport_arrangeItems` |
| Set page size, margins, body, header/footer and unit | `bcReport_setPageLayout` |
| Add AL columns or translatable labels | `bcReport_addAlColumns`, `bcReport_createAlLabel` |
| Rename a column in AL and related layouts | `bcReport_renameColumn` |
| Save and run the AL compiler | `bcReport_buildProject` |
| Show the result, selection or paginated preview | `bcReport_showInDesigner` |

Simple textbox values, styles, visibility, individual positions and report code can be edited directly in XML.
Use tools for structural edits. Layout changes participate in normal undo and refresh open designers. Previously
clean layouts are saved again; dirty documents retain their working-copy state. Tools changing AL or starting
the compiler request confirmation. Realistic preview data can be written to `<Layout>.data.json`.

## Comparison with Report Builder and Visual Studio

| Capability | Microsoft Report Builder | Visual Studio RDLC designer | This extension |
| --- | --- | --- | --- |
| Textbox, table, image, line, rectangle | Yes | Yes | Yes |
| Parent/child row groups, headers/footers, sorting, filters, breaks | Yes | Yes | Yes |
| Rows inside/outside groups; merge/split cells | Yes | Yes | Yes |
| Document lists, nested tables, matrices and column groups | Yes | Yes | Yes |
| Charts, combinations, secondary axes | More chart types | More chart types | Create, edit and preview supported types |
| Gauges | Yes | Yes | Preserve and preview |
| Maps and subreport preview | Yes | Yes | Preserve; show placeholders |
| Hyperlinks, bookmarks, drillthrough, embedded images | Yes | Yes | Yes |
| Separately formatted text runs | Yes | Yes | Text-run editor |
| Align, match sizes, distribute, center in container | Limited | Format menu | Yes |
| Visibility, drilldown, interactive sorting | Yes | Yes | Includes preview |
| Expression completion | Categories | IntelliSense | Includes AL column origin and code functions |
| Report Code block | Text field | Text field | VB editor and diagnostics |
| Document outline | No | Yes | Search, hidden markers and problems |
| Preview data | Data source | Project data source | Excel/CSV/JSON or generated BC rows |
| Export | PDF, Word, Excel, etc. | PDF, Word, Excel | PDF, Excel, Word, HTML, print |
| AL data source and build markers | No | No | Yes |
| Add AL columns/labels; fields from symbols | No | No | Yes |
| Rename columns across AL/layouts | No | No | Yes |
| BC formats/captions and AL validation | No | No | Yes |
| Navigate AL/layout, CodeLens, run in BC | No | No | Yes |
| Source-preserving saves | No | No | Yes |

## Additional features

The canvas provides rulers, grid/snapping, draggable section dimensions and body width, multiselection,
move/resize, clipboard and inline editing. The properties pane and icon toolbar expose fonts, colors, borders,
alignment, number formats and arrangement. Expression completion is also available in the Value property.
Visibility expressions, toggle textboxes and interactive sort are editable, as are header/footer printing on the
first/last page. Save, undo/redo and Hot Exit use VS Code's document lifecycle. Opening XML beside the designer
keeps both views synchronized.

## Languages

The UI follows VS Code's display language: English by default, with German translations. Manifest messages use
`package.nls.json`/`package.nls.de.json`; shared extension/webview messages use `webview/l10n.ts` and
`l10n/bundle.l10n.de.json`. Tests check translation coverage and placeholders. Documentation opens in German for
a German UI and in English for all other UI languages; each guide links to the other language.

## Accessibility

- Tab/Shift+Tab selects next/previous canvas items; arrows move, Alt+arrows resize, Shift makes small changes.
  Enter/F2 edits text, Delete removes and Shift+F10 opens the context menu.
- Screen readers receive item type, name/text, selection, position and size announcements.
- High-contrast themes outline items and use the active contrast border for selection.

## Tests

```sh
npm test               # Unit tests: RDL roundtrips, source preservation, rendering, pagination, VB, expressions, AL, import
npm run test:vscode    # Real VS Code, isolated profile: document lifecycle, AL, commands, preview, export and walkthrough
npm run test:corpus    # W1 Base App layouts/reports from github.com/microsoft/BCApps, in memory
```

Use `BC_RB_TIMEOUT_SCALE=3` on slow machines/CI. `BC_RB_TEST_LANGUAGE=de` forces German shared messages;
`BC_RB_LOCALE=de` selects the VS Code locale; `BC_RB_ONLY` filters integration tests by name.

The recorded corpus run checked 379 layouts for source preservation, stable output, complete outlines,
non-crashing rendering and AL dataset consistency: 379/379 roundtripped character-for-character, including full
regeneration. Of 368 layouts with AL comparisons, 357 matched exactly; the other 11 were outdated in Microsoft's
repository and were identified by the linter. No lint errors were reported for the Microsoft layouts.
Set `XSD=<path to 2010 ReportDefinition.xsd>` for additional schema validation.

## Development

Use Node.js 24 for development and packaging, as in CI.

```sh
npm install
npm run build          # out/extension.js and out/webview.js with esbuild
npm run watch
npm run typecheck
npm run check:docs     # bilingual links, anchors, JSON examples and tool names
npm run package        # builds and verifies artifacts/bc-report-builder-<version>.vsix
```

F5 launches an Extension Development Host with `samples/`: an AL project (`app.json`,
`src/Verkaufsrechnung.Report.al`), its BC-style `Verkaufsrechnung.rdlc` and an SSRS example `Umsatzbericht.rdl` with data.

### Packaging and publishing

`npm run package` builds production bundles, generates `THIRD_PARTY_NOTICES.md` from bundled dependencies in source
maps, then creates the VSIX. The `.vscodeignore` allowlist includes the manifest, translations, bilingual guides,
screenshots, examples, README files, changelog, licenses, icon and runtime bundles. `scripts/check-package.mjs`
checks exact contents, translations, walkthrough resources/buttons, version changelog entry, icon and bundle activation
without `node_modules`, including command/editor/tool registration. CI uploads the artifact without publishing it.

Publishing creates a GitHub Release with the VSIX asset used by the extension's updater:

```sh
# Bump version, add a dated CHANGELOG.md section, commit and push
npm version patch --no-git-tag-version
# Validate types, tests, VSIX and release plan without calling GitHub
npm run publish:github -- --dry-run
# Publish (optionally --draft); creates the v<version> tag on GitHub
npm run publish:github
```

`tools/publish-github.mjs` requires the [GitHub CLI](https://cli.github.com/) (`gh auth login`, or `GH_TOKEN`/
`GITHUB_TOKEN` with Contents: write), a clean working tree and a pushed release commit. It runs typecheck, tests
and packaging, creates the missing tag on the exact built commit, and calls `gh release create --verify-tag`.
Existing tags must point to that commit and are never moved; releases/assets are never overwritten. Notes come
from the matching changelog section. Dry-run files are `artifacts/v<version>-release-plan.json` and
`artifacts/v<version>-release-notes.md`; a VS Code publishing dry-run task is also available. Integration tests
run in CI and should pass for the release commit.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/extension.ts`, `src/reportEditorProvider.ts` | Activation, commands, status/context, document/webview bridge, import and print |
| `src/gettingStarted.ts` | Native walkthrough, example copies and localized offline guides |
| `src/al/parser.ts`, `src/al/context.ts`, `src/al/workspace.ts` | AL parsing, layout context and workspace report/table index |
| `src/al/edit.ts`, `src/al/symbols.ts`, `src/al/launch.ts` | AL edits, symbol packages and web-client URLs |
| `src/bcCommands.ts`, `src/codeBlock.ts` | BC commands, CodeLens and VB report-code documents |
| `src/lint.ts`, `src/layoutService.ts` | Validation and Problems panel integration |
| `src/xlsx.ts`, `src/csv.ts` | Data import |
| `src/updateCheck.ts` | GitHub release check, VSIX download and checksum |
| `scripts/`, `tools/publish-github.mjs` | Packaging, verification, licenses and releases |
| `src/tools/` | AI tools: inspection/validation/text preview, structural edits and registration |
| `src/layoutEdit.ts` | Host layout edits shared with AL operations |
| `webview/rdl.ts` | RDL parser and source-preserving serializer |
| `webview/render/` | Render tree, pagination, React views, charts, gauges and PDF |
| `webview/charts.ts`, `webview/images.ts`, `webview/richtext.ts` | Chart patches, embedded images and text runs |
| `webview/expr.ts`, `webview/vb.ts` | Expression and report-code interpreters |
| `webview/outline.ts`, `webview/nested.ts` | Outline and editing within preserved regions |
| `webview/bc.ts` | BC context, preview parameters and data |
| `webview/l10n.ts`, `l10n/`, `package.nls*.json` | Localization |
| `webview/components/` | Toolbar, canvas, report data, outline, properties, dialogs and preview |

## Limitations

- Unsupported chart features (3D, stock/candlestick/boxplot, additional calculated formulas such as Bollinger/MACD,
  and formatting beyond supported colors/markers) are preserved and require XML editing. RDL has no linear trendline.
- Maps remain placeholders; subreports are not executed locally.
- Body cells merge horizontally only; RDL supports `RowSpan` only in the corner.
- Excel/Word export transfers text, tables and chart values rather than a pixel-perfect rendering. PDF falls back
  to standard fonts with WinAnsi coverage when suitable local fonts are unavailable or embedding is prohibited.
- New AL columns/labels enter the layout dataset after a successful project build.
- Preview approximates the report server and performs no live data-source queries.
- The VB interpreter does not support classes, `Using` or `New` for .NET objects other than `Exception`;
  `On Error` is ignored. Affected functions report preview problems.
- Word/Excel layouts are opened in their applications and cannot be edited here.
- UI and end-user documentation are available in English and German.
