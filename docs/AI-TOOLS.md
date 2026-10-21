# AI tools for Report Builder

English | [Deutsch](AI-TOOLS.de.md)

Report Builder 1.0.0 registers **14 VS Code language model tools**. They let GitHub Copilot agent mode and other
compatible `vscode.lm` chats inspect and edit RDLC/RDL reports using the designer's own operations. These are
VS Code tools, not an MCP server, REST API or standalone command-line interface.

For manual editing see the [user guide](USER-GUIDE.md); for the move from Microsoft Report Builder see
[migration](MIGRATION.md). This reference describes the tool implementation and manifest shipped with this version.

## Getting started in chat

1. Open the project and a `.rdlc`/`.rdl` layout in VS Code with Report Builder installed.
2. Use a chat mode capable of invoking VS Code language model tools, such as Copilot's agent mode. Enable the
   Report Builder tools in the chat's tool selection if necessary.
3. Identify the file and explain the desired outcome and checks. Explicit references such as `#reportLayout`
   and `#previewReport` can direct the chat to a tool; use the names in the table below.
4. Ask it to inspect first, edit structure with the tools, validate, compare preview values and show the result
   in the designer. Review changes and any confirmation prompts.

Example prompt:

> In samples/Umsatzbericht.rdl, group the table by Region and add regional totals. Keep all eight rows and the
> grand total of 37,523.40 euros. Inspect the layout first, use the Report Builder table tools, validate the result
> and open the paginated preview. Report any checks that still need to be performed.

An AI chat requires its own account/access and tool support. Manual Report Builder use does not require Copilot.
The extension exposes tools through VS Code; it does not itself choose a model or provide a separate AI service.

## Tool IDs and chat references

The **tool ID** is used by the host. The **chat reference** is the name after `#`. JSON blocks below show tool
inputs, not terminal commands. An omitted `file` is resolved from the current context; explicit paths are safer
when several layouts are open.

| Tool ID | Chat reference | Main inputs and purpose |
| --- | --- | --- |
| `bcReport_inspectLayout` | `#reportLayout` | `file?`, `item?`: page setup, dataset, item names, nesting and XML line ranges; item details/styles |
| `bcReport_validateLayout` | `#validateReportLayout` | `file?`: XML, references, names, width, expressions, AL drift and preview evaluation errors |
| `bcReport_previewReport` | `#previewReport` | `file?`, `parameters?`, `maxRows?`: evaluated values, grouped rows and chart values as text |
| `bcReport_getReportData` | `#reportData` | `file?`, `tableFieldsOf?`: owning AL report, data items, labels, layouts and available table fields |
| `bcReport_insertItems` | `#insertReportItems` | `items` required, `file?`: create textboxes, rectangles, lines, images, tables, matrices and charts |
| `bcReport_editTable` | `#editReportTable` | `table`, `operations` required, `file?`: structural table/matrix edits |
| `bcReport_editChart` | `#editReportChart` | `chart` required, `file?`, `set?`: inspect a chart or patch selected properties |
| `bcReport_arrangeItems` | `#arrangeReportItems` | `file?`, `items?`, `boxes?`, alignment/size/distribution/order/delete options |
| `bcReport_setPageLayout` | `#reportPageSetup` | `file?`, page dimensions/margins, body dimensions, header/footer, `unit`, `fitBodyToPage` |
| `bcReport_addAlColumns` | `#addAlColumns` | `dataItem`, `columns` required, `file?`: add AL columns from table fields or expressions |
| `bcReport_createAlLabel` | `#createAlLabel` | `text` required, `file?`, `name?`, `textbox?`, `comment?`, `maxLength?`, `locked?` |
| `bcReport_renameColumn` | `#renameReportColumn` | `column`, `newName` required, `file?`: rename across AL and associated RDLC layouts |
| `bcReport_buildProject` | `#buildAlProject` | No inputs: save files and run `AL: Package` |
| `bcReport_showInDesigner` | `#showReportDesigner` | `file?`, `item?`, `mode?` (`design`/`preview`): open the result for review |

`?` means optional. Tool names and JSON keys are identical in both UI languages.

### Paths, names, units and scope

`file` accepts an absolute or workspace-relative layout path. A unique filename can also be resolved. Without a
path, tools try the current designer, active layout text editor, then the only layout in the workspace. Ambiguous
workspaces require an explicit file. Only `.rdlc`/`.rdl` layouts are accepted.

Use item/table/group names reported by `inspectLayout`, not visible cell text. Row/column indexes are **zero-based**.
Dimensions accept numbers in the report unit or explicit strings such as `"2.5cm"`, `"1in"`, `"10pt"` and `"5mm"`.
For new BC renderings, `LayoutFile` paths are relative to the project directory containing `app.json`, even when
the AL source is in `src/`.

