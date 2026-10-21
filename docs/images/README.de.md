# Dokumentationsbilder

[English](README.md) | Deutsch

Aufgenommen am 21.10.2026 über **Windows MCP** mit echten Desktop-Eingaben und Bildschirmaufnahmen.
Windows MCP `Screenshot` diente der Sichtkontrolle; die PNG-Dateien wurden über Windows MCP `PowerShell`
mit `System.Drawing.Graphics.CopyFromScreen` gespeichert. Es sind keine generierten Mockups.

Umgebung: Windows, 1620 × 952 Pixel Desktop, VS Code mit englischer Oberfläche, Report Builder 1.0.0
als Extension Development Host aus dem lokalen Build. Die Bilder sind auf den Anwendungsinhalt einschließlich
Editor-Tabs und Statusleiste beschnitten (1620 × 869 Pixel), ohne Desktop-Taskleiste und Fenstertitel.
Keine nachträgliche inhaltliche Bildbearbeitung.

Verwendet wurden separate Kopien von `samples/` in `artifacts/documentation/samples`; die Originale blieben unverändert.

| Datei | Motiv |
| --- | --- |
| `01-designer.png` | Verkaufsrechnung, Dokumentgliederung und Berichtseigenschaften |
| `02-berichtsdaten-al.png` | AL-Datenelemente und ausstehender Dataset-Build; bewusst veraltetes Beispiel |
| `03-ausdruck.png` | Ausdruck für `LineAmount_Line`, Live-Ergebnis aus erzeugten Beispieldaten |
| `04-gruppeneigenschaften.png` | Detailgruppe der Rechnung mit Sortierung nach Positionsnummer |
| `05-vorschau.png` | Unveränderter Umsatzbericht mit acht Zeilen aus `Umsatzbericht.data.json` |
| `06-export.png` | PDF-/Excel-/Word-/HTML-Auswahl derselben Vorschau |

Die Umsatzsumme beträgt 37.523,40 €, die Gesamtmenge 116. Der Unterbericht ist ein dokumentierter Platzhalter.
Die Bilder illustrieren die Bedienung; sie sind kein zusätzlicher Release-Test oder Nachweis einer BC-Ausführung.
