# AI handoff prompt

Copy the prompt below into a new coding-agent conversation. The agent must have access to the repository `madebycli/Picture-Downloader`.

---

## Prompt

Du arbeitest am privaten GitHub-Repository:

`https://github.com/madebycli/Picture-Downloader`

Dein Auftrag ist, die in `docs/IMPLEMENTATION_PLAN.md` beschriebene nächste Produktphase vollständig und schrittweise umzusetzen:

- bestehendes Tampermonkey-Userscript weiterhin unterstützen;
- zusätzliche Chromium- und Firefox-Extension-Builds erstellen;
- eine echte manuelle Dateimanager-Auswahl mit großem Grid-/Listen-Modal implementieren;
- Pinterest als neuen Adapter implementieren;
- Reddit-Post-Kommentarthreads unterstützen und ausgewählte Kommentare exportieren;
- Discord-Regressionsfreiheit bewahren;
- alle Sicherheits- und Architekturgrenzen einhalten.

### Zwingende Kontextphase — noch nichts ändern

Bevor du Code, Dokumentation, Manifeste oder Workflows veränderst, musst du **alle** folgenden Dateien vollständig lesen:

1. `AGENTS.md`
2. `.github/copilot-instructions.md`
3. `README.md`
4. `SECURITY.md`
5. `CONTRIBUTING.md`
6. `docs/PROJECT_CONTEXT.md`
7. `docs/CURRENT_STATE_AUDIT.md`
8. `docs/IMPLEMENTATION_PLAN.md`
9. `docs/ARCHITECTURE.md`
10. `docs/ADAPTERS.md`
11. `docs/DECISIONS.md`
12. `docs/TESTING.md`
13. `docs/RELEASE.md`
14. `docs/TROUBLESHOOTING.md`
15. `src/build-manifest.json`
16. `src/adapters/manifest.json`
17. `scripts/assemble-userscript.mjs`
18. `scripts/check-userscript.mjs`
19. `scripts/smoke-unsupported-page.mjs`
20. `package.json`

Danach musst du außerdem die aktuellen Module unter diesen Verzeichnissen lesen:

- `src/core/`
- `src/adapters/discord/`
- `.github/workflows/`

Deine **erste Antwort** muss ausschließlich enthalten:

1. eine Checkliste aller gelesenen Dateien;
2. eine Zusammenfassung der aktuellen Architektur in höchstens 15 Punkten;
3. die wichtigsten fünf Risiken der geplanten Änderung;
4. den von dir vorgesehenen Branch-Namen und die geplante Commit-Reihenfolge;
5. offene Punkte, die tatsächlich blockieren würden.

Erst nach dieser Kontextbestätigung darfst du Dateien verändern.

Wenn Prompt und Repository-Dokumentation widersprechen, gilt folgende Priorität:

1. `AGENTS.md` und `SECURITY.md`;
2. `docs/IMPLEMENTATION_PLAN.md`;
3. `docs/ARCHITECTURE.md`, `docs/ADAPTERS.md`, `docs/TESTING.md`;
4. dieser Prompt.

### Vor dem ersten Edit

Führe auf dem unveränderten `main` aus:

```bash
npm test
```

Dokumentiere den Ausgangszustand. Wenn der Test bereits fehlschlägt, untersuche und dokumentiere die Ursache, bevor du Roadmap-Code hinzufügst.

Erstelle danach einen Arbeitsbranch:

```text
feature/extension-pinterest-reddit-picker
```

Arbeite nicht direkt auf `main`.

### Nicht verhandelbare Regeln

- Bearbeite `media-archiver.user.js` niemals direkt. Es ist ein generiertes Artefakt.
- Ändere Quellen unter `src/`, Buildskripte, Tests und Dokumentation.
- Extrahiere, lies, logge oder speichere niemals Tokens, Cookies, Zugangsdaten oder Authorization-Header.
- Verwende keine undokumentierten authentifizierten Discord-, Pinterest- oder Reddit-APIs zur Inhaltserfassung.
- Sammle nur Inhalte, die die unterstützte Seite für den angemeldeten Browser bereits gerendert oder durch eine ausdrückliche, sichere Benutzeraktion nachgeladen hat.
- Führe keine Account-Aktionen aus: kein Posten, Voten, Reagieren, Folgen, Beitreten oder Messaging.
- Site-spezifische Selektoren, Hosts, IDs, Zeitregeln und Terminologie gehören ausschließlich in Adapter.
- Shared/Core-Code darf keine Discord-, Pinterest- oder Reddit-Hostnamen oder DOM-Selektoren enthalten.
- Jede Download-URL muss sowohl durch Build-Permissions als auch zur Laufzeit durch den aktiven Adapter erlaubt sein.
- Behalte den eingebauten ZIP-Fallback bei.
- UI-Strings und Logs bleiben vorerst Englisch.
- Changelog- oder Release-Notizen dürfen nicht in die Runtime-UI gelangen.
- Beachte `prefers-reduced-motion` und vollständige Tastaturbedienung.
- Halte Firefox und Chromium funktionsfähig.

