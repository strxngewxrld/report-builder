# Nachprüfung offener TODOs unter Windows

**Die unten dokumentierten Findings sind inzwischen behoben und erneut geprüft.** Aktueller Stand und zusätzliche
Abnahmefälle: [Findings behoben und Abnahme erweitert](RELEASE-TEST-2026-10-20-FIXES.md).
Dieses Protokoll erhält die ursprünglichen Reproduktionsschritte und Befunde.

20.10.2026, Windows Server 2025, VS Code 1.142.0, aktive RDP-Sitzung mit 1620 × 952 Pixeln.
Getestet wurde der gebaute Arbeitsstand im Extension Development Host, mit eigenem Profil und einer Kopie von
`samples/` unter `artifacts/qa-remaining/`. Das normale VS-Code-Profil und die BC-Installation wurden nicht verändert.
Native Eingaben erfolgten mit `C:\QA\tools\ui.ps1` (Win32 SendInput), DOM-Kontrollen über Debugport 9335.

## Bestätigter Fehler: Zwischenablage zwischen Berichten

1. `Verkaufsrechnung.rdlc` öffnen, Textfeld `CompanyName` auswählen, Strg+C.
2. Strg+V im selben Designer: zusätzliche Kopie `Textbox1` erscheint. Rückgängig.
3. `Umsatzbericht.rdl` im selben Fenster öffnen, Entwurfsfläche fokussieren, Strg+V und speichern.
4. Es wird kein Element eingefügt. Der SHA-256 des Zielberichts bleibt identisch mit dem Ausgangsbericht:
   `EF7A5BC1C7FD599CFF5D8A1EE4AD15E00818F03B9675D8E83FC262911DA79044`.

Ursache: `webview/App.tsx` hält `clipboard` als lokalen React-Zustand je Webview. `copy` schreibt nur diesen Zustand,
`paste` liest nur dieselbe lokale Referenz. Zwischen Designerinstanzen wird nichts übertragen.
Kein Produktfix in diesem Testauftrag. Belege: `copy-same.png`, `copy-other.png`.

## Bestätigter Fehler: defekte Bilddatei ohne Fehlermeldung

`broken.png` mit dem Inhalt `not a PNG` über Berichtsdaten → Bilder → Einbetten auswählen.
Die Datei wird ohne Fehlermeldung als PNG eingebettet. Auf die Fläche ziehen, speichern, Vorschau öffnen:
Das Bildelement bleibt unsichtbar. DOM-Kontrolle: `complete=true`, `naturalWidth=0`, `naturalHeight=0`,
Quelle `data:image/png;base64,bm90IGEgUE5H`. Im Layout existieren eingebettete Daten und `<Value>broken</Value>`.
Der übrige Bericht bleibt bedienbar und wird gerendert.

`pickImage` in `src/reportEditorProvider.ts` leitet den MIME-Typ nur aus der Endung ab; der Inhalt wird nicht geprüft.
Erwartet wäre eine verständliche Fehlermeldung beim Import oder spätestens bei der Darstellung.
Belege: `broken-embedded.png`, `broken-preview.png`. Kein Produktfix in diesem Testauftrag.

## Nativ geprüft

| Ablauf | Ergebnis |
| --- | --- |
| Bausteinbibliothek: Ersetzen abbrechen | `Titel` aus Umsatzbericht als `QA-Restabnahme` sichern, danach fett formatieren und erneut unter demselben Namen speichern. Escape im nativen Ersetzen-Dialog erhält die bisherige Datei ohne `FontWeight`. |
| Bausteinbibliothek: Ersetzen bestätigen | Erneut speichern, im nativen Dialog „Replace“ bestätigen. Bibliotheksdatei enthält danach zusätzlich `<FontWeight>Bold</FontWeight>`. Sonst kein Unterschied zwischen den gesicherten Bausteindateien. |
| Native Farbauswahl | Schriftfarbe von `Titel` über Toolbar öffnen, im RGB-Popup Rot von 31 auf 200 ändern (Grün 78, Blau 121). Gespeichertes Layout enthält `#c84e79`. |
| Mehrdatei-Undo bei AL-Label | `DocumentNo_Lbl` über Kontextmenü als `QaUndoLbl` anlegen. Strg+Z aus dem Designer nimmt AL-Label und Layoutverweis gemeinsam zurück. Wiederholen und erneutes Rückgängig aus dem AL-Editor ebenfalls geprüft. In diesen Abläufen erschien keine „alle Dateien?“-Rückfrage; deren Bestätigen/Abbrechen ist damit weiterhin nicht abgenommen. |
| Spalte umbenennen und Undo | Über das Kontextmenü in Berichtsdaten `CompanyName` nach `QaCompanyName` umbenennen. AL-Deklaration und Layout aktualisiert. Strg+Z im AL-Editor setzt beide Dateien zurück; gespeicherte SHA-256 identisch mit den jeweiligen Ausgangsdateien. Auch hier keine Rückfrage. |
| Großes Bild | Gültiges SVG mit 320 × 200 Pixeln und einem Kommentar von 2 MiB importieren. Größenwarnung erscheint; „Embed Anyway“ betätigen, Bild auf die Fläche ziehen. Designer und Vorschau zeigen das SVG; DOM bestätigt natürliche Größe 320 × 200. Kein Belastungstest sehr großer Rasterbilder. |

