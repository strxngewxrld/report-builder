# Lokale UI-Testmatrix

Diese Matrix trennt Tests im echten Webview-DOM von Desktopbedienung per macOS MCP.
Ein grüner Einzelablauf ist keine Abnahme aller Kombinationen oder anderer Betriebssysteme.

| Bereich | Ablauf | Nachweis / Stand |
| --- | --- | --- |
| Datenquellen | Anlegen, ungültiger/duplizierter Name, Verbindung, Umbenennen mit Dataset-Verweis, Löschen | Neuer Webview-Test grün |
| Datasets | SQL-Felder ableiten, Duplikate, Datentyp, berechnetes Feld, Löschen | Neuer Webview-Test grün |
| Dataset-Umbenennung | Tabellenbindung und Aggregatscopes in einfachen und Rich-Text-Feldern | Erweiterter Regressionstest grün; Scopefehler korrigiert |
| Parameter | Umbenennen, Default ändern, Abfrage-/Unterberichtsverweise, Vorschau | Neuer Webview-Test grün; Referenzfehler korrigiert |
| Ausdruckseditor | Syntaxfehler, Live-Ergebnis, Kategorien, Übernehmen, Escape ohne Änderung | Neuer Webview-Test grün |
| Ausdruckssuche | Suchen/Verwendungen, Vorschau, Sammelersetzung und Undo | Vorhandener Webview-Test grün |
| Rich Text | Aufteilen, Textteil/Absatz ergänzen, Formatierung, Zusammenfassen | Erweiterter Webview-Test grün |
| Direkter Texteditor | Cmd+V, Umlaute/&, Bestätigen mit Cmd-/Ctrl-Enter, Escape | Cmd+V nativ reproduziert und korrigiert; nativer Wiederholungstest grün, Regression ergänzt |
| Bilder | Datei auswählen, einbetten, auf Fläche ziehen, umbenennen inkl. Verweise, Escape, Löschen | Neuer Webview-Test grün |
| Drag-and-drop | Dataset → Tabelle; Feld → Zellbindung; Feld → Listen-Rechteck | Webview-Test grün; Listen-Rechteck zusätzlich nativ per macOS MCP geprüft |
| Gestaltung | Schriftgröße, Fett, Hyperlink, Aktion in Vorschau | Neuer Webview-Test grün |
| Gruppen | Parent/Child, Kopf/Fuß, Sortierung, Filter, Umbruch, Seitenzahlen-Neustart, Spaltengruppe | Neuer Webview-Test grün |
| Diagramme | Alle 19 Typen, Bereichswerte, ungültige Achsengrenzen, Kombi/Sekundärachse, gemeinsame Vorschau | Erweiterter Webview-Test grün |
| Datenimport | CSV mit Umlauten/Dezimalkomma; ungültige JSON-Zeilen ohne Überschreiben bestehender Daten | Neuer Webview-Test grün; Validierungsfehler korrigiert |
| Export | Excel/Word durch Webview und Extension-Host bis zur geschriebenen ZIP/XML-Datei | Neuer Webview-Test grün |
| PDF/Office | PDF-Seitenzahl, Größe, Schriften; Öffnen in Vorschau, Word und Excel | Erster Testlauf grün |
| Datengruppen | Plus klappt Gruppe nicht zu; Kategorie und Aktionen per Tastatur erreichbar; Enter im Auswahlfeld | Korrigiert; Tastatur-Regression grün |
| Layout-Bausteine | Dateiimport, Bibliothek speichern/auswählen, zweimal einfügen, Namenskonflikte, gemeinsames Undo | Vorhandene und neue Webview-/Unit-Tests grün |
| AL-Integration | Datasetabgleich, Definitionen, Labels, Spalten, Layoutwechsel, Code-Block | Vorhandene Integrationstests grün; echte AL-Laufzeit extern erforderlich |
| KI-Berichte | Echter Copilot erstellt Rechnungs-RDLC aus AL-Report und passt Umsatzbericht mit Gruppen, Summen, Diagramm und Stilen an | [Copilot-Abnahme](RELEASE-TEST-2026-10-21-COPILOT.md): echter AL-Build, unabhängige Summenprüfung, paginierte Vorschau, Befunde behoben; 162 Unit-Tests und 58 Integrationstests je Sprache |
| Tabellen | Spalten/Zeilen, Gruppenfuß, Undo; Mehrfachauswahl/Verbinden/Teilen | Vorhandener Integrationstest grün; Shift-Auswahl, Verbinden und Teilen nativ geprüft, gespeichertes ColSpan kontrolliert |
| Designer | Abschnittshöhe; Rechteck zeichnen/bewegen/skalieren; Kopieren/Einfügen; Rahmenauswahl; gleiche Breite und links ausrichten | Nativ geprüft; eindeutige Kopienamen, Positionen und Größen im DOM kontrolliert, Layout gespeichert |
| Navigation | Gliederungsfilter, Pfeiltasten, Zoom ohne Dokumentänderung | Neuer Webview-Test grün |
| Neuer Bericht | Speicherdialog, Kopf/Fuß, Einheit und Breite ändern, speichern | Neuer Webview-Test grün |
| Darstellung | Englisch/Deutsch; kleines Fenster; Hell/Dunkel/hoher Kontrast | Erster Testlauf geprüft; kein vollständiger Screenreader-Test |
| Persistenz | Speichern, externe Änderung, ungültiges XML, Undo/Redo | Vorhandene Integrationstests grün |

