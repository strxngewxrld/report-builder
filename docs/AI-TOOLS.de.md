# KI-Werkzeuge für Report Builder

[English](AI-TOOLS.md) | Deutsch

Report Builder 1.0.0 registriert **14 VS-Code-Sprachmodellwerkzeuge**. Damit können GitHub Copilot im Agentenmodus
und andere kompatible `vscode.lm`-Chats RDLC-/RDL-Berichte mit den Operationen des Designers lesen und bearbeiten.
Es handelt sich um VS-Code-Werkzeuge, nicht um einen MCP-Server, eine REST-API oder eine eigenständige Kommandozeile.

Für manuelle Bearbeitung siehe [Anwenderhandbuch](ANWENDERHANDBUCH.md), für den Wechsel vom Microsoft Report
Builder die [Umstiegsanleitung](UMSTIEG-REPORT-BUILDER.md). Diese Referenz beschreibt Manifest und Implementierung
der genannten Version.

## Im Chat beginnen

1. Projekt und `.rdlc`-/`.rdl`-Layout in VS Code mit installiertem Report Builder öffnen.
2. Einen Chatmodus mit Unterstützung für VS-Code-Sprachmodellwerkzeuge verwenden, etwa den Agentenmodus von
   Copilot. Bei Bedarf die Report-Builder-Werkzeuge in der Werkzeugauswahl des Chats aktivieren.
3. Datei, gewünschtes Ergebnis und Prüfkriterien nennen. Referenzen wie `#reportLayout` und `#previewReport`
   können ein Werkzeug ausdrücklich ansprechen; alle Namen stehen in der Tabelle unten.
4. Zuerst untersuchen lassen, Struktur mit Werkzeugen ändern, validieren, Vorschauwerte vergleichen und das
   Ergebnis im Designer zeigen lassen. Änderungen und Bestätigungsdialoge prüfen.

Beispielauftrag:

> Gruppiere in samples/Umsatzbericht.rdl die Tabelle nach Region und ergänze Regionssummen. Erhalte alle acht
> Zeilen und die Gesamtsumme 37.523,40 €. Untersuche zuerst das Layout, nutze die Report-Builder-Tabellenwerkzeuge,
> validiere und öffne die paginierte Vorschau. Nenne Prüfungen, die noch durchgeführt werden müssen.

Der KI-Chat benötigt seinen eigenen Zugang und Werkzeugunterstützung. Manuelles Arbeiten mit Report Builder
setzt Copilot nicht voraus. Die Erweiterung stellt Werkzeuge über VS Code bereit; sie wählt kein Modell und
bietet keinen eigenen KI-Dienst an.

## Werkzeug-IDs und Chat-Referenzen

Die **Werkzeug-ID** nutzt der Host; die **Chat-Referenz** steht nach `#`. JSON-Blöcke unten sind Werkzeugeingaben,
keine Terminalbefehle. Ohne `file` wird das Layout aus dem Kontext ermittelt. Bei mehreren Layouts besser einen
ausdrücklichen Pfad angeben.

| Werkzeug-ID | Chat-Referenz | Wichtigste Eingaben und Zweck |
| --- | --- | --- |
| `bcReport_inspectLayout` | `#reportLayout` | `file?`, `item?`: Seite, Dataset, Elementnamen, Verschachtelung und XML-Zeilen; Elementdetails/Stile |
| `bcReport_validateLayout` | `#validateReportLayout` | `file?`: XML, Verweise, Namen, Breite, Ausdrücke, AL-Abweichungen und Vorschaufehler |
| `bcReport_previewReport` | `#previewReport` | `file?`, `parameters?`, `maxRows?`: ausgewertete Werte, Gruppenzeilen und Diagrammwerte als Text |
| `bcReport_getReportData` | `#reportData` | `file?`, `tableFieldsOf?`: AL-Report, Datenelemente, Labels, Layouts und verfügbare Tabellenfelder |
| `bcReport_insertItems` | `#insertReportItems` | `items` erforderlich, `file?`: Textfelder, Rechtecke, Linien, Bilder, Tabellen, Matrizen und Diagramme anlegen |
| `bcReport_editTable` | `#editReportTable` | `table`, `operations` erforderlich, `file?`: Tabellen-/Matrixstruktur ändern |
| `bcReport_editChart` | `#editReportChart` | `chart` erforderlich, `file?`, `set?`: Diagramm lesen oder Eigenschaften ändern |
| `bcReport_arrangeItems` | `#arrangeReportItems` | `file?`, `items?`, `boxes?`, Optionen für Ausrichtung, Größe, Verteilung, Reihenfolge und Löschen |
| `bcReport_setPageLayout` | `#reportPageSetup` | `file?`, Seite/Ränder, Textkörper, Kopf/Fuß, `unit`, `fitBodyToPage` |
| `bcReport_addAlColumns` | `#addAlColumns` | `dataItem`, `columns` erforderlich, `file?`: AL-Spalten aus Tabellenfeldern oder Ausdrücken ergänzen |
| `bcReport_createAlLabel` | `#createAlLabel` | `text` erforderlich, `file?`, `name?`, `textbox?`, `comment?`, `maxLength?`, `locked?` |
| `bcReport_renameColumn` | `#renameReportColumn` | `column`, `newName` erforderlich, `file?`: in AL und zugehörigen RDLC-Layouts umbenennen |
| `bcReport_buildProject` | `#buildAlProject` | Keine Eingaben: Dateien speichern und `AL: Package` ausführen |
| `bcReport_showInDesigner` | `#showReportDesigner` | `file?`, `item?`, `mode?` (`design`/`preview`): Ergebnis zur Kontrolle öffnen |

