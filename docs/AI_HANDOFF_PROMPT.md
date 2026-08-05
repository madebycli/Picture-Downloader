# AI handoff prompt

Copy the prompt below into a fresh coding-agent conversation. The agent must have read/write access to `madebycli/Picture-Downloader`.

---

## Prompt for the new implementation agent

Du arbeitest am privaten GitHub-Repository:

`https://github.com/madebycli/Picture-Downloader`

Dein Auftrag ist, die nächste Media-Archiver-Produktphase vollständig, schrittweise und testbar umzusetzen.

Die drei gleichwertigen Zielartefakte sind:

1. universelles Userscript;
2. Chromium-Extension;
3. Firefox-Extension.

Das Userscript bleibt dauerhaft unterstützt und darf durch den Extension-Ausbau nicht ersetzt oder beschädigt werden.

Die Produktphase umfasst mindestens:

- gemeinsame Runtime-/Domain-Architektur;
- bestehende Discord-Regressionsfreiheit;
- Pinterest-Adapter;
- Reddit-Kommentar-Thread-Adapter, nicht Reddit-Feeds oder For You;
- großes Library-Modal mit Grid/List und Dateimanager-Auswahl;
- kollisionssicheres, konfigurierbares Benennungssystem;
- strukturierte Activity- und Developer-Logs;
- Copy- und Markdown-Diagnoseexport;
- sichtbare Live-Statistiken mit höchstens einer Sekunde Verzögerung;
- Tests, CI, Dokumentation und reproduzierbare Builds für alle drei Ziele.

## Zwingende Kontextphase — noch nichts verändern

Bevor du Code, Dokumentation, Manifeste, Workflows oder generierte Artefakte veränderst, musst du **alle** folgenden Dateien vollständig lesen:

1. `AGENTS.md`
2. `.github/copilot-instructions.md`
3. `README.md`
4. `SECURITY.md`
5. `CONTRIBUTING.md`
6. `docs/PROJECT_CONTEXT.md`
7. `docs/CURRENT_STATE_AUDIT.md`
8. `docs/IMPLEMENTATION_PLAN.md`
9. `docs/NAMING_SYSTEM.md`
10. `docs/DIAGNOSTICS_AND_LIVE_STATS.md`
11. `docs/ROADMAP_REQUIREMENTS_CHECKLIST.md`
12. `docs/ARCHITECTURE.md`
13. `docs/ADAPTERS.md`
14. `docs/DECISIONS.md`
15. `docs/TESTING.md`
16. `docs/RELEASE.md`
17. `docs/TROUBLESHOOTING.md`
18. `src/build-manifest.json`
19. `src/adapters/manifest.json`
20. `scripts/assemble-userscript.mjs`
21. `scripts/check-userscript.mjs`
22. `scripts/smoke-unsupported-page.mjs`
23. `package.json`

Danach liest du außerdem vollständig:

- alle aktuellen Module unter `src/core/`;
- alle aktuellen Module unter `src/adapters/discord/`;
- alle Dateien unter `.github/workflows/`;
- bestehende Tests und Fixtures, falls inzwischen vorhanden.

### Deine erste Antwort

Deine erste Antwort darf ausschließlich enthalten:

1. eine Checkliste aller gelesenen Dateien und Verzeichnisse;
2. eine Zusammenfassung der aktuellen Architektur in höchstens 15 Punkten;
3. eine Bestätigung, dass du die drei Zielartefakte verstanden hast;
4. eine Bestätigung, dass `NAMING_SYSTEM.md`, `DIAGNOSTICS_AND_LIVE_STATS.md` und `ROADMAP_REQUIREMENTS_CHECKLIST.md` verbindlich sind;
5. die wichtigsten fünf technischen Risiken;
6. den vorgesehenen Branch-Namen;
7. die geplante Commit-Reihenfolge;
8. echte Blocker oder offene Entscheidungen, die vor einem Edit geklärt werden müssen.

