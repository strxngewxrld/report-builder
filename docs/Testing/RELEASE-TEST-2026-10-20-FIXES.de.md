# Findings behoben und Abnahme erweitert

[English](RELEASE-TEST-2026-10-20-FIXES.md) | Deutsch

20.10.2026, Windows Server 2025, VS Code 1.142.0, Node.js 26, deutsche Tastatur, aktive RDP-Sitzung.
Fortsetzung der [Nachprüfung](RELEASE-TEST-2026-10-20-RESTPUNKTE.de.md). Alle Desktoptests in isolierten Profilen mit
Kopien von `samples/`; zusätzlich das frisch gebaute VSIX installiert. Testprofile und Belege:
`artifacts/qa-fixes/` (Git-ignoriert).

## Korrekturen

- **Zwischenablage zwischen Berichten:** Auswahl als portabler RDL-Baustein im Extension-Host teilen und an bestehende
  sowie neu geöffnete Designer verteilen. Eingebettete Bilder und benötigter Code werden übernommen; Namen,
  ReportItems-Verweise und Gruppenscopes passen sich an. Bild-/Codekonflikte brechen vor einer Änderung ab.
  Fehlende Datenverweise werden gemeldet. Ein Einfügen bleibt genau ein Undo-Schritt. Die Zwischenablage gilt für
  Designer desselben Extension-Hosts; ein Transfer zwischen eigenständigen VS-Code-Fenstern ist nicht implementiert.
- **Defekte Bilder:** Vor dem Einbetten mit dem tatsächlichen Browserdecoder prüfen, einschließlich SVG und Bildern
  mit plausibler, aber abgeschnittener PNG-Kopfzeile. Bei Fehler keine Dokumentänderung und verständliche Meldung.
  Auch das Sprachmodell-Werkzeug zum Einfügen von Bildern verwendet diese Prüfung. Größenwarnung bleibt erhalten.
- **Eingeschränkter Modus:** Manifest auf `limited` mit lokalisierter Beschreibung geändert. Build, BC-Aufruf und
  Symbol-Download prüfen explizit das Workspace-Vertrauen. Vor dieser Prüfung werden weder Dateien gespeichert noch
  AL-Befehle aufgerufen oder konfigurierte BC-Server kontaktiert. Auch das Build-Werkzeug prüft das Vertrauen.
- **PDF während Neuberechnung:** Der vorher bekannte Export-Timeout trat in einem Gesamtlauf erneut auf.
  Messwerte sind jetzt an den jeweiligen Berichts-/Datenstand gebunden, und ein PDF-Befehl während der Vermessung
  wird vorgemerkt. Ein neuer Test lädt 120 Datenzeilen und fordert sofort den Export an: PDF-Seitenzahl entspricht
  der neuen mehrseitigen Vorschau. Einzeltests für diesen Fall und den bisherigen Exportfall bestehen.

## Nativ im installierten VSIX

| Ablauf | Nachweis |
| --- | --- |
| Kopieren aus Umsatzbericht nach Bericht1 | Strg+C/Strg+V legt `Titel` im zweiten Bericht an; fehlender Parameter `Jahr` wird gemeldet. Nach Strg+Z und Speichern wieder identischer SHA-256 wie Original. |
| Defekte PNG importieren | Echter Windows-Dateidialog mit `broken.png` (`not a PNG`): Fehlermeldung, kein eingebettetes Bild, Datei unverändert. |
| Ausdruckssuche | Suche und Ersatz per Tastatur eingeben, Vorher/Nachher sichtbar. Escape schließt; Tab erreicht die nächste Toolbaraktion. Originaldatei unverändert. |
| Bausteinbibliothek mit Logo | Echtes PNG `Firmen Logo ä.png` einbetten, auf die Fläche ziehen, Bild und Titel auswählen, als `Native Firmenkopf` in Bibliothek sichern. |
| Export/Import zwischen Profilen | Auswahl über nativen Speicherdialog als `native-header.rdlc` exportieren; in zweitem Profil (anderes `user-data-dir`, Debugport 9337) über nativen Öffnen-Dialog importieren. Datei enthält Bilddaten und zwei Elemente. |
| Neuer Kopf und gemeinsames Undo | Importdialog zeigt fehlenden Parameter und sperrt Einfügen. Nur per Tastatur Seitenkopf und Position 0,25″ wählen, unaufgelöste Verweise zulassen, einfügen und speichern. Logo und Gestaltung sichtbar. Ein Strg+Z entfernt Elemente, eingebettetes Bild und neu angelegten Kopf; ursprünglicher Dateihash wiederhergestellt. |
| Abschließender PDF-Smoke-Test | Endgültiges VSIX nach PDF-Korrektur erneut installiert; Umsatzbericht nativ in Vorschau öffnen, Exportbefehl und Windows-Speicherdialog bedienen. `final-native.pdf`: 75.620 Bytes, 1 Seite wie Vorschau, A4 (595,28 × 841,89 pt), mit pdf-lib erneut geladen. |

