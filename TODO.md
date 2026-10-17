# TODO

Was zur vollständigen Anwendung noch fehlt – nach Priorität. Erledigtes steht abgehakt darunter.

## Absichern (vor einer Veröffentlichung) – braucht Hand und echte Umgebungen
- [ ] Neue Dialoge und Abläufe in VS Code von Hand durchgehen: Gruppe, Spaltengruppe, Matrix, Diagramm (Achsen, zweite Achse,
      Kombi), Textteile aufteilen/zusammenfassen, Aktionen, eingebettete Bilder, Layouts wechseln, native Kontextmenüs,
      Felder in Listen-Rechtecke ziehen, Tastaturbedienung mit Screenreader (VoiceOver/NVDA)
- [ ] Oberfläche auf Englisch von Hand durchsehen (Texte, Platz in Dialogen und Bereichen)
- [ ] Mehrdatei-Rückgängig von Hand prüfen: *Als AL-Label anlegen* und *Spalte umbenennen* (VS Code fragt „in allen Dateien?“)
- [ ] Symbolpakete gegen eine echte Base Application (`.alpackages/*.app`) prüfen – getestet nur mit selbst gebautem Paket
- [ ] „Report in Business Central ausführen“ gegen echte Umgebungen prüfen (Cloud-Sandbox, Docker, On-Prem)
- [ ] Excel-/Word-/PDF-Export in Microsoft Excel, Word und Acrobat öffnen (geprüft mit openpyxl, `textutil`, pdf-lib, Quick Look)
- [ ] UI-Tests für Dialoge in der Webview (Klicks im DOM) – Befehlswege, Vorschau, PDF und Lokalisierung sind integrationsgetestet

## Funktionen
- [ ] Karte darstellen (räumliche Daten) und Unterberichte in der Vorschau ausführen – in BC-RDLC-Layouts nicht verwendet
- [ ] Spaltengruppen auch für Tabellen mit vorhandenen Spaltenköpfen (heute: „Matrix einfügen“)
- [ ] Diagramme: Trendlinien, Spezialtypen (Trichter, Bereich, Polar), Formatierung einzelner Datenpunkte
- [ ] `<Code>`-Interpreter: `Try`/`Catch`, `With`, Arrays mit Index-Zuweisung
- [ ] PDF-Export: eingebettete TrueType-Schriften (heute PDF-Standardschriften, nur WinAnsi-Zeichen)
- [ ] Weitere Sprachen der Oberfläche (heute Englisch und Deutsch)

## Projekt und Veröffentlichung
- [ ] `repository`-Feld in `package.json`, sobald es ein Remote-Repository gibt
- [ ] README mit Screenshots/GIFs; Marketplace-Veröffentlichung (Publisher-Konto, Token)

## Erledigt
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
