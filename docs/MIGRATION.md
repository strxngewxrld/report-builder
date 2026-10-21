# Moving from Microsoft Report Builder to VS Code

English | [Deutsch](UMSTIEG-REPORT-BUILDER.md)

This guide is for users of **standalone Microsoft Report Builder** moving RDLC/RDL layout editing to
**Business Central Report Builder for VS Code**. Visual Studio RDLC designer users can use the same feature
mapping. This project ships a VS Code extension, not a separate standalone application.

Applies to version 1.0.0, 21 October 2026. Screenshots show the English Windows UI. See the
[user guide](USER-GUIDE.md) for full instructions and [AI tools](AI-TOOLS.md) for agent-assisted editing.

## What you can reuse

Open existing `.rdlc` and `.rdl` files directly. There is no conversion into a proprietary format. Textboxes,
`Fields!`/`Parameters!` expressions, tables, groups, images, headers and footers retain familiar RDL concepts.

Saving preserves source: unchanged items remain verbatim and unmodeled content is retained in edited items.
This does not mean every RDL feature can be edited visually or executed in local preview. Start with a copy of
complex reports and inspect the diff.

The main difference is **data and execution**. Local preview does not query SQL/SSRS data sources. For BC,
the AL report supplies data items, columns and labels. Other RDL definitions can be edited, but the extension
does not replace report-server connections, management or publishing.

## Where do I find familiar features?

![VS Code layout designer with outline, canvas, toolbar and properties](images/01-designer.png)

| Familiar task | In Report Builder for VS Code |
| --- | --- |
| Open report | Open the project folder and select `.rdlc`/`.rdl`; use Open in Designer if XML appears |
| New layout | Folder context menu › New Report Layout…, or File › New File… › Report Layout (RDLC) |
| Insert ribbon | Toolbar above the canvas, Insert in the editor title, or Command Palette |
| Report data | Report Data tab on the left |
| Properties window | Properties pane on the right, based on canvas/outline selection |
| Inspect report structure | Outline, including nested cell contents and groups |
| Expression dialog | Right-click textbox/cell › Expression…, or the Value property |
| Row/column groups | Select table; Grouping pane below the canvas |
| Insert rows/columns, merge cells | Select cell › Table context menu |
| Group properties | Gear in Grouping or group context menu |
| Page size and margins | Report Properties…, or Properties with no item selected |
| Page header/footer | Commands in the editor overflow menu or context menu |
| Align/match sizes | Toolbar or Align and Arrange |
| Run/preview | Show Preview, or F5 with the designer focused |
| Export/print | Export menu and Print in preview |
| Edit report XML | Open as XML; return with Open in Designer |
| Errors/warnings | VS Code Problems (`Ctrl+Shift+M`) and outline markers |
| Save/undo | Ctrl+S/Ctrl+Z; dirty state is shown on the editor tab |

Use the Command Palette (`Ctrl+Shift+P`) and search **Business Central Report Builder** plus the action name
when an icon is unfamiliar.

## Bring over your first report

