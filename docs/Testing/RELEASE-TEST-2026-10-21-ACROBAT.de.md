# Windows-MCP- und Acrobat-Abnahme am 21.10.2026

[English](RELEASE-TEST-2026-10-21-ACROBAT.md) | Deutsch

## Ergebnis

Die konkrete Windows-Checkliste in `ABNAHME.md` (historischer Verweis; im Checkout nicht vorhanden) ist vollständig erledigt.
Acrobat Reader 64 Bit **26.2.22031.0** wurde über den Windows-MCP mit echter Maus/Tastatur bedient.
Der beim Erststart angezeigte Adobe-Lizenzvertrag wurde nach ausdrücklicher Zustimmung des Benutzers akzeptiert.
Die Prüfung fand unter Windows Server 2025, VS Code 1.142.0 und aktivem RDP-Desktop 1620 × 952 statt.

## Gefundener und behobener Fehler

Im bisherigen Export erschien die Überschrift als „Umsatzbericht2026“, obwohl die Vorschau einen Abstand zeigte.
Die Schriftdatei für „Segoe UI Light“ führt „Segoe UI“ als typografische Familie und „Segoe UI Light“ als klassischen
Familiennamen. Der Fontindex berücksichtigte nur den bevorzugten Namen und wählte deshalb eine Ersatzschrift.
Deren andere Buchstabenbreiten überdeckten den Abstand zwischen den separat positionierten Wörtern.

`src/fonts.ts` indexiert jetzt beide Familiennamen einschließlich lokalisierter Namen. Die Auswahl der Schriftstärke,
Kursivschrift und die Prüfung der Einbettungsrechte bleiben erhalten. Ein plattformunabhängiger Unit-Test verwendet
eine Schrift mit unterschiedlichen klassischen/typografischen Namen; ein Webview-Integrationstest kontrolliert die
tatsächlich eingebettete Segoe UI Light, wenn sie installiert ist.

## Native Acrobat-Prüfungen

- Umsatzbericht: korrekter Titelabstand, Arial normal/fett/kursiv, Segoe UI und Segoe UI Light.
  Acrobat zeigt alle verwendeten Schriften als „Eingebettet“, TrueType (CID), Identity-H.
- „Süd“, „Bergmann & Söhne“, „Größter Einzelumsatz“, Eurozeichen, Gedankenstrich und deutsche Zahlenformate
  sind lesbar. Kopieren des PDF-Textes erhält „Umsatzbericht 2026“ und die Sonderzeichen.
  Summe: Menge 116, Umsatz 37.523,40 €; hervorgehobener Einzelumsatz 12.400,00 €.
- Rechnungsbericht: beide A4-Seiten einzeln angezeigt, Seitennavigation funktioniert, PDF-Eigenschaften bestätigen
  zwei Seiten mit 210 × 297 mm, PDF 1.7. Die generierten Beispieldaten enthalten „Header 1“/„Header 2“;
  die RDL-Seitennummer wird je Beleg auf 1 zurückgesetzt. Kein Reparatur-/Formatfehlerdialog.
- Neues VSIX in einem weiteren isolierten Profil installiert, Umsatzbericht per Befehlsauswahl geöffnet,
  Vorschau angezeigt und über den echten Speicherdialog nach `installed-vsix.pdf` exportiert.
  In Acrobat erneut korrekten Titel, Umlaute, Farben, Tabelle, Summe und eingebettetes PNG-Logo kontrolliert.
  Das Logo überlappt in dieser übernommenen QA-Datei absichtlich den Tabellenkopf; dieselbe Position ist in der Vorschau sichtbar.

Nachweise unter `artifacts/qa-2026-10-21/` (lokale, nicht versionierte Testartefakte):

