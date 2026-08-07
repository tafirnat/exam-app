# Exam App

[![Live Demo](https://img.shields.io/badge/Demo-Online-brightgreen.svg)](https://exam.rifatarslan.dev/)
[![Build & Deploy](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Tech Stack](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20JS-orange)

**Offline-first persönliche & private Lern-App für Prüfungen & Karteikarten mit geräteübergreifender Synchronisierung — kein Account, kein Abo, kein Drittanbieter-Tracking.**

Exam App verwandelt jedes Lernmaterial in interaktive Quizze und Karteikarten. Die App merkt sich, welche Fragen Ihnen schwer fallen, und plant Wiederholungen mit dem wissenschaftlich fundierten FSRS-Algorithmus zum richtigen Zeitpunkt ein. Ihre Daten bleiben standardmäßig lokal auf Ihrem Gerät; optional können Sie Ihre Daten nahtlos zwischen verschiedenen Geräten (PC, Smartphone, Tablet) über Ihr eigenes privates GitHub Gist unter Ihrer vollständigen Kontrolle synchronisieren.

> Einfach ausprobieren? **<a href="https://exam.rifatarslan.dev/" target="_blank" rel="noopener noreferrer">Live-Demo öffnen →</a>**

---

## Sprachen / Languages / Diller

> **Hinweis**: Die **englische Version** ([`README.md`](./README.md)) ist stets die **primäre Originalquelle**.
>
> **In anderen Sprachen lesen:**
> - **[English README](./README.md)** *(Originalquelle)*
> - **[Türkçe README](./README.tr.md)**

---

## Für Wen Ist Diese App?

Exam App wurde für alle entwickelt, die aus eigenem Material lernen:

- **Studierende**, die sich auf Uni-, Berufs- oder Sprachprüfungen vorbereiten
- **Selbstlerner**, die Notizen in Obsidian oder ähnlichen Markdown-Tools führen und diese in Übungstests umwandeln möchten
- **Alle**, die eine ablenkungsfreie, auf Datensouveränität ausgerichtete Alternative zu Anki, Quizlet & Co. suchen — ohne Abos oder Cloud-Bindung

---

## Funktionen

### 7 Fragetypen — Alles in einer App

- **Einzelauswahl** — Standard-Multiple-Choice mit einer richtigen Antwort
- **Mehrfachauswahl** — zwei oder mehr richtige Antworten erforderlich
- **Richtig / Falsch** — binäre Aussageprüfung
- **Kurzantwort** — exakte Antwort eintippen; unterstützt mehrere akzeptierte Varianten und optionale Groß-/Kleinschreibung
- **Lückentext** — Schlüsselwörter inline eingebettet via `{{Lücke}}` oder `{{Kanonisch|Alternativ}}`
- **Karteikarte (Flashcard)** — klassisches Flip-Karten-Format mit Selbstbewertung
- **Lesematerial** — reichhaltige Markdown-Lernnotizen ohne Bewertungsdruck *(ehem. `topic_review`)*

### Intelligentes Spaced Repetition (FSRS v4.5)

Schwierige Fragen kommen häufiger. Gut bekannte Fragen werden seltener wiederholt. Der FSRS v4.5-Algorithmus — auch von Anki genutzt — passt Wiederholungsintervalle an Ihr echtes Gedächtnis an, nicht an einen festen Plan.

### Tägliche Wiederholung mit einem Tipp

Eine Serien-Karte auf dem Startbildschirm zeigt, wie viele Fragen heute laut FSRS-Zeitplan fällig sind. Einmal tippen — kein Suchen nach Quellen nötig. Wählen Sie zwischen **reiner FSRS-Reihenfolge** (dringendste Frage zuerst) oder **nach Quelle/Ordner gruppiert** für kontextbewusstes Lernen.

### Serien- & Kontinuitätsverfolgung

Eine globale Lernserie zählt aufeinanderfolgende aktive Tage. Ein automatischer **Einfrierungspuffer** verzeiht stillschweigend bis zu 2 versäumte Tage pro Woche — ein geschäftiger Tag bricht Ihre Serie nicht.

### Fokus-Pools

Heften Sie bis zu 3 Quellen oder Ordner als tägliche Fokus-Pools mit einem individuellen Fragenziel an (1–5 pro Pool, max. 15 gesamt). Diese Fragen werden still in Ihre tägliche FSRS-Sitzung eingemischt, wenn sie noch nicht fällig sind — keine erzwungenen Quoten, kein Schuldgefühl.

### Schnelle Einblicke (Nuggets)

Lernen findet nicht nur durch Tests statt. Mit Schnellen Einblicken (Nuggets) können Sie die Kernaussage eines Themas erfassen, ohne dem Druck eines Frage-Antwort-Formats ausgesetzt zu sein. Sie erscheinen während des Lernens elegant im kontinuierlichen Stream und bieten eine ablenkungsfreie Möglichkeit, kritische Konzepte aufzunehmen. Sie können auch die KI beauftragen, diese Einblicke zu generieren, um komplexe Fragen in mundgerechte Fakten zu destillieren.

### Ordner- & Archivverwaltung

Organisieren Sie Quellen in farblich markierten Ordnerhierarchien. Archivieren Sie einzelne Quellen oder ganze Ordner zum Pausieren — die FSRS-Uhr **friert während der Archivierung ein**, sodass das Wiederherstellen eines großen Archivs Ihre tägliche Warteschlange nie mit überfälligen Karten überflutet.

### Fortschritts-Analytik

- **Aktivitäts-Heatmap** — GitHub-artiges Tagesraster, farblich nach dominantem Ordner kodiert
- **Wochen- & Monats-Trenddiagramme** — Balkendiagramme zum Lernvolumen über die Zeit
- **Fragenspezifische Analytik** — vollständige Historie, Abrufbarkeits-Score und Schwierigkeit für jede Frage
- **Detaillierte Quellenübersicht** — aktive vs. archivierte Quellen mit Frageanzahl auf einen Blick

### Push-Benachrichtigungen

Opt-in-Erinnerungen, die einmal täglich ausgelöst werden, wenn Karten fällig sind. Die Erlaubnis wird erst nach einer erfolgreichen Lernsitzung angefragt — nie beim ersten Start. Konfigurierbare Ruhezeiten (Standard: 22:00–08:00).

### Onboarding-Guide

Eine interaktive Schritt-für-Schritt-Tour führt Sie beim ersten Start (oder jederzeit über das Einstellungsmenü) durch die wichtigsten Funktionen der App.

### Mehrsprachige Benutzeroberfläche

Vollständige native Benutzeroberfläche auf **Englisch**, **Türkisch** und **Deutsch**. Integrierte Google-Translate-Unterstützung zur Übersetzung von Frageninhalt in 10+ Sprachen.

### KI-Integration

- **Fragensets generieren**: Nutzen Sie den mitgelieferten Prompt ([AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)) mit ChatGPT, Claude oder Gemini, um beliebigen Text in Exam App JSON umzuwandeln.
- **Ordnerspezifische Generierung**: Fügen Sie `"folderId": "folder_..."` zum JSON-Root hinzu, um importierte Fragensets direkt einem Ordner zuzuweisen (Ordner-IDs können über die Schaltfläche `id: ...` im Ordner-Verwaltungsmodal kopiert werden).
- **Sequenzielle Reihenfolge (`keepOrder`)**: Für aufeinander folgende Lesematerialien können Sie `"keepOrder": true` (oder `"preserveOrder": true`) im JSON-Root oder in `exam_metadata` hinzufügen, um das Mischen der Fragen zu verhindern. Dies kann auch jederzeit über die Schaltfläche **Sortiert** in den Quellenaktionen umgeschaltet werden.
- **KI zu einer Frage befragen**: Senden Sie den Kontext einer Frage mit einem Klick in Ihrer aktiven UI-Sprache an ChatGPT, Claude, Gemini, DeepSeek, Kimi usw.

### Text-to-Speech

Liest Fragen und Lesekarten mit nativer Browser-Sprachsynthese vor. Einstellbare Geschwindigkeit (×0,7–×1,3), automatische Wiedergabe bei Navigation, schwebende Steuerleiste.

### Datensouveränität & Bring-Your-Own-Cloud (BYOC)

Keine Drittanbieter-Tracking-Server oder zentrale Datenbanken. Kein Account-Zwang und keine Abos. Ihre Lerndaten werden standardmäßig lokal auf Ihrem Gerät gespeichert. Die geräteübergreifende Synchronisierung erfolgt sicher über **Ihr eigenes privates GitHub Gist**, das als persönliche, kostenlose Cloud dient. So bleiben Ihre Daten vollständig in Ihrem eigenen GitHub-Account und unter Ihrer Kontrolle.

---

## Screenshots

<div align="center">

### Dashboard & Tägliche Wiederholung

| Hell-Modus | Dunkel-Modus |
| :---: | :---: |
| ![Dashboard Light](./docs/screenshots/dashboard-light.png) | ![Dashboard Dark](./docs/screenshots/dashboard-dark.png) |

### Quiz-Benutzeroberfläche & Ergebnisse

| Aktive Lernsitzung | Testergebnisse & Analyse |
| :---: | :---: |
| ![Quiz Interface](./docs/screenshots/quiz-interface.png) | ![Test Results](./docs/screenshots/test-results.png) |

### Quellenverwaltung & Navigation

| Gespeicherte Quellen & Ordner | Seitenleisten-Menü |
| :---: | :---: |
| ![Saved Sources](./docs/screenshots/saved-sources.png) | ![Sidebar Menu](./docs/screenshots/sidebar-menu.png) |

### Detaillierte Fragen-Analytik

| Fragedetails & Historie |
| :---: |
| ![Question Details](./docs/screenshots/question-details.png) |

</div>

---

## Geräteübergreifende Synchronisierung (GitHub Gist)

Synchronisieren Sie alle Fragensets, Fortschritte, Statistiken, Notizen und Einstellungen ohne Drittanbieter-Server zwischen Geräten:

1. **GitHub-Token erstellen**
   - Rufen Sie die [GitHub-Token-Einstellungen](https://github.com/settings/tokens?type=beta) auf
   - Erstellen Sie ein Fine-grained Token mit **Gists: Read and Write**-Berechtigungen
2. **In der App verbinden**
   - Klicken Sie auf die Schaltfläche **GitHub** in der Kopfzeile, fügen Sie Ihr Token ein und klicken Sie auf **Verbinden & Synchronisieren**
3. **Automatische Hintergrund-Synchronisierung**
   - Die App erstellt automatisch ein geheimes Gist (`exam_app_backup.json`) und synchronisiert im Hintergrund
   - Archivierte Elemente werden separat synchronisiert (`exam_app_archive.json`), um die tägliche Synchronisierung leicht zu halten

### Obsidian-Plugin

Wenn Sie Fragen in Obsidian vorbereiten, synchronisiert das Plugin **[Obsidian ExamApp Gist Sync](https://github.com/tafirnat/Obsidian-ExamApp-Sync)** Ihren Obsidian-Tresor direkt über Gist mit Exam App.

---

## Erste Schritte

Der einfachste Weg, Exam App zu nutzen, ist die **<a href="https://exam.rifatarslan.dev/" target="_blank" rel="noopener noreferrer">Live-Demo</a>** — keine Installation erforderlich. Die App ist ein vollständig statisches, offline-fähiges PWA, das auch direkt vom Browser aus auf Ihrem Smartphone oder Desktop installiert werden kann.

Um eigene Fragen zu laden, nutzen Sie die Schaltfläche **Quelle hinzufügen** auf dem Startbildschirm, um eine JSON-Datei zu importieren. Das Datenformat finden Sie im [JSON-Schema-Leitfaden](./public/examples/schema-guide.md); Fragensets können automatisch mit dem [KI-Prompt](./AI_AGENT_PROMPT.md) generiert werden.

---

## KI-Fragenset-Generierung

Wandeln Sie Lehrbücher, Artikel oder Notizen in Exam App JSON um:

1. Öffnen Sie **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** und kopieren Sie die Anweisungen
2. Fügen Sie den Prompt zusammen mit Ihrem Lernmaterial in ChatGPT, Claude, Gemini oder DeepSeek ein
3. Importieren Sie das generierte JSON direkt in Exam App

---

## Datenformat & JSON-Schema

Exam App nutzt ein sauberes, menschenlesbares JSON-Schema bestehend aus `exam_metadata` und einem `questions`-Array. Prüfungs-IDs (`id`) werden im unveränderlichen **Hybrid-ID-Format** (`exam_[slug]_[zeitstempel/hash]`) gespeichert, um Synchronisationskonflikte zwischen Geräten zu vermeiden.

```json
{
  "exam_metadata": {
    "title": "Computernetzwerke 101",
    "id": "exam_computernetzwerke_101_1785739334",
    "category": "Informatik",
    "description": "Grundlegende Netzwerkprotokolle und -konzepte."
  },
  "questions": [
    {
      "id": "q1",
      "type": "single_choice",
      "difficulty": 2.0,
      "tags": ["web", "protokolle"],
      "content": { "text": "Welcher HTTP-Statuscode bedeutet **Nicht gefunden (Not Found)**?" },
      "options": [
        { "id": 1, "text": "200 OK" },
        { "id": 2, "text": "404 Not Found" },
        { "id": 3, "text": "500 Internal Server Error" }
      ],
      "answer": {
        "correct_ids": [2],
        "explanation": "Der Statuscode `404 Not Found` zeigt an, dass der Server die angeforderte Ressource nicht finden kann."
      }
    }
  ]
}
```

*Vollständige Schema-Spezifikationen finden Sie in **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** und **[schema-guide.md](./public/examples/schema-guide.md)**.*

---

## Technische Architektur

### Tech-Stack

- **Vanilla JS (ES-Module) & HTML5** — Kein Framework-Overhead; modulare Architektur mit tree-shakebaren Imports
- **Custom CSS** — Framework-freies Design-System mit CSS Custom Properties für glassmorphische Dunkel-/Hell-Themes
- **Vite + `vite-plugin-singlefile`** — Bündelt alle JS-, CSS- und Asset-Dateien in eine einzelne `index.html`
- **Browser-`localStorage`** — Der gesamte Status wird clientseitig gespeichert; kein Backend erforderlich
- **GitHub Gist REST API** — Optionale geräteübergreifende Synchronisierung über das private Gist des Nutzers
- **Service Worker (PWA)** — Offline-Unterstützung und Push-Benachrichtigungs-Planung

### Kern-Algorithmen

- **FSRS v4.5** — Free Spaced Repetition Scheduler für gedächtnisangepasste Wiederholungsintervalle
- **Archiv-FSRS-Einfrierung** — Die im Archiv verbrachte Zeit zählt nicht gegen Fragenschwellen; das Wiederherstellen großer Archive überflutet nie Ihre Warteschlange

---

## Lokale Entwicklung

### Voraussetzungen

- Node.js (v18 oder höher)
- npm

### Installation

```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app
npm install
```

### Dev-Server

```bash
npm run dev
```

### Build

```bash
npm run build
```

Der Single-File-Production-Build wird in `dist/index.html` generiert.

---

## CI/CD & Deployment

Jeder Commit auf `main` löst einen GitHub Actions Workflow ([deploy.yml](.github/workflows/deploy.yml)) aus, der einen Vite Single-File-Build ausführt und `dist/index.html` automatisch auf **GitHub Pages** (`gh-pages`-Branch) bereitstellt.

---

## Entwicklung & Danksagungen

Entwickelt mit Unterstützung der KI-Coding-Assistenten Antigravity und Claude.

---

## Lizenz

Bereitgestellt unter der **MIT-Lizenz**. Siehe [LICENSE](LICENSE) für weitere Informationen.

---
Erstellt von [tafirnat](https://github.com/tafirnat)