`?` bedeutet optional. Werkzeugnamen und JSON-Schlüssel bleiben in beiden Oberflächensprachen gleich.

### Pfade, Namen, Maße und Bereiche

`file` akzeptiert einen absoluten oder workspace-relativen Layoutpfad. Ein eindeutiger Dateiname kann ebenfalls
aufgelöst werden. Ohne Pfad wird zuerst der aktuelle Designer, dann der aktive Layout-Texteditor und schließlich
das einzige Layout im Workspace verwendet. Mehrdeutige Workspaces benötigen `file`. Akzeptiert werden `.rdlc`/`.rdl`.

Element-, Tabellen- und Gruppennamen aus `inspectLayout` verwenden, nicht sichtbare Zelltexte. Zeilen-/Spaltenindizes
sind **nullbasiert**. Maße akzeptieren Zahlen in der Berichtseinheit oder Angaben wie `"2.5cm"`, `"1in"`, `"10pt"`
und `"5mm"`. Neue BC-`LayoutFile`-Pfade sind relativ zum Projektordner mit `app.json`, auch wenn AL unter `src/` liegt.

## Vor Strukturänderungen untersuchen und prüfen

`bcReport_inspectLayout` mit `{"file":"samples/Umsatzbericht.rdl"}` aufrufen. Für ein bestimmtes Element
`"item":"Bestellungen"` ergänzen. Das Ergebnis zeigt Namen, Maße, Gruppen und XML-Zeilen; die Elementabfrage
liefert auch Stile. `bcReport_getReportData` beschreibt die AL-Seite. `tableFieldsOf` erwartet einen
**AL-Datenelementnamen**, etwa `Line`, nicht den Namen der zugrunde liegenden Tabelle.

Nach Änderungen `bcReport_validateLayout` aufrufen. Es prüft XML, fehlende bzw. falsch geschriebene Verweise,
doppelte Namen, `Fields!` in Seitenkopf/-fuß, Textkörperbreite, überstehende Elemente, Ausdrucksauswertung und
BC-Hinweise. Eine erfolgreiche Validierung beweist weder einen erfolgreichen AL-Build noch exakte Serverausgabe.

## Elemente und wiederholte Inhalte einfügen

Eingabe für `bcReport_insertItems`:

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

Positionen sind beispielhaft; vor dem Einfügen das Ziel untersuchen. `type` ist je Eintrag erforderlich. `section`
ist standardmäßig `body`; `header`/`footer` legen den Abschnitt bei Bedarf an. Ohne `top` wird unter vorhandenen
Elementen des Containers eingefügt. Namen werden eindeutig gemacht; den Rückgabewert für weitere Aufrufe beachten.

Mit `parent` und dem Namen eines vorhandenen Rechtecks wird **in wiederholten Tabellen-/Gruppeninhalt** eingefügt.
Ohne `parent` liegt das Textfeld auf Abschnittsebene und wiederholt sich nicht je Beleg. Tabellen akzeptieren
`fields` und `dataSet` und nutzen BC-Captions/Formatfelder. Matrizen verwenden `matrix` mit `rowGroup`,
`columnGroup`, `value` und optionalen Summen. Diagramme verwenden `chart` mit Typ/Kategorie/Reihen. Bilder können
über `imageFile` aus einer lokalen Datei eingebettet werden oder über `value` auf Namen/URL/Ausdruck verweisen.
PNG/JPEG/GIF/BMP/SVG werden unterstützt; das Einbetten über dieses Werkzeug ist auf 4 MB begrenzt.

## Tabellen und Gruppen ändern

Eingabe für `bcReport_editTable` mit der Detailzeile des unveränderten Umsatzbeispiels:

```json
{
  "file": "samples/Umsatzbericht.rdl", "table": "Bestellungen",
  "operations": [
    { "op": "addGroup", "row": 1, "mode": "parent", "expression": "=Fields!Region.Value",
      "name": "ByRegion", "header": true, "footer": true }
  ]
}
```

