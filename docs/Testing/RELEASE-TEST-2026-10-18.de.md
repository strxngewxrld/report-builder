# Lokaler Release-Test am 18.10.2026

[English](RELEASE-TEST-2026-10-18.md) | Deutsch

## Umgebung und Umfang

macOS 15.7.5, VS Code 1.142.0, Node.js 24.22.0. Tests im echten Extension Development Host
mit isolierten Profilen und Kopien von `samples/`; Desktopbedienung über macOS MCP.
Die ursprünglichen Beispieldateien und das normale VS-Code-Profil wurden nicht bearbeitet.

## Befunde und Korrekturen

1. **Dialogfokus:** Der gemeinsame Dialograhmen übernahm den Fokus nicht zuverlässig und ließ
   Tab/Shift-Tab in die Oberfläche hinter dem Dialog wechseln. Er verwendet jetzt dieselbe
   Fokusbegrenzung und Fokusrückgabe wie Ausdruckssuche und Bausteinimport.
2. **Zwischenablage:** Die Dialoge stoppten sämtliche Tastaturereignisse. Dadurch erreichte
   Cmd+V den VS-Code-Webview-Host nicht; Einfügen in Ausdrucksfelder funktionierte nicht.
   Nur behandelte Escape-Ereignisse werden jetzt gestoppt. Mit echtem Cmd+V im Dev-Host
   reproduziert und nach der Änderung erfolgreich erneut geprüft.
3. **Englische Oberfläche:** Der Hilfetext der Gliederung war fest auf Deutsch geschrieben.
   Er und die PDF-Exportfehlermeldung werden jetzt übersetzt.
4. **Eigenschaften:** Bearbeitbare Diagramme und Rich-Text-Textfelder wurden im Kopf des
   Eigenschaftenbereichs als nicht editierbar bezeichnet. Dort steht jetzt der passende Typ.
5. **Leere formatierte Zellen:** Neue Gruppenzeilen zeigten für leere Werte `0`, `0,00 €`
   oder `dd.MM.yyyy`. Leere Zeichenfolgen bleiben beim Formatieren jetzt leer; numerische
   Nullwerte werden weiterhin formatiert. Regression für Zahlen-, Währungs- und Datumsformate.
6. **Hoher Kontrast:** Sekundäre Schaltflächen verwendeten bei fehlendem Theme-Hintergrund
   einen fest hellgrauen Ersatz zusammen mit weißer Theme-Schrift. Der Ersatz verwendet
   jetzt die Eingabe-/Vordergrundfarben des Themes; Abbrechen und zusätzliche Reihen bleiben lesbar.

## Automatische Prüfungen

- Typecheck erfolgreich.
- 142/142 Unit-Tests erfolgreich, einschließlich Lokalisierung, Parser/Serializer, Tabellen,
  Gruppen/Matrix, Diagramme, Ausdrücke, Bausteine, Bilder, Schriften, Exporte und Publishing-Helfer.
- 23/23 Integrationstests im echten VS-Code-Host erfolgreich. Zwei neue Tests prüfen
  Dialogfokus, Tab/Shift-Tab, Escape, unveränderte Dokumente beim Abbrechen sowie Eingabe,
  Validierung, Einfügen und Vorschau von Diagramm und Matrix. Vorhandene Dialogtests prüfen
  zusätzlich die Weitergabe von Zwischenablage-Tastenkürzeln an den Webview-Host.
- Deutsch: 3/3 zusätzliche Integrationstests für Lokalisierung, Fokus/Tastenkürzel und
  Diagramm-/Matrixdialog erfolgreich. Zahlenformatierung und Lokalisierung außerdem gezielt
  erneut geprüft: 13/13 Tests erfolgreich.
- Korpus aus `microsoft/BCApps`: 379/379 Layouts unverändert **und vollständig neu erzeugt**
  zeichengleich. Keine Probleme im Korpustest. 45.086 bearbeitbare Elemente; 73 Elemente
  werden unverändert durchgereicht. Elf bereits im Microsoft-Korpus veraltete Layout-Datasets
  und Auswertungsmeldungen zu generierten Beispieldaten sind im Testprotokoll ausgewiesen.
- Frisches VSIX gebaut und geprüft: 15 Extension-Dateien, 93 Befehle, ein Custom Editor;
  Aktivierung des Pakets gegen die Prüf-API erfolgreich. Das ist keine Marketplace-Veröffentlichung.
- VSIX zusätzlich in ein separates Extensions-Verzeichnis installiert und den Designer ohne
  Development-/Test-Modus mit `Verkaufsrechnung.rdlc` geöffnet.

## Mit macOS MCP visuell und interaktiv geprüft