Erst nach dieser Kontextbestätigung darfst du Dateien verändern.

### Priorität bei Widersprüchen

1. `AGENTS.md` und `SECURITY.md`;
2. `docs/ROADMAP_REQUIREMENTS_CHECKLIST.md`;
3. `docs/IMPLEMENTATION_PLAN.md`, `docs/NAMING_SYSTEM.md` und `docs/DIAGNOSTICS_AND_LIVE_STATS.md`;
4. `docs/ARCHITECTURE.md`, `docs/ADAPTERS.md` und `docs/TESTING.md`;
5. dieser Prompt.

## Vor dem ersten Edit

Führe auf unverändertem `main` aus:

```bash
npm test
```

Dokumentiere:

- Commit-SHA;
- Testergebnis;
- aktuellen Userscript-Build;
- aktuelle Version;
- vorhandene Warnungen;
- welche manuellen Browsertests nicht ausführbar waren.

Wenn der Baseline-Test fehlschlägt, untersuche und dokumentiere zuerst die Ursache. Verstecke bestehende Fehler nicht hinter Roadmap-Änderungen.

Erstelle danach einen Arbeitsbranch, beispielsweise:

```text
feature/extension-pinterest-reddit-picker
```

Arbeite nicht direkt auf `main`.

## Nicht verhandelbare Sicherheits- und Architekturregeln

- Bearbeite `media-archiver.user.js` niemals direkt; es ist generiert.
- Ändere Quellen unter `src/`, Buildskripte, Tests und Dokumentation.
- Extrahiere, lies, logge oder speichere niemals Tokens, Cookies, Zugangsdaten oder Authorization-Header.
- Verwende keine undokumentierten authentifizierten Discord-, Pinterest- oder Reddit-APIs zur Inhaltserfassung.
- Sammle nur Inhalte, die die unterstützte Seite bereits gerendert oder durch eine ausdrückliche sichere DOM-Aktion nachgeladen hat.
- Führe keine Account-Aktionen aus: kein Posten, Voten, Reagieren, Folgen, Beitreten oder Messaging.
- Site-spezifische Selektoren, Hosts, IDs, Zeitregeln, URL-Regeln und Terminologie gehören ausschließlich in Adapter.
- Shared-Code darf keine Discord-, Pinterest- oder Reddit-Hosts/Selektoren enthalten.
- Jede Download-URL muss durch Build-Permissions und aktive Runtime-Allowlist erlaubt sein.
- Behalte den eingebauten ZIP-Fallback bei.
- Runtime-UI bleibt site-neutral und vorerst englisch.
- Changelog- oder Release-Inhalte dürfen nicht in die Runtime-UI gelangen.
- Beachte Tastaturzugänglichkeit, Focus Management und `prefers-reduced-motion`.
- Halte Userscript, Chromium und Firefox funktional und verhaltensgleich.

## Verbindliche Produktanforderungen

### 1. Gemeinsame Runtime und drei Builds

Führe einen Runtime-Contract ein für:

```js
runtime.fetchBinary(url, options)
runtime.abortRequest(requestId)
runtime.abortAllRequests()
runtime.saveBlob(blob, filename)
runtime.copyText(text)
runtime.getSetting(key, fallback)
runtime.setSetting(key, value)
runtime.getPlatformInfo()
runtime.openUi()
runtime.closeUi()
```

Erzeuge aus derselben Shared-Source:

- Userscript;
- Chromium-Extension;
- Firefox-Extension.

Die Extensions benötigen Content Script, Background Runtime, Messaging, Settings Storage, Toolbar Action und minimale generierte Host-Permissions. Es darf kein remote ausgeführtes JavaScript enthalten sein.

Vor der endgültigen Transportentscheidung testest du mindestens:

- ein Video über 50 MB;
- mindestens 300 MB Gesamtdaten;
- Cancellation;
- Speicherverhalten in Firefox und Chromium;
- ZIP-Speicherung aus dem gewählten Extension-Kontext.