| Nachweis | Datei |
| --- | --- |
| Korrigierter Titel und Schriftliste | `acrobat-title-fixed.png`, `acrobat-fonts-fixed.png` |
| Mehrseitiger Bericht und Eigenschaften | `acrobat-page-1.png`, `acrobat-page-2.png`, `acrobat-properties.png` |
| Export aus installiertem Paket | `installed-vsix.pdf`, `acrobat-installed-vsix.png` |
| Kopierter Unicode-Text | `acrobat-extracted-text.txt` |
| Echte Webview-Exporte | `acrobat.pdf`, `acrobat-fonts.pdf` |

## Automatisierte Prüfungen und Paket

- Typecheck bestanden; **161/161 Unit-Tests** bestanden.
- **52/52 Integrationstests Englisch**, **52/52 Deutsch** bestanden.
  Der deutsche Drag-Test fand im ersten Versuch seine noch nicht vorhandene DOM-Quelle nicht und bestand beim
  vorgesehenen zweiten Versuch. Ein separater deutscher Nachlauf dieses Tests bestand anschließend sofort.
  Diese Wiederholung ist kein Nachweis vollständiger Flake-Freiheit.
- PDF-Export und neuer Schriftregressionstest zusätzlich separat **2/2** bestanden.
- VSIX gebaut, Paketprüfung einschließlich Aktivierung bestanden: 93 Befehle, 14 Sprachmodell-Werkzeuge.
- Installation des Pakets im separaten QA-Profil erfolgreich; natives Exportergebnis wie oben geprüft.

Logs: `unit.log`, `pdf-integration.log`, `integration-en.log`, `integration-de.log`, `drag-de-repeat.log`,
`package.log`, `install.log`. Prüfungen des eingeschränkten Modus aus dem vorherigen Fix-Protokoll wurden durch die
reine Schriftkorrektur nicht erneut ausgeführt.

Paket: `artifacts/bc-report-builder-1.0.0.vsix`, SHA-256
`13255A6E6C175E279DAAEA6A07B049B7C98C110AEE998FF437736C0BE8A5F9FD`.
Dieses Paket ersetzt das im vorherigen Protokoll genannte Artefakt.
Nach Ergänzung des Changelogs wurde das Paket erneut gebaut, geprüft und im selben isolierten Profil installiert;
der dabei unveränderte Produktcode wurde zuvor nativ geprüft.

## Verbleibende Grenzen

Für die hier abgeschlossene Acrobat-Prüfung ist keine manuelle Wiederholung nötig. Die offenen breiteren
Abnahmepunkte in TODO.md bleiben ausdrücklich offen:

- Copilot-Modellentscheidungen benötigen eine angemeldete Sitzung mit verfügbarem Modell; die isolierten Tests
  melden keine angemeldete Sitzung. Die Werkzeugaufrufe selbst sind integrationsgetestet.
- Cloud-Sandbox und Docker sind keine bereitgestellten BC-Testziele; die vorhandene on-prem-Abnahme bleibt gültig.
- NVDA ist nicht installiert; VoiceOver benötigt macOS. Ein Webview-Test ersetzt keinen Screenreader-Durchgang.
- Weitere Filter-/Drilldown-, Gestaltungs-/Drag- und plattformübergreifende Varianten sowie die nicht erschienenen
  Mehrdatei-Undo-Bestätigungsdialoge sind durch diese Acrobat-Runde nicht zusätzlich geprüft.
  Label- und Spalten-Undo sind bereits nativ bytegenau geprüft; eine künstlich erzeugte Rückfrage wäre kein Ersatz.
- Drillthrough in der lokalen Vorschau zeigt nach Implementierung einen Hinweis mit ausgewerteten Parametern;
  tatsächliches Ausführen des Zielreports gehört zur Reporting-Server-Umgebung und wurde hier nicht behauptet.

Die vom Benutzer inzwischen abgehakten Remote-/Commit-Punkte wurden in dieser Runde nicht erneut geprüft.
Es wurde kein Commit erstellt und nichts veröffentlicht.