- Englischer Designer mit Gliederung, Eigenschaften und Tabellenzellen; native Kontextmenüs
  einschließlich Tabellen-Untermenü.
- Installiertes VSIX mit echtem deutschem VS-Code-Sprachpaket: Designer und Diagrammdialog
  geprüft, einschließlich 700 × 500 Pixel; Fehlermeldung und Schaltflächen bleiben erreichbar.
- Helles Theme und dunkler hoher Kontrast mit deutschem Diagrammdialog visuell geprüft.
  Den Kontrastfehler nach Korrektur im neu installierten VSIX mit einer frischen Webview erneut
  geprüft; Screenshots vor/nach der Korrektur liegen bei.
- Diagrammdialog bei Fenstergrößen 1440 × 1000, 900 × 650 und 700 × 500: Inhalt scrollbar,
  Fehler und Abbrechen/Einfügen erreichbar.
- Echte Tab-/Shift-Tab-Grenzen, Escape, Zwischenablageeingaben in Ausdrucksfelder.
- Liniendiagramm mit Kategorie `Region` und `Sum(Umsatz)` eingefügt, gespeichert und in der
  Vorschau mit echten Beispieldaten angezeigt.
- Tabellenzelle gelöscht und mit dem tatsächlichen Cmd+Z wiederhergestellt. Die deutsche
  Tastaturbelegung erfordert bei macOS MCP AppleScript für layoutabhängige Zeichen/Tastenkürzel.
- Übergeordnete Zeilengruppe mit Kopf/Fuß angelegt und in der Vorschau dargestellt.
  Zusätzliche Entwurfszeilen vergrößern die Tabelle; darunter absolut positionierte Elemente
  müssen bei Bedarf im Designer verschoben werden. Eine automatische Neuanordnung gehört
  nicht zu diesem Test.
- Excel und Word öffnen die generierten Beispielexporte ohne Reparaturdialog; Firmenname,
  Rechnungsnummer, Positionen und Summe sind sichtbar. Word verwendet den Kompatibilitätsmodus.
- PDF in macOS Vorschau geöffnet: zwei Seiten, Text und Seitennummerierung sichtbar;
  der Integrationstest prüft zusätzlich Seitengröße, Seitenzahl und eingebettete Schriften.

Screenshots und Konsolenprotokolle liegen lokal unter `artifacts/qa-2026-10-18/` (Git-ignoriert).
Exportdateien liegen unter `out/test/export/`.

## Grenzen der Abnahme

Dieser lokale Lauf ist keine vollständige Release-Freigabe. Weiterhin erforderlich sind:

- Windows/Linux und Remote-Extension-Hosts (WSL, SSH, Dev Container), insbesondere VSIX-Updates.
- Echte AL-Symbolpakete und Ausführen von Reports in Cloud-Sandbox, Docker und On-Prem.
- Vertrauensmodus mit tatsächlich eingeschränktem Workspace und den aufgerufenen AL-Befehlen.
- Vollständiger VoiceOver-/NVDA-Durchgang sowie alle Dialogvarianten und
  Kombinationen aus `ABNAHME.md`; ein Fokus-Regressionstest ersetzt diese Prüfung nicht.
- Mehrdatei-Undo mit den nativen VS-Code-Rückfragen unter realen AL-Projekten.
- Exportvergleich in Acrobat und unter Windows/Linux sowie genaue fachliche/Layout-Abnahme
  der Office-Ausgaben. Word/Excel-Ausgabe ist eine Daten-/Dokumentausgabe, kein Nachweis
  pixelgleicher Wiedergabe jedes RDL-Elements.

Keine Releases veröffentlicht, keine Commits angelegt.

## Vertiefung nach der ersten Prüfung

Die erste Runde deckte nicht alle lokal möglichen Funktionen ab. Die detaillierte
[UI-Testmatrix](UI-TESTMATRIX.de.md) erfasst die zweite Runde mit einzelnen Abläufen und Testarten.
16 weitere Integrationstests ergänzen den Bestand auf 39. Der Gesamtlauf ist mit 39/39 grün,
darunter das Einfügen und Rendern aller 19 Diagrammtypen. Der Import-Vorschautest benötigte
im ersten Gesamtlauf einen zweiten Versuch, weil das erste Bereitschaftssignal vor dem
sichtbaren Dateninhalt ankam. Die Wartefunktion unterstützt nun asynchrone Bedingungen,
und der Test wartet auf den sichtbaren Dateninhalt. Der Wiederholungslauf besteht mit 39/39
ohne Wiederholungsversuch.
Unit-Tests: 143/143 grün; Typecheck und frisch gebautes VSIX ebenfalls geprüft.
Zusätzlich bestehen sämtliche 16 neuen UI-Abläufe auf Deutsch ohne Wiederholungsversuch.
Die noch offenen lokalen Bedien- und Randfallprüfungen sind in der UI-Testmatrix separat aufgeführt.