### Vorgehensweise

Setze die Roadmap in den Phasen aus `docs/IMPLEMENTATION_PLAN.md` um. Überspringe keine Phase und halte das Userscript nach jedem Meilenstein lauffähig.

#### Phase 0: Fixtures und Baseline

- Erstelle nur sanitierte, minimale DOM-Fixtures.
- Übernimm keine vollständigen privaten Browser-Snapshots in das Repository.
- Entferne Benutzernamen, Servernamen, private Texte, Tokens und irrelevante Skripte.
- Lege erwartete Adapterergebnisse als Tests fest.

#### Phase 1: Shared Runtime und Domain

- Führe einen Runtime-Contract ein.
- Verschiebe `GM_xmlhttpRequest` und Runtime-spezifische Downloads aus Shared/Core-Code in den Userscript-Bridge.
- Führe den allgemeinen Archive-Item-Contract ein.
- Führe Adapter-Capabilities ein.
- Bewahre die aktuelle Discord-Funktionalität.

#### Phase 2: Manuelle Auswahl und Library-Modal

Implementiere eine vom Typ-/Datumsfilter unabhängige manuelle Auswahl.

Verhalten:

- Alle geeigneten Einträge starten ausgewählt, damit das aktuelle Verhalten erhalten bleibt.
- Plain click: nur dieses Element auswählen und Range-Anchor setzen.
- Checkbox/Checkmark click: Element toggeln, ohne andere zu löschen.
- Ctrl+click unter Windows/Linux: additive Einzelumschaltung.
- Cmd+click unter macOS: additive Einzelumschaltung.
- Shift+click: zusammenhängenden Bereich auswählen.
- Ctrl/Cmd+Shift+click: Bereich additiv auswählen.
- Ctrl/Cmd+A: alle geeigneten Elemente der aktuellen Ansicht auswählen.
- Space: fokussiertes Element toggeln.
- Escape: Modal schließen.

Verwende **nicht Alt** für Bereichsauswahl.

Baue:

- kompakten Launcher/Status;
- großes zentriertes Library-Modal;
- Grid-/Listen-Umschaltung;
- Suche, Sortierung und Filter;
- Select all visible, select all eligible, none und invert;
- Download/archive selected;
- rote, hochwertige Auswahlmarkierung mit Ring, Overlay, Check-Badge und kurzer Animation;
- reduzierte Animation bei `prefers-reduced-motion`;
- Focus Trap, ARIA-Dialog und Tastaturnavigation;
- performante Darstellung für mindestens 2.000 synthetische Einträge.

Die Auswahlmarkierung darf nur in der Media-Archiver-UI erscheinen, nicht direkt auf Discord, Pinterest oder Reddit.

#### Phase 3: Extension Builds

Erzeuge aus derselben Shared-Source:

- Tampermonkey-Userscript;
- Chromium-Extension;
- Firefox-Extension.

Implementiere:

- Content Script;
- Background Runtime;
- Runtime-Messaging;
- Cross-Origin-Binary-Fetch mit Cancellation;
- Settings Storage;
- Toolbar Action zum Öffnen der Shared UI;
- generierte minimale Host-Permissions aus dem Adaptermanifest;
- reproduzierbare Extension-ZIP-Artefakte.

Führe vor der endgültigen Transportentscheidung einen Spike mit mindestens einem 50-MB-Video und mindestens 300 MB Gesamtdaten durch. Dokumentiere Speicherverhalten und Cancellation in Firefox und Chromium.

Die Extension darf kein remote ausgeführtes JavaScript enthalten.

#### Phase 4: Pinterest Adapter

Initialer Scope:

- Pin-Detail;
- Boards;
- sichtbare Profile-Grids;
- Suchergebnisse.

Anforderungen:

