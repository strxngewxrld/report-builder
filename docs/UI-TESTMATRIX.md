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

- Vollständiger VoiceOver-Durchgang und reine Tastaturbedienung sämtlicher Dialogvarianten.
- Native Farbauswahl; jede Schrift-/Rahmen-/Zahlenformatkombination; alle Einfügewerkzeuge
  mit sämtlichen Ziehrichtungen, Raster-/Zoomstufen und Containerkombinationen.
- Bookmark-/Drillthrough-Eingaben und deren gesamte Navigation; komplexe Filterlisten,
  bedingte Umbrüche und Drilldown-Kombinationen im UI (Modelltests sind vorhanden).
- Bausteinbibliothek: native Ersetzen-Rückfrage bestätigen/abbrechen, Fehler bei Datei-/Code-/
  Bildkonflikten durch sämtliche Dialogwege; große bzw. defekte Bilddateien.
- Kopieren/Einfügen zwischen mehreren geöffneten Berichten und alle Mehrdatei-Undo-Rückfragen.

Diese Restpunkte sind keine bestätigten Fehler. Sie sind ausdrücklich **nicht** durch den
grünen Gesamtlauf als manuell abgenommen zu verstehen.

Protokolle: `artifacts/qa-2026-10-18/round2/`. Ergänzungen und Restpunkte stehen im Release-Testprotokoll.
