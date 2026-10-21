# TODO

Was zur vollständigen Anwendung noch fehlt – nach Priorität. Erledigtes steht abgehakt darunter.

Testnachweise: [Release-Testprotokoll](docs/RELEASE-TEST-2026-10-18.md), [Windows-Abnahme](docs/RELEASE-TEST-2026-10-20-WINDOWS.md),
[Nachprüfung offener Punkte](docs/RELEASE-TEST-2026-10-20-RESTPUNKTE.md),
[Korrekturen und erweiterte Abnahme](docs/RELEASE-TEST-2026-10-20-FIXES.md),
[Acrobat-Abnahme per Windows MCP](docs/RELEASE-TEST-2026-10-21-ACROBAT.md),
[weitere Absicherung mit NVDA](docs/RELEASE-TEST-2026-10-21-ABSICHERN.md) und
[UI-Testmatrix mit verbleibenden Lücken](docs/UI-TESTMATRIX.md). Grüne Tests ersetzen keine vollständige manuelle Abnahme.

## Erstes Release (1.0.0)
- [ ] Aktuellen Freigabestand committen und pushen; CI (Unit-, Integrations-, Lokalisierungstest, VSIX-Prüfung) muss für den Commit grün sein
      (neue Findings-Korrekturen und Abnahmetests sind lokal geprüft; Push und CI-Freigabe stehen noch aus)
- [x] Screenshot `media/preview.png` (Designer mit Gliederung und Berichtsdaten) erstellt und im README eingebunden;
      auch für die Release-Seite verwendbar
- [x] Lokalen Release-Dry-Run ausführen: `npm run publish:github -- --dry-run` (18.10.2026: Typecheck, 143/143 Tests und VSIX-Prüfung grün; nichts veröffentlicht)
- [x] Remote-Fenster (WSL/SSH/Dev Container): Update-Installation prüfen (VSIX liegt im temporären Ordner des Extension-Hosts)
- [x] Eingeschränkter Modus: `limited` mit Beschreibung, explizite Vertrauensprüfung vor AL-Befehlen und
      BC-Metadatenabruf; echter Restricted-Mode-Test grün (`npm run test:vscode:untrusted`), Entwurf/Vorschau verfügbar

## Absichern (vor einer Veröffentlichung)
- [x] KI-Werkzeuge mit Copilot im Agentenmodus an echten Aufgaben abnehmen (neuer Bericht aus AL-Report, Gruppen/Summen,
      Diagramm, Labels, Build); prüfen, ob das Modell XML- und Werkzeugweg wie beschrieben wählt, und die
      `modelDescription`s danach nachschärfen
      (Rechnungsanlage mit echtem Copilot und AL-Build sowie Anpassung eines bestehenden Reports bestanden;
      Speicher-/Projektwurzel-/Sprachbefunde behoben, Summen und beide Vorschauseiten unabhängig geprüft.
      162/162 Unit-Tests, 58/58 Integrationstests je Sprache; [Copilot-Protokoll](docs/RELEASE-TEST-2026-10-21-COPILOT.md).
      Repräsentative Aufgaben mit Copilot Auto; keine Abnahme aller Modelle oder beliebiger XML-Konstruktionen.)
- [ ] Verbleibende plattform-/betrachterspezifische Abnahme aus `docs/ABNAHME.md`; lokale Windows-Fälle einschließlich
      Acrobat, Baustein-Konflikten und kombinierter Vorschau-Umbrüche automatisiert/nativ geprüft;
      die konkrete Windows-Checkliste ist vollständig abgehakt, Screenreader und weitere Plattformen bleiben offen
- [x] Repräsentative komplexe Filter-/Drilldown-Kombination prüfen: Zahlenfilter + Like + Top-N in zwei Belegen,
      getrenntes Auf-/Zuklappen, interaktive Sortierung und erhaltene Belegzustände; Enter/Leertaste geprüft.
      Verschachtelte Spaltengruppen, berechnete Reihen/Punktfarben, Bookmark-Seitensprung und Drillthrough-Parameter zuvor geprüft.
- [ ] Tatsächliche Drillthrough-Servernavigation in einer passenden Reporting-Server-Umgebung prüfen.
      Die lokale Vorschau zeigt absichtlich Ziel und ausgewertete Parameter als Hinweis; sie führt keinen Zielreport aus.
- [x] NVDA unter Windows für Diagrammdialog, Validierungsansage, Ausdruckssuche/Trefferansage und Fokus-Rückkehr
      nativ prüfen. Gefundene Tastaturprobleme bei Diagrammtypen und Vorschau-Schaltern behoben; portable NVDA-Kopie,
      separate Testprofile und protokollierte Ansagen, siehe Absicherungsprotokoll.