Anschließend erneut untersuchen und die neu eingefügten Zeilen/Zellen bestimmen, bevor Werte gesetzt werden.
Operationen laufen **nacheinander**; Indizes beziehen sich auf den Stand nach der vorigen Operation.

| Operationen | Zugehörige Eingaben |
| --- | --- |
| `insertColumn`, `deleteColumn`, `setColumnWidth` | `at`, `width`, optional `field` oder `values` je Zeile |
| `insertRow`, `deleteRow`, `setRowHeight` | `row`, `place` (`above`, `below`, `outsideAbove`, `outsideBelow`), `values`, `height` |
| `headerRow`, `footerRow` | `present` für eine Zeile außerhalb aller Gruppen |
| `addGroup`, `deleteGroup`, `addGroupRow` | `row`, `mode` parent/child, `expression`, `name`, header/footer; vorhandene `group`, `deleteRows`, `which` |
| `setGroup` | `group`, `expressions`, `sort`, `filters`, `pageBreak`, `hidden` |
| `addColumnGroup`, `deleteColumnGroup` | `column`, `expression`, `name`; vorhandene `group`, `deleteColumns` |
| `mergeCells`, `splitCell` | Benachbarte Zellnamen einer Zeile in `cells`; einzelne `cell` zum Teilen |
| `setCell`, `setDataSet` | `row`, `column`, `value`, `style`; bzw. `dataSet` |

Nur in der Untersuchung als mit `bcReport_editTable` bearbeitbar markierte Tabellen werden unterstützt;
andernfalls das erhaltene XML bearbeiten. Eine Gruppenfußsumme verwendet den Gruppenbereich. Gesamtsummen
außerhalb der betreffenden Gruppe platzieren oder den Dataset-Bereich ausdrücklich angeben.

## Diagramme, Anordnung und Seite

`bcReport_editChart` liest ohne `set` ein Diagramm. Mit `set` werden Typ, Dataset, Kategorie, Reihen, Achsen,
Legende, Titel, Palette und Beschriftungen angepasst. **`series` ersetzt die gesamte Liste**; alle zu erhaltenden
Reihen mitgeben. Reihen unterstützen eigenen Typ, zweite Achse, Farbe/Ausdruck, Markierung und unterstützte Trends.

`bcReport_arrangeItems` verwendet `boxes` für Position/Größe oder `items` mit `align`, `sameSize`, `distribute`,
`center`, `order` bzw. `delete`. Das erste Element dient als Bezug für Ausrichtung/Größe. Ausrichten, gleiche Größe
und Verteilen benötigen denselben Container; Verteilen mindestens drei Elemente. Tabellenzellen über Zeilen-/
Spaltenoperationen vergrößern.

Beispiel für `bcReport_setPageLayout`:

```json
{
  "file": "samples/Umsatzbericht.rdl",
  "pageWidth": "21cm", "pageHeight": "29.7cm",
  "marginLeft": "2cm", "marginRight": "2cm", "fitBodyToPage": true
}
```

`fitBodyToPage` setzt die Textkörperbreite auf die bedruckbare Breite. Danach überstehende Elemente und Umbrüche
prüfen. `header`/`footer` unterstützen `present`, `height`, `printOnFirstPage`, `printOnLastPage`. `unit`
(`cm`/`in`) ändert die Schreibweise der Maße, nicht die physische Größe.

## AL-Spalten, Labels, Umbenennung und Build

Zuerst den AL-Report und die Rendering-Zuordnung herstellen. Ein nicht registriertes Layout hat kein AL-Ziel.

Eingabe für `bcReport_addAlColumns`, nachdem verfügbare Felder mit `tableFieldsOf: "Line"` ermittelt wurden:

```json
{
  "file": "samples/Verkaufsrechnung.rdlc", "dataItem": "Line",
  "columns": [{ "field": "Unit Price", "name": "UnitPriceForNote_Line" }]
}
```

Jede Spalte benötigt `field` oder `source` (AL-Ausdruck). `name` ist optional und folgt sonst der BC-Konvention.
Vorhandene Symbole/Workspace-Tabellen dienen der Feldprüfung. Fehlen sie, warnt das Ergebnis vor ungeprüften
Namen. Für übersetzte Captions `IncludeCaption = true` an der AL-Spalte ergänzen.

Eingabe für `bcReport_createAlLabel`:

```json
{
  "file": "samples/Verkaufsrechnung.rdlc", "text": "Invoice no.",
  "name": "InvoiceNoLbl", "textbox": "DocumentNo_Lbl",
  "comment": "Heading before the invoice number", "maxLength": 40
}
```

