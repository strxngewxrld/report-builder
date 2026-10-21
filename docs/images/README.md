# Documentation screenshots

English | [Deutsch](README.de.md)

Captured on 21 October 2026 through **Windows MCP**, using real desktop input and screen capture.
Windows MCP `Screenshot` was used for inspection; PNG files were saved through Windows MCP `PowerShell`
using `System.Drawing.Graphics.CopyFromScreen`. These are not generated mockups.

Environment: Windows, 1620 × 952 desktop, English VS Code UI, Report Builder 1.0.0 in an Extension Development
Host from the local build. Images are cropped to application content including editor tabs and status bar
(1620 × 869), excluding the desktop taskbar and window title. No subsequent content editing was applied.

Separate copies of `samples/` in `artifacts/documentation/samples` were used; originals remained unchanged.

| File | Content |
| --- | --- |
| `01-designer.png` | Invoice, document outline and report properties |
| `02-berichtsdaten-al.png` | AL data items and pending dataset build in the intentionally outdated example |
| `03-ausdruck.png` | `LineAmount_Line` expression and live result from generated sample data |
| `04-gruppeneigenschaften.png` | Invoice detail group sorted by line number |
| `05-vorschau.png` | Unchanged revenue report with eight rows from `Umsatzbericht.data.json` |
| `06-export.png` | PDF/Excel/Word/HTML choices for the same preview |

Total revenue is 37,523.40 euros (displayed as 37.523,40 €), total quantity 116. The subreport is a documented
placeholder. Images illustrate usage and are not an additional release test or evidence of BC execution.