- nur gerenderte Medien;
- höchste tatsächlich gerenderte Bild-/Videoquelle, ohne URLs zu erfinden;
- stabile Pin-/Medienkeys;
- Deduplizierung bei Masonry-Re-Rendering;
- minimale Host-Allowlist;
- keine privaten APIs;
- nur unterstützte Scanmodi anzeigen;
- Datumsfilter deaktivieren, wenn kein verlässlicher gerenderter Zeitstempel existiert;
- Fixture- und Live-Regressionstests.

#### Phase 5: Reddit Comments Adapter

Aktiviere ausschließlich auf Post-Detail-/Kommentar-Thread-Seiten. Nicht auf Home, Popular, Subreddit-Feed, Search-Feed oder Recommendation-Seiten.

Sammle gerenderte Kommentare mit:

- Comment ID;
- Parent ID;
- Tiefe;
- Autor wie gerendert;
- Body als Plain Text;
- optional sanitisiertes Body-HTML;
- Zeitstempel;
- sichtbarer Score-Text;
- Permalink;
- gerenderte Medien innerhalb des Kommentars.

Exportiere ausgewählte Kommentare als:

- `comments.json`;
- `comments.md`;
- `comments.csv`.

Erhalte die Hierarchie. Behandle gelöschte, eingeklappte, bearbeitete und verschachtelte Kommentare robust. Exportiere nur manuell ausgewählte Kommentare. Account-Aktionen und authentifizierte API-Aufzählung sind verboten.

#### Phase 6: Tests, CI und Dokumentation

Ergänze:

- Unit-Tests für Auswahl-Reducer, Range Selection und Archive Handler;
- DOM-Fixture-Tests für Discord, Pinterest und Reddit Comments;
- Extension-Manifestvalidierung;
- Userscript- und Extension-Buildjobs;
- Playwright-Tests für Modal, Grid/List und Tastaturauswahl;
- CI-Artefakte für Chromium- und Firefox-Pakete;
- aktualisierte README-, Architektur-, Adapter-, Test-, Security-, Release- und Troubleshooting-Dokumentation.

### Technische Qualitätsanforderungen

- Keine vollständige Listen-Neuerstellung bei jedem einzelnen Selection Toggle.
- Auswahlzustand lebt außerhalb der DOM-Karten.
- Stabile Keys und batched updates.
- Lazy Loading und begrenzte Video-Vorschauen.
- Keine unbeschränkte Parallelität.
- Keine unnötig duplizierten großen ArrayBuffer.
- Finaler Archive-Inhalt basiert auf `eligible && manuallySelected`.
- Filteränderungen dürfen explizite Auswahl nicht stillschweigend löschen.
- Shift-Range verwendet die aktuell sichtbare Sortier-/Filterreihenfolge.
- Sortieränderungen müssen deterministisch sein.
- Kommentare und Medien sind unterschiedliche Item-Kinds, keine Typ-Tricks.

### Tests nach jedem Meilenstein

Führe mindestens aus:

```bash
npm test
```

Sobald vorhanden zusätzlich:

```bash
npm run test:unit
npm run test:fixtures
npm run test:ui
npm run build:userscript
npm run build:extension:chromium
npm run build:extension:firefox
```

Behaupte niemals, dass etwas funktioniert, wenn der entsprechende Test nicht gelaufen ist. Liste nicht ausführbare manuelle Browserprüfungen ausdrücklich als noch offen auf.

### Commits und Pull Request

Nutze fokussierte Commits in dieser Reihenfolge:

1. Fixtures/Baseline
2. Runtime- und Domain-Contracts
3. Userscript Runtime Bridge
4. Selection Store
5. Library Modal
6. Extension Builds
7. Pinterest Adapter
8. Reddit Comments Adapter
9. Tests/CI
10. Dokumentation/Releasevorbereitung

Erstelle anschließend einen Pull Request gegen `main`.

Der PR-Body muss enthalten:

- Architekturänderungen;
- Nutzerfunktionen;
- Adapter-Scope;
- Permission-Änderungen;
- Sicherheitsprüfung;
- ausgeführte automatisierte Tests;
- manuelle Browsermatrix;
- bekannte Einschränkungen;
- Screenshots oder kurze Aufnahmen der Grid-/Listen-Auswahl;
- Extension-Artefakte oder Workflow-Links.

### Abschlussbericht

Deine letzte Antwort muss enthalten:

1. PR-Link;
2. Commit-Liste;
3. geänderte Architektur;
4. umgesetzte Funktionen;
5. Testergebnisse;
6. noch offene manuelle Prüfungen;
7. bekannte Risiken;
8. Installationswege für Userscript, Chromium und Firefox.

Beginne jetzt ausschließlich mit der zwingenden Kontextphase. Verändere noch keine Datei.

---
