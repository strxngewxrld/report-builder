# Änderungsprotokoll

[English](CHANGELOG.md) | Deutsch

Alle nennenswerten Änderungen an der Erweiterung. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [1.0.0] - 2026-10-18

### Korrigiert bei der macOS-Nachprüfung (21.10.2026)
- CI auf Node 24 aktualisiert: Testdatei-Platzhalter funktionieren damit auch unter Windows,
  und die Node-Anforderungen der Build-/Paketwerkzeuge werden erfüllt.

### Korrigiert bei der Windows-Abnahme (21.10.2026)
- KI-Werkzeuge: AL-Build speichert auch unsichtbare, durch Werkzeuge geänderte Dokumente
  und bricht bei Speicherfehlern ab. AL-Projektwurzel über `app.json` auch ohne Workspace-Zuordnung
  bestimmen. Textvorschau verwendet die Berichtssprache und kennzeichnet Kopf-/Fußzeilen als
  unpaginierten Snapshot mit Seitenzahl-Platzhaltern. Diagrammachsen, Datenbeschriftungen und
  Tooltips berücksichtigen ebenfalls die Berichtssprache. Werkzeugbeschreibungen anhand
  echter Copilot-Aufgaben präzisiert.
- Tastaturbedienung: Diagrammtypen mit Pfeiltasten/Home/End und einem Tabstopp auswählen;
  Validierungsfehler werden als Warnung angesagt. Drilldown und interaktive Sortierung in der Vorschau
  sind per Tastatur erreichbar und auslösbar; Drilldown meldet seinen aufgeklappten Zustand.
- PDF-Export erkennt neben typografischen auch klassische Schriftfamiliennamen. Dadurch wird etwa
  „Segoe UI Light“ korrekt eingebettet; eine breitere Ersatzschrift verschluckt keine Wortabstände mehr.

### Hinzugefügt
- Vollständige englische Fassungen der historischen Testprotokolle, UI-Matrix und des Changelogs mit deutschen
  Gegenstücken; vollständiges Dokumentationsverzeichnis und Prüfung aller Sprachpaare.
- Anwenderdokumentation und README standardmäßig auf Englisch, zusätzlich auf Deutsch mit Sprachwechsel-Links.
  Neue KI-Tools-Referenz in beiden Sprachen; Getting Started öffnet alle drei Anleitungen passend zur
  Oberflächensprache (Englisch als Fallback), einschließlich Offline-Dateien im VSIX.
- **Getting Started** als nativer VS-Code-Walkthrough auf Deutsch und Englisch: bearbeitbare Beispielkopie mit
  Vorschaudaten, Entwurf, Vorschau, AL-Dataset und Export. Über **Erste Schritte** erneut aufrufbar;
  Anwenderhandbuch und Umstiegsanleitung mit Screenshots sind auch offline im VSIX enthalten.
- **KI-Werkzeuge für GitHub Copilot** (Agentenmodus, `vscode.lm`): 14 Tools, mit denen ein Sprachmodell RDLC-Berichte
  vollständig bauen kann – Überblick mit XML-Zeilennummern, Prüfung (auch falsch geschachtelte Tags, `Fields!` im
  Seitenkopf, Leerseiten durch zu breiten Textkörper), Vorschau als Text, AL-Kontext mit Tabellenfeldern aus den Symbolen;
  Einfügen von Elementen, Tabellen-/Gruppenstruktur, Diagramme, Anordnen, Seitenlayout; AL-Spalten und -Labels, Spalte
  umbenennen, Projekt erstellen, Anzeige im Designer. Einfache Eigenschaften ändert die KI direkt im XML.
  Voraussetzung jetzt VS Code 1.95
- **Updates**: Beim Start sucht die Erweiterung in den GitHub Releases nach einer neueren Version und bietet an, sie direkt
  zu installieren (VSIX mit geprüfter SHA-256-Prüfsumme), den Release zu öffnen oder die Version zu überspringen
  (Einstellung `bcReportBuilder.checkForUpdates`)
- Veröffentlichung als GitHub Release (`npm run publish:github`, mit Probelauf), Prüfung der fertigen VSIX und
  `THIRD_PARTY_NOTICES.md` mit den Lizenzen der gebündelten Pakete
- **Ausdrücke und Verwendungen**: Suchen/Ersetzen mit Vorher/Nachher, Einzel-/Sammelersetzung und Syntaxprüfung;
  Verwendungsübersicht für Felder und AL-Labels mit Sprung ins Layout, auch für Gruppen, Stile und erhaltene XML-Bereiche
