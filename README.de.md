# 🎓 Exam App

[![Live Demo](https://img.shields.io/badge/Demo-Online-brightgreen.svg)](https://exam.rifatarslan.dev/)
[![Build & Deploy](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml/badge.svg)](https://github.com/tafirnat/exam-app/actions/workflows/deploy.yml)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Tech Stack](https://img.shields.io/badge/Tech-HTML5%20%7C%20CSS3%20%7C%20JS-orange)

**Ihre persönliche, private Lern-App für Prüfungen & Karteikarten — 100 % offline, kein Account, kein Abo, keine Daten auf fremden Servern.**

Exam App verwandelt jedes Lernmaterial in interaktive Quizze und Karteikarten. Die App merkt sich, welche Fragen Ihnen schwer fallen, und plant Wiederholungen mit dem wissenschaftlich fundierten FSRS-Algorithmus zum richtigen Zeitpunkt ein. Alles bleibt auf Ihrem Gerät (oder synchronisiert optional mit Ihrem eigenen privaten GitHub Gist).

> 💡 Einfach ausprobieren? **[Live-Demo öffnen →](https://exam.rifatarslan.dev/)**

---

## 🌐 Sprachen / Languages / Diller

> ℹ️ **Hinweis**: Die **englische Version** ([`README.md`](./README.md)) ist stets die **primäre Originalquelle**.
>
> 🌐 **In anderen Sprachen lesen:**
> - 🇬🇧 **[English README](./README.md)** *(Originalquelle)*
> - 🇹🇷 **[Türkçe README](./README.tr.md)**

---

## 🤔 Für Wen Ist Diese App?

Exam App wurde für alle entwickelt, die aus eigenem Material lernen:

- 📚 **Studierende**, die sich auf Uni-, Berufs- oder Sprachprüfungen vorbereiten
- 🧠 **Selbstlerner**, die Notizen in Obsidian oder ähnlichen Markdown-Tools führen und diese in Übungstests umwandeln möchten
- 🔁 **Alle**, die eine ablenkungsfreie, datenschutzorientierte Alternative zu Anki, Quizlet & Co. suchen — ohne Abos oder Cloud-Bindung

---

## ✨ Was Kann Die App?

### 📋 7 Fragetypen — Alles in einer App

- **Einzelauswahl** — Standard-Multiple-Choice mit einer richtigen Antwort
- **Mehrfachauswahl** — zwei oder mehr richtige Antworten erforderlich
- **Richtig / Falsch** — binäre Aussageprüfung
- **Kurzantwort** — exakte Antwort eintippen; unterstützt mehrere akzeptierte Varianten und optionale Groß-/Kleinschreibung
- **Lückentext** — Schlüsselwörter inline eingebettet via `{{Lücke}}` oder `{{Kanonisch|Alternativ}}`
- **Karteikarte (Flashcard)** — klassisches Flip-Karten-Format mit Selbstbewertung
- **Lesematerial** — reichhaltige Markdown-Lernnotizen ohne Bewertungsdruck *(ehem. `topic_review`)*

### 🧠 Intelligentes Spaced Repetition (FSRS v4.5)

Schwierige Fragen kommen häufiger. Gut bekannte Fragen werden seltener wiederholt. Der FSRS v4.5-Algorithmus — auch von Anki genutzt — passt Wiederholungsintervalle an Ihr echtes Gedächtnis an, nicht an einen festen Plan.

### ⚡ Tägliche Wiederholung mit einem Tipp

Eine Serien-Karte auf dem Startbildschirm zeigt, wie viele Fragen heute laut FSRS-Zeitplan fällig sind. Einmal tippen — kein Suchen nach Quellen nötig. Wählen Sie zwischen **reiner FSRS-Reihenfolge** (dringendste Frage zuerst) oder **nach Quelle/Ordner gruppiert** für kontextbewusstes Lernen.

### 🔥 Serien- & Kontinuitätsverfolgung

Eine globale Lernserie zählt aufeinanderfolgende aktive Tage. Ein automatischer **Einfrierungspuffer** verzeiht stillschweigend bis zu 2 versäumte Tage pro Woche — ein geschäftiger Tag bricht Ihre Serie nicht.

### 📌 Fokus-Pools

Heften Sie bis zu 3 Quellen oder Ordner als tägliche Fokus-Pools mit einem individuellen Fragenziel an (1–5 pro Pool, max. 15 gesamt). Diese Fragen werden still in Ihre tägliche FSRS-Sitzung eingemischt, wenn sie noch nicht fällig sind — keine erzwungenen Quoten, kein Schuldgefühl.

### 📁 Ordner- & Archivverwaltung

Organisieren Sie Quellen in farblich markierten Ordnerhierarchien. Archivieren Sie einzelne Quellen oder ganze Ordner zum Pausieren — die FSRS-Uhr **friert während der Archivierung ein**, sodass das Wiederherstellen eines großen Archivs Ihre tägliche Warteschlange nie mit überfälligen Karten überflutet.

### 📊 Fortschritts-Analytik

- **Aktivitäts-Heatmap** — GitHub-artiges Tagesraster, farblich nach dominantem Ordner kodiert
- **Wochen- & Monats-Trenddiagramme** — Balkendiagramme zum Lernvolumen über die Zeit
- **Fragenspezifische Analytik** — vollständige Historie, Abrufbarkeits-Score und Schwierigkeit für jede Frage
- **Detaillierte Quellenübersicht** — aktive vs. archivierte Quellen mit Frageanzahl auf einen Blick

### 🔔 Smarte Push-Benachrichtigungen

Opt-in-Erinnerungen, die einmal täglich ausgelöst werden, wenn Karten fällig sind. Die Erlaubnis wird erst nach einer erfolgreichen Lernsitzung angefragt — nie beim ersten Start. Konfigurierbare Ruhezeiten (Standard: 22:00–08:00).

### 🚀 Onboarding-Guide

Eine interaktive Schritt-für-Schritt-Tour führt Sie beim ersten Start (oder jederzeit über das Einstellungsmenü) durch die wichtigsten Funktionen der App.

### 🌐 Mehrsprachige Benutzeroberfläche

Vollständige native Benutzeroberfläche auf **Englisch**, **Türkisch** und **Deutsch**. Integrierte Google-Translate-Unterstützung zur Übersetzung von Frageninhalt in 10+ Sprachen.

### 🤖 KI-Integration

- **Fragensets generieren**: Nutzen Sie den mitgelieferten Prompt ([AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)) mit ChatGPT, Claude oder Gemini, um beliebigen Text in Exam App JSON umzuwandeln.
- **Ordnerspezifische Generierung**: Fügen Sie `"folderId": "folder_..."` zum JSON-Root hinzu, um importierte Fragensets direkt einem Ordner zuzuweisen (Ordner-IDs können über die Schaltfläche `id: ... 📋` im Ordner-Verwaltungsmodal kopiert werden).
- **Sequenzielle Reihenfolge (`keepOrder`)**: Für aufeinander folgende Lesematerialien können Sie `"keepOrder": true` (oder `"preserveOrder": true`) im JSON-Root oder in `exam_metadata` hinzufügen, um das Mischen der Fragen zu verhindern. Dies kann auch jederzeit über die Schaltfläche **Sortiert** in den Quellenaktionen umgeschaltet werden.
- **KI zu einer Frage befragen**: Senden Sie den Kontext einer Frage mit einem Klick in Ihrer aktiven UI-Sprache an ChatGPT, Claude, Gemini, DeepSeek, Kimi usw.

### 🔊 Text-to-Speech

Liest Fragen und Lesekarten mit nativer Browser-Sprachsynthese vor. Einstellbare Geschwindigkeit (×0,7–×1,3), automatische Wiedergabe bei Navigation, schwebende Steuerleiste.

### 🔒 100 % Privat — Null Backend

Keine Server. Kein Account. Kein Abo. Lerndaten werden im `localStorage` des Browsers gespeichert. Optionale geräteübergreifende Synchronisation über Ihren eigenen privaten GitHub Gist.

---

## 📸 Screenshots

<div align="center">

### 🏠 Dashboard & Tägliche Wiederholung

| Hell-Modus | Dunkel-Modus |
| :---: | :---: |
| ![Dashboard Light](./docs/screenshots/dashboard-light.png) | ![Dashboard Dark](./docs/screenshots/dashboard-dark.png) |

### 📝 Prüfungsoberfläche & Ergebnisse

| Aktive Prüfungssitzung | Testergebnisse & Analysen |
| :---: | :---: |
| ![Quiz Interface](./docs/screenshots/quiz-interface.png) | ![Test Results](./docs/screenshots/test-results.png) |

### 📂 Quellverwaltung & Navigation

| Gespeicherte Quellen & Ordner | Seitenmenü & Schnellzugriff |
| :---: | :---: |
| ![Saved Sources](./docs/screenshots/saved-sources.png) | ![Sidebar Menu](./docs/screenshots/sidebar-menu.png) |

### 📊 Detaillierte Fragenanalyse

| Fragedetails & Verlauf |
| :---: |
| ![Question Details](./docs/screenshots/question-details.png) |

</div>

---

## ☁️ Geräteübergreifende Synchronisation (GitHub Gist)

Synchronisieren Sie alle Fragensammlungen, Fortschritte, Statistiken, Notizen und Einstellungen geräteübergreifend — ohne fremde Server:

1. **GitHub-Token erstellen**
   - Rufen Sie die [GitHub-Token-Einstellungen](https://github.com/settings/tokens?type=beta) auf
   - Erstellen Sie ein Fine-Grained-Token mit den Berechtigungen **Gists: Read and Write**
2. **In der App verbinden**
   - Klicken Sie auf das **GitHub ↗**-Symbol im Header, fügen Sie Ihr Token ein und klicken Sie auf **Verbinden & Synchronisieren**
3. **Automatische Hintergrundsynchronisation**
   - Die App erstellt automatisch ein geheimes Gist (`exam_app_backup.json`) und synchronisiert im Hintergrund
   - Archivierte Elemente werden separat synchronisiert (`exam_app_archive.json`) — hält die Routinesynchronisation leicht

### 🔗 Zugehöriges Obsidian-Plugin

Wenn Sie Fragen in Obsidian entwerfen, synchronisiert das Plugin **[Obsidian ExamApp Gist Sync](https://github.com/tafirnat/Obsidian-ExamApp-Sync)** Ihren Vault direkt über Gist mit der Exam App.

---

## 📥 Erste Schritte (für Endnutzer)

Der einfachste Weg, Exam App zu nutzen, ist die **[Live-Demo](https://exam.rifatarslan.dev/)** — keine Installation erforderlich. Die App ist ein vollständig statisches, offline-fähiges PWA, das auch direkt vom Browser aus auf Ihrem Smartphone oder Desktop installiert werden kann.

Um eigene Fragen zu laden, nutzen Sie die Schaltfläche **Quelle hinzufügen** auf dem Startbildschirm, um eine JSON-Datei zu importieren. Das Datenformat finden Sie im [JSON-Schema-Leitfaden](./public/examples/schema-guide.md); Fragensets können automatisch mit dem [KI-Prompt](./AI_AGENT_PROMPT.md) generiert werden.

---

## 🤖 Fragensets mit KI Erstellen

Wandeln Sie beliebige Lehrbücher, Artikel oder Vorlesungsnotizen in Exam App JSON um:

1. Öffnen Sie **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** und kopieren Sie die Anweisungen
2. Fügen Sie den Prompt zusammen mit Ihrem Lernmaterial in ChatGPT, Claude, Gemini oder DeepSeek ein
3. Importieren Sie das generierte JSON direkt in die Exam App

---

## 📊 Datenstruktur & JSON-Schema

Exam App nutzt ein sauberes, menschenlesbares JSON-Schema mit `exam_metadata` und einem `questions`-Array.

```json
{
  "exam_metadata": {
    "title": "Computernetzwerke 101",
    "id": "exam_net_101",
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

*Vollständige Schema-Spezifikationen und KI-Prompt-Anweisungen finden Sie in **[AI_AGENT_PROMPT.md](./AI_AGENT_PROMPT.md)** und **[schema-guide.md](./public/examples/schema-guide.md)**.*

---

## ⚙️ Technische Architektur

### 🛠️ Tech-Stack

- **Vanilla JS (ES-Module) & HTML5** — kein Framework-Overhead; modulare Architektur mit tree-shakeablen Imports
- **Benutzerdefiniertes CSS** — Tailwind-freies Designsystem mit CSS-Variablen für glassmorphisches Dunkel-/Hell-Theming
- **Vite + `vite-plugin-singlefile`** — erzeugt ein einzelnes, eigenständiges `index.html` mit allem JS, CSS und Assets
- **Browser `localStorage`** — gesamter Zustand wird clientseitig gespeichert; kein Backend erforderlich
- **GitHub Gist REST API** — optionale geräteübergreifende Synchronisation über den eigenen privaten Gist
- **Service Worker (PWA)** — Offline-Unterstützung und Push-Benachrichtigungs-Planung

### 🧠 Kernalgorithmen

- **FSRS v4.5** — Free Spaced Repetition Scheduler für gedächtnisoptimierte Wiederholungsintervalle
- **Archiv-FSRS-Einfrierung** — Archivzeit wird nicht auf den Fragen-Zeitplan angerechnet; Archiv-Wiederherstellung überflutet die Tageswarteschlange nie

---

## 📥 Lokale Entwicklung

### Voraussetzungen

- Node.js (v18 oder höher)
- npm

### Installation

```bash
git clone https://github.com/tafirnat/exam-app.git
cd exam-app
npm install
```

### Entwicklungsserver starten

```bash
npm run dev
```

### Einzeldatei-Produktions-Build erstellen

```bash
npm run build
```

Die kompilierte, eigenständige Datei wird unter `dist/index.html` ausgegeben.

---

## 🚀 CI/CD & Automatische Bereitstellung

Jeder Commit auf `main` löst einen GitHub Actions Workflow ([deploy.yml](.github/workflows/deploy.yml)) aus, der einen Vite Single-File-Build ausführt und `dist/index.html` automatisch auf **GitHub Pages** (`gh-pages`-Branch) bereitstellt.

---

## 🤖 Entwicklungstransparenz & Danksagung

Diese Anwendung wurde mit Unterstützung von KI-Coding-Tools (**Antigravity** & **Claude**) konzipiert und entwickelt. Feedback und Fehlermeldungen sind jederzeit willkommen!

---

## 📄 Lizenz

Verteilt unter der **MIT-Lizenz**. Siehe [LICENSE](LICENSE) für Details.

---
Mit ❤️ entwickelt von [tafirnat](https://github.com/tafirnat)