- [ ] Reine Tastaturbedienung sämtlicher Dialogvarianten mit VoiceOver prüfen; vollständiger NVDA-Durchgang über
      alle Varianten bleibt zusätzlich offen. Die geprüften NVDA-Fälle sind keine vollständige Screenreader-Abnahme.
- [x] Weitere repräsentative Gestaltungs-/Drag-Varianten prüfen: vier Ziehrichtungen bei 50/100/200 %, Raster an/aus,
      Alt ohne Raster und verschachtelter Container; Georgia/Fett/Kursiv/gestrichelter Rahmen sowie N2/C2/P1 in deutscher Vorschau.
      Native RGB-Farbauswahl, gültige PNG, großes SVG und Ablehnung defekter/abgeschnittener Bilder zuvor geprüft.
- [x] Kopieren/Einfügen zwischen mehreren geöffneten Berichten behoben und nativ im installierten VSIX nachgeprüft;
      Bilder/Code/interne Verweise, Konfliktabbruch und gemeinsames Undo zusätzlich integrationsgetestet
- [x] Mehrdatei-Rückgängig von Hand prüfen: *Als AL-Label anlegen* und *Spalte umbenennen* unter Windows nativ
      bytegenau rückgängig gemacht; Spalten-Undo am 21.10. auch aus dem AL-Editor mit zuvor geschlossenen Designern geprüft.
      VS Code zeigt die Mehrdatei-Rückfrage nur unter bestimmten Bedingungen; in diesen Abläufen erschien keine.
      Bestätigen/Abbrechen einer tatsächlich angezeigten Rückfrage ist damit nicht geprüft, aber kein erforderlicher
      zusätzlicher Handgriff für die hier abgenommenen Abläufe.
- [x] Symbolpakete gegen eine echte Base Application (`.alpackages/*.app`) prüfen – BC 29 on-prem, *Felder als Spalten
  hinzufügen* mit „Sales Invoice Line“ (Windows-Abnahme 20.10.)
- [ ] „Report in Business Central ausführen“ gegen echte Umgebungen prüfen (Cloud-Sandbox, Docker; On-Prem mit
  Windows-Anmeldung geprüft)


## Erledigt
- [x] Weitere Absicherung am 21.10.: drei Tastaturbefunde behoben, native NVDA-Ansagen geprüft,
      zusätzliche Filter-/Drilldown-/Sortier- und Gestaltungs-/Drag-Kombinationen abgenommen; Typecheck,
      161/161 Unit-Tests, 55/55 Integrationstests je Sprache und finales VSIX grün. Nachweise im Absicherungsprotokoll.
- [x] Acrobat-Abnahme mit Windows MCP: Schrift-Einbettung, Umlaute/Sonderzeichen, Logo und zwei A4-Seiten geprüft;
      Schriftfamilien-Aliase im PDF-Export korrigiert (Segoe UI Light), Regressionstests und installiertes VSIX geprüft.
      Typecheck, 161/161 Unit-Tests und 52/52 Integrationstests je Sprache grün; Details im Acrobat-Protokoll.
- [x] Findings-Korrekturen mit erweiterter Abnahme: Ausdruckssuche (Stile/Gruppen, Einzel-/Sammelersetzung, Undo/Redo),
      Bausteinbibliothek mit Logo und Profilwechsel, Konflikte, fehlende Abhängigkeiten, neue Kopfbereiche und Undo,
      kombinierte Gruppen-/Containerumbrüche, lange Texte/Schriften und sofortiger PDF-Export. Nachweise im Fix-Protokoll.
- [x] PDF-Export beim Wechsel der Vorschaudaten: alte Messwerte verwerfen und Export bis zur neuen Vermessung vormerken;
      neuer Regressionstest mit 120 Datenzeilen und PDF-/Vorschau-Seitenvergleich
- [x] Nachprüfung 20.10.: native Baustein-Ersetzen-Rückfrage (Abbrechen/Bestätigen), RGB-Farbauswahl und gemeinsames
      AL-Label-Undo aus Designer/AL-Editor; neue Webview-Tests für sechs berechnete Diagrammreihen, Punktfarben,
      Bookmark-Auflösung und Drillthrough-Hinweis. Keine vollständige Abnahme aller Navigations-/Undo-Varianten.
- [x] Windows-Abnahme (20.10.2026): 41/41 Integrationstests auf Englisch und mit deutschem VS Code, natives Durchklicken mit
      echter Maus/Tastatur (AltGr, Zwischenablage, Kontextmenüs, Drag-and-drop, native Dialoge, Pfade mit Umlauten/`&`, CRLF);
      neun Fehler behoben, Details im Windows-Protokoll
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