Belege: `block-replace.png`, `block-after-cancel.rdlc`, `block-after-replace.rdlc`, `block-replaced.png`,
`color-picker.png`, `color-result.png`, `label-options.png`, `undo-label.png`, `undo-label-from-al.png`,
`renamed.png`, `rename-undo.png`, `before-rename.rdlc`, `large-warning.png`, `large-embedded.png`.

Nach AL-Label-Undo waren AL und RDLC bytegenau identisch zu `samples/` (SHA-256 geprüft).
Für Spalten-Undo wurde der Layoutzustand nach den Bildtests als Ausgangsstand gesichert und verglichen.

## Zusätzliche Webview-Integrationstests

Die Tests bedienen die tatsächlichen React-Dialoge im VS-Code-Webview über DOM-Ereignisse.
Sie ersetzen keine native Tastatur- oder Screenreader-Abnahme.

- Alle sechs berechneten Diagrammreihen: MovingAverage, ExponentialMovingAverage, WeightedMovingAverage,
  TriangularMovingAverage, Mean und Median. Periode 0 sperrt die Bestätigung, Periode 3 wird akzeptiert.
  Bedingte Punktfarbe über `IIf` eingeben, RDL-Formeln kontrollieren, gemeinsame Vorschau ohne Renderfehler.
- Bookmark-Aktion und Bookmark-Ziel eingeben, speichern und in der Vorschau anklicken. Der Test verwendet ein Ziel
  am selben Titel und prüft die fehlerfreie Auflösung, **keinen** Sprung zwischen verschiedenen Seiten.
- Drillthrough-Ziel eingeben und Vorschauaktion anklicken: Hinweis nennt den Zielreport. Eine tatsächliche
  Reportserver-Navigation ist nicht Bestandteil der lokalen Vorschau.
- Vorhandenen Gruppentest um eine zweite Spaltengruppe bei bereits bestehender Spaltengruppe erweitert.

Gesamtläufe nach den Testerweiterungen:

- `npm run typecheck`: bestanden.
- `npm test`: 160/160 bestanden.
- `npm run test:vscode`: 43/43 bestanden, keine Wiederholung.
- `BC_RB_LOCALE=de BC_RB_TEST_LANGUAGE=de npm run test:vscode`: 43/43 bestanden, keine Wiederholung.

Der erste neue Navigationstest scheiterte an einem ungeeigneten Testziel (`Untertitel` hat andere Eigenschaften).
Test auf Bookmark am Titel korrigiert, Einzeltest und beide Gesamtläufe danach grün. Keine Produktänderung erforderlich.
Logs: `typecheck.log`, `unit.log`, `integration-en.log`, `integration-de.log`.

## Screenshot

`media/preview.png` direkt vom isolierten VS-Code-Fenster aufgenommen und im README eingebunden.
Zwei Ansichten desselben unveränderten Umsatzbericht-Beispiels: links Entwurf/Gliederung, rechts Berichtsdaten/Vorschau.
Keine generierte oder nachgestellte Produktoberfläche. Der Bildausschnitt enthält nur die Editorfläche.

## Eingeschränkter Modus: Codebefund

Das Manifest deklariert weiterhin `untrustedWorkspaces.supported: true`.
`buildAl` und `runInBc` in `src/bcCommands.ts` prüfen `vscode.workspace.isTrusted` nicht.
`runInBc` liest die Workspace-Konfiguration und fragt den Metadaten-Endpunkt ab, bevor die Öffnen-/Veröffentlichen-
Rückfrage erscheint; bei Windows-Authentifizierung kann dabei PowerShell mit `UseDefaultCredentials` laufen.
Nur `supported` auf `limited` zu ändern würde diese Pfade nicht selbst sperren.
Eine explizite Vertrauensprüfung und eine Abnahme im eingeschränkten Modus bleiben erforderlich.
Dies ist ein Codebefund, kein hier ausgeführter Angriffstest.

## Verbleibende Grenzen

- WSL meldet „nicht installiert“. Docker ist nicht im Suchpfad; kein Remote-Testziel wurde verwendet.
- Das isolierte Profil ist nicht bei Copilot angemeldet; keine Abnahme von Modellentscheidungen im Agentenmodus.
- NVDA ist nicht im Suchpfad; keine Screenreader-Abnahme. VoiceOver benötigt macOS.
- Keine Cloud-Sandbox oder Docker-BC-Umgebung geprüft.
- Noch offen: seitenübergreifende Bookmark-Navigation, Drillthrough-Parameter und Servernavigation, komplexe
  Filter-/Drilldown-Kombinationen, kombinierte Vorschau-Umbrüche, sämtliche Baustein-Konfliktdialoge,
  weitere große Bildformate, Fehlerbehandlung für defekte Bilder, weitere Gestaltungs-/Drag-Varianten sowie
  native Mehrdatei-Undo-Rückfragen.

Die nicht abgenommenen Kombinationen bleiben in TODO und UI-Testmatrix offen.
Lokale Rohprotokolle und Bildschirmfotos: `artifacts/qa-remaining/` (Git-ignoriert).