`textbox` ist optional und muss bei Angabe ein Textfeld mit genau einem Textteil bezeichnen. Label und Textfeld
werden in einem Rückgängig-Schritt geändert. Bei mehreren Textteilen das Label allein anlegen und den Ausdruck
separat setzen. Auch `locked` wird unterstützt. Übersetzungen über den XLIFF-Ablauf des AL-Projekts pflegen.

Für Umbenennungen `bcReport_renameColumn` mit `column` und `newName` statt Suchen/Ersetzen nutzen. AL, zugehörige
RDLC-Layouts, Format-/Caption-Verweise und zutreffende Elementnamen ändern sich in einem rückgängig machbaren
Schritt. Word-/Excel-Layouts werden nicht angepasst.

AL-Änderungen können in Arbeitskopien ohne sichtbaren Tab liegen. `bcReport_buildProject` mit `{}` speichert
Dateien und ruft `AL: Package` auf. Danach **Compiler-Ausgabe und Diagnosen** prüfen und das Layout erneut
validieren. Ein erfolgreicher Werkzeugaufruf bedeutet, dass der Befehl ausgeführt wurde, **nicht dass der Build
erfolgreich war**. Der Build benötigt Microsofts AL-Erweiterung und einen vertrauenswürdigen Workspace und
bricht bei Speicherfehlern ab.

## Vorschaudaten und belastbare Prüfung

`bcReport_previewReport` akzeptiert optional `parameters` (Zeichenketten nach Parameternamen) und `maxRows`
(standardmäßig 60 ausgegebene Tabellenzeilen). Es liest `<Layout>.data.json` oder erzeugt Beispielzeilen.
Für `Umsatzbericht.rdl` heißt die gespeicherte Datei `Umsatzbericht.data.json`:

```json
{
  "Umsaetze": [
    { "Region": "Nord", "Kunde": "Example", "Menge": 2, "Umsatz": 123.45 }
  ]
}
```

Die Datei ist nach **Dataset-Namen** gegliedert. Der JSON-Importdialog des Designers erwartet dagegen ein Array;
siehe [Vorschaudaten](ANWENDERHANDBUCH.md#vorschaudaten-laden-und-ergebnisse-prüfen). Bei BC müssen Kopf-/
Positionsbeziehungen und Gruppenschlüssel zusammenpassen.

Die Textvorschau prüft Werte, Formate, Filter, Gruppen und Summen. Sie ist **nicht paginiert**:
`PageNumber`/`TotalPages` sind Platzhalter (1/1), keine echte Seitenanzahl. Kopf-/Fuß-Snapshots mit `Code`/
`ReportItems` können den Stand des letzten Belegs widerspiegeln. Daraus weder Seitenanzahl noch überlappungsfreie
Seiten oder korrekte seitenabhängige Köpfe ableiten.

Zum Abschluss `bcReport_showInDesigner` aufrufen:

```json
{ "file": "samples/Umsatzbericht.rdl", "mode": "preview" }
```

Optional mit `item` ein Element auswählen. Die paginierte Ausgabe ansehen, bei Bedarf PDF exportieren und
BC-Berichte mit der echten BC-Ausführung vergleichen. Für Karten, Unterberichte und nicht unterstütztes VB gelten
die [dokumentierten Grenzen](../README.de.md#grenzen).

## Bearbeitungsverhalten und Bestätigungen

- Strukturelle Layoutänderungen sind normale VS-Code-Dokumentänderungen. Offene Designer aktualisieren sich;
  Rückgängig nimmt Änderungen zurück. Vorher saubere Layouts werden gespeichert, bereits geänderte behalten
  ihren ungespeicherten Stand. Arbeitskopie und Git-Diff prüfen.
- Werkzeuge für AL-Spalten, Labels, Spaltenumbenennung und Build liefern Bestätigungstexte an den Chat-Host.
  Der Host bestimmt ihre Darstellung. Angeforderte AL-Änderungen und Builds vor der Bestätigung prüfen.
- Einfache `<Value>`-, `<Style>`-, Sichtbarkeits-, Positions- und `<Code>`-Änderungen können direkt im XML erfolgen;
  danach validieren. BC-Dataset-/Label-Deklarationen nicht von Hand als Ersatz für neue AL-Felder ändern.
- Die Werkzeuge sind kein automatischer Deployment- oder Server-Rendering-Dienst. Keines veröffentlicht die
  Erweiterung oder bestätigt die produktive Ausgabe eines BC-Berichts.

Implementierung: Das mitgelieferte [Werkzeugmanifest](../package.json) beschreibt die Eingaben. Quelltext online:
[Registrierung und Handler](https://github.com/strxngewxrld/report-builder/blob/main/src/tools/index.ts),
[Strukturänderungen](https://github.com/strxngewxrld/report-builder/blob/main/src/tools/edit.ts),
[Untersuchung/Prüfung/Vorschau](https://github.com/strxngewxrld/report-builder/blob/main/src/tools/inspect.ts).
