# Vom Microsoft Report Builder zu VS Code

[English](MIGRATION.md) | Deutsch

Diese Anleitung richtet sich an Anwender des **eigenständigen Microsoft Report Builder**, die ihre RDLC-/RDL-Layouts
mit dem **Business Central Report Builder in VS Code** bearbeiten möchten. Auch für Anwender des RDLC-Designers
in Visual Studio enthält sie die wichtigsten Zuordnungen. Das Projekt liefert eine VS-Code-Erweiterung;
eine separate Standalone-Ausgabe dieser Erweiterung gehört nicht zum hier dokumentierten Umfang.

Stand: 21.10.2026, Version 1.0.0. Die Screenshots zeigen die englische Oberfläche unter Windows.
Für die vollständigen Arbeitsabläufe siehe [Anwenderhandbuch](ANWENDERHANDBUCH.md).
Den Einsatz der KI-Werkzeuge beschreibt die [KI-Tools-Dokumentation](AI-TOOLS.de.md).

## Was Sie weiterverwenden können

Bestehende `.rdlc`- und `.rdl`-Dateien lassen sich direkt öffnen. Es gibt keinen vorgeschalteten Import in ein
eigenes Dateiformat. Textfelder, Ausdrücke mit `Fields!` und `Parameters!`, Tabellen, Gruppen, Bilder, Kopf- und
Fußbereiche bleiben die vertrauten RDL-Konzepte.

Der Designer speichert Änderungen quellerhaltend: unveränderte Elemente bleiben wortgleich, und nicht modellierte
Inhalte bearbeiteter Elemente bleiben erhalten. Das bedeutet nicht, dass jede RDL-Funktion visuell bearbeitbar oder
in der lokalen Vorschau ausführbar ist. Bei komplexen Altbeständen zuerst mit einer Kopie arbeiten und den Diff prüfen.

Der wichtigste Unterschied liegt bei **Daten und Ausführung**: Die lokale Vorschau fragt keine SQL-/SSRS-Datenquelle
ab. Bei Business Central ist der AL-Report die Quelle für Datenelemente, Spalten und Labels. Für andere RDL-Dateien
lassen sich die Layoutdefinitionen bearbeiten; eine Verbindung zum Berichtsserver samt Serververwaltung oder
Veröffentlichung ersetzt die Erweiterung nicht.

## Wo finde ich was?

![VS-Code-Designer mit Gliederung, Layoutfläche, Formatleiste und Eigenschaften](images/01-designer.png)

| Gewohnte Aufgabe | Im Report Builder für VS Code |
| --- | --- |
| Bericht öffnen | Projektordner öffnen, `.rdlc`/`.rdl` im Explorer wählen; bei XML **Im Designer öffnen** |
| Neues Layout | Ordner-Kontextmenü **Neues Berichtslayout…** oder **Datei › Neue Datei… › Berichtslayout (RDLC)** |
| Menüband „Einfügen“ | Symbolleiste über der Fläche, **Einfügen** in der Editor-Titelleiste oder Befehlspalette |
| Berichtsdaten | Register **Berichtsdaten** (Report Data) links im Designer |
| Eigenschaftenfenster | **Eigenschaften** (Properties) rechts; Auswahl auf der Fläche oder in der Gliederung |
| Berichtsstruktur untersuchen | **Dokumentgliederung** (Outline) links, einschließlich verschachtelter Zellinhalte und Gruppen |
| Ausdrucksdialog | Rechtsklick auf Textfeld/Zelle › **Ausdruck…**, alternativ Eigenschaft **Wert** |
| Zeilen-/Spaltengruppen | Tabelle auswählen; Bereich **Gruppierung** unterhalb der Fläche |
| Zeile/Spalte einfügen oder Zellen verbinden | Zelle auswählen › Kontextmenü **Tabelle** |
| Gruppeneigenschaften | Zahnrad in **Gruppierung** oder Gruppen-Kontextmenü |
| Seitengröße und Ränder | **Berichtseigenschaften…** oder Berichtseigenschaften ohne Elementauswahl |
| Seitenkopf/-fuß einblenden | Entsprechende Befehle im „…“-Menü der Editor-Titelleiste oder im Kontextmenü |
| Ausrichten / gleiche Größe | Formatleiste bzw. **Ausrichten und anordnen** |
| Ausführen / Vorschau | **Vorschau anzeigen** oder `F5` bei aktivem Designer |
| Export / Drucken | Exportmenü und **Drucken** in der Vorschau |
| Bericht als XML bearbeiten | **Als XML öffnen**; zurück mit **Im Designer öffnen** |
| Fehler und Warnungen | VS-Code-Problembereich (`Strg+Umschalt+M`) und Markierungen in der Gliederung |
| Speichern / Rückgängig | VS-Code-Befehle `Strg+S` / `Strg+Z`; ungespeicherte Änderungen am Editor-Tab erkennbar |