## Inspect and validate before changing structure

Call `bcReport_inspectLayout` with `{"file":"samples/Umsatzbericht.rdl"}`. To inspect a specific item, add
`"item":"Bestellungen"`. The result lists names, dimensions, groups and XML ranges; an item query includes styles.
`bcReport_getReportData` describes the AL side; `tableFieldsOf` takes an **AL data-item name** such as `Line`, not
the underlying table name.

After edits, call `bcReport_validateLayout`. It checks XML, missing/case-mismatched references, duplicate names,
`Fields!` in page headers/footers, body width, out-of-section items, expression parsing/evaluation and BC hints.
A successful validation is not proof of a successful AL compile or exact server rendering.

## Insert items and repeating content

Input to `bcReport_insertItems`:

```json
{
  "file": "samples/Umsatzbericht.rdl",
  "items": [
    {
      "type": "textbox", "name": "RevenueNote", "section": "body",
      "top": "8cm", "left": "0cm", "width": "12cm", "height": "0.6cm",
      "value": "=\"Total: \" & Format(Sum(Fields!Umsatz.Value, \"Umsaetze\"), \"N2\")",
      "style": { "FontWeight": "Bold", "FontSize": "10pt" }
    }
  ]
}
```

Positions are illustrative; inspect the target before inserting. `type` is required for each entry. `section`
defaults to `body`; `header`/`footer` create the section if missing. With no `top`, insertion goes below existing
items in the container. Names are made unique; read the result before using a new name in later calls.

Use `parent` with an existing rectangle name to insert **inside repeating table/group content**. Without it, a
new textbox is at section level and will not repeat per document. Tables accept `fields` plus `dataSet` and apply
BC captions/format fields. Matrices accept `matrix` with `rowGroup`, `columnGroup`, `value` and optional totals.
Charts use `chart` with kind/category/series. Images can use `imageFile` to embed a local file, or `value` for an
embedded name/URL/expression. Supported image types are PNG/JPEG/GIF/BMP/SVG; embedding through the tool is limited to 4 MB.

## Change tables and groups

Input to `bcReport_editTable`, using the unchanged revenue example's detail row:

```json
{
  "file": "samples/Umsatzbericht.rdl", "table": "Bestellungen",
  "operations": [
    { "op": "addGroup", "row": 1, "mode": "parent", "expression": "=Fields!Region.Value",
      "name": "ByRegion", "header": true, "footer": true }
  ]
}
```

Inspect again afterward to find the inserted rows/cells before filling them. Operations execute **in order**;
indexes refer to the structure left by the previous operation.

| Operations | Relevant inputs |
| --- | --- |
| `insertColumn`, `deleteColumn`, `setColumnWidth` | `at`, `width`, optional `field` or per-row `values` |
| `insertRow`, `deleteRow`, `setRowHeight` | `row`, `place` (`above`, `below`, `outsideAbove`, `outsideBelow`), `values`, `height` |
| `headerRow`, `footerRow` | `present` for a row outside all groups |
| `addGroup`, `deleteGroup`, `addGroupRow` | `row`, parent/child `mode`, `expression`, `name`, header/footer; existing `group`, `deleteRows`, `which` |
| `setGroup` | `group`, `expressions`, `sort`, `filters`, `pageBreak`, `hidden` |
| `addColumnGroup`, `deleteColumnGroup` | `column`, `expression`, `name`; existing `group`, `deleteColumns` |
| `mergeCells`, `splitCell` | Adjacent same-row cell names in `cells`; a single `cell` for splitting |
| `setCell`, `setDataSet` | `row`, `column`, `value`, `style`; or `dataSet` |

Only tables marked editable by `bcReport_editTable` in inspection are supported by this tool; otherwise edit the
preserved XML. A group footer sum uses the group scope. Place a grand total outside the intended group or use
an explicit dataset scope.

## Charts, arrangement and page setup

`bcReport_editChart` without `set` reads a chart. With `set`, it patches type, dataset, category, series, axes,
legend, title, palette and labels. **`series` replaces the whole list**, so include all series you want to keep.
Series support their own type, secondary axis, color/expression, marker and supported calculated trends.

`bcReport_arrangeItems` accepts `boxes` for explicit geometry, `items` plus `align`, `sameSize`, `distribute`,
`center`, `order` or `delete`. The first item is the reference for alignment/matching size; alignment, matching
size and distribution require a shared container. Distribution needs at least three items. Resize table cells
through table row/column operations.

Example input to `bcReport_setPageLayout`:

```json
{
  "file": "samples/Umsatzbericht.rdl",
  "pageWidth": "21cm", "pageHeight": "29.7cm",
  "marginLeft": "2cm", "marginRight": "2cm", "fitBodyToPage": true
}
```