SHA-256 für den wiederhergestellten Zielbericht `Bericht1.rdlc`:
`C090676F3D520646C0211BD26C070446F4B2527CDBF866369F019DFED411296E`.

Bildbelege: `native-copy-other.png`, `native-image-rejected.png`, `native-search-keyboard.png`,
`native-search-focus-return.png`, `native-library-logo.png`, `native-block-export.png`,
`native-import-other-profile.png`, `native-import-header.png`. Export: `native-header.rdlc`.
Abschließender Export: `native-final-pdf-dialog.png`, `native-final-pdf-saved.png`, `final-native.pdf`.

## Zusätzliche automatisierte Abnahme im echten Webview

- Zwischenablage: zwei Berichte, zweimal einfügen, eindeutige Namen, angepasste interne Verweise, eingebettetes Bild,
  Code, Undo einschließlich Abhängigkeiten, neuer Designer und atomarer Konfliktabbruch.
- Bilder: ungültige PNG, abgeschnittene PNG, ungültiges SVG; defektes Bild über KI-Werkzeug; Größenwarnung für SVG
  über 2 MiB abbrechen/bestätigen und Import rückgängig machen.
- Ausdruckssuche: Treffer in Text, Stil und Gruppenausdruck, Groß-/Kleinschreibung, ungültiger Ersatz, einzelne und
  übrige Treffer ersetzen, Sammel-Undo/Redo, feste Texte erhalten, Parameterverwendung mit Layoutnavigation.
- Bausteindialog: fehlendes Feld/Label sperrt Einfügen bis zur Freigabe; neuer Kopf und Undo; Bild- und Codekonflikt
  mit sichtbarer Fehlermeldung ohne Teiländerung.
- Vorschau/PDF: Rechteck mit Start, End, StartAndEnd; zusammenfallende verschachtelte Endumbrüche ohne Leerseite,
  Seitennummerierung startet neu; sofortiger PDF-Export hat dieselbe Seitenzahl. Wiederholtes Umschalten mit Arial,
  Georgia und Consolas; zusätzlich lange wachsende Texte in zwei Schriften mit stabiler Aufteilung und PDF-Vergleich.
  Auch Tabellen mit allen drei Umbruchvarianten und jeweiligem PDF-Abgleich geprüft.
- Gruppen: Endumbruch auch nach letzter Gruppe, `Disabled` je nach `Paid` wahr/falsch, zusammenfallender Gruppen-/
  Tabellen-Endumbruch ohne zusätzliche Leerseite; `ResetPageNumber = Not Paid` ergibt je nach Variante zuletzt
  „Seite 1“/„Seite 2“, Gesamtsumme beider Belege 741 in der tatsächlichen Vorschau.
- Navigation: Bookmark scrollt von Seite 1 auf Seite 2; fehlendes Ziel gibt Hinweis. Drillthrough-Dialog mit Parameter
  `DocumentNo = =21*2`; Vorschauhinweis nennt Ziel und ausgewerteten Wert `42`. Servernavigation bleibt Serveraufgabe.