- **Layout-Bausteine**: Auswahl in der profilweiten Bibliothek speichern oder als RDLC exportieren, in anderen Reports
  mit Abschnitt-/Positionsauswahl einfügen; eindeutige Namen, angepasste interne Verweise, eingebettete Bilder und
  Berichtscode, Prüfung fehlender Abhängigkeiten und Vermeidung von Code-/Bildkonflikten
- DOM-Integrationstests für die Ausdruckssuche und den Bausteinimport einschließlich Rückgängig;
  manueller Abnahmeplan unter `docs/ABNAHME.md`
- **PDF-Export mit eingebetteten Schriften**: die installierten TrueType-/OpenType-Schriften des Berichts (auch aus
  `.ttc`-Sammlungen) werden als Teilmenge eingebettet – alle Unicode-Zeichen der Schrift statt nur WinAnsi; Schriften
  ohne Einbettungsrecht und fehlende Schriften fallen auf die PDF-Standardschriften zurück
- **Diagramme**: Trichter, Pyramide, Bereich, Bereichssäulen/-balken (oberer und unterer Wert), Polar und Netz;
  berechnete Reihen (gleitender, exponentieller, gewichteter und dreieckiger Durchschnitt, Mittelwert, Median) als
  gestrichelte Linie; Farbe der Datenpunkte (auch als Ausdruck je Punkt) und Markierungen
- **Spaltengruppen auch bei vorhandenen Spaltenköpfen**: weitere Spaltengruppen in Tabellen mit Spaltengruppe und
  Elterngruppen um die Spaltengruppe einer Matrix; die Ecke wächst und schrumpft mit den Kopfebenen
- `<Code>`-Block: `Try`/`Catch` (mit `When`)/`Finally`, `Throw`, `Exit Try`, `With`/`End With`, Arrays (`Dim a(5)`,
  `{…}`-Initialisierung, mehrere Dimensionen, `ReDim [Preserve]`, `a(i) = x`, `UBound`/`LBound`, `Array.IndexOf/Sort/Reverse`),
  mehrere Variablen in einem `Dim`; nicht initialisierte Zahlen sind 0 und Wahrheitswerte `False`
- **Englische Oberfläche**: Die Erweiterung folgt der Anzeigesprache von VS Code (Englisch und Deutsch) – Befehle, Menüs,
  Einstellungen, Meldungen, Prüfungen, Designer, Dialoge und Vorschau
- **PDF-Export** direkt aus der Vorschau (`pdf-lib`): Text, Rahmen und Hintergründe als Vektoren, Bilder und Diagramme eingebettet
- **Diagramme**: Achsen (Titel, Zahlenformat, Minimum/Maximum), Datenbeschriftungen, zweite Werteachse, Typ je Reihe
  (Kombidiagramm), neue Typen Säulen 100 %, Linie geglättet, Fläche gestapelt, Punkte
- **Messgeräte** (GaugePanel, rund und linear) in Vorschau und Designer statt Platzhalter
- **Spaltengruppen** zu bestehenden Tabellen hinzufügen und löschen; Spalteneigenschaften *Ausblenden* und *Umschalten durch*
- **Aktionen** an Textfeldern und Bildern (Hyperlink, Lesezeichen-Link, Drillthrough mit Parametern) und Lesezeichen;
  in der Vorschau anklickbar
- **Eingebettete Bilder** verwalten: einbetten, umbenennen (mit Anpassung der Bildelemente), löschen, auf die Fläche ziehen
- Textfeld **in Textteile aufteilen** und Textteile **zu einem einfachen Textfeld zusammenfassen**
- **Spalte umbenennen** in AL und allen RDLC-Layouts des Reports und seiner Report-Extensions (ein Rückgängig-Schritt)
- **Layouts des Reports** in *Berichtsdaten*: zwischen RDLC-Layouts wechseln, Word-/Excel-Layouts extern öffnen
- **Labels** mit `Comment`, `MaxLength` und `Locked` anlegen; Hinweise zu XLIFF-Übersetzungsdateien
- `<Code>`-Block in der Vorschau: `For`/`Next` (mit `Step`), `For Each`, `While`/`End While`, `Do`…`Loop`
  (`While`/`Until` vorn oder hinten), `Select Case` (Werte, Bereiche mit `To`, `Is <op>`, `Case Else`),
  `Exit`/`Continue For|Do|While`, Zuweisungen mit `*=` und `/=`