Weitere reproduzierte und korrigierte Fehler:

- **Plus-Schaltflächen:** Hinzufügen klappte zugleich die Datengruppe zu. Das Klickereignis
  bleibt jetzt bei der Aktion; der neu angelegte Eintrag bleibt sichtbar.
- **Parameterumbenennung:** Nur einfache Textfelder wurden geändert. Jetzt werden auch
  Abfrage-, Unterberichts-, Stil-, Gruppen- und erhaltene XML-Ausdrücke berücksichtigt.
  Die Referenzerkennung behandelt Collection-Syntax und Groß-/Kleinschreibung, ohne Texte
  in Stringliteralen umzuschreiben.
- **Dataset-Umbenennung:** Aggregatscopes wie `CountRows("Umsaetze")` blieben zurück.
  Die Umbenennung aktualisiert jetzt Dataset-Bindungen und tatsächliche Scopeargumente;
  gleichlautende Stringliterale und ReportItems-Verweise bleiben erhalten.
- **Vorschaudaten:** JSON-Arrays mit `null`, Zahlen oder Strings wurden gespeichert und
  konnten gültige Daten ersetzen. Solche Zeilen werden vor dem Schreiben abgelehnt.
- **Tastatur:** Datengruppen und bislang nur per Hover sichtbare Aktionen waren nicht
  erreichbar. Kategorien und Einträge sind fokussierbar, Aktionen erscheinen auch bei Fokus,
  und Kategorien lassen sich per Enter/Leertaste umschalten.
- **Enter in Auswahlfeldern:** Enter bestätigte den gesamten Dialog beim Bedienen eines
  Select-Felds. Auswahlfelder, Checkboxen, Radiobuttons und Farbauswahl lösen diesen
  Bestätigungsweg jetzt nicht mehr aus.
- **Direkter Texteditor:** Wie zuvor die Dialoge blockierte auch der Inline-Editor sämtliche
  Tastaturereignisse und damit Cmd+V. Nativ reproduziert, korrigiert und mit echtem Einfügen
  von `QA & Überprüfung`, Cmd+Enter und Speichern erfolgreich erneut geprüft.

Zusätzlich nativ mit macOS MCP geprüft: Abschnittshöhe ziehen, Rechteck zeichnen/bewegen/
skalieren, eindeutige Kopie per Cmd+C/Cmd+V, Rahmen-Mehrfachauswahl, gleiche Breite und linke
Ausrichtung. Positionen/Größen wurden über den DOM des laufenden Hosts kontrolliert.
Ein Feld wurde mit der Maus in das Rechteck einer BC-Liste gezogen und als dessen Kind
gespeichert. Zwei echte Tabellenzellen wurden mit Shift ausgewählt, verbunden (`ColSpan=2`)
und wieder geteilt; die gespeicherte Datei wurde jeweils kontrolliert.

Die DOM-Inspektion für diese Mausprüfungen nutzte zusätzlich den lokalen Chromium-Debugport
eines separaten Dev-Hosts. Geprüfte Dateien liegen ausschließlich in einer temporären Kopie.
Der Host mit Debugport wurde nach der Prüfung beendet. Protokolle und geprüfte Layoutkopien
liegen unter `artifacts/qa-2026-10-18/round2/`; die nativen Screenshots im übergeordneten Ordner.

## TODO-Abgleich und Release-Dry-Run

Am 18.10.2026 zusätzlich `npm run publish:github -- --dry-run` erfolgreich ausgeführt:
Typecheck, 143/143 Tests und Paketprüfung (15 Extension-Dateien, 93 Befehle, ein Custom Editor).
Der Lauf erzeugt die VSIX sowie `artifacts/v1.0.0-release-plan.json` und Release-Notizen lokal;
er ruft GitHub nicht auf, legt keinen Tag an und veröffentlicht nichts.
Das Protokoll liegt unter `artifacts/qa-2026-10-18/round2/report-builder-release-dry-run.log`.

Die TODO-Liste trennt nun nachgewiesene lokale Prüfungen von den verbleibenden manuellen
Varianten und externen Umgebungen. Die aktuellen QA-Korrekturen sind noch uncommittet;
der frühere abgehakte Commit-/CI-Punkt gilt nicht als Nachweis für diesen Arbeitsstand.
Vor dem Release sind Commit/Push und CI für genau den finalen Stand erneut erforderlich.
Die vollständige manuelle Abnahme nach `docs/ABNAHME.md` bleibt ausdrücklich offen.