### 2. Allgemeines Archivobjektmodell

Reddit-Kommentare dürfen nicht als Medien-Dateityp getarnt werden. Verwende ein allgemeines `ArchiveItem`-Modell mit unterschiedlichen `kind`-Werten und kind-spezifischen Handlern.

Finale Archivaufnahme ist immer:

```text
eligible && manuallySelected
```

### 3. Manuelle Dateimanager-Auswahl

Implementiere eine unabhängige Auswahlablage mit stabilen Keys.

Verhalten:

- alle geeigneten Einträge starten ausgewählt;
- Plain click: nur dieses Element auswählen und Range-Anchor setzen;
- Checkmark click: ein Element toggeln, ohne andere zu löschen;
- Ctrl+click: additive Einzelumschaltung unter Windows/Linux;
- Cmd+click: additive Einzelumschaltung unter macOS;
- Shift+click: zusammenhängenden Bereich auswählen;
- Ctrl/Cmd+Shift+click: Bereich additiv auswählen;
- Ctrl/Cmd+A: alle geeigneten Einträge der aktuellen Ansicht;
- Space: fokussiertes Element toggeln;
- Escape: Modal schließen;
- Pfeiltasten: Fokusnavigation.

Verwende nicht Alt für die Bereichsauswahl.

Baue ein großes zentriertes Library-Modal mit:

- Grid/List;
- Suche;
- Sortierung;
- Filtern;
- Select all visible;
- Select all eligible;
- none;
- invert;
- archive selected;
- roter hochwertiger Auswahlmarkierung mit Ring, Overlay, Check-Badge und kurzer Animation;
- reduzierter Animation bei `prefers-reduced-motion`;
- ARIA-Dialog, Focus Trap und vollständiger Tastaturbedienung.

Auswahlmarkierungen erscheinen nur in Media Archiver, nie direkt auf Discord, Pinterest oder Reddit.

Die Ansicht muss mit mindestens 2.000 synthetischen Einträgen flüssig bleiben. Ein Toggle darf nicht die komplette Bibliothek neu aufbauen.

### 4. Kollisionssicheres Benennungssystem

`docs/NAMING_SYSTEM.md` ist vollständig umzusetzen.

Wichtigster Regressionstest:

```text
Forbidden:
000001.jpg
000001.jpeg
000001.png

Required:
000001.jpg
000002.jpeg
000003.png
```

Plane alle finalen Namen vor Downloads zentral. Verwende denselben unveränderlichen Namensplan für Vorschau, Retries, Downloads, Manifeste und alle ZIP-Teile.

Unterstütze eine saubere File-naming-UI mit:

- Numbered — newest to oldest als Standard;
- Source date/time;
- Source + date + number;
- Original + number;
- sicherem Advanced-Template hinter Customize;
- Live-Vorschau;
- Windows- und plattformübergreifender Sanitization;
- echten unveränderten Dateiendungen;
- identischen Ergebnissen in allen drei Zielartefakten.

### 5. Eine Sekunde Live-Statistiken — konkrete 6.0-Regression

`docs/DIAGNOSTICS_AND_LIVE_STATS.md` ist vollständig umzusetzen.

Tester haben in der aktuellen 6.0-Version beobachtet, dass sichtbare Zähler teilweise erst nach ungefähr zehn Sekunden aktualisiert werden. Es reicht nicht, dass intern häufig `updateCounters()` aufgerufen wird.

Verbindliches Ziel:

> Während eines aktiven Vordergrund-Scans, Downloads oder ZIP-Vorgangs darf die DOM-sichtbare Statistik unter normalen Bedingungen höchstens eine Sekunde hinter dem internen Zustand liegen.

Anforderungen:

