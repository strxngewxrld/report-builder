# Windows-Abnahme am 20.10.2026

Ergänzt den [macOS-Lauf vom 18.10.](RELEASE-TEST-2026-10-18.md) um Windows. Die Desktop-Bedienung erfolgte mit echten
Maus- und Tastatureingaben (Win32 `SendInput`) und Bildschirmfotos. Kontrolliert wurde über den DOM der Webview, über
den Chromium-Debugport einer separaten Instanz. Alle Tests liefen in isolierten Profilen mit Kopien von `samples/`.

## Umgebung

Windows Server 2025 (10.0.26100) in einer RDP-Sitzung (1620 × 952, 100 %), deutsches Tastaturlayout, VS Code 1.142.0
(x64, systemweit unter `C:\Program Files`), Node.js 26. Geprüft wurde das frisch gebaute VSIX in einem separaten
Profil sowie der Extension Development Host. Ein Arbeitsbereich lag unter einem Pfad mit Leerzeichen, Umlauten und `&`
(`…\Mein Projekt Ä&Ö\`). Die Beispieldateien kommen durch `core.autocrlf` mit CRLF an, wie es bei Windows-Nutzern üblich ist.

## Automatische Prüfungen

- Typecheck grün, 152/152 Unit-Tests (neue Regressionstests für Vorschaudaten und AL-Labels).
- Integrationstests im echten VS Code unter Windows: 41/41 auf Englisch, 41/41 mit deutschem VS Code
  (`BC_RB_LOCALE=de BC_RB_TEST_LANGUAGE=de`), jeweils ohne zweiten Versuch.
  Drei Tests prüften bisher englische Texte („Table cell“, „in the Designer“) und sind jetzt sprachneutral.
- VSIX gebaut, geprüft (15 Dateien, 93 Befehle, 14 Sprachmodell-Tools) und per `--install-extension` installiert.
- CI: Windows-Runner zusätzlich zu Ubuntu (Unit-, Integrations- und deutsche Webview-Tests, VSIX).

## Nativ unter Windows geprüft

- **Tastatur (deutsches Layout):** Alle AltGr-Zeichen `{ } [ ] \ @ € | ~` sowie Umlaute in Eigenschaftsfeldern.
  AltGr ist unter Windows Ctrl+Alt und kollidiert dabei nicht mit den Zoom-Kürzeln Ctrl+Alt+0/−/= (Zoom blieb bei 121 %).
  Ctrl+Enter, Escape, Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+S, F5 und F2/Enter/Tab auf der Designfläche funktionieren.
- **Zwischenablage:** Ctrl+V aus der Windows-Zwischenablage (`QA & Überprüfung <b>€</b>`) im direkten Texteditor;
  der Text wird wörtlich gespeichert. Das war der Fehler, der auf macOS gefunden worden war.
- **Speichern:** CRLF bleibt in RDLC- und AL-Dateien vollständig erhalten (auch nach *Als AL-Label anlegen*), kein BOM
  wird hinzugefügt.
- **Native Dialoge:** PDF-, Excel- und Word-Export über den Windows-Speicherdialog in den Pfad mit Sonderzeichen,
  Dateiname `Rechnung Prüfung €.pdf`. Bild einbetten über den Öffnen-Dialog aus `Bilder Ü\Firmen Logo ä.png`.
- **PDF:** 2 Seiten A4. Arial und Arial Bold aus `C:\Windows\Fonts` sind als Teilmenge eingebettet. Die Datei öffnet im
  Windows-Standardbetrachter (Edge mit Acrobat-Engine) mit Positionen, Summe und Seitenzahl.
- **Excel/Word:** Die Dateien sind wohlgeformte ZIP/XML mit allen Positionen, Zahlen sind echte Zahlenzellen. Microsoft
  Office ist auf dem Testserver nicht installiert, daher wurden sie nicht in Office geöffnet.
- **Kontextmenüs:** Rechtsklick auf Zelle/Element/Fläche, Tabellen-Untermenü (Spalte rechts einfügen, Rückgängig),
  Menübedienung nur per Tastatur bis zum Dialog und zurück.
- **Drag-and-drop mit echter Maus:** Feld aus *Berichtsdaten* in das Listen-Rechteck, Bild in den Seitenkopf.
- **AL:** Der AL-Kontext wird im Pfad mit Sonderzeichen gefunden. *Als AL-Label anlegen* ändert AL-Datei und Layout
  in einem Schritt.
- **Persistenz:** Hot Exit im normalen Fenster: Eine ungespeicherte Änderung bleibt nach *Reload Window* erhalten.
  Im Extension Development Host schreibt VS Code grundsätzlich keine Backups, das ist kein Fehler der Erweiterung.
- **Öffnen:** Doppelklick im Explorer, `code datei.rdl` in eine laufende Instanz und Kaltstart mit Dateiargument öffnen
  im Designer. Nur beim allerersten Start direkt nach der CLI-Installation öffnete VS Code die Datei einmal als XML
  (Erweiterung noch nicht registriert). Das war danach nicht reproduzierbar.

## Gefundene und behobene Fehler

1. **Vorschau ohne Positionen (alle BC-Berichte mit generierten Daten):** `bindRows` übernahm nur die Spalten der ersten
   Zeile. Bei BC-Daten ist das eine Kopfzeile ohne Positionsspalten, deshalb blieben alle Positionen `null`.
   Dasselbe galt für Beispieldaten-JSON. Jetzt zählen die Spalten aller Zeilen.
2. **`#Error` nach *Als AL-Label anlegen*:** Die Vorschau kannte nur Parameter aus dem Layout. AL-Labels und -Captions,
   die erst der nächste Build ins Layout schreibt, liefern jetzt ihren Text.
3. **Fokusverlust nach dem direkten Texteditor:** Nach Escape bzw. Ctrl+Enter lag der Fokus auf `body`. Tab, Enter,
   F2, Pfeiltasten und Entf wirkten dann nicht mehr. Bei der Korrektur fiel im neuen Regressionstest auf, dass das
   Zurücksetzen des Fokus vor dem Entfernen des Editors dessen `blur` auslöste und Escape den Text doch übernahm.
   Auch das ist behoben.
4. **Shift+F10 / Kontextmenütaste ohne Menü:** Das Ereignis traf die Designfläche, die keinen Menükontext hat. Es öffnet
   jetzt das Menü des ausgewählten Elements bzw. des Abschnitts. Unter macOS reagierte Shift+F10 vorher gar nicht.
5. **Fokus nach nativem Kontextmenü und daraus geöffnetem Dialog:** Er fiel auf `body` und kehrt jetzt zur
   Designfläche zurück.
6. **Eingefügte Elemente über den Rand hinaus:** Ein Drop oder Klick nahe dem rechten Rand legte ein 1,5″ breites Feld
   über den Textkörper bzw. das Listen-Rechteck hinaus. Der Textkörper wuchs, gedruckt entstehen so Leerseiten.
   Breite und Position werden jetzt auf den Container begrenzt.
7. **Zeilenhöhe Designer ≠ Vorschau:** Der Designer nutzte 1,2 × Schriftgröße, Vorschau und PDF die Metrik der Schrift.
   Unterlängen und Unterstriche wurden im Designer früher abgeschnitten, als die Ausgabe es tut.
8. **Designer-Sitzungen:** Der PDF-Test brauchte in vollen Läufen gelegentlich einen zweiten Versuch. Ursache war ein
   echter Fehler: Das verspätete `dispose` eines geschlossenen Designers meldete den inzwischen neu geöffneten
   Designer derselben Datei ab, Befehle gingen dann ins Leere. Bei geteiltem Editor gingen Titelleisten-Befehle
   außerdem immer an den zuletzt geöffneten statt an den fokussierten Designer. Ein neuer Integrationstest scheitert
   ohne die Korrektur und besteht mit ihr.
9. **Release unter Windows:** `THIRD_PARTY_NOTICES.md` übernahm CRLF aus dem Windows-Checkout. Jeder Build veränderte
   so die Datei, und `publish:github` brach nach dem Paketbau ab („Arbeitsstand wurde verändert“).
10. **Tests:** Drei Integrationstests scheiterten mit deutschem VS Code an englischen Texten. Bereits vorher
    vorbereitet: CRLF in AL-Einfügungen und VS-Code-Suche unter `Program Files`.

Fehler 1, 2 und 4 bis 8 sind plattformunabhängig und betreffen auch macOS.

## BC/Office-Abnahme

Zweiter Durchgang auf demselben Server gegen ein echtes **Business Central 29.0 DE on-prem** (DVD-Installation,
Instanz `BC290`, Webclient `http://localhost:8080/BC290/`, Windows-Anmeldung, Mandant CRONUS AG) und **Microsoft 365
Word/Excel** (nicht aktiviert). Bedienung wieder mit echter Maus/Tastatur, Kontrolle über Bildschirmfotos, den
Webview-DOM und den Workbench-DOM (Chromium-Debugport). Geprüft im installierten VSIX (`-Mode Vsix`), nach jeder
Korrektur neu gebaut und installiert. Belege: `C:\QA\screens`, `C:\QA\logs` auf dem Testserver.

| Punkt | Ergebnis |
| --- | --- |
| A1 Excel/Word aus der BC-Vorschau | bestanden nach Korrektur: kein Reparaturdialog; Menge `530` (N0, Zellwert 529,5), Preise `167,10`, Beträge `1.141,80`, Belegdatum als Excel-Datum (Format „Datum“, kein Fehlerdreieck); Word mit Tabellen, Umlauten, A4. Word zeigte „Kompatibilitätsmodus“ und alle Belege auf einer Seite, das Datum im Text als `15.01.26` → behoben (7, 8) |
| A2 `Umsatzbericht.rdl` | bestanden nach Korrektur: Daten, Summen, Datum; Währung `C` kam ohne `€` in Excel an → behoben (9), Excel erkennt jetzt „Währung“ |
| B1 Projekt erstellen | bestanden: AL-Compiler schreibt BOM und Dataset um, Ergebnis zeichengleich mit `Verkaufsrechnung.alc-output.rdlc`; Designer lädt nach, Hinweis „noch nicht im Layout“ verschwindet; Fett + Speichern → 3 Zeilen Diff, BOM und CRLF bleiben; Rückgängig + Speichern → zeichengleich |
| B2 Als AL-Label anlegen | Fehler (2) gefunden und behoben; danach Build grün, Label als `ReportParameter` im Layout, Vorschau zeigt „Rechnungsnr.“, in BC veröffentlicht und im PDF gegengeprüft; ein Rückgängig nimmt AL und Layout zurück |
| B3 Report in BC ausführen | Fehler (1) bestätigt (HTTP 500) und behoben: geöffnet wird `http://localhost:8080/BC290/?report=50100`, Anforderungsseite erscheint; *Zuerst veröffentlichen* veröffentlicht per `al.publishNoDebug` und öffnet den Report |
| B4 Vergleich mit BC | bestanden nach Korrekturen: Mit den BC-Daten (*Excel nur Daten*, nach Korrektur 3: 57 Zeilen) zeigt die Vorschau wie das BC-PDF 30 Seiten, je Beleg eine Seite, „Seite 1“ auf jeder Seite (Neustart), gleiche Positionen und Summen (103001: 25/120 × 83,00, Gesamt 12.035,00; 103002: 10.043,00). Abweichungen: generierte Daten nach dem Build als Zahlen → Korrektur 4; Seitenkopf → Korrektur 5 |
| B5 Symbole / Felder als Spalten | bestanden: ohne `.alpackages` bietet die Erweiterung *Symbole herunterladen* an (lädt alle 5 Pakete von BC290), danach listet *Felder als Spalten hinzufügen* die echten Felder von „Sales Invoice Line“ (Nummer, Typ); `column(ShipmentDate_Line; "Shipment Date")` wird angelegt und kompiliert |
| B6 Report-Extension | bestanden: `reportextension 50110 … extends "Standard Sales - Invoice"` mit zwei RDLC-Layouts; Hinweis „Basisreport nicht im Workspace“, Layoutwechsel über *Layouts des Reports*, *Report in BC ausführen* meldet „ID des Basisreports nicht bekannt“ |
| C1 Base-App-Layouts im Designer | bestanden: 12 Layouts (StandardSalesInvoice, Reminder, Customer Statement, BankAccountStatement, InventoryValuation, InventoryPickingList, TrialBalance, Check, VATStatement, VATViesDeclarationTaxDE, VendorPaymentsList, CostAcctgStatement) öffnen ohne Fehler, nie „geändert“; Öffnen + Strg+S → alle 12 Dateien unverändert (SHA-256); Fett an einem Feld → genau eine Zeile Diff, BOM und CRLF bleiben |
| C2 alle 399 Layouts automatisch | bestanden: 399/399 unverändert zeichengleich (alle mit BOM und CRLF), 399/399 neu erzeugt stabil, keine Renderfehler. Dabei gefunden: Umlaute in Feldnamen, `Code.<Shared-Variable>`, `Microsoft.VisualBasic.Strings.Len`, `.Replace` → behoben (6) |
| D1 Kaltstart mit Dateiargument | reproduziert, Ursache VS Code: Beim Fensterstart per `code --new-window <Ordner> <Datei>` öffnet VS Code die Datei als Text, bevor es nach dem Custom Editor fragt (die Erweiterung wird dann über `workspaceContains` statt `onCustomEditor` aktiviert). Gleiches Verhalten mit frischem und mit benutztem Profil und für `.rdl`; dieselbe Datei per `code --reuse-window` in die laufende Instanz, per Explorer oder aus der Fenster-Wiederherstellung öffnet im Designer. Keine Änderung an der Erweiterung (siehe offene Punkte) |
| D2 Excel-Gegenprüfung | bestanden (siehe A1) |

### Gefundene und behobene Fehler

1. **Report in BC ausführen öffnete eine tote Adresse:** `reportUrl()` baute on-prem `server` + Instanz ohne
   Webclient-Port. Jetzt fragt die Erweiterung `…:7049/<Instanz>/dev/metadata` und nimmt `webEndpoint`, wie die
   AL-Erweiterung mit `usePublicURLFromServer` (Windows-Anmeldung über PowerShell, weil `fetch` kein Negotiate kann).
2. **AL0926 nach *Als AL-Label anlegen*:** Der neue `labels`-Block kam hinter `dataset`, also vor `rendering`.
3. **BC-Excel-Daten: 0 Zeilen:** BC 29 schreibt `<x:worksheet>`/`<x:row>`/`<x:c>`; der Leser erwartete Elemente ohne
   Präfix. Präfixe werden jetzt entfernt.
4. **Generierte Daten nach dem AL-Build als Zahlen:** `numericFieldsFromLayout` wertete das `<` von `</Value>` als
   Vergleich. Nach jedem Build (ohne `rd:TypeName`) zeigte die Vorschau „1254.1“ statt Firmenname und Beschreibung.
5. **Seitenkopf in BC leer, in der Vorschau gefüllt:** Das Beispiel rief `Code.SetData` im Wert eines Textfelds mit
   `Hidden=true` auf. Der BC-Berichtsviewer wertet den Wert ausgeblendeter Textfelder nicht aus (PDF aus BC: nur
   „Seite 1“ im Kopf), die Vorschau tat es. Die Vorschau wertet ihn jetzt nur aus, wenn `ReportItems` ihn liest. Das
   Beispiel ruft `SetData` wie die Base App im `Hidden`-Ausdruck auf; nach Veröffentlichung zeigt das BC-PDF Firma und
   Belegnummer im Kopf jeder Seite, genau wie die Vorschau.
6. **Deutsche Base-App-Layouts:** Bezeichner mit Umlauten (Tokenizer, Prüfung, Verwendungssuche),
   `Code.PageNo` für `Shared`-Variablen (Vorschau und Prüfung), `Microsoft.VisualBasic.*` und Textmethoden.
7. **Datumsformat `d`:** `Intl` liefert für de-DE `24.01.28`, .NET/BC `24.01.2028` (auch `g`/`G`).
8. **Word-Export:** keine Seitenumbrüche und Kompatibilitätsmodus (fehlende `word/settings.xml`).
9. **Excel-Export:** `C` ohne Währungssymbol.

Regressionstests für alle Punkte (Unit), danach Typecheck, 160/160 Unit-Tests, Integrationstests 41/41 englisch und
41/41 deutsch.

### Beobachtungen ohne Änderung

- Info-Meldungen mit Schaltflächen (z. B. *Projekt erstellen*, *Öffnen*) blendet VS Code nach einigen Sekunden aus;
  ein späterer Klick an dieselbe Stelle trifft nichts. Die Meldung bleibt in der Benachrichtigungszentrale. Das ist
  VS-Code-Standard und erklärte mehrere scheinbar wirkungslose Klicks im Test.
- *Öffnen im Designer* aus dem XML-Editor öffnet einen zweiten Tab statt den XML-Tab zu ersetzen.
- Generierte Daten liefern Datumsspalten ohne Typ als Text (linksbündig); BC übergibt `Date`-Spalten als Datum
  (rechtsbündig). Mit geladenen BC-Daten stimmt die Ausrichtung.
- Für Report-Extensions könnte die Basisreport-ID aus den Symbolen gelesen werden (heute nur Hinweis).

## Nicht abgedeckt

- Acrobat, NVDA-Durchgang, Windows-Kontrastdesigns (`forced-colors`) und Anzeigeskalierung über 100 %: Beides sind
  systemweite Einstellungen der RDP-Sitzung und wurden nicht verändert.
- BC online (SaaS) und Docker-Container für *Report in BC ausführen*; on-prem mit `NavUserPassword` (nur Windows-Anmeldung
  geprüft).
- Die übrigen offenen Punkte aus [TODO](../TODO.md) und [UI-Testmatrix](UI-TESTMATRIX.md).

Protokolle: `artifacts/qa-windows/` (Git-ignoriert).

## Nachprüfung der BC/Office-Abnahme

Die Korrektur für *Report in BC ausführen* übergab die Server-Adresse aus der launch.json als Teil eines
PowerShell-Befehls. Mit präparierter launch.json (typografisches Anführungszeichen) und einem mit 401/Negotiate
antwortenden Server wäre so Befehlsausführung möglich gewesen. Die Adresse wird jetzt als http(s)-URL normalisiert
und über eine Umgebungsvariable übergeben; Regressionstest ergänzt, gegen BC290 nachgeprüft (`webEndpoint`
`http://localhost:8080/BC290/`). Danach 160/160 Unit-Tests und 41/41 Integrationstests.

Offen: Der PDF-Export-Test brauchte in einem von fünf Komplettläufen einen zweiten Versuch („PDF geschrieben“),
isoliert und zusammen mit dem vorherigen Test nicht reproduzierbar.
