# Änderungsprotokoll

Alle nennenswerten Änderungen an der Erweiterung. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt
- `<Code>`-Block in der Vorschau: `For`/`Next` (mit `Step`), `For Each`, `While`/`End While`, `Do`…`Loop`
  (`While`/`Until` vorn oder hinten), `Select Case` (Werte, Bereiche mit `To`, `Is <op>`, `Case Else`),
  `Exit`/`Continue For|Do|While`, Zuweisungen mit `*=` und `/=`

### Geändert
- Integrationstests: Zeitlimits über `BC_RB_TIMEOUT_SCALE` skalierbar, ein zweiter Versuch je Test, Warten auf das
  Schließen des vorherigen Designers

### Behoben
- Leere Elemente, die das Layout als `<X></X>` schreibt (z. B. `<Visibility></Visibility>`), werden nicht mehr als
  `<X />` gespeichert

## [0.1.0] – 2026-10-17

Erste Fassung: visueller RDLC-Designer mit Dokumentgliederung, AL-Report als Datenquelle, Bearbeiten des AL-Reports
aus dem Designer, Prüfung im Problembereich, paginierte Vorschau mit `<Code>`-Interpreter, Tabellen/Gruppen/Listen/
Matrizen/Diagramme, quellerhaltendes Speichern sowie Excel-/Word-/HTML-Export der Vorschau.