1. Commit the starting point or make a working copy of the project, including related AL files and images.
2. Install the VSIX extension; see [installation](USER-GUIDE.md#installation-and-first-steps).
3. Open the project folder. For BC, include the owning `app.json`.
4. Open the layout and inspect header, body, tables and footer in Outline.
5. Change a simple textbox's font/alignment, save and review the Git diff.
6. Load your preview data and press F5. Then compare values and grouping.
7. Export PDF and inspect it in a viewer. For BC, also run the report in the target system.

For practice, copy `samples/Umsatzbericht.rdl` together with `Umsatzbericht.data.json`. Preview should show eight
rows, quantity **116** and revenue **37,523.40 €**, displayed as **37.523,40 €** in the German report. Its subreport
remains a placeholder; local comparison does not test subreport execution.

## The BC difference: AL instead of dataset dialogs

![Invoice AL data with pending build markers](images/02-berichtsdaten-al.png)

When the designer recognizes a BC report, **Report Data** shows its AL tree. Data source, dataset and parameter
dialogs are intentionally hidden because the AL compiler generates the layout dataset.

| Previous approach | BC layout workflow |
| --- | --- |
| Add the field to the layout dataset | Add an AL column, for example using Add Fields as Columns…, then build |
| An AL column is immediately available in the layout | A Build marker means run Build Project (AL: Package) and check compiler success |
| Type a literal heading | Use Create AL Label… for translatable text and build afterward |
| Rename a field only in the layout | Use Rename Column (AL and Layouts)… to update related files together |
| Open a dataset query designer | Edit data retrieval and data-item links in AL |
| Preview retrieves server data | Load Excel/CSV/JSON data and verify the actual report in BC afterward |

Register new layouts with `rendering`/`LayoutFile` or `RDLCLayout` in AL. **New Report Layout…** creates neither
an AL report nor a rendering reference. Paths are relative to the project root containing `app.json`.
Keep BC format fields for decimals and caption parameters for headings. Dragging fields applies these conventions.

## Keep using expressions and groups

![Expression editor using familiar RDL field references](images/03-ausdruck.png)

Expression syntax stays the same, such as `=Fields!Umsatz.Value` and `=Sum(Fields!Umsatz.Value)`.
The expression editor provides field lists, completion (`Ctrl+Space`) and a live result. Missing field,
label or code references also appear in Problems.

The distinction between **detail rows**, **group headers/footers** and rows **outside a group** still matters.
A sum in a group footer totals that group; grand totals need the appropriate scope outside the detail/regional
group. **Delete Group Only** preserves rows; deleting the group with its rows removes the associated structure.

![Detail group properties with sorting and visibility](images/04-gruppeneigenschaften.png)

Open group properties using the gear in **Grouping** below the canvas. The screenshot shows a detail group;
field-based groups have additional grouping and page-break settings. Repeating table headings are configured
in row properties.

## Adapt your preview and export workflow

**Load Preview Data (Excel, CSV, JSON)…** imports tabular data. JSON input is an array of objects. The saved
`<LayoutName>.data.json` sidecar instead uses an object keyed by dataset name. See examples of both formats in
the [data chapter](USER-GUIDE.md#loading-preview-data-and-checking-results).

![Paginated revenue preview using loaded data](images/05-vorschau.png)

Without a data file, generated sample rows help you assess layout and formatting but cannot validate business
totals. Use multiple groups, long text, null/empty values and enough rows to span pages.

![Export choices in preview](images/06-export.png)

Choose **PDF** for a paginated file; **Print** opens preview in the browser. Excel/Word support further editing
of data and text and are not pixel-perfect layout copies. PDF requires suitable local, embeddable fonts.

Local preview approximates report execution. It does not run data-source queries or subreports; maps also appear
as placeholders. Existing VB report code is interpreted only within the supported subset. Compare complex
layouts against the actual output in BC or the previous target environment.

## Common migration issues

| Observation | Next step |
| --- | --- |
| Only XML is visible | Explorer context menu › Open in Designer |
| Canvas is too small | Hide the VS Code sidebar with Ctrl+B, toggle internal panes through View and adjust status-bar zoom |
| Cannot find the ribbon | Use the toolbar, editor overflow menu, context menus and Command Palette |
| New AL field is missing | Check AL association and build output; the compiler updates the dataset |
| Preview values look invented | Load actual test data and check the loaded-data indicator |
| Extra blank page after a change | Check width plus margins, protruding items and group/item breaks |
| Report language differs from the UI | Check report language and format fields; display language is independent |
| Specialized legacy item is missing in preview | Check limitations; maps/subreports are expected placeholders |

## First acceptance checklist

- [ ] Layout/AL reference is correct; needed columns and labels exist after a successful build.
- [ ] Git diff reviewed for unintended changes.
- [ ] Representative data loaded; rows, groups and totals compared with the original report.
- [ ] All preview pages checked, including repeated headers and final group pages.
- [ ] Language, number formats, logos and fonts are correct.
- [ ] PDF opened and output compared with the target system.
- [ ] Features not executed locally checked in the target system.

Continue with the [user guide](USER-GUIDE.md) or the [README](../README.md) for the complete feature overview
and limitations.
