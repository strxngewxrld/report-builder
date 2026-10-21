# Abnahme der neuen Designer-Funktionen

Das frisch gebaute VSIX in einem separaten VS-Code-Profil installieren. Für AL-Änderungen und Tests mit echten
Umgebungen eine Kopie des Projekts verwenden. Englisch und Deutsch sowie mindestens Windows und macOS prüfen.

**Aktueller Stand 21.10.2026:** Abgehakte Punkte sind für die geprüften Windows-Abläufe erledigt, teils nativ im
installierten VSIX, teils automatisiert im echten Webview. Nachweise und genaue Grenzen stehen im
[Fix-/Abnahmeprotokoll](RELEASE-TEST-2026-10-20-FIXES.md). Eine Wiederholung dieser Windows-Fälle von Hand ist nicht nötig.
Die Acrobat-Nachprüfung einschließlich Schriftkorrektur steht im
[Windows-MCP-/Acrobat-Protokoll](RELEASE-TEST-2026-10-21-ACROBAT.md).
Die plattformübergreifende Abnahme und Screenreader sind separat offen.
Erste native NVDA-Fälle und weitere lokale Kombinationen sind im
[Absicherungsprotokoll](RELEASE-TEST-2026-10-21-ABSICHERN.md) dokumentiert; dies ersetzt keinen vollständigen Screenreader-Durchgang.

Die KI-Abnahme mit echtem Copilot wird separat im
[Copilot-Protokoll](RELEASE-TEST-2026-10-21-COPILOT.md) geführt: Rechnungsanlage mit AL-Build
und Anpassung eines bestehenden Reports bestanden; Summen und paginierte Vorschau unabhängig geprüft.

## KI-Berichte mit Copilot

- [x] Zusätzliches Rechnungs-RDLC aus vorhandenem AL-Report erstellen, fünf übersetzbare Labels,
      zwei Beispielrechnungen und erfolgreicher echter AL-Build.
- [x] Bestehenden Umsatzbericht mit Regionengruppen, Zwischen-/Gesamtsummen und Diagramm anpassen;
      alle acht Ursprungszeilen unverändert, vier Diagrammwerte stimmen mit den Gruppensummen überein.
- [x] XML-/Werkzeugwahl beobachten und Beschreibungen anhand der Fehlversuche präzisieren;
      Speicher-, Projektwurzel-, Textvorschau- und Diagramm-Sprachfehler beheben und nachprüfen.
- [x] Beide Rechnungsseiten nativ prüfen; abschließende Umsatzvorschau aus dem installierten VSIX
      einschließlich deutscher Diagrammwerte und lesbarer Summenzeilen prüfen. Wegen getrennter RDP-Sitzung
      erfolgte die letzte Prüfung per lokalem Designer-Debug-Anschluss mit Screenshots und DOM-Nachweis.

## Ausdrücke und Verwendungen

- [x] Über die Lupe im Designer oder den Befehl „Ausdrücke und Verwendungen…“ öffnen.
- [x] Nach einem Feldverweis suchen, der in einem Textfeld, einem Stil und einer Gruppe vorkommt.
      Alle Stellen erscheinen mit Elementname, Eigenschaft und Pfad; feste Texte werden nicht ersetzt.
- [x] „Groß-/Kleinschreibung beachten“ ein- und ausschalten; die Treffer ändern sich entsprechend.
- [x] Ersatztext eingeben: Vorher/Nachher vergleichen, eine Stelle ersetzen, danach alle übrigen.
      Ungültige Ausdruckssyntax verhindert das Ersetzen.
- [x] Dialog schließen, einmal Rückgängig: Die letzte Sammelersetzung wird vollständig zurückgenommen.
      Wiederholen stellt sie wieder her. Speichern und neu öffnen.
- [x] Modus „Feld- und Labelverwendungen“: Feld und AL-Label wählen, alle Verwendungen der Testberichte prüfen,
      auch in Tabellen und unverändert gespeicherten Bereichen. „Im Layout anzeigen“ springt zum Element.
- [x] Ausdruckssuche per Tastatur bedienen: Fokus bleibt im Dialog, Escape schließt ihn, danach ist der vorherige Fokus wieder aktiv.

## Layout-Bausteine

- [x] Kopfbaustein mit Textfeld und eingebettetem Logo auswählen. Über Bibliothek/Befehl
      „Auswahl als Baustein speichern…“ → „In Baustein-Bibliothek speichern“ sichern.
- [x] In einem anderen Report „Layout-Baustein einfügen…“ wählen. Baustein, Abschnitt und Position wählen.
      Logo und Gestaltung bleiben erhalten; fehlende Felder/Labels werden vorher angezeigt.
- [x] Bei fehlenden Abhängigkeiten bleibt Einfügen gesperrt, bis „Mit unaufgelösten Verweisen einfügen“ gewählt wird.
      Die Freigabe wurde mit absichtlich fehlenden Verweisen geprüft. Bei realer Verwendung anschließend die
      gemeldeten Abhängigkeiten im Zielprojekt ergänzen oder die Ausdrücke anpassen.