- leichte Heartbeat-Aktualisierung alle 500–1000 ms;
- Found, Eligible/In range, Selected, Downloaded, Saved, Skipped, Errors, Bytes, aktuelles Element/ZIP-Teil und Laufzeit;
- Test misst DOM-sichtbare Werte;
- keine komplette Grid/List-Neuerstellung pro Sekunde;
- keine Thumbnail-Neuladung durch Metrik-Updates;
- Dirty/Version-Flags für fast leere Heartbeats;
- Timer nur während aktiver Arbeit;
- sofortiger exakter Flush bei Phasenende;
- sofortiger exakter Flush bei Rückkehr aus einem gedrosselten Background-Tab;
- gemeinsames Runtime-neutrales Metrikmodell für alle drei Targets.

Erstelle einen synthetischen Test über mindestens zwölf Sekunden, bei dem regelmäßig neue Einträge erscheinen. Der sichtbare Zähler darf nie mehr als eine Sekunde veraltet sein.

### 6. Activity und Developer Logs

Ordinary Activity bleibt kurz und nutzerfreundlich.

Aktionsleiste:

```text
Copy | Download .md | Developer logs | Clear
```

Anforderungen:

- Logtext explizit markierbar (`user-select: text`);
- strukturierter Event Store als Quelle, nicht DOM-Text;
- stabile Fehlercodes;
- Kategorien und Levels;
- Such-/Filterfunktionen;
- expandable details;
- Copy activity;
- Copy sanitized developer report;
- Download sanitized UTF-8 Markdown report;
- Clipboard-Fallback mit weiterhin auswählbarem Text;
- begrenzte Event-Speicherung, ohne wichtige Fehler zu verdrängen.

Diagnoseberichte müssen standardmäßig redigieren:

- URL-Query/Fragmente;
- signierte CDN-Parameter;
- Tokens/Cookies/Authorization;
- private Nachrichten- oder Kommentartexte;
- private Source-Labels/Benutzernamen;
- lokale Dateipfade;
- unnötige Extension-IDs.

Fehler müssen sagen:

- was fehlgeschlagen ist;
- welche Dateien betroffen sind;
- ob der Lauf fortgesetzt wurde;
- was der Nutzer versuchen kann;
- stabiler Referenzcode.

### 7. Pinterest

Initialer Scope:

- Pin detail;
- Boards;
- sichtbare Profile-Grids;
- Search results.

Nicht sofort der personalisierte Homefeed.

Nur gerenderte Medien. Höchste tatsächlich gerenderte Quelle, stabile Keys, Masonry-Deduplizierung, minimale Hosts, keine privaten APIs. Datumsfilter nur bei verlässlichen gerenderten Zeitstempeln.

### 8. Reddit Comments

Aktiviere ausschließlich auf Post-Detail-/Kommentar-Thread-Seiten, niemals auf Home, Popular, Subreddit-Feeds, Suchempfehlungen oder For You.

Sammle gerenderte Kommentare mit:

- Comment ID;
- Parent ID;
- Tiefe;
- Autor wie gerendert;
- Body als Plain Text;
- optional sanitisiertes HTML;
- Zeitstempel;
- sichtbarer Score-Text;
- Permalink;
- gerenderte Medien im Kommentar.

Exportiere nur manuell ausgewählte Kommentare als:

- `comments.json`;
- `comments.md`;
- `comments.csv`.

Erhalte die Hierarchie und behandle gelöschte, eingeklappte, bearbeitete und verschachtelte Kommentare robust. Keine Account-Aktionen und keine API-Aufzählung.

## Umsetzungsphasen

Halte das Userscript nach jedem Meilenstein lauffähig.

### Phase 0 — Baseline und Fixtures

- unverändertes `npm test`;
- aktuelles 6.0-Verhalten dokumentieren;
- langsame sichtbare Stats als Regression reproduzieren;
- Windows-Duplicate-Stem-Regression erfassen;
- minimale anonymisierte Discord-, Pinterest- und Reddit-DOM-Fixtures;
- keine vollständigen privaten Browser-Snapshots.

