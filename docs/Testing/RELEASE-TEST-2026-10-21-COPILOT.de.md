# Copilot-Abnahme unter Windows (21.10.2026)

[English](RELEASE-TEST-2026-10-21-COPILOT.md) | Deutsch

## Umgebung und Umfang

VS Code 1.142.0, GitHub Copilot 0.70.0, Agentenmodus mit Auto-Modellauswahl
(in beiden Aufgaben GPT-6 Luna), Windows Server 2025. Bedienung über Windows MCP.
Separates Profil `Report Builder Copilot QA`, installiertes Report-Builder-VSIX und
Microsofts AL-Erweiterung; Projektkopie `C:\QA\copilot-report-e2e-fixed` außerhalb des
Repositories. Kein Deployment und keine Änderung an BC-Servereinstellungen.

## Neuer Rechnungsbericht: bestanden

Fachliche Aufgabe: zusätzliches RDLC-Rendering für „Contoso Verkaufsrechnung“, A4,
Positionstabelle, übersetzbare Überschriften, zwei Beispielrechnungen, Prüfung und AL-Build.
Copilot verwendete das vorhandene Rechnungsdesign als Vorlage und erstellte
`KIRechnungsuebersicht.rdlc` einschließlich AL-Rendering und eigener Datendatei.
Dies prüft ein zusätzliches Layout aus einem vorhandenen AL-Report, kein neues AL-Dataset
und keinen vollständig ohne Vorlage erzeugten Report.

- Produktwerkzeuge: `inspectLayout`, `getReportData`, `insertItems`, `createAlLabel`,
  `previewReport`, `setPageLayout`, `editTable`, `buildProject`, `validateLayout`,
  `showInDesigner`; ergänzend allgemeine Datei-/XML-Werkzeuge.
- Fünf neue AL-Labels nach dem Build auf der Platte und als Layoutparameter vorhanden.
  Layoutreferenz korrekt relativ zur `app.json`: `./KIRechnungsuebersicht.rdlc`.
- Echter AL-Compiler: „Success: The package is created“, Ausgabe und erzeugte App-Datei
  geprüft. Ein erfolgreicher Werkzeugaufruf allein wäre kein Kompilierungsnachweis.
- Vier Positionen: 2.501,00 + 1.499,97 = **4.000,97** und 301,00 + 179,00 = **480,00**.
  Gespeicherte Daten und gerenderte Summen unabhängig geprüft; keine Validierungsprobleme.
- Native Vorschau beider Seiten geprüft: jeweils passende Firma, Nummer, Datum, Positionen
  und Rechnungssumme. Screenshots `02-invoice-page1.png` und `03-invoice-page2.png`.
- Erneuter echter Copilot-Aufruf bestätigt nach der Formatkorrektur deutsche Zahlenformate
  und beide Rechnungssummen.

## Umsatzbericht anpassen: funktionaler Lauf bestanden

Aufgabe: acht vorhandene Umsatzzeilen nach Region gruppieren, Zwischensummen,
Gesamtsumme, Säulendiagramm unterhalb der Tabelle und dunkelblaue Gestaltung.
Copilot hat die Regionengruppe über das Tabellenwerkzeug angelegt, die Gruppenfüße mit
Summen gefüllt, das Diagramm eingefügt und bearbeitet, Elemente angeordnet, validiert und
den Designer in der Vorschau geöffnet. Einfache Stile änderte das Modell direkt im XML.
Im wiederaufgenommenen Lauf versuchte es zunächst längere XML-Änderungen und suchte die
Produktwerkzeuge erst später. Nach der Werkzeugsuche verwendete es Tabellen-/Diagrammwerkzeuge.

Unabhängige Dateiprüfung: keine Validierungsprobleme; die Datendatei ist gegenüber der
ursprünglichen Kopie SHA-256-identisch. Alle acht Positionen bleiben erhalten.

| Region | Menge | Umsatz |
| --- | ---: | ---: |
| Nord | 15 | 4.992,50 € |
| Ost | 49 | 14.515,75 € |
| Süd | 32 | 11.415,25 € |
| West | 20 | 6.599,90 € |
| Gesamt | 116 | 37.523,40 € |

Das Diagramm enthält genau diese vier Regionswerte. Native Vorschau: Tabelle auf Seite 1,
Diagramm und vorhandener Hinweis/Unterbericht-Platzhalter auf Seite 2, ohne Überlappung.
Die Ausführung des vorhandenen Unterberichts wird in der lokalen Vorschau nicht geprüft.
Die Behauptung des Modells „eine Seite“ war falsch; seine Textvorschau hatte nur einen
Seitenzahl-Platzhalter. Dieser Modellfehler wurde zurückgemeldet und die Beschreibung verschärft.
Die unpassend umbrechenden Gruppenfuß-Beschriftungen hat Copilot im Folgeauftrag über das
Tabellenwerkzeug durch Verbinden der ersten drei Zellen verbessert; Summen unverändert.

