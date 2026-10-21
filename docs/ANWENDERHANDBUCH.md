# Report Builder – Anwenderhandbuch

[English](USER-GUIDE.md) | Deutsch

Dieses Handbuch beschreibt den **Business Central Report Builder für VS Code**: RDLC-/RDL-Layouts öffnen,
gestalten, mit Daten prüfen und exportieren. Für den Wechsel vom eigenständigen Microsoft Report Builder gibt es
eine separate [Umstiegsanleitung](UMSTIEG-REPORT-BUILDER.md).
Alle KI-Werkzeuge beschreibt die [KI-Tools-Dokumentation](AI-TOOLS.de.md).

Stand: 21.10.2026, Version 1.0.0. Die Screenshots zeigen die englische Oberfläche unter Windows mit den
Beispielberichten dieses Repositorys. Die Anleitung verwendet deutsche Befehlsnamen; wichtige englische
Beschriftungen stehen in Klammern. Die Oberfläche folgt der Anzeigesprache von VS Code.

## Inhalt

- [Installation und erster Start](#installation-und-erster-start)
- [Die Oberfläche](#die-oberfläche)
- [Ein Layout bearbeiten](#ein-layout-bearbeiten)
- [Tabellen, Gruppen und Seiten](#tabellen-gruppen-und-seiten)
- [Mit Business Central und AL arbeiten](#mit-business-central-und-al-arbeiten)
- [Vorschaudaten laden und Ergebnisse prüfen](#vorschaudaten-laden-und-ergebnisse-prüfen)
- [Exportieren und drucken](#exportieren-und-drucken)
- [Wiederverwenden, suchen und KI einsetzen](#wiederverwenden-suchen-und-ki-einsetzen)
- [Tastatur und Fehlerhilfe](#tastatur-und-fehlerhilfe)

## Installation und erster Start

Für einen geführten Einstieg in der Befehlspalette **Business Central Report Builder: Erste Schritte** wählen
(englisch: **Getting Started**). Der Rundgang öffnet auf Wunsch eine separate Kopie des Umsatzbeispiels mit
Vorschaudaten. Diese liegt in einem temporären Ordner; Änderungen mit **Speichern unter…** dauerhaft ablegen.
Der Rundgang bietet Handbuch, Umstiegsanleitung und KI-Tools-Dokumentation offline an. Bei deutscher
VS-Code-Sprache öffnen die deutschen Fassungen; für andere Sprachen ist Englisch der Standard.

1. VS Code ab Version 1.95 installieren bzw. öffnen.
2. Das VSIX-Paket `bc-report-builder-<version>.vsix` aus den
   [Releases](https://github.com/strxngewxrld/report-builder/releases) herunterladen.
3. In der Befehlspalette (`Strg+Umschalt+P`) **Extensions: Install from VSIX…** wählen und das Paket öffnen.
4. Den Projektordner über **Datei › Ordner öffnen…** öffnen. Für Business Central den Ordner mit `app.json`,
   AL-Dateien und Layouts verwenden: Dadurch kann der Designer den zugehörigen AL-Report finden.
5. Eine `.rdlc`- oder `.rdl`-Datei im Explorer öffnen. Falls XML erscheint, das Explorer-Kontextmenü
   **Im Designer öffnen** verwenden.

Für reinen Layoutentwurf und lokale Vorschau ist die Microsoft-AL-Erweiterung nicht erforderlich.
Für **Projekt erstellen (AL: Package)** und die AL-Entwicklung wird sie benötigt. Build, Symbol-Download und
Ausführung in Business Central benötigen einen vertrauenswürdigen Arbeitsbereich.

Zum Ausprobieren eine Kopie des Ordners [samples](../samples) öffnen:

- `Umsatzbericht.rdl` hat bereits eine Datendatei und eignet sich für die erste Vorschau.
- `Verkaufsrechnung.rdlc` gehört zu `src/Verkaufsrechnung.Report.al` und zeigt die BC-Integration.
  Der Beispieldatensatz ist absichtlich gegenüber AL veraltet; ein Build-Hinweis ist hier zu erwarten.
- `Bericht1.rdlc` ist ein weiteres Layoutbeispiel.

Ein neues Layout entsteht über das Ordner-Kontextmenü **Neues Berichtslayout…** oder **Datei › Neue Datei… ›
Berichtslayout (RDLC)**. Das erzeugt die Layoutdatei. Für einen BC-Bericht muss sie zusätzlich im AL-Report
registriert sein; siehe [AL-Zuordnung](#layout-und-al-report-zuordnen).

## Die Oberfläche

![Rechnung im Entwurf mit Dokumentgliederung links und Berichtseigenschaften rechts](images/01-designer.png)

Die Entwurfsfläche zeigt **Seitenkopf**, **Textkörper** und gegebenenfalls **Seitenfuß**. Platzhalter wie
`[CompanyName]` oder `«Expr»` stehen für Feldwerte und Ausdrücke; die ausgewerteten Werte erscheinen in der Vorschau.

| Bereich | Zweck |
| --- | --- |
| Dokumentgliederung (Outline), links | Elemente, verschachtelte Tabellen und Gruppen finden; nach Namen oder Ausdrücken filtern; Auswahl mit der Fläche synchronisieren |
| Berichtsdaten (Report Data), links | Felder, Labels, Bilder und Vorschaudaten; bei BC zusätzlich AL-Datenelemente und die Layouts des Reports |
| Symbolleiste über der Fläche | Elemente einfügen, Schrift und Zahlenformat ändern, Elemente ausrichten, Ausdrücke suchen und Bausteine einfügen |
| Eigenschaften (Properties), rechts | Eigenschaften der Auswahl; ohne Elementauswahl Eigenschaften des Berichts und der Seite |
| Gruppierung (Grouping), unten | Gruppen der ausgewählten Tabelle und ihre Eigenschaften |
| Editor-Titelleiste und ihr „…“-Menü | Entwurf/Vorschau, XML, Einfügen, Ansicht, Berichtseigenschaften und weitere Befehle |
| VS-Code-Statusleiste | Auswahl, Maßeinheit, Zoom, AL-Report sowie in der Vorschau die aktuelle Seite |

Symbolbeschriftungen erscheinen beim Überfahren mit der Maus. Alle wesentlichen Aktionen sind auch über die
Befehlspalette unter **Business Central Report Builder** erreichbar. Bei wenig Platz die VS-Code-Seitenleiste
mit `Strg+B` schließen oder die internen Bereiche über **Ansicht** im „…“-Menü ein-/ausblenden.

## Ein Layout bearbeiten

### Text, Position und Format

1. Ein Textfeld auf der Fläche oder in der Dokumentgliederung auswählen.
2. Mit **F2**, **Eingabe** oder **Text bearbeiten** im Kontextmenü den Text bearbeiten.
3. Die direkte Textbearbeitung mit `Strg+Eingabe` übernehmen oder mit `Esc` abbrechen.
4. Schrift, Farbe, Ausrichtung und Zahlenformat in der Symbolleiste bzw. den Eigenschaften setzen.
5. Das Element ziehen oder Position und Größe in den Eigenschaften ändern.
6. Mit `Strg+S` speichern. `Strg+Z` nimmt eine Änderung zurück.

Zum Einfügen ein Werkzeug wie **Textfeld**, **Rechteck**, **Linie** oder **Tabelle** wählen und das Element auf der
Fläche platzieren. `Esc` beendet das Einfügewerkzeug. Felder lassen sich aus **Berichtsdaten** in die Fläche
oder auf eine Tabellenzelle ziehen. Für ein Logo unter **Berichtsdaten › Bilder** eine Bilddatei einbetten und
das Bild in den gewünschten Abschnitt ziehen.

Mehrere Elemente auswählen und über **Ausrichten und anordnen** ausrichten, auf gleiche Größe setzen oder verteilen.
Beim Ausrichten dient das zuerst ausgewählte Element als Bezug. Raster und Einrasten lassen sich über **Ansicht**
steuern; mit gedrückter `Alt`-Taste lässt sich beim Ziehen frei positionieren.

### Ausdrücke statt festem Text

Im Kontextmenü des Textfelds **Ausdruck…** wählen oder den Ausdruck bei **Wert** in den Eigenschaften bearbeiten.
Ein Ausdruck beginnt mit `=`:

```vb
=Fields!LineAmount_Line.Value
=Sum(Fields!LineAmount_Line.Value)
=Parameters!YourReferenceCaption.Value
="Seite " & Globals!PageNumber
```

Die Namen müssen im jeweiligen Layout vorhanden sein. Für Aggregate den passenden Gruppen-/Dataset-Bereich
berücksichtigen. Die Beispiele zeigen die Syntax; nicht jedes Feld bzw. jeder Parameter existiert in jedem Bericht.

![Ausdruckseditor mit Feldliste und ausgewertetem Beispielwert](images/03-ausdruck.png)

`Strg+Leertaste` öffnet die Vervollständigung. Nach `Fields!`, `Parameters!`, `Globals!`, `ReportItems!` und `Code.`
erscheinen ebenfalls Vorschläge. Der Editor bietet Syntaxprüfung und ein Live-Ergebnis. Seitenabhängige Ausdrücke
anschließend auf den tatsächlichen Vorschauseiten prüfen.

Für ein Textfeld mit unterschiedlich formatierten Teilen **Textteile › Aufteilen** verwenden, etwa für ein
normales „Seite “ mit fett gesetzter Seitenzahl. Über **In einfaches Textfeld** lassen sich die Teile wieder zusammenfassen.

## Tabellen, Gruppen und Seiten

### Eine Tabelle ändern

Eine Zelle auswählen und das Kontextmenü **Tabelle** öffnen. Dort lassen sich Spalten und Zeilen einfügen oder
löschen, Zellen verbinden/teilen und Gruppen bearbeiten. Bei Zeilen zwischen **innerhalb** und **außerhalb der
Gruppe** unterscheiden: Eine Detailzeile wiederholt sich für jeden Datensatz; eine Zeile außerhalb der Detailgruppe
kann beispielsweise eine Gesamtsumme aufnehmen.

Zellen im Tabellenkörper können waagerecht verbunden werden. Für mehrere Zellen eine zusammenhängende Auswahl
verwenden. Für eine Matrix **Matrix einfügen…** mit Zeilenfeld, Spaltenfeld und Wert verwenden.

### Diagramme einfügen

**Diagramm einfügen…** wählen und Typ, Kategorie und Wert festlegen. Für einen Umsatzvergleich beispielsweise
`Region` als Kategorie und `Sum(Fields!Umsatz.Value)` als Wert verwenden. Über **Diagrammeigenschaften…**
anschließend Reihen, Achsen, Titel, Legende und Beschriftungen anpassen. Bei mehreren Reihen lassen sich
unterschiedliche Typen und eine zweite Werteachse verwenden. Die Vorschau mit bekannten Summen vergleichen;
die unterstützten Diagrammtypen und Einschränkungen stehen in der [README](../README.de.md#grenzen).

### Gruppieren und summieren

Beispiel am `Umsatzbericht.rdl`:

1. Eine Detailzelle der Tabelle auswählen.
2. **Tabelle › Gruppe › Übergeordnete Gruppe hinzufügen…** wählen.
3. Als Gruppierung `=Fields!Region.Value` verwenden und einen Gruppenkopf oder Gruppenfuß ergänzen.
4. Im Gruppenfuß ein Textfeld mit `=Sum(Fields!Umsatz.Value)` setzen. In diesem Bereich ergibt das die Regionssumme.
5. In **Gruppierung** die Gruppe und ihr Zahnrad für **Gruppeneigenschaften…** öffnen. Sortierung,
   Filter und bei einer gruppierten Gruppe den Seitenumbruch prüfen.
6. In der Vorschau jede Gruppe und die Gesamtsumme kontrollieren.

![Eigenschaften der Detailgruppe mit Sortierung nach der Positionsnummer](images/04-gruppeneigenschaften.png)

Der Screenshot zeigt die **Detailgruppe** der Verkaufsrechnung: eine Zeile je Datensatz und Sortierung nach
`LineNo_Line`. Bei einer Gruppe nach einem Feld stehen zusätzliche Gruppierungs- und Umbruchoptionen zur Verfügung.
Bereits vorhandene komplexe Filter können als unverändert übernommene, nur im XML bearbeitbare Ausdrücke erscheinen.

Beim Löschen einer Gruppe bewusst zwischen **nur Gruppe** und **Gruppe mit Zeilen** wählen.
Für Tabellenüberschriften in den Zeileneigenschaften **Auf jeder Seite wiederholen** und **Bei Gruppe halten** prüfen.

### Seitenformat und Umbrüche

Über **Berichtseigenschaften…** bzw. die Eigenschaften ohne Elementauswahl Seitengröße, Ränder und
Textkörperbreite einstellen. Für A4 hoch beispielsweise 21 × 29,7 cm. Es muss gelten:

```text
Textkörperbreite + linker Rand + rechter Rand ≤ Seitenbreite
```

Auch Elemente dürfen nicht über den Textkörper hinausragen. Zusätzliche leere Seiten entstehen häufig durch
zu große Breite, überstehende Elemente oder Gruppen-/Elementumbrüche. Seitenkopf und Seitenfuß benötigen
zusätzlichen Platz innerhalb der nutzbaren Seitenhöhe. **KeepTogether**, wiederholte Tabellenköpfe und
Gruppenumbrüche immer mit mehrseitigen Daten prüfen.

## Mit Business Central und AL arbeiten

### Layout und AL-Report zuordnen

Der Designer erkennt Layoutreferenzen über `rendering › layout › LayoutFile` oder `RDLCLayout`, auch in
Report-Extensions. Ein Rendering sieht beispielsweise so aus:

```al
rendering
{
    layout(MeinLayout)
    {
        Type = RDLC;
        LayoutFile = './Layouts/MeinLayout.rdlc';
    }
}
```

Der Layoutpfad ist relativ zur Projektwurzel mit `app.json`. Ein allein geöffnetes Layout ohne passenden
AL-Report hat keinen AL-Kontext. In diesem Fall zuerst den Projektordner und die Layoutreferenz prüfen.

### Neue Felder und übersetzbare Beschriftungen

![AL-Berichtsdaten mit Datenelementen, Spalten, Captions und Hinweis auf den erforderlichen Build](images/02-berichtsdaten-al.png)

Unter **Berichtsdaten** erscheinen die Datenelemente des AL-Reports mit ihren Spalten. Doppelklick auf eine
Spalte öffnet die Definition im AL-Code. Die Beispielrechnung zeigt `YourReference` und die Caption als **Build**:
Sie existieren in AL, fehlen aber noch im Layout-Dataset.

Für eine zusätzliche Spalte:

1. Am Datenelement das Kontextmenü **Felder als Spalten hinzufügen…** öffnen.
2. Tabellenfelder auswählen. Die Auswahl nutzt Tabellen im Workspace und heruntergeladene Symbolpakete in `.alpackages`.
3. Die eingefügte AL-Spalte prüfen und **Projekt erstellen (AL: Package)** ausführen.
4. Den Compilererfolg in der AL-Ausgabe und die Diagnosen prüfen. Erst ein erfolgreicher Build aktualisiert das Dataset.
5. Die Spalte aus **Berichtsdaten** auf die Fläche oder in eine Tabellenzelle ziehen.

Für eine übersetzbare Überschrift ein Textfeld mit festem Text auswählen und **Als AL-Label anlegen…** aufrufen.
Der Designer legt das AL-Label an und ersetzt den Text durch einen Parameterverweis. Danach das Projekt erstellen.
Übersetzungen gehören in die XLIFF-Dateien unter `Translations/`; dafür muss `TranslationFile` im AL-Projekt aktiviert sein.

Bei Dezimalspalten vorhandene `<Spalte>Format`-Felder verwenden; beim Ziehen berücksichtigt der Designer sie automatisch.
Für Überschriften mit `IncludeCaption` die erzeugten `<Spalte>Caption`-Parameter einsetzen.
Eine Spalte über **Spalte umbenennen (AL und Layouts)…** umbenennen, damit AL und die zugehörigen RDLC-Layouts
gemeinsam angepasst werden.

### Im Zielsystem prüfen

**Report in Business Central ausführen** nutzt die Umgebung aus `.vscode/launch.json`, gegebenenfalls nach dem
Veröffentlichen. Für die Abnahme das gewünschte Rendering in Business Central verwenden und mit echten Daten prüfen:
Beleggruppen, Sprache, Beträge, Seitenköpfe, Umbrüche und Schriften. Die lokale Vorschau ist eine Annäherung an
die Berichtsausführung und ersetzt diesen Schritt nicht.

## Vorschaudaten laden und Ergebnisse prüfen

Mit aktivem Designer `F5` oder **Vorschau anzeigen** wählen. Ohne geladene Daten erzeugt die Vorschau Beispieldaten.
Diese helfen beim Gestalten, sind jedoch kein Nachweis fachlich korrekter Werte.

Für eigene Daten unter **Berichtsdaten › Vorschaudaten** oder über den Befehl
**Vorschaudaten laden (Excel, CSV, JSON)…** eine Datei auswählen:

- Excel (`.xlsx`) oder CSV mit Spaltenüberschriften; Feldnamen des Datasets als Überschriften verwenden.
- JSON als **Array von Objekten** für den Importdialog, beispielsweise:

```json
[
  { "Region": "Nord", "Kunde": "Beispiel GmbH", "Menge": 2, "Umsatz": 123.45 }
]
```

Der Import speichert die Daten neben dem Layout als `<Layoutname>.data.json`, ohne `.rdl`/`.rdlc` im Namen.
Diese gespeicherte Datei ist nach Dataset-Namen gegliedert; sie hat deshalb eine andere Struktur als die Importdatei:

```json
{
  "Umsaetze": [
    { "Region": "Nord", "Kunde": "Beispiel GmbH", "Menge": 2, "Umsatz": 123.45 }
  ]
}
```

`Umsaetze` ist hier der Dataset-Name aus `Umsatzbericht.rdl`. Bei mehreren Datasets den Import am passenden Dataset
starten. Für BC können Daten aus der Berichtsausführung über **Senden an › Microsoft Excel-Dokument (nur Daten)**
gewonnen werden. Kopf-/Positionszeilen und Gruppierungsschlüssel müssen für einen realistischen Belegtest zusammenpassen.

![Umsatzvorschau mit acht Positionen, Menge 116 und Gesamtsumme 37.523,40 Euro](images/05-vorschau.png)

Das unveränderte Umsatzbeispiel zeigt acht Positionen, **116** als Gesamtmenge und **37.523,40 €** Umsatz.
Der Unterbericht „Kundendetails“ ist als Platzhalter sichtbar, weil lokale Unterberichte nicht ausgeführt werden.
In der Vorschau lassen sich Parameter setzen und über **Bericht anzeigen** (View Report) anwenden.
Vorhandene Drilldown- und Sortieraktionen sind interaktiv bedienbar.

Für die Kontrolle alle Seiten durchgehen und auf fehlende Zeilen, falsche Gruppen, `#Error`, abgeschnittene Texte,
Überlappungen und leere Seiten achten. Mit `F5` oder **Entwurf** zurückwechseln.

## Exportieren und drucken

![Exportmenü der Vorschau mit PDF, Excel, Word und HTML](images/06-export.png)

In der Vorschau das Exportmenü neben **Drucken** öffnen oder den entsprechenden Befehl der Befehlspalette wählen.

| Ausgabe | Einsatz und Grenzen |
| --- | --- |
| PDF | Paginierte Ausgabe; Texte, Rahmen und Hintergründe als Vektoren, Bilder/Diagramme eingebettet |
| Excel | Daten und Tabellen weiterbearbeiten; Zahlen werden als Zahlen ausgegeben, kein pixelgenaues Layoutabbild |
| Word | Texte und Tabellen weiterbearbeiten, kein pixelgenaues Layoutabbild |
| HTML | Bericht als HTML-Datei exportieren |
| Drucken | Paginierte Vorschau im Browser öffnen und dort drucken bzw. über den Browser als PDF speichern |

Für PDF die im Bericht verwendeten Schriftdateien lokal installieren. Der Export bettet unterstützte
TrueType-/OpenType-Schriften als Teilmenge ein, sofern die Schriftlizenz das erlaubt. Ohne geeignete Schriftdatei
verwendet er PDF-Standardschriften mit begrenztem Zeichenvorrat. Den exportierten Bericht vor Weitergabe öffnen und prüfen.

## Wiederverwenden, suchen und KI einsetzen

Die **Lupe** öffnet **Ausdrücke und Verwendungen…**. Damit lassen sich Ausdrücke layoutweit suchen und mit
Vorher-/Nachher-Vorschau ersetzen. Der Modus **Feld- und Labelverwendungen** zeigt, welche Elemente eine Spalte
oder ein Label verwenden. **Im Layout anzeigen** springt zum Element.

Für einen wiederverwendbaren Firmenkopf oder Adressblock die Elemente auswählen und **Auswahl als Baustein speichern…**
verwenden. **Layout-Baustein einfügen…** öffnet die Bibliothek; alternativ Bausteine als RDLC-Datei exportieren/importieren.
Die Bibliothek gehört zum VS-Code-Profil. Vor dem Einfügen fehlende Felder, Labels oder Datasets prüfen und im Zielreport
ergänzen. Ein Baustein überträgt kein AL-Dataset und keine Datenquellen.

GitHub Copilot kann im Agentenmodus die Report-Builder-Werkzeuge verwenden, etwa `#reportLayout` oder `#previewReport`.
Ein sinnvoller Auftrag nennt Layout, gewünschte Änderung und Prüfkriterien:

> Gruppiere die Tabelle in Umsatzbericht.rdl nach Region, ergänze Regionssummen und erhalte die Gesamtsumme.
> Verwende die Report-Builder-Werkzeuge, prüfe das Layout und zeige das Ergebnis im Designer.

Änderungen und AL-Build-Ausgabe selbst prüfen. Die Textvorschau der KI liefert Werte, aber keine belastbare
Seitenanzahl und keinen Nachweis für überlappungsfreie Seiten. Dafür die paginierte Designer-Vorschau verwenden.
Werkzeugeingaben, Beispiele und Bestätigungen stehen in der [KI-Tools-Dokumentation](AI-TOOLS.de.md).

## Tastatur und Fehlerhilfe

Die Kürzel gelten unter Windows bei aktivem Designer; beim Bearbeiten eines Eingabefelds gelten dessen Textbefehle.

| Taste | Aktion |
| --- | --- |
| `F5` | Entwurf/Vorschau wechseln |
| `F2` / `Eingabe` | Ausgewähltes Textfeld bearbeiten |
| `Strg+Eingabe` / `Esc` | Direkte Textbearbeitung übernehmen / abbrechen |
| `Tab` / `Umschalt+Tab` | Nächstes/vorheriges Element auf der Fläche |
| Pfeiltasten | Ausgewähltes Element verschieben |
| `Alt+Pfeiltasten` | Größe ändern; mit `Umschalt` fein |
| `Umschalt+F10` | Kontextmenü der Auswahl |
| `Strg+S` / `Strg+Z` / `Strg+Y` | Speichern / Rückgängig / Wiederholen |
| `Strg+Mausrad` | Zoom ändern |
| `Strg+Umschalt+P` | VS-Code-Befehlspalette |

Unter macOS verwenden die üblichen Bearbeitungsbefehle `⌘` statt `Strg`.

| Problem | Prüfen und beheben |
| --- | --- |
| Layout öffnet als XML | Explorer-Kontextmenü **Im Designer öffnen**; Installation und Aktivierung der Erweiterung prüfen |
| Feld fehlt oder trägt „Build“ | AL-Spalte und Layoutreferenz prüfen, Projekt erstellen, Compilerfehler beheben |
| Kein AL-Report erkannt | Projektordner mit `app.json` öffnen; `LayoutFile`/`RDLCLayout` und Dateipfad prüfen |
| `#Error` oder fehlende Werte | Feld-/Parameternamen, Groß-/Kleinschreibung, Dataset und importierte Daten prüfen; VS-Code-Problembereich öffnen |
| Leere zusätzliche Seite | Textkörperbreite plus Ränder, überstehende Elemente und explizite Umbrüche prüfen |
| Falsches Zahlen-/Datumsformat | Berichtssprache, Zahlenformat und BC-Formatfelder prüfen; VS-Code-Sprache allein bestimmt nicht die Berichtssprache |
| Build-/BC-Befehl nicht verfügbar | Arbeitsbereichsvertrauen, AL-Erweiterung und Projekt-/Umgebungskonfiguration prüfen |
| Karte oder Unterbericht als Platzhalter | Karten werden lokal nicht gerendert, Unterberichte nicht ausgeführt; Ausgabe im Zielsystem prüfen |
| Word-/Excel-Layout nicht bearbeitbar | Der Designer bearbeitet `.rdlc`/`.rdl`; Word-/Excel-Layouts öffnen in der jeweiligen Anwendung |

Weitere Funktionsgrenzen, insbesondere zu Diagrammen und VB-Berichtscode, stehen unter
[Grenzen in der README](../README.de.md#grenzen).