### Phase 1 — Shared Contracts

- Runtime-/Storage-Contract;
- ArchiveItem und Adapter-Capabilities;
- Naming-Service;
- Diagnostics Store;
- Live Metrics Store;
- Userscript Runtime Bridge;
- aktuelle Discord-Funktionalität bewahren.

### Phase 2 — Shared UI

- unabhängiger Selection Store;
- Library Modal;
- Grid/List und Range Selection;
- File-naming-UI;
- Activity actions;
- Developer Logs;
- one-second status heartbeat;
- incremental card rendering;
- Accessibility und reduced motion.

### Phase 3 — Extension Builds

- Chromium;
- Firefox;
- Messaging, Clipboard, Storage, Downloads;
- identische Naming-/Diagnostics-/Metrics-Fixtures;
- reproduzierbare Artefakte.

### Phase 4 — Pinterest

- deterministische Seiten;
- Fixtures;
- minimal permissions;
- Live Regression Checklist.

### Phase 5 — Reddit Comments

- Post-thread only;
- comments hierarchy and exports;
- comment media;
- Fixtures;
- no feeds or account actions.

### Phase 6 — Tests, CI, Dokumentation

- Unit Tests;
- DOM Fixtures;
- Playwright UI Tests;
- 1-second DOM-visible stats test;
- diagnostics/redaction/copy/Markdown tests;
- Windows naming regression;
- all three build targets;
- browser matrix;
- README/Architecture/Adapters/Testing/Security/Release/Troubleshooting updates.

## Tests nach jedem Meilenstein

Mindestens:

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

Behaupte niemals eine Funktion, ohne den passenden Test ausgeführt zu haben. Nicht ausführbare manuelle Browserprüfungen bleiben ausdrücklich offen.

## Empfohlene Commit-Reihenfolge

1. `test: add sanitized fixtures and 6.0 regression baselines`
2. `refactor: introduce runtime archive and adapter contracts`
3. `feat: add shared naming diagnostics and live metrics`
4. `refactor: isolate userscript runtime bridge`
5. `feat: add manual selection store and library modal`
6. `feat: add naming and diagnostics UI`
7. `build: add Chromium and Firefox extension targets`
8. `feat: add Pinterest adapter`
9. `feat: add Reddit comments adapter`
10. `test: add cross-target UI timing and adapter suites`
11. `docs: complete release and migration documentation`

## Pull Request completeness gate

Vor dem PR musst du `docs/ROADMAP_REQUIREMENTS_CHECKLIST.md` Punkt für Punkt prüfen.

Jeder nicht erledigte Punkt erhält einen sichtbaren Status:

```text
Implemented
Tested automatically
Tested manually
Deferred with reason
Out of scope with approval
Blocked with evidence
```

Kein Punkt darf stillschweigend verschwinden.

Der PR-Body enthält:

- Architekturänderungen;
- Nutzerfunktionen;
- Adapter-Scope;
- Permission-Änderungen;
- Sicherheitsprüfung;
- ausgeführte Tests;
- manuelle Browsermatrix;
- bekannte Einschränkungen;
- Screenshots oder kurze Aufnahmen;
- Links zu Userscript-, Chromium- und Firefox-Artefakten;
- ausgefüllte Requirements-Checkliste.

## Abschlussbericht

Deine letzte Antwort muss enthalten:

1. PR-Link;
2. Commit-Liste;
3. Architekturänderungen;
4. umgesetzte Funktionen;
5. Testergebnisse;
6. offene manuelle Prüfungen;
7. bekannte Risiken;
8. Installationswege für Userscript, Chromium und Firefox;
9. Status aller Punkte aus `ROADMAP_REQUIREMENTS_CHECKLIST.md`.

Beginne jetzt ausschließlich mit der zwingenden Kontextphase. Verändere noch keine Datei.

---
