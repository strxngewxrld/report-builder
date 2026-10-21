# Weitere Absicherung am 21.10.2026

[English](RELEASE-TEST-2026-10-21-ABSICHERN.md) | Deutsch

## Lokale Abnahmefälle

Die offenen Sammelpunkte aus TODO.md wurden in konkrete lokale Prüfungen und verbleibende externe Voraussetzungen
aufgeteilt. Die geprüften Fälle müssen nicht noch einmal von Hand wiederholt werden. Die Ergebnisse ergänzen die
[Windows-Abnahme](RELEASE-TEST-2026-10-20-FIXES.de.md) und die [Acrobat-Abnahme](RELEASE-TEST-2026-10-21-ACROBAT.de.md).

### Filter, Drilldown und interaktive Sortierung

Im echten VS-Code-Webview wird eine BC-Rechnung mit zwei Belegen und je vier unterschiedlichen Positionen geöffnet.
Ein Zahlenfilter `>= 100`, ein `Like Keep*` und anschließend `TopN = 1` wirken gemeinsam in der verschachtelten
Positionstabelle. Erwartet ist je Beleg nur die größte passende Position; eine größere, aber nicht passende Position
darf nicht gewinnen. Die vorhandene Detailgruppenfilterung bleibt zusätzlich aktiv.

Die Positionstabellen beginnen eingeklappt. Beleg A per Enter öffnen, B öffnen, A per Leertaste schließen:
Die Belege behalten getrennte Zustände. Interaktive Sortierung per Enter/Leertaste wechselt bis absteigend;
der aufgeklappte Beleg B bleibt derselbe. Die Layoutdatei wird dabei nicht geändert.

### Gestaltung und Ziehen

Der neue Webview-Test erzeugt ein Rechteck in allen vier Ziehrichtungen, jeweils bei 50, 100 und 200 % Zoom.
Größe und normalisierte Position werden aus dem tatsächlich geänderten RDL gelesen; jeder Schritt wird bytegenau
rückgängig gemacht. Ein Textfeld innerhalb eines Rechtecks wird mit Raster, mit Alt ohne Raster und mit ausgeschaltetem
Raster verschoben. Der übergeordnete Container bleibt stehen, Gestaltung und Format bleiben erhalten.

Die Vorschau prüft zusätzlich Georgia mit 14 pt/Fett/Kursiv und gestricheltem Rahmen sowie Consolas/Arial mit weiteren
Rahmenvarianten. Deutsche Zahlenformate N2, C2 und P1 ergeben `1.234,50`, `1.234,50 €` und `12,5 %`.
Schrift und Rahmen werden am tatsächlich gerenderten DOM geprüft; die Schrift liegt entsprechend RDL im TextRun,
der Rahmen am Textfeld. Das sind repräsentative zusätzliche Kombinationen, keine erschöpfende Kombination aller Stile.

Die dafür ergänzten Aktionen des DOM-Testtreibers sind nur im ausdrücklich aktivierten Test-Webview verfügbar.
Die vorhandene Drag-Prüfung wartet nun auch auf die asynchron aufgebaute Quelle, bevor sie den Drop auslöst.

## NVDA: tatsächlich ausgeführte Tastaturprüfung

