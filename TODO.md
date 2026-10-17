# TODO

Was zur vollständigen Anwendung noch fehlt – nach Priorität.

## Absichern (vor einer Veröffentlichung)
- [ ] Neue Dialoge und Abläufe in VS Code von Hand durchgehen: Gruppe, Matrix, Diagramm, Textteile, native Kontextmenüs,
      Felder in Listen-Rechtecke ziehen
- [ ] „Als AL-Label anlegen“ und „Felder als Spalten hinzufügen“ mit Eingabefeld/Auswahlliste testen (nur die AL-Textänderungen
      haben Unit-Tests)
- [ ] Symbolpakete gegen eine echte Base Application (`.alpackages/*.app`) prüfen – getestet nur mit selbst gebautem Paket
- [ ] „Report in Business Central ausführen“ gegen echte Umgebungen prüfen (Cloud-Sandbox, Docker, On-Prem)
- [ ] Excel-/Word-Export in Microsoft Excel und Word öffnen (geprüft nur mit openpyxl bzw. macOS `textutil`)
- [ ] Integrationstests unter Last stabil machen: zwei Tests liefen direkt nach dem Korpus-Test in Zeitüberschreitungen
- [ ] UI-Tests für die Webview (Dialoge, Symbolleiste, Zeilen/Gruppen-Befehle) – bisher nur Logik und Nachrichten getestet

## Funktionen
- [ ] Spaltengruppe zu einer bestehenden Tabelle hinzufügen/löschen (heute nur über „Matrix einfügen“); Eigenschaften
      einzelner Spalten (Ausblenden, Umschalten)
- [ ] RowSpan im Tabellenkörper bearbeiten (Zeilen verbinden)
- [ ] Aktionen an Textfeldern/Bildern: Hyperlink, Drillthrough, Lesezeichen (werden heute nur unverändert erhalten)
- [ ] Eingebettete Bilder verwalten (hinzufügen, umbenennen, löschen; z. B. Firmenlogo) – heute nur Anzeige
- [ ] Diagramme: Achsen (Titel, Format, Min/Max), Datenbeschriftungen, Sekundärachse, weitere Typen
- [ ] Messgerät und Karte darstellen (heute Platzhalter); Unterberichte in der Vorschau ausführen
- [ ] `<Code>`-Interpreter: `For`/`While`-Schleifen und `Select Case`
- [ ] Rich-Text-Textfeld in ein einfaches Textfeld umwandeln und umgekehrt
- [ ] Vorschau-Export als PDF direkt (heute über Druckdialog des Browsers)
- [ ] Word-/Excel-Layouts von BC (`.docx`/`.xlsx`) – bewusst nicht unterstützt, ggf. Hinweis im Designer

## Business Central
- [ ] Spalte umbenennen in AL und allen Layouts gleichzeitig (Refactoring)
- [ ] Mehrere Layouts eines Reports (`rendering`) im Designer wechseln
- [ ] Mehrsprachigkeit: Labels mit `Comment`/`MaxLength` anlegen, XLIFF-Hinweise
- [ ] Rückgängig über AL- und Layout-Änderung gemeinsam (heute zwei getrennte Schritte)

## Projekt und Veröffentlichung
- [ ] Git-Repository anlegen, `repository`-Feld in `package.json`
- [ ] `LICENSE` (package.json nennt MIT; Rechteinhaber festlegen)
- [ ] CI: Typecheck, Unit-Tests, Integrationstests (xvfb), Korpus-Test nächtlich
- [ ] Oberfläche lokalisieren (`vscode-l10n`, `package.nls.json`) – heute nur Deutsch
- [ ] Barrierefreiheit prüfen: Tastaturbedienung der Entwurfsfläche, Screenreader-Labels, hoher Kontrast
- [ ] README mit Screenshots/GIFs, CHANGELOG, Marketplace-Veröffentlichung
- [ ] Bekannte Restabweichung im Korpus: `<Visibility></Visibility>` wird als `<Visibility />` geschrieben (1 Layout, 1 Zeile)