- [x] Denselben Baustein zweimal einfügen: Element- und Gruppennamen bleiben eindeutig. Interne ReportItems-Verweise,
      Drilldown-Ziele und Gruppenscopes zeigen auf die jeweils eingefügte Kopie.
- [x] Einfügen in einen noch nicht vorhandenen Seitenkopf/-fuß: Abschnitt wird angelegt (Windows: Kopf geprüft).
- [x] Einmal Rückgängig nimmt die Einfügung einschließlich neuer Bilder und neu übernommenem Code zurück.
- [x] Baustein als Datei exportieren und in einem anderen Profil importieren. Datei bleibt ein lesbares RDLC.
- [x] Gleichnamiges Bild mit anderem Inhalt bzw. abweichender Code-Block im Ziel: verständliche Fehlermeldung,
      keine teilweise Einfügung und kein Überschreiben des Zielcodes.
- [x] Bestehenden Bibliotheksnamen speichern und den Ersetzen-Dialog einmal abbrechen, einmal bestätigen.
      Windows, 20.10.2026: native Tastatur/Maus; Bibliotheksdateien vor/nach Ersetzen verglichen,
      siehe [Nachprüfung](RELEASE-TEST-2026-10-20-RESTPUNKTE.md). macOS für diesen Fall weiterhin offen.

Die Bausteine übernehmen Gestaltung, benötigte eingebettete Bilder und verwendeten Berichtscode. Datenquellen,
Abfragen, Parameterdefinitionen und AL-Datasets werden nicht übertragen; Abhängigkeiten gehören zum Zielreport.

## Vorschau und Export

- [x] Rechteck und Tabelle mit Seitenumbruch „Am Anfang“, „Am Ende“ und „Am Anfang und Ende“ prüfen.
      Nachfolgende Inhalte beginnen auf einer neuen Seite.
      Alle drei Varianten im echten Webview mit PDF-Seitenabgleich geprüft.
- [x] Gruppe mit Umbruch „Am Ende“: auch die letzte Gruppeninstanz trennt nachfolgende Inhalte ab.
- [x] `PageBreak/Disabled` und `ResetPageNumber` mit Ausdrücken pro Gruppe prüfen.
      Bedingung einmal wahr, einmal falsch; Seitenzahlen und Gesamtsummen kontrollieren.
      `Disabled = Paid` und `ResetPageNumber = Not Paid` mit zwei Belegen: letzte Seite je nach Variante
      „Seite 1“/„Seite 2“, Gesamtsumme 741; zusätzlich Modelltests für Ausdrücke.
- [x] Zusammenfallende Umbrüche (Gruppe und Container) erzeugen keine zusätzlichen Leerseiten;
      der angeforderte Neustart der Seitennummerierung bleibt erhalten.
- [x] Einen Bericht mit langen Texten und mehreren Schriften öffnen, mehrfach zwischen Entwurf und Vorschau wechseln.
      Seitenaufteilung bleibt nach dem Laden der Schriften stabil.
- [x] Direkt nach Öffnen der Vorschau als PDF exportieren; Seitenzahl und Umbrüche mit der Vorschau vergleichen.
      PDF-Erzeugung, Seitenzahlen/-größen und eingebettete Schriften automatisiert geprüft; zusätzlich sofortiger
      Export während eines Datenwechsels mit 120 neuen Zeilen.
- [x] Gesonderte Sichtkontrolle von Schriften, Umlauten und Sonderzeichen in Acrobat.
      Acrobat Reader 64 Bit 26.2.22031.0, nativ über Windows MCP: eingebettete Schriften einschließlich Segoe UI Light,
      Fett/Kursiv, Umlaute/ß/€/Gedankenstrich, PNG-Logo und beide A4-Rechnungsseiten geprüft.
      Falsche Ersatzschrift bei „Segoe UI Light“ behoben; Export aus dem neu installierten VSIX nachgeprüft.

## Ergebnis

- VS-Code-Version / Betriebssystem: 1.142.0 / Windows Server 2025, RDP 1620 × 952.
- BC-Version / Umgebung: lokale neue Abnahme ohne BC-Änderungen; BC 29 on-prem im vorherigen Windows-Protokoll.
- Getestete Reports: Beispieldateien und isolierte Abnahme-Fixtures, siehe Fix-Protokoll.
- Befunde: Zwischenablage, Bildvalidierung, Workspace Trust, PDF-Schriftfamilien und Tastaturbedienung von
  Diagrammtypen/Vorschau-Schaltern sowie Validierungsansagen behoben und nachgeprüft; zusätzlich KI-Speichern,
  AL-Projektwurzel und Berichtssprache in Text-/Diagrammvorschau, siehe Copilot-Protokoll.
- Abnahme: Codex, automatisierte und native Windows-Tests am 20./21.10.2026; 162 Unit-Tests,
  abschließend 58/58 Integrationstests je Sprache ohne Wiederholung. Native NVDA-Fälle, weitere Kombinationen und
  Grenzen im Absicherungsprotokoll; der frühere Acrobat-Lauf hatte einen wiederholten deutschen Drag-Test.
