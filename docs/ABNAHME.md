# Abnahme der neuen Designer-Funktionen

Das frisch gebaute VSIX in einem separaten VS-Code-Profil installieren. Für AL-Änderungen und Tests mit echten
Umgebungen eine Kopie des Projekts verwenden. Englisch und Deutsch sowie mindestens Windows und macOS prüfen.

## Ausdrücke und Verwendungen

- [ ] Über die Lupe im Designer oder den Befehl „Ausdrücke und Verwendungen…“ öffnen.
- [ ] Nach einem Feldverweis suchen, der in einem Textfeld, einem Stil und einer Gruppe vorkommt.
      Alle Stellen erscheinen mit Elementname, Eigenschaft und Pfad; feste Texte werden nicht ersetzt.
- [ ] „Groß-/Kleinschreibung beachten“ ein- und ausschalten; die Treffer ändern sich entsprechend.
- [ ] Ersatztext eingeben: Vorher/Nachher vergleichen, eine Stelle ersetzen, danach alle übrigen.
      Ungültige Ausdruckssyntax verhindert das Ersetzen.
- [ ] Dialog schließen, einmal Rückgängig: Die letzte Sammelersetzung wird vollständig zurückgenommen.
      Wiederholen stellt sie wieder her. Speichern und neu öffnen.
- [ ] Modus „Feld- und Labelverwendungen“: Feld und AL-Label wählen, alle Verwendungen prüfen,
      auch in Tabellen und unverändert gespeicherten Bereichen. „Im Layout anzeigen“ springt zum Element.
- [ ] Nur per Tastatur bedienen: Fokus bleibt im Dialog, Escape schließt ihn, danach ist der vorherige Fokus wieder aktiv.

## Layout-Bausteine

- [ ] Firmenkopf mit Textfeldern und eingebettetem Logo auswählen. Über das Bibliothek-Symbol
      „Auswahl als Baustein speichern…“ → „In Baustein-Bibliothek speichern“ sichern.
- [ ] In einem anderen Report „Layout-Baustein einfügen…“ wählen. Baustein, Abschnitt und Position wählen.
      Logo und Gestaltung bleiben erhalten; fehlende Felder/Labels werden vorher angezeigt.
- [ ] Bei fehlenden Abhängigkeiten bleibt Einfügen gesperrt, bis „Mit unaufgelösten Verweisen einfügen“ gewählt wird.
      Anschließend die gemeldeten Abhängigkeiten im Zielprojekt ergänzen oder die Ausdrücke anpassen.
- [ ] Denselben Baustein zweimal einfügen: Element- und Gruppennamen bleiben eindeutig. Interne ReportItems-Verweise,
      Drilldown-Ziele und Gruppenscopes zeigen auf die jeweils eingefügte Kopie.
- [ ] Einfügen in einen noch nicht vorhandenen Seitenkopf/-fuß: Abschnitt wird angelegt.
- [ ] Einmal Rückgängig nimmt die Einfügung einschließlich neuer Bilder und neu übernommenem Code zurück.
- [ ] Baustein als Datei exportieren und in einem anderen Profil importieren. Datei bleibt ein lesbares RDLC.
- [ ] Gleichnamiges Bild mit anderem Inhalt bzw. abweichender Code-Block im Ziel: verständliche Fehlermeldung,
      keine teilweise Einfügung und kein Überschreiben des Zielcodes.
- [ ] Bestehenden Bibliotheksnamen speichern und den Ersetzen-Dialog einmal abbrechen, einmal bestätigen.

Die Bausteine übernehmen Gestaltung, benötigte eingebettete Bilder und verwendeten Berichtscode. Datenquellen,
Abfragen, Parameterdefinitionen und AL-Datasets werden nicht übertragen; Abhängigkeiten gehören zum Zielreport.

## Vorschau und Export

- [ ] Rechteck und Tabelle mit Seitenumbruch „Am Anfang“, „Am Ende“ und „Am Anfang und Ende“ prüfen.
      Nachfolgende Inhalte beginnen auf einer neuen Seite.
- [ ] Gruppe mit Umbruch „Am Ende“: auch die letzte Gruppeninstanz trennt nachfolgende Inhalte ab.
- [ ] `PageBreak/Disabled` und `ResetPageNumber` mit Ausdrücken pro Gruppe prüfen.
      Bedingung einmal wahr, einmal falsch; Seitenzahlen und Gesamtsummen kontrollieren.
- [ ] Zusammenfallende Umbrüche (Gruppe und Container) erzeugen keine zusätzlichen Leerseiten;
      der angeforderte Neustart der Seitennummerierung bleibt erhalten.
- [ ] Einen Bericht mit langen Texten und mehreren Schriften öffnen, mehrfach zwischen Entwurf und Vorschau wechseln.
      Seitenaufteilung bleibt nach dem Laden der Schriften stabil.
- [ ] Direkt nach Öffnen der Vorschau als PDF exportieren; Seitenzahl und Umbrüche mit der Vorschau vergleichen.
      Eingebettete Schriften, Umlaute und Sonderzeichen in Acrobat prüfen.

## Ergebnis

- VS-Code-Version / Betriebssystem:
- BC-Version / Umgebung:
- Getestete Reports:
- Befunde mit Schritten zum Nachstellen:
- Abgenommen von / Datum:
