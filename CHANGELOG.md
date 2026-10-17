# Änderungsprotokoll

Alle nennenswerten Änderungen an der Erweiterung. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt
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
- Leere Elemente, die das Layout als `<X></X>` schreibt (z. B. `<Visibility></Visibility>`), werden nicht mehr als
  `<X />` gespeichert – alle 379 Base-App-Layouts bleiben auch bei kompletter Neuerzeugung zeichengleich

## [0.1.0] – 2026-10-17

Erste Fassung: visueller RDLC-Designer mit Dokumentgliederung, AL-Report als Datenquelle, Bearbeiten des AL-Reports
aus dem Designer, Prüfung im Problembereich, paginierte Vorschau mit `<Code>`-Interpreter, Tabellen/Gruppen/Listen/
Matrizen/Diagramme, quellerhaltendes Speichern sowie Excel-/Word-/HTML-Export der Vorschau.
