# Änderungsprotokoll

Alle nennenswerten Änderungen an der Erweiterung. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [1.0.0] - 2026-10-18

### Hinzugefügt
- **Updates**: Beim Start sucht die Erweiterung in den GitHub Releases nach einer neueren Version und bietet an, sie direkt
  zu installieren (VSIX mit geprüfter SHA-256-Prüfsumme), den Release zu öffnen oder die Version zu überspringen
  (Einstellung `bcReportBuilder.checkForUpdates`)
- Veröffentlichung als GitHub Release (`npm run publish:github`, mit Probelauf), Prüfung der fertigen VSIX und
  `THIRD_PARTY_NOTICES.md` mit den Lizenzen der gebündelten Pakete
- **Ausdrücke und Verwendungen**: Suchen/Ersetzen mit Vorher/Nachher, Einzel-/Sammelersetzung und Syntaxprüfung;
  Verwendungsübersicht für Felder und AL-Labels mit Sprung ins Layout, auch für Gruppen, Stile und erhaltene XML-Bereiche
- **Layout-Bausteine**: Auswahl in der profilweiten Bibliothek speichern oder als RDLC exportieren, in anderen Reports
  mit Abschnitt-/Positionsauswahl einfügen; eindeutige Namen, angepasste interne Verweise, eingebettete Bilder und
  Berichtscode, Prüfung fehlender Abhängigkeiten und Vermeidung von Code-/Bildkonflikten
- DOM-Integrationstests für die Ausdruckssuche und den Bausteinimport einschließlich Rückgängig;
  manueller Abnahmeplan unter `docs/ABNAHME.md`
- **PDF-Export mit eingebetteten Schriften**: die installierten TrueType-/OpenType-Schriften des Berichts (auch aus
  `.ttc`-Sammlungen) werden als Teilmenge eingebettet – alle Unicode-Zeichen der Schrift statt nur WinAnsi; Schriften
  ohne Einbettungsrecht und fehlende Schriften fallen auf die PDF-Standardschriften zurück
- **Diagramme**: Trichter, Pyramide, Bereich, Bereichssäulen/-balken (oberer und unterer Wert), Polar und Netz;
  berechnete Reihen (gleitender, exponentieller, gewichteter und dreieckiger Durchschnitt, Mittelwert, Median) als
  gestrichelte Linie; Farbe der Datenpunkte (auch als Ausdruck je Punkt) und Markierungen
- **Spaltengruppen auch bei vorhandenen Spaltenköpfen**: weitere Spaltengruppen in Tabellen mit Spaltengruppe und
  Elterngruppen um die Spaltengruppe einer Matrix; die Ecke wächst und schrumpft mit den Kopfebenen
- `<Code>`-Block: `Try`/`Catch` (mit `When`)/`Finally`, `Throw`, `Exit Try`, `With`/`End With`, Arrays (`Dim a(5)`,
  `{…}`-Initialisierung, mehrere Dimensionen, `ReDim [Preserve]`, `a(i) = x`, `UBound`/`LBound`, `Array.IndexOf/Sort/Reverse`),
  mehrere Variablen in einem `Dim`; nicht initialisierte Zahlen sind 0 und Wahrheitswerte `False`
- **Englische Oberfläche**: Die Erweiterung folgt der Anzeigesprache von VS Code (Englisch und Deutsch) – Befehle, Menüs,
  Einstellungen, Meldungen, Prüfungen, Designer, Dialoge und Vorschau
- **PDF-Export** direkt aus der Vorschau (`pdf-lib`): Text, Rahmen und Hintergründe als Vektoren, Bilder und Diagramme eingebettet
- **Diagramme**: Achsen (Titel, Zahlenformat, Minimum/Maximum), Datenbeschriftungen, zweite Werteachse, Typ je Reihe
  (Kombidiagramm), neue Typen Säulen 100 %, Linie geglättet, Fläche gestapelt, Punkte
- **Messgeräte** (GaugePanel, rund und linear) in Vorschau und Designer statt Platzhalter
- **Spaltengruppen** zu bestehenden Tabellen hinzufügen und löschen; Spalteneigenschaften *Ausblenden* und *Umschalten durch*
- **Aktionen** an Textfeldern und Bildern (Hyperlink, Lesezeichen-Link, Drillthrough mit Parametern) und Lesezeichen;
  in der Vorschau anklickbar
- **Eingebettete Bilder** verwalten: einbetten, umbenennen (mit Anpassung der Bildelemente), löschen, auf die Fläche ziehen
- Textfeld **in Textteile aufteilen** und Textteile **zu einem einfachen Textfeld zusammenfassen**
- **Spalte umbenennen** in AL und allen RDLC-Layouts des Reports und seiner Report-Extensions (ein Rückgängig-Schritt)
- **Layouts des Reports** in *Berichtsdaten*: zwischen RDLC-Layouts wechseln, Word-/Excel-Layouts extern öffnen
- **Labels** mit `Comment`, `MaxLength` und `Locked` anlegen; Hinweise zu XLIFF-Übersetzungsdateien
- `<Code>`-Block in der Vorschau: `For`/`Next` (mit `Step`), `For Each`, `While`/`End While`, `Do`…`Loop`
  (`While`/`Until` vorn oder hinten), `Select Case` (Werte, Bereiche mit `To`, `Is <op>`, `Case Else`),
  `Exit`/`Continue For|Do|While`, Zuweisungen mit `*=` und `/=`
- **Barrierefreiheit**: Tab-Navigation, Größe per Alt+Pfeiltasten und Bearbeiten per Eingabe/F2 auf der Entwurfsfläche,
  Screenreader-Beschriftungen und -Ansagen, Hervorhebungen in Hochkontrast-Designs
- CI-Workflow (Typecheck, Unit-, Integrations-, Korpus-Test), `LICENSE`, dieses Änderungsprotokoll

### Geändert
- *Als AL-Label anlegen* ändert Label und Textfeld in einem Bearbeitungsschritt – ein Rückgängig nimmt beides zurück
- Integrationstests: Zeitlimits über `BC_RB_TIMEOUT_SCALE` skalierbar, ein zweiter Versuch je Test, Warten auf das
  Schließen des vorherigen Designers; neue Tests für Label, Spalten, Umbenennen, Layouts, PDF und Tabellenbefehle

### Behoben
- Vorschau: Umbrüche vor/nach Rechtecken und Datenbereichen; Gruppen-Umbrüche „Am Ende“ auch nach der letzten Instanz,
  ausdrucksgesteuertes `Disabled` und `ResetPageNumber`; zusammenfallende Umbrüche behalten den Seitenzahl-Neustart
- Vorschau und PDF-Export warten auf geladene Schriften, bevor Seiten vermessen bzw. exportiert werden
- Die Diagrammlegende schnitt kurze Kategorienamen ab („J…“ statt „Jan“)
- Leere Elemente, die das Layout als `<X></X>` schreibt (z. B. `<Visibility></Visibility>`), werden nicht mehr als
  `<X />` gespeichert – alle 379 Base-App-Layouts bleiben auch bei kompletter Neuerzeugung zeichengleich

## [0.1.0] – 2026-10-17

Erste Fassung: visueller RDLC-Designer mit Dokumentgliederung, AL-Report als Datenquelle, Bearbeiten des AL-Reports
aus dem Designer, Prüfung im Problembereich, paginierte Vorschau mit `<Code>`-Interpreter, Tabellen/Gruppen/Listen/
Matrizen/Diagramme, quellerhaltendes Speichern sowie Excel-/Word-/HTML-Export der Vorschau.
