# Continuation prompt for the active implementation agent

Use this prompt after the agent has already completed the initial repository analysis from `AI_HANDOFF_PROMPT.md`.

---

## Prompt

Deine Kontextanalyse ist akzeptiert. Fahre jetzt mit der Umsetzung fort, aber beachte vor dem ersten Edit eine wichtige neue verbindliche Produktklarstellung.

Deine Analyse basierte auf `main`-Commit:

```text
414f24769dc8455245a12bae6f1cf1364b1838c9
```

Der aktuelle `main` enthält inzwischen mindestens den neueren Commit:

```text
eb31597028d033427c2bec2b5bfef588cd21d581
```

Dort wurde die verbindliche Datei hinzugefügt:

```text
docs/SELECTION_WORKFLOW_CLARIFICATION.md
```

## Sofortige Pflichtschritte

1. Aktualisiere deinen lokalen Repository-Stand.
2. Lies `docs/SELECTION_WORKFLOW_CLARIFICATION.md` vollständig.
3. Prüfe den aktuellen `main`-Head erneut und verwende nicht mehr `414f247…` als Baseline.
4. Falls der Feature-Branch noch nicht existiert, erstelle ihn vom aktuellen `main`.
5. Falls der Feature-Branch bereits auf dem alten Stand erstellt wurde, rebase oder merge den aktuellen `main`, bevor du Implementierungscode hinzufügst.
6. Führe anschließend auf dem aktualisierten unveränderten Baseline-Stand `npm test` aus und dokumentiere SHA, Version, Build-Ausgabe, Warnungen und nicht ausführbare manuelle Browsertests.
7. Bestätige kurz, dass die neue Auswahlklarstellung verstanden wurde. Danach beginne direkt mit Phase 0 und arbeite die Roadmap weiter ab. Stoppe nicht nach einer weiteren reinen Planungsantwort, sofern kein echter Blocker besteht.

## Verbindlicher Auswahl- und Downloadablauf

Die vorhandene Scan-/„Abfräs“-Funktion wird nicht ersetzt oder vereinfacht. Erhalte weiterhin alle unterstützten Funktionen:

- Von-Datum bis neuester verfügbarer Inhalt;
- fester inklusiver Zeitraum Von/Bis;
- neueste zu älteste Inhalte;
- aktuelle Position zu ältesten Inhalten;
- aktuelle Position zu neuesten Inhalten;
- kompletter Timeline-Durchlauf;
- manuelles Stoppen und anschließende Verarbeitung der bis dahin gefundenen Inhalte;
- Medienfilter;
- Abschlussposition;
- verzögerte Grenzbestätigung virtueller Timelines;
- ZIP-Aufteilung und eingebauter Firefox-ZIP-Fallback.

Manuelle Auswahl ist eine zusätzliche Schicht nach der Erfassung und ersetzt keine dieser Funktionen.

Implementiere zwei saubere, nutzerseitig wählbare Modi:

### Quick archive

```text
Scan → deduplicate → download/archive every eligible item
```

Dieser Modus bewahrt den bestehenden unbeaufsichtigten Ablauf. Nutzer können den Scan starten und vollständig automatisch abschließen lassen.

### Review before archive

```text
Configure scan
→ scan/collect rendered candidates
→ canonicalize and deduplicate
→ open near-fullscreen Library
→ optionally select/deselect
→ confirm Archive selected
→ fetch only selected originals
→ create ZIP parts
```

Verbindliche Regeln für Review mode:

- Vor der finalen Bestätigung werden nicht pauschal alle Originaldateien heruntergeladen.
- Der Scan sammelt zunächst Metadaten, Vorschaudaten, Zeitstempel, Quellkontext und kanonische Original-URLs.
- Nach vollständigem Scan oder manuellem Stop wird eine nahezu bildschirmfüllende Library geöffnet beziehungsweise prominent angeboten.
- Alle geeigneten, deduplizierten Elemente beginnen ausgewählt, damit der Nutzer ohne Änderungen einfach bestätigen kann.
- Der Nutzer kann einzelne Elemente abwählen, nur wenige auswählen, sichtbare Filter verwenden und Dateimanager-Shortcuts einsetzen.
- Nur Elemente mit `canonical && eligible && manuallySelected` dürfen Original-Requests erhalten und in ZIPs gelangen.
- Das Schließen oder Abbrechen der Library darf keinen Download starten.
- Deselectete Elemente dürfen weder heruntergeladen noch gezippt werden.
- Das aktuelle Verhalten „erst alles herunterladen, anschließend lokal Ungewünschtes löschen“ ist für Review mode ausdrücklich falsch.

## Near-fullscreen Library ist Pflicht

Die zuverlässige Kernfunktion ist eine große, fast bildschirmfüllende Library, nicht eine kleine Liste im Eckpanel.

Sie benötigt mindestens:

- Grid als Standard für Bilder, GIFs und Videos;
- optionale Listenansicht;
- große nutzbare Vorschauen;
- Suche, Sortierung und Filter;
- sichtbare Auswahlzahl;
- Select all visible, Select all eligible, None und Invert;
- Plain click;
- Checkmark toggle;
- Ctrl+click unter Windows/Linux;
- Cmd+click unter macOS;
- Shift+click für einen Bereich;
- Ctrl/Cmd+Shift+click für additive Bereiche;
- Ctrl/Cmd+A;
- Space, Escape und Pfeiltasten;
- rote zugängliche Auswahlmarkierung mit Ring, Overlay, Check-Badge und reduzierter Animation bei `prefers-reduced-motion`;
- klaren finalen Button `Archive selected` oder `Download selected`.

