# TODO

Was zur vollständigen Anwendung noch fehlt – nach Priorität. Erledigtes steht abgehakt darunter.

Testnachweise: [Release-Testprotokoll](docs/RELEASE-TEST-2026-10-18.md) und
[UI-Testmatrix mit verbleibenden Lücken](docs/UI-TESTMATRIX.md). Grüne Tests ersetzen keine vollständige manuelle Abnahme.

## Erstes Release (1.0.0)
- [x] Offene Änderungen committen und pushen; CI (Unit-, Integrations-, Lokalisierungstest, VSIX-Prüfung) muss für den Commit grün sein
- [ ] Nach den lokalen QA-Korrekturen erneut committen/pushen und CI für genau diesen Release-Stand prüfen (aktuell uncommittete Änderungen)
- [ ] Screenshot `media/preview.png` (Designer mit Gliederung und Berichtsdaten) für README und Release-Seite
- [x] Lokalen Release-Dry-Run ausführen: `npm run publish:github -- --dry-run` (18.10.2026: Typecheck, 143/143 Tests und VSIX-Prüfung grün; nichts veröffentlicht)
- [ ] Nach bestandener Abnahme und grüner CI veröffentlichen: `npm run publish:github`
- [ ] Remote-Fenster (WSL/SSH/Dev Container): Update-Installation prüfen (VSIX liegt im temporären Ordner des Extension-Hosts)
- [ ] Eingeschränkter Modus: `untrustedWorkspaces.supported: true` überdenken – *Report in BC ausführen* und *Projekt
      erstellen* starten AL-Befehle; ggf. `limited` mit Beschreibung wie bei Sheets

## Absichern (vor einer Veröffentlichung) – braucht Hand und echte Umgebungen
- [ ] Restliche manuelle Fälle aus `docs/ABNAHME.md` abnehmen (insbesondere Baustein-Ersetzen bestätigen/abbrechen, Konfliktpfade und kombinierte Vorschau-Umbrüche)
- [ ] Noch offene Dialog-/Navigationsvarianten prüfen: verschachtelte Spaltengruppen, berechnete Diagrammreihen und Punktfarben,
      Bookmark/Drillthrough samt Navigation sowie komplexe Filter-/Drilldown-Kombinationen; Details in `docs/UI-TESTMATRIX.md`
- [ ] Reine Tastaturbedienung sämtlicher Dialogvarianten mit VoiceOver prüfen; NVDA unter Windows separat abnehmen
- [ ] Native Farbauswahl und weitere Gestaltungs-/Drag-Varianten prüfen (Schriften, Rahmen, Zahlenformate, Raster/Zoom, Container); große/defekte Bilder testen
- [ ] Kopieren/Einfügen zwischen mehreren geöffneten Berichten nativ prüfen
- [ ] Mehrdatei-Rückgängig von Hand prüfen: *Als AL-Label anlegen* und *Spalte umbenennen* (VS Code fragt „in allen Dateien?“)
- [ ] Symbolpakete gegen eine echte Base Application (`.alpackages/*.app`) prüfen – getestet nur mit selbst gebautem Paket
- [ ] „Report in Business Central ausführen“ gegen echte Umgebungen prüfen (Cloud-Sandbox, Docker, On-Prem)
- [ ] PDF-Export in Acrobat sowie eingebettete Schriften unter Windows/Linux prüfen (macOS Vorschau bereits geprüft)


## Erledigt
- [x] Dialog-UI im echten VS-Code-Webview per DOM-Eingaben/Klicks testen: 39/39 Integrationstests, zusätzlich alle 16 neuen UI-Abläufe auf Deutsch; 143/143 Unit-Tests
- [x] Englischen Designer und geprüfte Dialoge visuell durchsehen; deutsche Oberfläche sowie Hell/Dunkel/hoher Kontrast und kleine Diagrammdialoge prüfen (keine Vollabnahme aller Varianten)
- [x] Gruppen, Matrix, Diagrammdialog, Rich Text und Bilder über Webview-Tests prüfen; native Kontextmenüs, Listen-Rechteck-Drop, Inline-Text, Tabellenzellen verbinden/teilen sowie Designer-Auswahl/Größe/Ausrichtung per macOS MCP prüfen
- [x] Excel-/Word-Exporte in Microsoft Excel und Word unter macOS ohne Reparaturdialog öffnen; PDF in macOS Vorschau prüfen (ergänzend openpyxl, `textutil`, pdf-lib und Quick Look)
- [x] Ausdrücke suchen/ersetzen mit Vorschau, Syntaxprüfung und Sammel-Undo; Feld-/Labelverwendungen mit Layout-Navigation
- [x] Wiederverwendbare Layout-Bausteine: Bibliothek, RDLC-Export/Import, Bilder und interne Verweise, Abhängigkeitsprüfung
- [x] Vorschau: Container-Umbrüche, Gruppen-Endumbrüche, bedingte Umbrüche und Seitenzahl-Neustart; Schriften vor Vermessung laden
- [x] Echte Dialogeingaben/Klicks für Ausdruckssuche und Bausteinimport integrationsgetestet; Abnahmeplan `docs/ABNAHME.md`
- [x] Spaltengruppen auch für Tabellen mit vorhandenen Spaltenköpfen (weitere Gruppe, Elterngruppe einer Matrix)
- [x] Diagramme: berechnete Reihen (gleitende Durchschnitte, Mittelwert, Median – RDL kennt keine lineare Trendlinie),
      Trichter, Pyramide, Bereich, Polar, Netz, Farbe und Markierung der Datenpunkte