- **Barrierefreiheit**: Tab-Navigation, Größe per Alt+Pfeiltasten und Bearbeiten per Eingabe/F2 auf der Entwurfsfläche,
  Screenreader-Beschriftungen und -Ansagen, Hervorhebungen in Hochkontrast-Designs
- CI-Workflow (Typecheck, Unit-, Integrations-, Korpus-Test), `LICENSE`, dieses Änderungsprotokoll

### Geändert
- *Als AL-Label anlegen* ändert Label und Textfeld in einem Bearbeitungsschritt – ein Rückgängig nimmt beides zurück
- Integrationstests: Zeitlimits über `BC_RB_TIMEOUT_SCALE` skalierbar, ein zweiter Versuch je Test, Warten auf das
  Schließen des vorherigen Designers; neue Tests für Label, Spalten, Umbenennen, Layouts, PDF und Tabellenbefehle

### Behoben
- PDF-Export während einer Neuberechnung der Vorschau: Exportanfragen werden bis zur Vermessung vorgemerkt;
  Seitenzahlen und Export verwenden nur Messwerte des aktuellen Berichts-/Datenstands.
- Kopieren/Einfügen zwischen geöffneten Berichten: gemeinsame Designer-Zwischenablage mit Bildern, Code,
  eindeutigen Namen und angepassten internen Verweisen; Konflikte brechen ohne Teiländerung ab, gemeinsames Undo.
- Defekte Bilddateien werden vor dem Einbetten tatsächlich dekodiert und mit Fehlermeldung abgelehnt;
  dieselbe Prüfung gilt für das KI-Werkzeug zum Einfügen von Bildern.
- Eingeschränkter Workspace: Build, Symbol-Download und BC-Aufruf verlangen Vertrauen, auch vor Metadatenabruf
  und Windows-Anmeldung; Build-Werkzeug ebenfalls gesperrt. Entwurf und Vorschau bleiben verfügbar (`limited`).
- Vorschau: Umbrüche vor/nach Rechtecken und Datenbereichen; Gruppen-Umbrüche „Am Ende“ auch nach der letzten Instanz,
  ausdrucksgesteuertes `Disabled` und `ResetPageNumber`; zusammenfallende Umbrüche behalten den Seitenzahl-Neustart
- Vorschau und PDF-Export warten auf geladene Schriften, bevor Seiten vermessen bzw. exportiert werden
- Die Diagrammlegende schnitt kurze Kategorienamen ab („J…“ statt „Jan“)
- Leere Elemente, die das Layout als `<X></X>` schreibt (z. B. `<Visibility></Visibility>`), werden nicht mehr als
  `<X />` gespeichert – alle 379 Base-App-Layouts bleiben auch bei kompletter Neuerzeugung zeichengleich
- Vorschau mit generierten Business-Central-Daten: Die Positionszeilen blieben leer, weil nur die Spalten der ersten
  (Kopf-)Zeile übernommen wurden; dasselbe galt für Beispieldaten, deren erste Zeile Spalten auslässt
- Vorschau: Ein gerade mit *Als AL-Label anlegen* erzeugtes Label zeigt bis zum nächsten AL-Build seinen Text statt `#Error`
- AL-Labels, -Spalten und `add()`-Blöcke übernehmen das Zeilenende der AL-Datei (CRLF unter Windows)
- Tastatur: Nach dem direkten Texteditor (Ctrl+Enter/Escape), einem Kontextmenü oder einem daraus geöffneten Dialog bleibt
  der Fokus auf der Designfläche; Shift+F10 und die Kontextmenütaste öffnen das Menü des ausgewählten Elements
  (vorher kein Menü, unter macOS gar keine Reaktion)
- Per Drag-and-drop oder Klick eingefügte Elemente ragen nicht mehr über den rechten Rand von Textkörper bzw.
  Listen-Rechteck hinaus (der Textkörper wurde breiter, gedruckt entstanden Leerseiten)
- Designer: Textfelder verwenden die Zeilenhöhe der Schrift wie Vorschau und PDF (vorher 1,2-fach; Unterlängen und
  Unterstriche wurden in niedrigen Feldern früher abgeschnitten als in der Ausgabe)
- Geteilter Editor bzw. schnelles Schließen und Wiederöffnen: Befehle aus Titelleiste und CodeLens gingen an den zuletzt
  geöffneten statt an den fokussierten Designer, und das Schließen eines Designers konnte den anderen derselben Datei
  abmelden (Befehle wirkten dann nicht mehr)