Filter verändern nur die sichtbare Ansicht. Sie dürfen eine ausdrückliche Auswahl nicht stillschweigend löschen.

## Direkte Auswahl innerhalb von Discord

Eine Auswahl direkt in der Discord-Oberfläche ist ein optionales Adapter-Feature, nicht die zwingende Basis.

Wenn sie robust umgesetzt werden kann:

- verwende einen expliziten, adaptergesteuerten Auswahlmodus oder ein unaufdringliches Overlay;
- markierte Discord-Elemente synchronisieren in denselben Shared Selection Store;
- gewöhnliche Discord-Interaktionen dürfen nicht gefährlich verändert werden;
- Highlighting startet noch keinen Download;
- die Fullscreen Library bleibt zur Kontrolle und Nachbearbeitung verfügbar.

Wenn die direkte Discord-Auswahl technisch fragil ist, verschiebe sie ausdrücklich und liefere zuerst die vollständige post-scan Fullscreen Library. Die Fullscreen Library ist nicht optional.

## Deduplication

Vor finaler Auswahl und vor Original-Downloads müssen wiederholte Darstellungen desselben kanonischen Mediums zusammengeführt werden, soweit die Identität ohne Binärdownload zuverlässig erkennbar ist.

Mindestens zusammenführen:

- dieselbe kanonische Medien-ID;
- dasselbe Medium aus wiederholtem Virtual-DOM-Rendering;
- Preview- und Attachment-Elemente derselben Originalquelle;
- URLs, die laut Adapterregeln nur durch vergängliche Signaturen variieren;
- wiederholte Entdeckung derselben Nachricht, desselben Pins oder desselben Kommentar-Mediums.

Die Library zeigt ein logisches Element. Es wird einmal heruntergeladen. Merged-duplicate-Zahlen erscheinen in Live Metrics und Developer Logs.

Byte-identische Inhalte hinter unterschiedlichen, vorher nicht eindeutig zuordenbaren URLs können optional nach Fetch per Content Hash aus dem ZIP dedupliziert werden. Behaupte in Logs aber nicht, dass deren Gleichheit vor dem Download bekannt war.

## Reihenfolge der Umsetzung

Halte dich weiter an die verbindlichen Plan- und Checklisten-Dateien. Integriere diese Klarstellung insbesondere in:

- Domain-/ArchiveItem-Modell;
- Selection Store;
- Workflow State Machine;
- Runtime Download Contract;
- Live Metrics;
- Diagnostics;
- Library UI;
- Unit-, Fixture- und UI-Tests;
- Userscript-, Chromium- und Firefox-Ausgaben.

Die Workflow-Zustände müssen mindestens unterscheiden:

```text
idle
scanning
scan-stopped
review-ready
reviewing
fetching-selected
packing
completed
error
```

Quick archive darf nach Scan/Dedup direkt zu `fetching-selected` wechseln, wobei alle geeigneten Elemente ausgewählt sind. Review mode muss über `review-ready`/`reviewing` gehen und auf ausdrückliche Bestätigung warten.

## Zusätzliche Pflicht-Tests

Ergänze automatisierte Tests dafür, dass:

1. alle bestehenden Scanmodi und Datumsbereiche erhalten bleiben;
2. Quick archive weiterhin alle geeigneten deduplizierten Elemente archiviert;
3. Review mode vor Bestätigung keine Originaldateien anfordert;
4. deselectete Elemente keinen Original-Request auslösen;
5. nach Bestätigung ausschließlich ausgewählte Elemente geladen werden;
6. alle geeigneten Elemente im Review mode zunächst ausgewählt sind;
7. Cancel/Close keinen Download startet;
8. ein manueller Stop in Review der Teilmenge übergehen kann;
9. kanonische Duplikate nur einmal in der Library erscheinen und einmal geladen werden;
10. Auswahl Filter-, Sortier-, Re-Render- und Virtualisierungswechsel übersteht;
11. derselbe Ablauf im Userscript, in Chromium und Firefox gilt;
12. direkte Host-Page-Auswahl, falls implementiert, mit dem gemeinsamen Store synchronisiert und optional deaktivierbar ist.

## Weiterer Auftrag

Arbeite anschließend die bereits bestätigten verbindlichen Anforderungen vollständig ab:

- Shared Runtime und drei Zielartefakte;
- aktuelle Discord-Regressionsfreiheit;
- konfigurierbares kollisionssicheres Namenssystem;
- höchstens eine Sekunde alte sichtbare Statistiken;
- strukturierte, kopierbare und als Markdown exportierbare Diagnosen;
- Pinterest-Adapter;
- Reddit-Kommentar-Thread-Adapter;
- CI, Tests, Dokumentation und reproduzierbare Builds.

Arbeite in fokussierten Commits auf dem Feature-Branch. Behaupte keine bestandenen manuellen Browsertests, die nicht tatsächlich ausgeführt wurden. Erstelle am Ende einen Pull Request gegen `main` mit Testergebnissen, Artefakten, bekannten Einschränkungen und noch offenen manuellen Prüfungen.

Beginne jetzt mit dem Aktualisieren auf den aktuellen `main`, lies die neue Klarstellung und fahre danach mit der tatsächlichen Umsetzung fort.

---
