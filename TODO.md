# TODO

Was zur vollständigen Anwendung noch fehlt – nach Priorität.

## Absichern (vor einer Veröffentlichung) – braucht Hand und echte Umgebungen
- [ ] Neue Dialoge und Abläufe in VS Code von Hand durchgehen: Gruppe, Spaltengruppe, Matrix, Diagramm (Achsen, zweite Achse,
      Kombi), Textteile aufteilen/zusammenfassen, Aktionen, eingebettete Bilder, Layouts wechseln, native Kontextmenüs,
      Felder in Listen-Rechtecke ziehen, Tastaturbedienung mit Screenreader (VoiceOver/NVDA)
- [ ] Mehrdatei-Rückgängig von Hand prüfen: *Als AL-Label anlegen* und *Spalte umbenennen* (VS Code fragt „in allen Dateien?“)
- [ ] Symbolpakete gegen eine echte Base Application (`.alpackages/*.app`) prüfen – getestet nur mit selbst gebautem Paket
- [ ] „Report in Business Central ausführen“ gegen echte Umgebungen prüfen (Cloud-Sandbox, Docker, On-Prem)
- [ ] Excel-/Word-/PDF-Export in Microsoft Excel, Word und Acrobat öffnen (geprüft mit openpyxl, `textutil`, pdf-lib, Quick Look)
- [ ] UI-Tests für Dialoge in der Webview (Klicks im DOM) – Befehlswege, Vorschau und PDF sind integrationsgetestet

## Funktionen
- [ ] Karte darstellen (räumliche Daten) und Unterberichte in der Vorschau ausführen – in BC-RDLC-Layouts nicht verwendet
- [ ] Spaltengruppen auch für Tabellen mit vorhandenen Spaltenköpfen (heute: „Matrix einfügen“)
- [ ] Diagramme: Trendlinien, Spezialtypen (Trichter, Bereich, Polar), Formatierung einzelner Datenpunkte
- [ ] `<Code>`-Interpreter: `Try`/`Catch`, `With`, Arrays mit Index-Zuweisung
- [ ] PDF-Export: eingebettete TrueType-Schriften (heute PDF-Standardschriften, nur WinAnsi-Zeichen)
- [x] ~~RowSpan im Tabellenkörper~~ – entfällt: RDL erlaubt `RowSpan` nur in der Tablix-Ecke (Report Builder: „Im
      Tabellenkörper können Zellen nur horizontal verbunden werden“)

## Projekt und Veröffentlichung
- [ ] `repository`-Feld in `package.json`, sobald es ein Remote-Repository gibt
- [ ] Oberfläche lokalisieren (`vscode-l10n`, `package.nls.json`) – heute nur Deutsch
- [ ] README mit Screenshots/GIFs; Marketplace-Veröffentlichung (Publisher-Konto, Token)