Die VS-Code-Befehlspalette (`Strg+Umschalt+P`) ist ein guter Einstieg, wenn ein Symbol ungewohnt ist:
nach **Business Central Report Builder** und dem Befehlsnamen suchen.

## Den ersten vorhandenen Bericht übernehmen

1. Den Ausgangsstand in Git sichern oder eine Arbeitskopie des Projekts anlegen. Zugehörige AL-Dateien und Bilder
   mitnehmen, damit Referenzen auflösbar bleiben.
2. Die Erweiterung aus dem VSIX-Paket installieren; siehe [Installation](ANWENDERHANDBUCH.md#installation-und-erster-start).
3. Den Projektordner öffnen. Bei BC sollte die zugehörige `app.json` im Projekt liegen.
4. Die Layoutdatei öffnen und in der Dokumentgliederung Seitenkopf, Textkörper, Tabellen und Seitenfuß prüfen.
5. Ein einfaches Textfeld auswählen, Schrift oder Ausrichtung ändern, speichern und den Git-Diff ansehen.
6. Eigene Vorschaudaten laden und mit `F5` die Vorschau öffnen. Erst dann Beträge und Gruppierung vergleichen.
7. PDF exportieren und im PDF-Betrachter prüfen. Bei Business Central zusätzlich im Zielsystem ausführen.

Zum Üben eignet sich eine Kopie von `samples/Umsatzbericht.rdl` zusammen mit `Umsatzbericht.data.json`.
Die Vorschau sollte acht Positionen, Menge **116** und Umsatz **37.523,40 €** zeigen. Der vorhandene Unterbericht
bleibt ein Platzhalter; seine Ausführung ist kein Bestandteil dieses lokalen Vergleichs.

## Der BC-Unterschied: AL statt Dataset-Dialog

![Berichtsdaten der Verkaufsrechnung mit AL-Spalten und Build-Markierungen](images/02-berichtsdaten-al.png)

Wenn der Designer einen BC-Report erkennt, zeigt **Berichtsdaten** den AL-Baum. Datenquellen-, Dataset- und
Parameterdialoge sind in diesem Modus ausgeblendet. Das ist beabsichtigt: Der AL-Compiler erzeugt das Layout-Dataset.

| Bisheriger Gedanke | Arbeitsablauf bei einem BC-Layout |
| --- | --- |
| „Ich ergänze das Feld im Dataset des Layouts.“ | Spalte im AL-Report ergänzen, etwa über **Felder als Spalten hinzufügen…**, dann Projekt erstellen |
| „Meine neue Spalte ist schon in AL, also ist sie im Layout verfügbar.“ | Bei **Build**-Markierung zuerst **Projekt erstellen (AL: Package)**; Compilererfolg prüfen |
| „Die Überschrift schreibe ich direkt in das Textfeld.“ | Für übersetzbare BC-Texte **Als AL-Label anlegen…** verwenden und anschließend bauen |
| „Ich benenne das Feld nur im Layout um.“ | **Spalte umbenennen (AL und Layouts)…** verwenden, damit die zugehörigen Dateien zusammenpassen |
| „Ich öffne den Dataset-Query-Designer.“ | Datenbeschaffung und Datenelement-Verknüpfung im AL-Report bearbeiten |
| „Vorschau holt die echten Serverdaten.“ | Exportierte Excel-/CSV-/JSON-Daten laden; echten Bericht anschließend in BC prüfen |

Ein neues Layout muss im AL-Report über `rendering`/`LayoutFile` oder `RDLCLayout` referenziert sein.
Ein **Neues Berichtslayout…** allein erzeugt keinen AL-Report und keine Rendering-Zuordnung.
Layoutpfade beziehen sich auf die Projektwurzel mit `app.json`.

Bei Dezimalwerten die BC-Formatfelder und bei Beschriftungen die Caption-Parameter beibehalten.
Beim Ziehen eines Felds berücksichtigt der Designer diese Konventionen automatisch.

## Vertraute Ausdrücke und Gruppen verwenden

![Ausdruckseditor mit unveränderter RDL-Feldsyntax](images/03-ausdruck.png)

Die Ausdruckssyntax bleibt erhalten, beispielsweise `=Fields!Umsatz.Value` und `=Sum(Fields!Umsatz.Value)`.
Im Ausdruckseditor helfen Feldliste, Vervollständigung (`Strg+Leertaste`) und ein Live-Ergebnis.
Fehlende Feld-, Label- oder Code-Verweise erscheinen zusätzlich im Problembereich.

Beim Arbeiten mit Gruppen bleiben die Unterschiede zwischen **Detailzeile**, **Gruppenkopf/-fuß** und Zeilen
**außerhalb einer Gruppe** entscheidend. Eine Summe im Gruppenfuß berechnet die Gruppe; die Gesamtsumme benötigt
den passenden Bereich außerhalb der Detail-/Regionsgruppe. **Nur Gruppe löschen** erhält Zeilen,
**Gruppe mit Zeilen löschen** entfernt die zugehörige Struktur.

![Detailgruppeneigenschaften mit Sortierung und Sichtbarkeit](images/04-gruppeneigenschaften.png)

Die Gruppeneigenschaften erreichen Sie über das Zahnrad im unteren Bereich **Gruppierung**.
Der Screenshot zeigt eine Detailgruppe. Gruppen nach einem Feld bieten zusätzliche Einstellungen für
Gruppierung und Seitenumbrüche. Wiederholte Tabellenüberschriften werden über die Zeileneigenschaften gesteuert.

## Vorschau und Export umstellen

**Vorschaudaten laden (Excel, CSV, JSON)…** importiert tabellarische Daten. Bei JSON erwartet der Importdialog
ein Array von Objekten. Die daneben gespeicherte `<Layoutname>.data.json` enthält dagegen ein Objekt mit
Dataset-Namen als Schlüsseln. Die beiden Formate sind im
[Datenkapitel](ANWENDERHANDBUCH.md#vorschaudaten-laden-und-ergebnisse-prüfen) mit Beispielen beschrieben.

![Paginierte lokale Vorschau des Umsatzbeispiels mit geladenen Daten](images/05-vorschau.png)

Ohne Datendatei werden Beispieldaten erzeugt. Damit können Sie Positionen und Formate beurteilen, aber keine
fachlichen Summen abnehmen. Testdaten sollten mehrere Gruppen, lange Texte, Null-/Leerwerte und genügend
Positionen für mehrere Seiten enthalten.

![Exportauswahl in der Vorschau](images/06-export.png)

Für eine paginierte Datei **PDF** wählen. **Drucken** öffnet die Vorschau im Browser.
Excel und Word dienen der Weiterverarbeitung von Daten und Texten; sie bilden das Layout nicht pixelgenau ab.
Für PDF müssen die gewünschten Schriften lokal verfügbar und einbettbar sein.

Die lokale Vorschau nähert sich der Berichtsausführung an. Sie führt keine echten Datenbankabfragen und keine
Unterberichte aus; Karten erscheinen ebenfalls als Platzhalter. Bestehender VB-Code wird nur im unterstützten
Sprachumfang interpretiert. Deshalb das Ergebnis bei anspruchsvollen Layouts zusätzlich mit der tatsächlichen
Ausgabe in Business Central bzw. der bisherigen Zielumgebung vergleichen.

## Häufige Stolperstellen beim Wechsel

| Beobachtung | Nächster Schritt |
| --- | --- |
| „Ich sehe nur XML.“ | **Im Designer öffnen** im Explorer-Kontextmenü wählen |
| „Die Fläche ist zu klein.“ | VS-Code-Seitenleiste mit `Strg+B` schließen, interne Bereiche über **Ansicht** steuern, Zoom in der Statusleiste ändern |
| „Ich finde das Menüband nicht.“ | Symbolleiste, Editor-„…“-Menü, Kontextmenü und Befehlspalette verwenden |
| „Mein neues AL-Feld fehlt.“ | AL-Zuordnung und Build-Ausgabe prüfen; das Dataset wird vom Compiler aktualisiert |
| „Meine Vorschauwerte sehen erfunden aus.“ | Eigene Daten laden und die Anzeige geladener Daten in der Vorschau prüfen |
| „Nach der Änderung gibt es eine leere Seite.“ | Breite plus Ränder, überstehende Elemente und Gruppen-/Elementumbrüche prüfen |
| „Die Berichtssprache passt nicht zur Oberfläche.“ | Berichtssprache und Formatfelder prüfen; Anzeigesprache und Berichtssprache sind getrennte Einstellungen |
| „Ein altes Spezialelement fehlt in der Vorschau.“ | Funktionsgrenzen prüfen; bei Karten/Unterberichten ist der Platzhalter zu erwarten |

## Checkliste für die erste Abnahme

- [ ] Layout und AL-Zuordnung stimmen; benötigte Spalten und Labels sind nach erfolgreichem Build im Dataset.
- [ ] Änderungen im Git-Diff geprüft; keine unbeabsichtigten Layoutänderungen.
- [ ] Repräsentative Daten geladen; Zeilen, Gruppen und Summen mit dem Ausgangsbericht verglichen.
- [ ] Alle Vorschauseiten geprüft, einschließlich wiederholter Köpfe und letzter Seite jeder Gruppe.
- [ ] Berichtssprache, Zahlenformate, Logos und Schriften stimmen.
- [ ] PDF geöffnet; Ausgabe mit der Zielumgebung verglichen.
- [ ] Nicht lokal ausgeführte Funktionen ausdrücklich im Zielsystem geprüft.

Für weitere Arbeitsschritte siehe das [Anwenderhandbuch](ANWENDERHANDBUCH.md), für den vollständigen Funktionsumfang
und bekannte Grenzen die [README](../README.de.md).