NVDA **2026.2 AMD64** wurde von NV Access heruntergeladen, die Authenticode-Signatur war gültig
(NV Access Limited). Die portable Kopie liegt ausschließlich unter `artifacts/qa-absichern/nvda-portable/`,
mit eigenem Konfigurationsverzeichnis. Kein Autostart und keine systemweite Installation wurden eingerichtet.
Grundlage für den portablen Start und die Protokollierung ist das
[offizielle NVDA-Handbuch](https://api.nvaccess.org/documentation/userGuide.html).

Die abschließende native Sitzung verwendete eSpeak NG und deutsche NVDA-Ausgaben, VS Code mit englischer Oberfläche
und ein isoliertes Profil mit installiertem VSIX. Echte Tasten wurden über Windows MCP gesendet; die tatsächlich von
NVDA erzeugten Ansagen wurden im Debugprotokoll ausgewertet. Das ist keine subjektive Hör-/Verständlichkeitsbewertung.

| Fall | Beobachtete NVDA-Ausgabe / Ergebnis |
| --- | --- |
| Diagrammdialog öffnen | „Insert Chart“, Dialogfeld; Diagrammtypen als Auswahlschalter |
| Tab zur Typauswahl, Pfeil rechts | „Stacked column“, Auswahlschalter, **aktiviert**, 2 von 19 |
| Ein weiteres Tab | „Name“, Eingabefeld; kein Durchlaufen aller 19 Typen mehr erforderlich |
| Namen leeren | „Invalid name“ wird angesagt; Einfügen gesperrt |
| Weitere Felder per Tab | Dataset, Feldauswahl, Reihentyp und Kontrollfeld werden benannt |
| Escape | Fokus auf „Design surface of the report“, einschließlich Tastaturhilfe |
| Ausdruckssuche | Dialog und Find/Replace-Eingaben werden benannt; Eingabe „Umsatz“ meldet „6 matching expressions“ |

### Behobene Tastaturbefunde

1. Diagrammtypen hatten `role="radio"`, reagierten aber nicht auf Pfeiltasten und belegten jeweils einen Tabstopp.
   Jetzt gibt es einen Tabstopp für die Auswahl; Pfeile wählen zyklisch, Home/End wählen Anfang/Ende.
   Der Fokus folgt der Auswahl. Die Fokusbegrenzung des Dialogs berücksichtigt negative Tabindizes.
2. Die gemeinsame Modal-Validierung hatte keine Live-Ansage. Fehler tragen jetzt `role="alert"`;
   die tatsächliche NVDA-Ansage wurde nativ nachgeprüft.
3. Drilldown-/Sortierschalter in der Vorschau waren ausschließlich klickbare Spans.
   Sie haben jetzt Button-Semantik, Tastaturfokus und Enter-/Leertastenbedienung. Drilldown meldet `aria-expanded`.
   Diese Vorschaukorrektur ist im realen Webview automatisiert geprüft; sie ist kein zusätzlicher nativer NVDA-Durchgang.

Ein neuer Integrationstest prüft Pfeile einschließlich Umlauf, Home/End, genau einen Tabstopp, Validierungsansage und
unverändertes Dokument nach Escape. Die portable NVDA-Sitzung wurde nach der Prüfung wieder beendet.

## Mehrdatei-Undo

Zusätzlich zu den vorherigen nativen Label-/Spaltenprüfungen wurden diesmal alle Designer geschlossen und die Spalte
`No_SalesInvHdr` direkt im AL-Texteditor in `QaNativeDocumentNo` umbenannt. Die native Erfolgsmeldung bestätigt
AL und ein Layout mit sechs Stellen. Ein Undo und anschließendes Speichern stellen beide Ausgangsdateien bytegenau
wieder her; Nachweis `native-undo.json`.

Eine Mehrdatei-Rückfrage erschien nicht. Der installierte VS-Code-Code zeigt die Auswahl „alle Dateien/diese Datei“
nur bei aufteilbaren Workspace-Undo-Elementen außerhalb einer gemeinsamen Undo-Gruppe. Eine Rückfrage ist daher keine
zugesicherte Eigenschaft jedes Mehrdatei-Undo. Bestätigen/Abbrechen einer tatsächlich auftretenden Rückfrage wird hier
ausdrücklich nicht als geprüft behauptet; die normalen Produktabläufe sind nativ abgenommen.

## Nachweise und Prüfläufe

Typecheck und **161/161 Unit-Tests** sind grün. Die drei neuen Absicherungsfälle bestehen gezielt auf Englisch
und Deutsch (**3/3 je Sprache**). Die abschließenden vollständigen Läufe bestehen mit **55/55 Englisch** und
**55/55 Deutsch**, jeweils ohne Wiederholungsversuch (`final-en.log`, `final-de.log`).
Bei der Entwicklung der Prüfungen wurden falsche Testselektoren korrigiert (Seitencontainer, Zoom-Nachricht,
Schrift am TextRun statt am umgebenden Textfeld); diese anfänglichen Aufbauläufe sind nicht die abschließenden Nachweise.

Artefakte unter `artifacts/qa-absichern/`:

- `nvda.log`: ursprünglicher Tastaturbefund; `nvda-after.log` und `nvda-speech-transcript.txt`: native Nachprüfung.
- `nvda-chart-validation.png`: Diagrammdialog mit der geprüften Validierung.
- `native-undo.json`, `undo-before.al`, `undo-before.rdlc`: Bytevergleich der nativen Rücknahme.
- `unit.log`, `targeted-final-en.log`, `targeted-final-de.log`, `final-en.log`, `final-de.log`: abschließende Prüfungen.
- `package.log`, `install.log`: Paketprüfung und Installation im isolierten Profil.

Finales VSIX: `artifacts/bc-report-builder-1.0.0.vsix`, Paketprüfung einschließlich Aktivierung erfolgreich
(93 Befehle, 14 Sprachmodell-Werkzeuge), Installation im separaten QA-Profil erfolgreich.
SHA-256: `B9A2AF398ABCDA110091E032FE2B1380BC986C08732816E125AC008629EEB7EF`.
Dieses Artefakt ersetzt das im Acrobat-Protokoll genannte Paket. Die nativ geprüften Produktkorrekturen sind enthalten;
nach der nativen Prüfung kamen nur Testtreiber-/Test- und Dokumentationsergänzungen hinzu.

## Weiterhin offen

- Copilot-Aufgaben mit echten Modellentscheidungen: keine angemeldete Sitzung bzw. kein verfügbares Modell in den
  geprüften Profilen; native Oberfläche bietet „Sign In“, die Testlogs melden keine angemeldete Sitzung.
  Werkzeugaufrufe selbst sind integrationsgetestet. `modelDescription`s wurden ohne Modellbeobachtung nicht spekulativ geändert.
- Cloud-Sandbox/Docker: keine bereitgestellten Ziele; Docker ist hier nicht installiert. Die bestehende BC-29-on-prem-
  Abnahme bleibt gültig. Eine neue Server-/Containerinstallation ist für diese Nachprüfung nicht erfolgt.
- Reale Drillthrough-Ausführung: lokale Vorschau bietet laut Implementierung nur Ziel-/Parameterhinweis.
  Eine Reporting-Server-Umgebung mit passendem Zielbericht fehlt; ein BC-Webclient allein belegt diese Funktion nicht.
- VoiceOver benötigt macOS. Auch unter NVDA sind noch nicht sämtliche Dialogvarianten vollständig geprüft.
  Die oben genannten konkreten Windows-Ansagen sind erledigt; die umfassende Screenreader-Abnahme bleibt offen.
- Erschöpfende Kombinationen aller Gestaltungs-, Container- und Interaktionsvarianten sind durch repräsentative Tests
  nicht bewiesen. Die konkret aufgeführten zusätzlichen lokalen Varianten sind abgenommen.

Keine Commits, Pushes oder Veröffentlichungen in dieser Runde.
