# macOS-Nachprüfung am 21.10.2026

[English](RELEASE-TEST-2026-10-21-MACOS.md) | Deutsch

## Ergebnis und Freigabe

Für die geprüften macOS-Abläufe wurde kein Produktfehler bestätigt. Die Windows-/Copilot-Korrekturen
bestehen die macOS-Nachprüfung. **Vor dem Release muss die CI mit der lokalen Node-24-Korrektur
auf dem tatsächlichen Release-Commit grün sein.** Die bisherige Windows-CI ist rot.
Keine Commits, Pushes oder Veröffentlichungen in dieser Runde.

## Grundlage und Umgebung

Anwendungsstand: `7f4485d80ec1df5b2052637703a75953a0f4b712`.
macOS 15.7.5 (24G624), Intel, VS Code 1.142.0, Node.js 24.22.0, deutsche QWERTZ-Tastatur.
Integrationstests mit isolierten Profilen und Kopien von `samples/`; native Prüfung im
installierten Produktions-VSIX mit separatem Profil und Extensions-Verzeichnis.
Die Originalberichte und das normale VS-Code-Profil wurden nicht für Teständerungen verwendet.

## Automatische Prüfungen

- Typecheck erfolgreich, 162/162 Unit-Tests bestanden.
- Vollständige Integrationstests: **58/58 Englisch und 58/58 Deutsch ohne Wiederholungsversuch**.
  Einschließlich Zwischenablage zwischen Berichten mit Bildern/Code/Verweisen, Bildvalidierung,
  Ausdruckssuche, Bausteinkonflikten, kombinierten Umbrüchen, PDF-/Office-Export,
  Tastaturbedienung und den drei neuen Copilot-Regressionen.
- Deutscher Lauf mit `BC_RB_LOCALE=de` und `BC_RB_TEST_LANGUAGE=de`; deutsches Sprachpaket
  im isolierten Test-Extensions-Verzeichnis installiert. Der Bundle-Test erzwingt ausdrücklich
  die deutsche Extension-/Webview-Sprache; die native Stichprobe verwendete die englische Oberfläche.
- Echter eingeschränkter Modus: **1/1 Englisch und 1/1 Deutsch**, beide Launcher Exitcode 0.
  AL/Serverzugriffe gesperrt, Entwurf/Vorschau verfügbar.
- Microsoft-BCApps-Korpus: **379/379 Layouts** unverändert und nach vollständiger Neuerzeugung
  zeichengleich, keine Probleme. 45.201 bearbeitbare und 73 unverändert durchgereichte Elemente.
  368 Layouts AL-Reports zugeordnet, davon 357 mit exakt passendem Dataset; die elf im
  Microsoft-Korpus veralteten Layouts werden weiterhin vom Linter gemeldet.
- Produktions-VSIX gebaut und geprüft: 15 Extension-Dateien, 93 Befehle,
  14 Sprachmodell-Werkzeuge, ein Custom Editor; Aktivierung des gepackten Bundles erfolgreich.
  Installation in das separate native Testprofil erfolgreich.

## Native Stichproben

- Designer und Vorschau des Umsatzberichts; acht Datenzeilen, Menge 116 und Gesamtsumme
  `37.523,40 €`, deutsche Zahlen-/Datumsformate und Sonderzeichen sichtbar korrekt.
- Direkttext mit `macOS Prüfung: Grüße & €`: per Cmd+V eingefügt, mit Cmd+Enter übernommen,
  mit Cmd+S gespeichert; XML enthält korrekt `&amp;`.
- Cmd+Z stellt die Originaldatei bytegenau wieder her; Cmd+Shift+Z stellt die bearbeitete Datei
  bytegenau wieder her. Nach erneuter Rücknahme ist die Testdatei identisch zum Original.
- Native PDF-Speicherauswahl im Pfad `Prüfung & Berichte`; erzeugtes PDF in macOS Vorschau
  geöffnet. Eine Seite, Titel, acht Positionen, Summe, Umlaute, Eurozeichen und Gestaltung
  sichtbar korrekt. Automatisierte Prüfungen decken zusätzlich A4, mehrere Seiten und Schrifteinbettung ab.
- Normales Beenden des installierten Pakets per Cmd+Q: Prozess endet mit Exitcode 0.