Während dieses Laufs und eines MCP-UI-Baumabrufs hing der gemeinsame VS-Code-Hauptprozess.
Ursache ungeklärt; keinem Produktbaustein sicher zugeordnet. Zwischenstand gesichert.
Der Nutzer hat VS Code anschließend neu gestartet. Der Anpassungslauf wurde danach abgeschlossen.

## Behobene Befunde

1. Werkzeugänderungen konnten in unsichtbaren AL-Arbeitskopien verbleiben. Der Build
   speichert geänderte dateibasierte Dokumente explizit und startet bei Speicherfehlern nicht.
2. AL-URIs ohne Workspace-Zuordnung erhielten fälschlich `src` als Projektwurzel.
   Die Suche läuft jetzt bis zur übergeordneten `app.json`; Workspace-Grenzen bleiben erhalten.
3. Die Textvorschau erzwang die VS-Code-Sprache. Jetzt gilt die Berichtssprache,
   etwa `de-DE` auch im englischen VS Code.
4. Textvorschau bezeichnet Kopf-/Fußzeilen jetzt als unpaginierten Snapshot statt als
   Seite 1. Seitenabhängiges `Code`/`ReportItems` muss in der Designer-Vorschau geprüft werden.
   Ein zusätzlicher Hinweis erklärt, dass `PageNumber`/`TotalPages` Platzhalter sind und
   weder Seitenanzahl noch Überlappungsfreiheit aus dieser Ausgabe abgeleitet werden dürfen.
5. Diagramme zeigten im deutschen Bericht Dollarzeichen und englische Trenner. Der
   Renderbaum übergibt jetzt die Berichtssprache an Achsen, Datenbeschriftungen und Tooltips.
   Neuer SVG-Regressionstest mit `de-DE`/`en-US`, Säulen, zweiter Achse, Radar und Kreis.

Die `modelDescription`s wurden anhand der echten Fehlversuche präzisiert: AL-Dataitem-Name
statt Tabellenname, Layoutpfade relativ zur `app.json`, Rendering vor Labelanlage registrieren,
wiederholte Container, Speicher-/Buildverhalten und Grenzen der Textvorschau.
Ein erster abgebrochener Lauf bleibt als Fehlernachweis erhalten und zählt nicht als Erfolg.

## Nachweise

Lokale Artefakte unter `artifacts/qa-copilot-e2e/`: `create-fixed-chat.json` (echter Copilot-Lauf),
`create-validation-final.json` (unabhängige Dateiprüfung), `modify-before-window-recovery.rdl`
und `modify-intermediate-validation.json` (unvollständiger Anpassungslauf).

Typecheck und **162/162 Unit-Tests** grün; drei neue Copilot-Regressionen **3/3** grün.
Erster Integrationslauf **57/58** bei parallelen Desktop-Eingaben: Direkttext-Test zweimal im Zeitlimit;
isoliert danach **1/1**. Ein Zusammenhang mit dem Fokus ist plausibel, aber nicht gesondert bewiesen.
Der nächste Gesamtlauf wurde durch den IDE-Neustart unterbrochen. Nach dem Neustart
**58/58 je Sprache** ohne Testwiederholung. Beim deutschen Lauf schlug erst das Aufräumen
nach Exit 0 wegen einer Windows-Dateisperre fehl; der Runner wiederholt diese Löschung jetzt begrenzt.
Nach der Diagrammkorrektur abschließend erneut **58/58 je Sprache**, jeweils Exit 0 einschließlich Aufräumen,
ohne Testwiederholung (`integration-en-chart-final.log`, `integration-de-chart-final.log`).
VSIX gebaut, geprüft und im QA-Profil installiert, SHA-256:
`3c34fd42fbfeb815b6a973b6336bb790fa4f9e7ffb8e8a67ef09649af4afb4b7`.

Die letzte RDP-Sitzung wurde getrennt, wodurch Windows MCP keine Desktopbilder mehr aufnehmen konnte.
Die abschließende Sichtkontrolle erfolgte deshalb automatisch über den lokalen Chromium-Debug-Anschluss
einer weiteren isolierten VS-Code-Instanz mit **installiertem VSIX** und den tatsächlichen Copilot-Dateien:
`06-revenue-final-page2.png`, `07-revenue-final-page1.png`, `final-designer-proof.json`.
Bestätigt: zwei Seiten, deutsche Euro-Achsen/-Datenbeschriftungen, vier korrekte Diagrammwerte,
vier verbundene Summenzellen (`colspan=3`) und unveränderte Gesamtsumme. Keine zusätzliche
manuelle Sichtprüfung dieser Abläufe erforderlich. Dies ist eine Designer-/Webview-Prüfung,
kein neuer nativer Maus-/Tastaturdurchgang nach der Diagrammkorrektur.
Die geprüften Aufgaben ersetzen keinen Test aller Modelle oder beliebiger XML-Konstruktionen.