- Neu angelegtes AL-Label `MengeLbl` in der Verwendungsübersicht auswählen, genau einen Treffer kontrollieren und
  zum Tabellenfeld navigieren. Ausdruckssuche zusätzlich nach Speichern/Schließen/erneutem Öffnen geprüft.

## Eingeschränkten Modus reproduzieren

`npm run test:vscode:untrusted` öffnet einen echten nicht vertrauenswürdigen Workspace in einem Wegwerfprofil.
Der Test verlangt `workspace.isTrusted === false`, prüft null AL-Aufrufe/null Netzwerkzugriffe bei Build/BC-Aufruf,
kein implizites Speichern und die Ablehnung des KI-Build-Werkzeugs. Entwurf und Vorschau bleiben nutzbar.
Der Aufruf ist in der CI für Windows und Linux ergänzt; der entfernte CI-Lauf wurde hier nicht gestartet.

Der Standardstarter von `@vscode/test-electron` deaktiviert Workspace Trust grundsätzlich. Deshalb startet dieser
eine Test VS Code direkt mit eigenen Profilpfaden und ohne diesen Schalter. Es wird kein Vertrauen im normalen
Benutzerprofil geändert. Lokaler Lauf: **1/1 bestanden**, siehe `restricted-final.log`.

## Abschließende Prüfungen

- Typecheck bestanden, 160/160 Unit-Tests bestanden.
- Vollständige Integration: **51/51 Englisch und 51/51 Deutsch**, jeweils ohne Wiederholungsversuch.
- Echter eingeschränkter Modus: **1/1 Englisch und 1/1 Deutsch**.
- Anschließend um die letzten Tabellenumbruch-/Gruppenvarianten erweiterte Tests zusätzlich **2/2 Englisch und
  2/2 Deutsch**; abschließender Typecheck erneut grün.
- VSIX gebaut und geprüft: 93 Befehle, 14 Sprachmodell-Werkzeuge, Aktivierung des gepackten Codes erfolgreich.

Logs: `typecheck-release.log`, `unit-release.log`, `integration-release-en.log`, `integration-release-de.log`,
`restricted-final.log`, `restricted-release-de.log`, `breaks-complete-en.log`, `breaks-complete-de.log`,
`package-release.log`. Früherer 50er-Lauf hatte vor der PDF-Korrektur einen PDF-Wiederholungsversuch; die obigen
abschließenden 51er-Läufe nicht.

Paket: `artifacts/bc-report-builder-1.0.0.vsix`, SHA-256
`C90FB6F2DE77A11F21A84DA77EF50C6A6DA02CB820C53C966BF3CC2CAF746AE9`.

## Verbleibende externe Abnahme

- Copilot-Modellentscheidungen im Agentenmodus benötigen ein angemeldetes Konto; die Werkzeugpfade selbst sind getestet.
- WSL/SSH/Dev Container für Remote-Updateinstallation; hier kein vorbereitetes Remote-Ziel.
- BC Cloud-Sandbox/Docker; on-prem wurde im vorherigen Windows-Protokoll abgenommen.
- NVDA/VoiceOver, sämtliche Dialogvarianten mit Screenreader und plattformübergreifende Sichtkontrolle.
- Gesonderte Bestätigen-/Abbrechen-Varianten nativer Mehrdatei-Undo-Rückfragen: Label- und Spalten-Undo funktionieren
  bytegenau, eine solche Rückfrage erschien in den ausgeführten Abläufen nicht.
- Nicht jede denkbare Filter-/Drilldown-, Schrift-/Rahmen-/Zahlenformat-, Drag-/Zoom-/Containerkombination wurde ausgeführt.
  Die konkreten Windows-Funktionsfälle aus `ABNAHME.md` sind bis auf die separate Acrobat-Sichtkontrolle abgehakt.

Für die abgeschlossenen Windows-Fälle ist keine Wiederholung von Hand erforderlich.