### Aufgeklärte Auffälligkeiten der Teststeuerung

Der erste englische Lauf hatte ein nicht sichtbares Testfenster: Vorschau und Direkttextbestätigung
liefen in Timeouts (56/58 bestanden), der Labeltest benötigte eine Wiederholung.
Mit sichtbar nach vorn geholtem Testfenster bestehen die drei auffälligen Fälle gezielt (3/3),
anschließend alle 58 Fälle je Sprache ohne Wiederholung. Animation Frames und Fokus-/Blur-Tests
benötigen ein tatsächlich sichtbares, fokussiertes Fenster.

Nach den vollständigen Läufen meldete der Extension-Host Exitcode 0, der fensterlose VS-Code-Hauptprozess
blieb jedoch bestehen. Die ersten beiden Hauptprozesse wurden nach abgeschlossenen Tests gezielt beendet;
ein selbstständiger Exit des gesamten Launchers wird für diese Läufe nicht behauptet.
Gezielte und Restricted-Mode-Läufe endeten selbstständig; späteres normales Cmd+Q beendete auch
weitere vollständige Testanwendungen mit Exitcode 0. Das installierte Paket lässt sich normal beenden.

Ein vermeintlicher nativer Undo-Fehler stellte sich als QWERTZ-Zuordnung der Teststeuerung heraus:
Der Automationsaufruf `command+z` sendet hier die Y-Taste, `command+y` die Z-Taste.
Die Gegenprobe mit einem separat direkt aus `7f4485d` gebauten und installierten VSIX bestätigt
bytegenaues Undo/Redo ohne Anwendungskorrektur. Die vorläufige Tastaturweiterleitung und ihr
zusätzlicher DOM-Test wurden deshalb vollständig zurückgenommen. Die während dieser Untersuchung
entstandenen 59-Test-Läufe sind zusätzliche Explorationsnachweise, nicht die Testzahl des Release-Stands.

## CI-Befund und Korrektur

Die [CI des geprüften Commits](https://github.com/strxngewxrld/report-builder/actions/runs/39630124842)
ist unter Linux erfolgreich, unter Windows jedoch bereits vor den Integrationstests fehlgeschlagen:

```text
Could not find 'D:\a\report-builder\report-builder\out\test\*.test.js'
```

Die CI verwendet Node 20.20.2. Dessen Windows-Testaufruf expandiert die Dateiplatzhalter nicht;
außerdem benötigen `@vscode/test-electron` und `@vscode/vsce` mindestens Node 22.
Beide Node-Konfigurationen in `.github/workflows/ci.yml` wurden auf Node 24 angehoben.
Zusätzliche lokale Gegenprobe ohne Shell-Expansion, mit wörtlichen Platzhaltern als Prozessargumenten
an Node 24.22.0: **162/162 bestanden**. Das prüft genau die zuvor fehlerhafte Dateiauflösung;
es ersetzt keinen neuen Windows-CI-Lauf. README und CHANGELOG dokumentieren Node 24.

## Artefakte und Grenzen

Logs und native Testkopien: `artifacts/qa-macos-2026-10-21/` (von Git ausgeschlossen).
Wesentliche Nachweise: `typecheck.log`, `unit.log`, `unit-literal-globs.log`, `corpus.log`,
`integration-en-final.log`, `integration-de-final.log`, `untrusted-en.log`, `untrusted-de.log`,
`native-baseline-undo.json`, `native-baseline-edited.rdl`, `native-preview.png`,
`native-pdf-preview.png`, `package-release.log` und `install-release.log`.

VSIX: `artifacts/bc-report-builder-1.0.0.vsix`. Prüfsumme siehe `release-vsix.sha256` im QA-Verzeichnis.
Das finale Anwendungspaket enthält keine Undo-/Redo-Codeänderung; seine Anwendungsbundles entsprechen
dem nativ geprüften Ausgangsstand. Änderungen dieser Runde betreffen CI und Dokumentation.

Vollständige VoiceOver-/NVDA-Abnahme aller Dialogvarianten, weitere Cloud-/Docker-Ziele,
tatsächliche Drillthrough-Servernavigation sowie sämtliche nativen Konflikt-/Gestaltungsvarianten
bleiben separate offene Abnahmebereiche. Die lokalen Prüfungen ersetzen diese nicht.