Ergebnis der zweiten Runde: 39/39 Integrationstests, 143/143 Unit-Tests und Typecheck grün.
Der erste Gesamtlauf brauchte beim Import-Vorschautest einen zweiten Versuch. Die Wartefunktion
berücksichtigt jetzt auch asynchrone Bedingungen; der Test wartet zusätzlich auf sichtbare Daten.
Der Wiederholungslauf besteht mit 39/39 ohne Wiederholungsversuch.
Alle 16 neuen UI-Abläufe bestehen zusätzlich mit deutscher Webview-Lokalisierung, ebenfalls
ohne Wiederholungsversuch. Das VSIX wurde nach den Produktkorrekturen erneut gebaut und geprüft.

## Lokal noch nicht vollständig abgenommen

macOS-Nachprüfung 21.10.: [Protokoll](RELEASE-TEST-2026-10-21-MACOS.md), 162/162 Unit-Tests,
58/58 Integrationstests je Sprache, Restricted Mode je Sprache, 379/379 Korpuslayouts und VSIX grün.
Native Zwischenablage im Direkttexteditor, Cmd+Enter/Speichern, bytegenaues Undo/Redo und PDF in
macOS Vorschau geprüft. Kein bestätigter Produktfehler; die Windows-CI braucht Node 24.
Die folgende Liste bleibt die Grenze der repräsentativen Abnahme.

Weitere Absicherung 21.10.: [Filter/Drilldown, Gestaltung, NVDA und Undo](RELEASE-TEST-2026-10-21-ABSICHERN.md).
Zusätzliche repräsentative Filter-/Drilldown-/Sortier- und Drag-/Zoom-/Raster-/Containerkombinationen geprüft.
Native NVDA-Ansagen für Diagrammdialog und Ausdruckssuche nachgeprüft; Tastaturbedienung der Diagrammtypen,
Validierungsansagen und Vorschau-Schalter korrigiert. Kein vollständiger NVDA-/VoiceOver-Durchgang.
Spalten-Undo aus dem AL-Editor mit zuvor geschlossenen Designern erneut bytegenau geprüft; keine Rückfrage erschienen.
Abschließend Typecheck, 161/161 Unit-Tests und 55/55 Integrationstests je Sprache ohne Wiederholung grün.

Nachprüfung 21.10.: [Acrobat-Abnahme über Windows MCP](RELEASE-TEST-2026-10-21-ACROBAT.md).
Die konkrete Windows-Checkliste in `ABNAHME.md` ist einschließlich Acrobat erledigt. Dabei gefundene
PDF-Schriftfamilienkorrektur mit 161/161 Unit-Tests und 52/52 Integrationstests je Sprache geprüft;
im deutschen Gesamtlauf ein Drag-Test im zweiten Versuch, gezielter Nachlauf sofort grün.
Acrobat bestätigt eingebettete Segoe UI Light; Sonderzeichen, Logo und zwei A4-Seiten nativ geprüft.

Aktueller Stand unter Windows am 20.10.: [Korrekturen und erweiterte Abnahme](RELEASE-TEST-2026-10-20-FIXES.md).
Die bestätigten Zwischenablage-/Bildvalidierungsfehler sind behoben und nativ im installierten VSIX nachgeprüft.
Echter eingeschränkter Modus ebenfalls geprüft; eigener Testbefehl und CI-Prüfung ergänzt.
Zusätzlich erledigt: Ausdruckssuche mit Stil-/Gruppentreffern, Einzel-/Sammel-Undo, Baustein-Konfliktdialoge,
Export/Import zwischen Profilen mit Logo und neuem Kopf, gemeinsame Rücknahme, kombinierte Gruppen-/Containerumbrüche,
Schriften und lange Texte mit PDF-Abgleich, Bookmark-Seitensprung und Drillthrough-Parameter.
AL-Label-Undo aus Designer und AL-Editor sowie Spaltenumbenennung/Undo funktionieren; dabei erschien keine Mehrdatei-Rückfrage.
Abschließend: Typecheck und 160/160 Unit-Tests grün, 51/51 Integrationstests jeweils Englisch/Deutsch ohne Wiederholung;
Restricted Mode 1/1 je Sprache. Letzte zusätzliche Tabellen-/Gruppenvarianten 2/2 je Sprache.

- Vollständiger VoiceOver-/NVDA-Durchgang und reine Tastaturbedienung sämtlicher Dialogvarianten.
- Weitere Farbvarianten; jede Schrift-/Rahmen-/Zahlenformatkombination; alle Einfügewerkzeuge
  mit sämtlichen Ziehrichtungen, Raster-/Zoomstufen und Containerkombinationen.
- Tatsächliche Drillthrough-Servernavigation (die lokale Vorschau bietet absichtlich nur einen Hinweis) und
  weitere Varianten über die dokumentierten Filter-/Drilldown-/Sortierkombinationen hinaus.
  Bedingte Gruppenumbrüche, Reset-Ausdrücke und Summen sind in repräsentativen Webview-Abläufen geprüft.
- Weitere große Bildformate, jede denkbare Konflikt-/Gestaltungskombination und native Mehrdatei-Undo-Rückfragen.

Diese verbleibenden Restpunkte sind keine bestätigten Fehler. Sie sind ausdrücklich **nicht** durch den
grünen Gesamtlauf als manuell abgenommen zu verstehen.

Protokolle: `artifacts/qa-2026-10-18/round2/`, `artifacts/qa-remaining/`, `artifacts/qa-fixes/`.