`fitBodyToPage` sets the body to printable width. Check protruding elements and pagination afterward. `header`
and `footer` accept `present`, `height`, `printOnFirstPage` and `printOnLastPage`. `unit` (`cm`/`in`) changes how
dimensions are written, not their physical size.

## AL columns, labels, renaming and builds

For BC work, establish the AL report/rendering reference first. An unregistered layout has no AL target.

Input to `bcReport_addAlColumns`, after inspecting available fields with `tableFieldsOf: "Line"`:

```json
{
  "file": "samples/Verkaufsrechnung.rdlc", "dataItem": "Line",
  "columns": [{ "field": "Unit Price", "name": "UnitPriceForNote_Line" }]
}
```

Each column requires `field` or `source` (an AL expression); `name` is optional and otherwise follows BC naming.
Available symbols/workspace tables are used to validate field names; when unavailable the result warns that
names were not checked. For translated captions, add `IncludeCaption = true` to the AL column.

Input to `bcReport_createAlLabel`:

```json
{
  "file": "samples/Verkaufsrechnung.rdlc", "text": "Invoice no.",
  "name": "InvoiceNoLbl", "textbox": "DocumentNo_Lbl",
  "comment": "Heading before the invoice number", "maxLength": 40
}
```

`textbox` is optional. When supplied, it must identify a single-text-run textbox; label and textbox change share
one undo step. For multiple runs, create the label alone and update the expression separately. `locked` is also
available. Use the AL project's XLIFF translation workflow for translations.

Use `bcReport_renameColumn` with `column` and `newName` instead of search/replace. It updates AL, related RDLC
layouts, companion format/caption references and applicable item names in one undoable operation. Word/Excel
layouts are not updated.

These AL edits may remain in working copies without a visible tab. Run `bcReport_buildProject` with `{}` to save
files and invoke `AL: Package`; then inspect **compiler output/diagnostics** and validate the layout again.
The tool returning successfully means the command ran, **not that compilation succeeded**. Build needs the
Microsoft AL extension and a trusted workspace, and aborts if saving fails.

## Preview data and reliable verification

`bcReport_previewReport` accepts optional `parameters` (string values keyed by parameter name) and `maxRows`
(default 60 output table rows). It reads `<Layout>.data.json`, or generates sample rows if no data is loaded.
For `Umsatzbericht.rdl`, the saved sidecar is `Umsatzbericht.data.json`:

```json
{
  "Umsaetze": [
    { "Region": "Nord", "Kunde": "Example", "Menge": 2, "Umsatz": 123.45 }
  ]
}
```

The sidecar is keyed by **dataset name**. The designer's JSON import dialog instead accepts a plain array;
see [preview data](USER-GUIDE.md#loading-preview-data-and-checking-results). BC test data must preserve valid
header/line relationships and grouping keys.

Text preview checks values, formats, filters, groups and totals. It is **unpaginated**: `PageNumber`/`TotalPages`
are placeholders (1/1), not a real page count. Page-header/footer `Code`/`ReportItems` snapshots may reflect the
last document. Do not infer page count, non-overlap or correct per-page headers from this output.

Finish with input to `bcReport_showInDesigner`:

```json
{ "file": "samples/Umsatzbericht.rdl", "mode": "preview" }
```

Optionally set `item` to select an element. Inspect the paginated result, export PDF as needed and compare BC
reports with actual BC execution. Maps/subreports and unsupported VB remain subject to the
[documented limitations](../README.md#limitations).

## Editing behavior and confirmations

- Structural layout edits are regular VS Code document edits. Open designers refresh, and Undo reverts changes.
  Previously clean layouts are saved again; already dirty layouts keep unsaved changes. Review the working copy and Git diff.
- Tools adding AL columns, creating labels, renaming columns or building supply confirmation messages to the chat host.
  The host controls how those prompts are presented. Review requested AL changes and builds before approving them.
- Simple `<Value>`, `<Style>`, visibility, geometry and `<Code>` edits can be made directly in XML. Run validation
  afterward. Do not hand-edit BC compiler-generated dataset/label declarations to add AL fields.
- Tools are not an automatic deployment or server-rendering service. No tool in this set publishes the extension
  or certifies a Business Central report's production output.

Implementation: the bundled [tool manifest](../package.json) is the input reference. Online source:
[registration and handlers](https://github.com/strxngewxrld/report-builder/blob/main/src/tools/index.ts),
[structural edits](https://github.com/strxngewxrld/report-builder/blob/main/src/tools/edit.ts) and
[inspection/validation/preview](https://github.com/strxngewxrld/report-builder/blob/main/src/tools/inspect.ts).