- [x] `<Code>`-Interpreter: `Try`/`Catch`/`Finally`, `Throw`, `With`, Arrays mit Index-Zuweisung und `ReDim`
- [x] PDF-Export: eingebettete TrueType-/OpenType-Schriften (Teilmenge, fontkit bei Bedarf nachgeladen)
- [x] „Als AL-Label anlegen“ und „Felder als Spalten hinzufügen“ mit Eingabefeld/Auswahlliste testen (Integrationstests mit
      beantworteten Eingaben, auch „Spalte umbenennen“)
- [x] Integrationstests unter Last stabil machen (Zeitlimits über `BC_RB_TIMEOUT_SCALE`, zweiter Versuch je Test, Warten auf
      das Schließen des vorherigen Designers)
- [x] UI-Tests für die Webview, soweit vom Extension-Host erreichbar: Tabellenbefehle, Vorschau, PDF-Export, Lokalisierung
- [x] Spaltengruppe zu einer bestehenden Tabelle hinzufügen/löschen; Eigenschaften einzelner Spalten (Ausblenden, Umschalten)
- [x] ~~RowSpan im Tabellenkörper bearbeiten~~ – entfällt: RDL erlaubt `RowSpan` nur in der Tablix-Ecke (Report Builder:
      „Im Tabellenkörper können Zellen nur horizontal verbunden werden“)
- [x] Aktionen an Textfeldern/Bildern: Hyperlink, Drillthrough, Lesezeichen (bearbeitbar, in der Vorschau anklickbar)
- [x] Eingebettete Bilder verwalten (einbetten, umbenennen, löschen, auf die Fläche ziehen)
- [x] Diagramme: Achsen (Titel, Format, Min/Max), Datenbeschriftungen, Sekundärachse, weitere Typen (100 %, geglättet,
      gestapelte Fläche, Punkte), Kombidiagramme
- [x] Messgerät darstellen (rund und linear)
- [x] `<Code>`-Interpreter: `For`/`While`-Schleifen und `Select Case`
- [x] Rich-Text-Textfeld in ein einfaches Textfeld umwandeln und umgekehrt
- [x] Vorschau-Export als PDF direkt (pdf-lib)
- [x] Word-/Excel-Layouts von BC: Hinweis im Designer, Öffnen in Word/Excel aus *Layouts des Reports*
- [x] Spalte umbenennen in AL und allen Layouts gleichzeitig (Refactoring)
- [x] Mehrere Layouts eines Reports (`rendering`) im Designer wechseln
- [x] Mehrsprachigkeit: Labels mit `Comment`/`MaxLength`/`Locked` anlegen, XLIFF-Hinweise
- [x] Rückgängig über AL- und Layout-Änderung gemeinsam (*Als AL-Label anlegen*, *Spalte umbenennen*: ein `WorkspaceEdit`)
- [x] Git-Repository anlegen
- [x] `LICENSE` (MIT, Tom Knüppel)
- [x] CI: Typecheck, Unit-Tests, Integrationstests (xvfb), deutsche Lokalisierung, Korpus-Test nächtlich
- [x] Oberfläche lokalisieren (`vscode.l10n`-Bundle, `package.nls.json`): Englisch und Deutsch nach Anzeigesprache von VS Code
- [x] Barrierefreiheit: Tastaturbedienung der Entwurfsfläche, Screenreader-Beschriftungen und -Ansagen, hoher Kontrast
- [x] CHANGELOG
- [x] Bekannte Restabweichung im Korpus: `<Visibility></Visibility>` bleibt erhalten – 379/379 Layouts zeichengleich