- Excel-Export: Zahlen behalten das Format des Textfelds (N0, N2, F, P, D und eigene Muster wie `#,##0.00`) statt eines
  einheitlichen `#,##0.##` (Excel zeigte 167,1 statt 167,10 und 530, mit Komma); Datumswerte werden echte Excel-Daten im
  Datumsformat statt Text (Excel markierte sie als „Textdatum“)
- `THIRD_PARTY_NOTICES.md` wird mit LF erzeugt – unter Windows (`core.autocrlf`) veränderte jeder Build die Datei, und
  `npm run publish:github` brach deshalb nach dem Paketbau ab
- *Report in BC ausführen* (on-prem): Die URL wurde aus `server` der launch.json ohne Webclient-Port gebildet
  (`http://localhost/BC290/?report=…` → HTTP 500, der Webclient einer BC-Installation von der DVD läuft auf Port 8080).
  Die Adresse kommt jetzt wie bei der AL-Erweiterung (`usePublicURLFromServer`) aus den Metadaten des
  Developer-Endpunkts (`webEndpoint` = `PublicWebBaseUrl`), mit Windows-Anmeldung; ohne Antwort wie bisher.
  Die Server-Adresse aus der launch.json des Arbeitsbereichs wird dabei nur als normalisierte http(s)-URL und als
  Daten an PowerShell übergeben, nie als Teil des Befehls
- *Als AL-Label anlegen* in einem Report ohne `labels`-Block legte ihn direkt hinter `dataset` an, vor `requestpage`/
  `rendering` – der AL-Compiler (BC 29) lehnt das ab (AL0926 „expected section order is: dataset, requestpage,
  rendering, labels“). Der Block steht jetzt hinter dem letzten dieser Abschnitte
- Vorschaudaten aus Business Central 29 (*Senden an › Microsoft Excel-Dokument (nur Daten)*) ergaben 0 Zeilen:
  BC schreibt die Arbeitsmappe mit Namespace-Präfix (`<x:row>`, `<x:c>`), das der Leser nicht kannte
- Vorschau mit generierten Daten für Layouts, die der AL-Compiler geschrieben hat (ohne `rd:TypeName`): Firmenname,
  Beschreibung, Belegnummer und Datum erschienen als Zahlen, weil `=Fields!X.Value</Value>` als Vergleich `<` galt.
  Spalten mit `…Format`-Begleitspalte gelten jetzt als Dezimalzahlen, `NoOf…` als Zahlen
- Vorschau wie der Berichtsviewer von Business Central: Der Wert eines ausgeblendeten Textfelds wird nur ausgewertet,
  wenn ein Ausdruck ihn über `ReportItems` liest. `=Code.SetData(…)` als Wert eines ausgeblendeten Textfelds füllte
  bisher den Seitenkopf in der Vorschau, in BC blieb er leer. Das Beispiel `Verkaufsrechnung.rdlc` ruft `SetData` jetzt
  wie die Base App im `Hidden`-Ausdruck auf (in BC 29 gegengeprüft)
- Deutsche Base-App-Layouts: Feldnamen mit Umlauten (`Fields!…auswählen_Caption`) ergaben in der Vorschau `#Error` und
  in der Prüfung „Feld existiert nicht“; `Code.PageNo` für eine `Shared`-Variable galt als „nicht definiert“;
  `Microsoft.VisualBasic.Strings.Len(…)` (Mahnung) und `.Replace`/`.StartsWith`/`.EndsWith`/`.IndexOf` an Texten
  werden ausgewertet
- Standardformate `d`, `g` und `G` mit vierstelligem Jahr und ohne Komma vor der Uhrzeit wie in .NET/Business Central
  (`24.01.2028` statt `24.01.28`) – in Vorschau, PDF und Word-Export
- Word-Export: Seitenumbrüche des Berichts (z. B. ein Beleg je Seite) bleiben erhalten, und Word öffnet die Datei nicht
  mehr im Kompatibilitätsmodus
- Excel-Export: Das Währungsformat `C` behält das Währungssymbol (`4.380,50 €` statt `4.380,50`)

## [0.1.0] – 2026-10-17

Erste Fassung: visueller RDLC-Designer mit Dokumentgliederung, AL-Report als Datenquelle, Bearbeiten des AL-Reports
aus dem Designer, Prüfung im Problembereich, paginierte Vorschau mit `<Code>`-Interpreter, Tabellen/Gruppen/Listen/
Matrizen/Diagramme, quellerhaltendes Speichern sowie Excel-/Word-/HTML-Export der Vorschau.
